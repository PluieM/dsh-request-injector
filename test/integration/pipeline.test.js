import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { apply } from '../../lib/index.js'
import { getStore } from '../../lib/context.js'
import { resetFetchBackendForTests } from '../../lib/backend-fetch.js'

// 包装层链表是模块级状态、测试又在单进程内串行跑，必须在每个用例前清空，
// 否则上一个用例遗留的 baseFetch/layer 会让后续包装接到已失效的假 fetch 上
beforeEach(() => resetFetchBackendForTests())

/**
 * 端到端演练宿主真实链路：
 *
 *   llm/stream 监听器（插件）
 *     -> als.run(store, next)  返回迭代器代理
 *     -> 消费者 for await
 *          -> generator body（此刻才真正执行）
 *               -> prepareHeaders 扩展点（后端 A）
 *               -> fetch（后端 B，globalThis.fetch 已被包装）
 *
 * 目的：证明 ALS 在 generator body 内有效、两个后端能协作、同一规则不重复注入。
 */

function makeCtx() {
  const listeners = new Map()
  const logger = { debug() {}, info() {}, warn() {}, error() {} }
  const ctx = {
    logger,
    fiber: { entry: { options: { id: 'dsh-request-injector' } } },
    effect: (factory) => { const d = factory(); return () => typeof d === 'function' && d() },
    inject: (_deps, callback) => {
      callback({
        effect: (factory) => { const d = factory(); return () => typeof d === 'function' && d() },
        get: () => ({ configure: () => () => {} }),
        settings: { configure: () => () => {} },
      })
    },
    on: (event, listener, options) => {
      listeners.set(event, { listener, options })
      return () => listeners.delete(event)
    },
  }
  return { ctx, listeners }
}

const config = {
  enabled: true,
  backend: 'auto',
  onMissingVariable: 'skip',
  debug: false,
  rules: [
    {
      id: 'r1',
      match: { provider: 'newapi-responses' },
      headers: { 'x-session': '${sessionId}', 'x-static': 'v1' },
      order: 0,
    },
  ],
}

/**
 * 模拟宿主 pi-ai 适配器：先走扩展点准备请求头，再发 fetch。
 *
 * 注意顺序：这里先把 globalThis.fetch 换成记录用的假 fetch，**之后**才能 apply 插件，
 * 这样插件包装的是假 fetch（记录点在链路最底层）。反过来会绕过插件包装。
 */
function makeHostCall({ listeners, url = 'https://api.example.com/v1/chat' }) {
  const fetched = []
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    fetched.push({ url: String(input), headers: init?.headers })
    return new Response('ok', { status: 200 })
  }
  const restore = () => { globalThis.fetch = originalFetch }

  // 模拟 adapterStream：async generator，body 延迟执行
  async function* adapterStream(request) {
    const response = await globalThis.fetch(url, {
      method: 'POST',
      headers: prepareHeaders(request),
    })
    await response.text()
    yield { done: true }
  }

  // 模拟 requestHeaders：调用扩展点，再叠加 attributionHeaders
  function prepareHeaders(request) {
    const hook = listeners.get('llm-pi-ai/request-headers')
    const initial = new Headers()
    const prepared = hook ? hook.listener(request, initial, () => initial) : initial
    const final = new Headers(prepared)
    final.set('user-agent', 'DSH/0.2.2-rc.1')
    return final
  }

  function stream(options) {
    const hook = listeners.get('llm/stream')
    const iterator = hook
      ? hook.listener(options, () => adapterStream(options))
      : adapterStream(options)
    return iterator
  }

  return { stream, fetched, restore }
}

test('ALS 上下文在 generator body 内可用（端到端）', async () => {
  const { ctx, listeners } = makeCtx()
  const host = makeHostCall({ listeners })
  apply(ctx, config)

  let seenInBody
  const hook = listeners.get('llm/stream')
  const iterator = hook.listener(
    { sessionId: 'ses-abc', provider: 'newapi-responses', model: 'deepseek-v4.1-flash', purpose: 'chat' },
    async function* () {
      seenInBody = getStore()
      yield 1
    },
  )
  await iterator.next()
  host.restore()

  assert.equal(seenInBody?.sessionId, 'ses-abc')
  assert.equal(seenInBody?.provider, 'newapi-responses')
})

