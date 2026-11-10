import test, { beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { createWrappedFetch, registerFetchBackend, resetFetchBackendForTests } from '../../lib/backend-fetch.js'
import { RuleStore } from '../../lib/rules.js'
import { probe } from '../../lib/probe.js'
import { registerStreamContext, getStore } from '../../lib/context.js'

// 同 pipeline：包装层链表是模块级状态，用例之间必须复位
beforeEach(() => resetFetchBackendForTests())

function fakeLog() {
  const records = []
  const push = (level) => (message) => records.push({ level, message })
  return { records, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error'), errorOnce: (e) => records.push({ level: 'error', message: String(e?.message ?? e) }) }
}

/** 记录调用参数的假 fetch */
function fakeFetch() {
  const calls = []
  const fn = async (input, init) => {
    const headers = new Headers(init?.headers ?? (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined))
    calls.push({ input, init, headers })
    return { ok: true, headers }
  }
  return { fn, calls }
}

const storeOf = (config) => new RuleStore(() => config)

/**
 * 在模拟的 `llm/stream` 上下文里执行一段 fetch 调用。
 *
 * P1 之后，后端 B 在无 ALS 上下文时只允许「显式写了 host」的规则命中
 * （见 lib/rules.js 的 matches）。因此 `match: {}` 这类全通配规则
 * 必须在 stream 上下文内才会生效，本 helper 负责提供该上下文。
 * @param {() => Promise<any>} run 待执行调用
 * @param {object} [options] llm/stream 的请求元数据
 */
async function inStream(run, options = { sessionId: 'sess-test', provider: 'test-provider', model: 'test-model' }) {
  const ctx = {
    handlers: new Map(),
    on(name, listener) {
      this.handlers.set(name, listener)
      return () => this.handlers.delete(name)
    },
  }
  registerStreamContext(ctx)
  let result
  async function* driver() {
    result = await run()
    yield null
  }
  const iterator = ctx.handlers.get('llm/stream')(options, () => driver())
  await iterator.next()
  return result
}

test('命中规则时向 init.headers 写入头', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    backend: 'auto',
    rules: [{ id: 'r1', match: {}, headers: { 'x-test': 'v1' } }],
  }), fakeLog())
  await inStream(() => wrapped('https://api.example.com/v1/chat', { method: 'POST' }))
  assert.equal(fetch.calls[0].headers.get('x-test'), 'v1')
})

test('host 变量从 URL 解析', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    rules: [{ id: 'r1', match: { host: 'api.example.com' }, headers: { 'x-host': '${host}' } }],
  }), fakeLog())
  await wrapped('https://api.example.com/v1/chat')
  assert.equal(fetch.calls[0].headers.get('x-host'), 'api.example.com')
})

test('host 不匹配时透传，不加头', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    rules: [{ id: 'r1', match: { host: 'other.example.com' }, headers: { 'x-a': '1' } }],
  }), fakeLog())
  await wrapped('https://api.example.com/v1/chat')
  assert.equal(fetch.calls[0].headers.has('x-a'), false)
})

test('总开关关闭时透传', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({ enabled: false, rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }] }), fakeLog())
  await inStream(() => wrapped('https://api.example.com/x'))
  assert.equal(fetch.calls[0].headers.has('x-a'), false)
})

test("backend='headers' 时后端 B 不注入", async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({ enabled: true, backend: 'headers', rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }] }), fakeLog())
  await inStream(() => wrapped('https://api.example.com/x'))
  assert.equal(fetch.calls[0].headers.has('x-a'), false)
})

test('保留头被跳过', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    rules: [{ id: 'r1', match: {}, headers: { host: 'evil', 'x-ok': '1' } }],
  }), fakeLog())
  await inStream(() => wrapped('https://api.example.com/x'))
  assert.equal(fetch.calls[0].headers.has('x-ok'), true)
  // host 头由 fetch/undici 按 URL 计算，插件不写它（写了也会被覆盖或被拒）
  assert.equal(fetch.calls[0].headers.has('host'), false)
})