test('两个后端在同一次请求里协作，且同一规则不重复注入', async () => {
  const { ctx, listeners } = makeCtx()
  const host = makeHostCall({ listeners })
  apply(ctx, config)

  const iterator = host.stream({
    sessionId: 'ses-abc',
    provider: 'newapi-responses',
    model: 'deepseek-v4.1-flash',
    purpose: 'chat',
  })
  for await (const _ of iterator) { /* 驱动 generator */ }
  host.restore()

  assert.equal(host.fetched.length, 1)
  const headers = host.fetched[0].headers
  // 后端 A 已注入，后端 B 去重后不再重复写（值相同即视为一致）
  assert.equal(headers.get('x-session'), 'ses-abc')
  assert.equal(headers.get('x-static'), 'v1')
})

test('后端 A 未覆盖的路径（如模型探测）由后端 B 兜底', async () => {
  const { ctx, listeners } = makeCtx()
  const host = makeHostCall({ listeners, url: 'https://api.example.com/v1/models' })
  apply(ctx, config)

  // 直接调 fetch（不经过 llm/stream，等价于 discoverModels 场景）：
  // 没有 ALS 上下文，provider 无法匹配，规则不应命中
  await globalThis.fetch('https://api.example.com/v1/models', { method: 'GET' })
  host.restore()

  const headers = host.fetched[0].headers
  assert.equal(headers, undefined, '无命中规则时不应改写请求头')
})

test('无 ALS 上下文时只有不限 provider/model 的规则（如仅 host）能命中', async () => {
  const { ctx, listeners } = makeCtx()
  const host = makeHostCall({ listeners })
  // 这条限制很重要：discoverModels 不走 llm/stream，没有 provider/model 上下文，
  // 因此带 provider/model 约束的规则即使在 fetch 后端也命中不了；
  // 想在探测请求上也注入，规则只能约束 host（或不约束）。
  apply(ctx, {
    ...config,
    rules: [
      { id: 'by-provider', match: { provider: 'newapi-responses' }, headers: { 'x-by-provider': '1' }, order: 0 },
      { id: 'by-host', match: { host: 'api.example.com' }, headers: { 'x-by-host': '1' }, order: 10 },
    ],
  })

  await globalThis.fetch('https://api.example.com/v1/models', { method: 'GET' })
  host.restore()

  const headers = new Headers(host.fetched[0].headers)
  assert.equal(headers.has('x-by-provider'), false, 'provider 规则需要 llm/stream 上下文')
  assert.equal(headers.get('x-by-host'), '1', 'host 规则不依赖上下文')
})

test('backend: headers 时后端 B 完全放行', async () => {
  const { ctx, listeners } = makeCtx()
  const host = makeHostCall({ listeners })
  apply(ctx, { ...config, backend: 'headers' })

  await globalThis.fetch('https://api.example.com/x', { headers: { 'x-orig': '1' } })
  host.restore()

  const headers = new Headers(host.fetched[0].headers)
  assert.equal(headers.get('x-orig'), '1')
  assert.equal(headers.has('x-session'), false)
})

test('enabled: false 时两个后端都放行', async () => {
  const { ctx, listeners } = makeCtx()
  const host = makeHostCall({ listeners })
  apply(ctx, { ...config, enabled: false })

  const iterator = host.stream({
    sessionId: 'ses-abc',
    provider: 'newapi-responses',
    model: 'm',
  })
  for await (const _ of iterator) { /* 驱动 */ }
  host.restore()

  const headers = new Headers(host.fetched[0].headers)
  assert.equal(headers.has('x-session'), false)
})

test('插件卸载后 globalThis.fetch 还原', () => {
  const { ctx } = makeCtx()
  const original = globalThis.fetch
  apply(ctx, config)
  assert.notEqual(globalThis.fetch, original, 'apply 后 fetch 应被包装')
  // 手动触发 ctx.effect 返回的清理函数
  const { ctx: ctx2 } = makeCtx()
  const disposers = []
  ctx2.effect = (factory) => { const d = factory(); if (typeof d === 'function') disposers.push(d); return () => {} }
  const before = globalThis.fetch
  apply(ctx2, config)
  disposers.forEach((d) => d())
  assert.equal(globalThis.fetch, before, '卸载后应还原为包装前的 fetch')
})