test('复制 init 而不原地修改调用方对象', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({ enabled: true, rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }] }), fakeLog())
  const init = { method: 'POST', headers: { existing: 'yes' } }
  await inStream(() => wrapped('https://api.example.com/x', init))
  assert.equal(init.headers.existing, 'yes')
  assert.equal(init.headers['x-a'], undefined)
  assert.equal(fetch.calls[0].headers.get('existing'), 'yes')
  assert.equal(fetch.calls[0].headers.get('x-a'), '1')
})

test('传入 Request 时保留其原有头', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({ enabled: true, rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }] }), fakeLog())
  const request = new Request('https://api.example.com/x', { headers: { 'x-original': 'keep' } })
  await inStream(() => wrapped(request))
  assert.equal(fetch.calls[0].headers.get('x-original'), 'keep')
  assert.equal(fetch.calls[0].headers.get('x-a'), '1')
})

test('缺变量 skip 策略：跳过该头', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    onMissingVariable: 'skip',
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '${purpose}', 'x-b': 'ok' } }],
  }), fakeLog())
  await inStream(() => wrapped('https://api.example.com/x'))
  assert.equal(fetch.calls[0].headers.has('x-a'), false)
  assert.equal(fetch.calls[0].headers.get('x-b'), 'ok')
})

test('缺变量 empty 策略：头值为空串', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    onMissingVariable: 'empty',
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '${purpose}' } }],
  }), fakeLog())
  await inStream(() => wrapped('https://api.example.com/x'))
  assert.equal(fetch.calls[0].headers.get('x-a'), '')
})

test('非法 / 相对 URL：不抛错，不带 host 的规则仍生效', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    rules: [
      { id: 'r1', match: {}, headers: { 'x-a': '1' } },
      { id: 'r2', match: { host: 'api.example.com' }, headers: { 'x-host-rule': '1' } },
    ],
  }), fakeLog())
  await inStream(() => wrapped('not-a-url', {}))
  // 相对 / 非法 URL 解析不出 host，因此 host 规则不命中；无 host 条件的规则照常生效
  assert.equal(fetch.calls[0].headers.get('x-a'), '1')
  assert.equal(fetch.calls[0].headers.has('x-host-rule'), false)
})

test("缺变量 error 策略：原样上抛，请求失败", async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    onMissingVariable: 'error',
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '${nope}' } }],
  }), fakeLog())
  // 用户显式要求「缺变量就失败」，不能吞掉后照常发请求
  await assert.rejects(() => inStream(() => wrapped('https://api.example.com/x')), /missing variables for header "x-a": nope/)
  assert.equal(fetch.calls.length, 0, '失败时不应发出请求')
})

test('注入阶段意外抛错时原样透传且只调用一次原 fetch', async () => {
  const log = fakeLog()
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, {
    config: () => ({ enabled: true, onMissingVariable: 'skip', rules: [{ id: 'r1', match: {} }] }),
    // 让匹配阶段就抛错：模拟插件自身的意外 bug（非 MissingVariableError）
    match: () => { throw new Error('boom') },
  }, log)
  const result = await inStream(() => wrapped('https://api.example.com/x'))
  assert.equal(result.ok, true)
  assert.equal(fetch.calls.length, 1)
  assert.equal(fetch.calls[0].init, undefined, '透传时应保持原始 init')
  assert.equal(log.records.some((r) => r.level === 'error'), true)
})

test('registerFetchBackend 包装并还原 globalThis.fetch', async () => {
  const original = globalThis.fetch
  const fetch = fakeFetch()
  globalThis.fetch = fetch.fn
  const cleanup = registerFetchBackend({ store: storeOf({ enabled: true, rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }] }), log: fakeLog() })
  assert.notEqual(globalThis.fetch, original)
  await inStream(() => globalThis.fetch('https://api.example.com/x'))
  assert.equal(fetch.calls[0].headers.get('x-a'), '1')
  cleanup()
  assert.equal(globalThis.fetch, fetch.fn)
  globalThis.fetch = original
})

test('cleanup 只在仍是自己那次包装时还原', () => {
  const original = globalThis.fetch
  const fetch = fakeFetch()
  globalThis.fetch = fetch.fn
  const cleanup = registerFetchBackend({ store: storeOf({ enabled: true, rules: [] }), log: fakeLog() })
  const someoneElse = async () => ({})
  globalThis.fetch = someoneElse
  cleanup()
  assert.equal(globalThis.fetch, someoneElse, '别人的包装不该被还原掉')
  globalThis.fetch = original
})

test('多实例链式包装：两个都卸载后 globalThis.fetch 回到原始实现（I1 回归）', () => {
  const original = globalThis.fetch
  const base = async () => ({ ok: true })
  globalThis.fetch = base

  const storeA = storeOf({ enabled: true, rules: [{ id: 'a', match: {}, headers: { 'x-a': '1' } }] })
  const storeB = storeOf({ enabled: true, rules: [{ id: 'b', match: {}, headers: { 'x-b': '1' } }] })
  const disposeA = registerFetchBackend({ store: storeA, log: fakeLog() })
  const disposeB = registerFetchBackend({ store: storeB, log: fakeLog() })

  // 乱序卸载：先卸里面那个，再卸外面那个
  disposeB()
  disposeA()
  assert.equal(globalThis.fetch, base, '全部卸载后必须回到原始 fetch，不能残留已释放的包装')
  globalThis.fetch = original
})

test('多实例链式包装：卸载内层后外层仍能工作', async () => {
  const original = globalThis.fetch
  const fetch = fakeFetch()
  globalThis.fetch = fetch.fn

  const disposeA = registerFetchBackend({ store: storeOf({ enabled: true, rules: [{ id: 'a', match: {}, headers: { 'x-a': '1' } }] }), log: fakeLog() })
  const disposeB = registerFetchBackend({ store: storeOf({ enabled: true, rules: [{ id: 'b', match: {}, headers: { 'x-b': '1' } }] }), log: fakeLog() })

  disposeA() // 内层先走
  await inStream(() => globalThis.fetch('https://api.example.com/x'))
  assert.equal(fetch.calls.length, 1)
  assert.equal(fetch.calls[0].headers.get('x-b'), '1', '外层包装应仍然生效')

  disposeB()
  globalThis.fetch = original
})

test('扩展点从未触发时给出一条提示，且只给一次', async () => {
  const original = probe.headersBackendFired
  const warned = probe.warnedMissingHeadersHook
  probe.headersBackendFired = false
  probe.warnedMissingHeadersHook = false

  const log = fakeLog()
  const wrapped = createWrappedFetch(fakeFetch().fn, storeOf({
    enabled: true,
    backend: 'auto',
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }],
  }), log)
  await inStream(() => wrapped('https://api.example.com/x'))
  await inStream(() => wrapped('https://api.example.com/x'))

  // 默认 profile 只装 llm-deepseek 时后端 A 本就不该触发，所以提示降为 debug 级
  const hints = log.records.filter((r) => r.level === 'debug' && String(r.message).includes('request-headers'))
  assert.equal(hints.length, 1, '每进程最多提示一次')

  probe.headersBackendFired = original
  probe.warnedMissingHeadersHook = warned
})

test('扩展点已触发过时不再提示', async () => {
  const original = probe.headersBackendFired
  const warned = probe.warnedMissingHeadersHook
  probe.headersBackendFired = true
  probe.warnedMissingHeadersHook = false

  const log = fakeLog()
  const wrapped = createWrappedFetch(fakeFetch().fn, storeOf({
    enabled: true,
    backend: 'auto',
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }],
  }), log)
  await inStream(() => wrapped('https://api.example.com/x'))
  assert.equal(log.records.some((r) => String(r.message).includes('request-headers')), false)

  probe.headersBackendFired = original
  probe.warnedMissingHeadersHook = warned
})

test('保留头会被跳过并记警告', async () => {
  const fetch = fakeFetch()
  const log = fakeLog()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    rules: [{ id: 'r1', match: {}, headers: { authorization: 'Bearer x', 'x-a': '1' } }],
  }), log)
  await inStream(() => wrapped('https://api.example.com/x'))
  assert.equal(fetch.calls[0].headers.has('authorization'), false)
  assert.equal(fetch.calls[0].headers.get('x-a'), '1', '一个保留头不能影响同规则的其他头')
  assert.equal(log.records.some((r) => String(r.message).includes('reserved header skipped')), true)
})

test('非法头值只跳过该头，同请求后续规则仍生效（C1 回归）', async () => {
  const fetch = fakeFetch()
  const log = fakeLog()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    rules: [
      { id: 'r1', match: {}, headers: { 'x-first': 'a', 'x-bad': '中文', 'x-after': 'b' } },
      { id: 'r2', match: {}, headers: { 'x-second-rule': 'c' } },
    ],
  }), log)
  await inStream(() => wrapped('https://api.example.com/x'))
  const headers = fetch.calls[0].headers
  assert.equal(headers.get('x-first'), 'a')
  assert.equal(headers.has('x-bad'), false)
  assert.equal(headers.get('x-after'), 'b', '同一规则里排在坏头之后的头不能被牵连')
  assert.equal(headers.get('x-second-rule'), 'c', '后续规则不能被牵连')
})

test('无 llm/stream 上下文时，全通配规则不注入（H1 回归）', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    rules: [{ id: 'r1', match: {}, headers: { 'x-secret': 'sk-live' } }],
  }), fakeLog())
  await wrapped('https://third-party.example/collect')
  assert.equal(fetch.calls[0].headers.has('x-secret'), false, '没有 stream 上下文时不得把密钥头注入任意请求')
})

test('无 llm/stream 上下文时，显式写了 host 的规则仍注入（模型探测路径）', async () => {
  const fetch = fakeFetch()
  const wrapped = createWrappedFetch(fetch.fn, storeOf({
    enabled: true,
    rules: [{ id: 'r1', match: { host: 'api.example.com' }, headers: { 'x-a': '1' } }],
  }), fakeLog())
  await wrapped('https://api.example.com/models')
  assert.equal(fetch.calls[0].headers.get('x-a'), '1')
})

test('原 fetch 自身失败时不会二次调用（回归：catch 里的降级重发）', async () => {
  let calls = 0
  const original = async () => {
    calls += 1
    throw new Error('network down')
  }
  const wrapped = createWrappedFetch(original, storeOf({
    enabled: true,
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }],
  }), fakeLog())
  // 异步 reject 不会被外层同步 try/catch 捕获，因此只会调用一次
  await assert.rejects(() => inStream(() => wrapped('https://api.example.com/x')), /network down/)
  assert.equal(calls, 1, '原 fetch 的异步失败不应触发降级重发')
})

test('注入中途抛错时退回原始 init，只调用一次原 fetch', async () => {
  const fetch = fakeFetch()
  const log = fakeLog()
  const store = {
    config: () => ({ enabled: true, onMissingVariable: 'skip', rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }] }),
    // 拿到规则后，在渲染头时抛错
    match: () => [{ id: 'r1', headers: { 'x-a': '1' } }],
  }
  const wrapped = createWrappedFetch(fetch.fn, store, log)
  // 用 getter 制造渲染阶段的意外异常
  Object.defineProperty(store, 'match', { value: () => [{ id: 'r1', get headers() { throw new Error('boom') } }] })
  await inStream(() => wrapped('https://api.example.com/x', { method: 'POST' }))
  assert.equal(fetch.calls.length, 1)
  assert.equal(fetch.calls[0].init.method, 'POST', '降级时应退回调用方原始 init')
  assert.equal(fetch.calls[0].headers.has('x-a'), false)
  assert.equal(log.records.some((r) => r.level === 'error'), true)
})
