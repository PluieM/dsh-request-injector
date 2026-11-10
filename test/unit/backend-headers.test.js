import test from 'node:test'
import assert from 'node:assert/strict'
import { registerHeadersBackend } from '../../lib/backend-headers.js'
import { RuleStore } from '../../lib/rules.js'

/** 最小假 ctx */
function fakeCtx() {
  const handlers = new Map()
  return {
    handlers,
    on(name, listener, options) {
      handlers.set(name, { listener, options })
      return () => handlers.delete(name)
    },
    /** 取出注册的监听器（cordis 的真实形状是 {listener, options}） */
    listener(name) {
      return handlers.get(name)?.listener
    },
    /** 取出注册时的选项，用于断言 { global: true } 真的被透传 */
    optionsOf(name) {
      return handlers.get(name)?.options
    },
  }
}

function fakeLog() {
  const records = []
  const push = (level) => (message) => records.push({ level, message })
  return {
    records,
    debug: push('debug'),
    info: push('info'),
    warn: push('warn'),
    error: push('error'),
    errorOnce: (error) => records.push({ level: 'error', message: String(error?.message ?? error) }),
  }
}

/** 造一个可被当作 next() 的下游，记录调用次数 */
function makeNext(behavior = () => new Headers({ downstream: 'yes' })) {
  let calls = 0
  const next = () => {
    calls += 1
    return behavior()
  }
  return { next, calls: () => calls }
}

function setup(config, { log = fakeLog() } = {}) {
  const ctx = fakeCtx()
  const store = new RuleStore(() => config)
  registerHeadersBackend(ctx, { store, log })
  return { handler: ctx.listener('llm-pi-ai/request-headers'), log, ctx }
}

test('监听器以 { global: true } 注册（否则看不到别的 fiber 上的 stream）', () => {
  const { ctx } = setup({ enabled: true, rules: [] })
  assert.deepEqual(ctx.optionsOf('llm-pi-ai/request-headers'), { global: true })
})

const REQUEST = Object.freeze({ provider: 'newapi-responses', model: 'deepseek-v4-flash', baseURL: 'https://api.example.com', sessionId: 'sess-1' })

test('监听器注册在 llm-pi-ai/request-headers 上', () => {
  const { handler } = setup({})
  assert.equal(typeof handler, 'function')
})

test('命中规则时写入头并调用一次 next', () => {
  const { handler } = setup({
    enabled: true,
    backend: 'auto',
    rules: [{ id: 'r1', enabled: true, order: 0, match: {}, headers: { 'x-opencode-session': '${sessionId}' } }],
  })
  const downstream = new Headers()
  const { next, calls } = makeNext(() => { const result = new Headers(downstream); return result })
  handler(REQUEST, downstream, next)
  assert.equal(calls(), 1)
  assert.equal(downstream.get('x-opencode-session'), 'sess-1')
})

test('总开关关闭时不注入但仍调用 next', () => {
  const { handler } = setup({
    enabled: false,
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }],
  })
  const headers = new Headers()
  const { next, calls } = makeNext(() => headers)
  handler(REQUEST, headers, next)
  assert.equal(calls(), 1)
  assert.equal(headers.has('x-a'), false)
})

test("backend='fetch' 时后端 A 不注入", () => {
  const { handler } = setup({
    enabled: true,
    backend: 'fetch',
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }],
  })
  const headers = new Headers()
  const { next } = makeNext(() => headers)
  handler(REQUEST, headers, next)
  assert.equal(headers.has('x-a'), false)
})

test('带 host 的规则在后端 A 不命中', () => {
  const { handler } = setup({
    enabled: true,
    rules: [{ id: 'r1', match: { host: 'api.example.com' }, headers: { 'x-a': '1' } }],
  })
  const headers = new Headers()
  handler(REQUEST, headers, makeNext(() => headers).next)
  assert.equal(headers.has('x-a'), false)
})

test('保留头被跳过并记 warn', () => {
  const log = fakeLog()
  const { handler } = setup({
    enabled: true,
    rules: [{ id: 'r1', match: {}, headers: { host: 'evil.example.com', 'x-ok': 'v' } }],
  }, { log })
  const headers = new Headers()
  handler(REQUEST, headers, makeNext(() => headers).next)
  assert.equal(headers.has('x-ok'), true)
  assert.equal(log.records.some((r) => r.level === 'warn' && r.message.includes('host')), true)
})

test("缺失变量 skip 策略：整条头跳过，其余头照发", () => {
  const { handler } = setup({
    enabled: true,
    onMissingVariable: 'skip',
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '${purpose}', 'x-b': 'fixed' } }],
  })
  const headers = new Headers()
  handler(REQUEST, headers, makeNext(() => headers).next)
  assert.equal(headers.has('x-a'), false)
  assert.equal(headers.get('x-b'), 'fixed')
})

test("缺失变量 empty 策略：头照发，值为空串", () => {
  const { handler } = setup({
    enabled: true,
    onMissingVariable: 'empty',
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '${purpose}' } }],
  })
  const headers = new Headers()
  handler(REQUEST, headers, makeNext(() => headers).next)
  assert.equal(headers.get('x-a'), '')
})

test("缺失变量 error 策略：原样上抛，让本次推理失败", () => {
  const { handler } = setup({
    enabled: true,
    onMissingVariable: 'error',
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '${purpose}' } }],
  })
  const headers = new Headers()
  const { next, calls } = makeNext(() => headers)
  // 用户显式要求「缺变量就失败」，这里不能吞：宿主会把异常包成 REQUEST_HEADERS
  assert.throws(() => handler(REQUEST, headers, next), /missing variables for header "x-a": purpose/)
  assert.equal(calls(), 0)
})

test('多条规则按 order 升序，同头名后者覆盖', () => {
  const { handler } = setup({
    enabled: true,
    rules: [
      { id: 'late', order: 20, match: {}, headers: { 'x-echo': 'late' } },
      { id: 'early', order: 10, match: {}, headers: { 'x-echo': 'early' } },
    ],
  })
  const headers = new Headers()
  handler(REQUEST, headers, makeNext(() => headers).next)
  assert.equal(headers.get('x-echo'), 'late')
})

test('下游抛错时原样上抛，不二次调用 next', () => {
  const log = fakeLog()
  const { handler } = setup({ enabled: true, rules: [] }, { log })
  const headers = new Headers()
  const boom = new Error('downstream boom')
  let calls = 0
  const next = () => { calls += 1; throw boom }
  assert.throws(() => handler(REQUEST, headers, next), /downstream boom/)
  assert.equal(calls, 1)
})

test('注入阶段抛错时吞掉并调用 next（下游未被调用过）', () => {
  const log = fakeLog()
  const { handler } = setup({
    enabled: true,
    onMissingVariable: 'skip',
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }],
  }, { log })
  // 让 headers.set 抛错，模拟注入阶段异常。单头 try/catch 会吃掉它，
  // 但这里连 get 都没有的实现会继续往下走，故只断言不抛错且 next 被调用一次
  const broken = { set() { throw new Error('set failed') } }
  const { next, calls } = makeNext(() => new Headers())
  assert.doesNotThrow(() => handler(REQUEST, broken, next))
  assert.equal(calls(), 1)
  assert.equal(log.records.some((r) => String(r.message).includes('header rejected')), true)
})

test('规则命中时把 header 写进宿主传入的 Headers', async () => {
  const { registerStreamContext } = await import('../../lib/context.js')
  const ctx = fakeCtx()
  const store = new RuleStore(() => ({
    enabled: true,
    rules: [{ id: 'r1', match: {}, headers: { 'x-a': '1' } }],
  }))
  registerHeadersBackend(ctx, { store, log: fakeLog() })
  registerStreamContext(ctx)

  const headersHandler = ctx.listener('llm-pi-ai/request-headers')
  const streamHandler = ctx.listener('llm/stream')
  const headers = new Headers()

  async function* downstream() {
    // 在 generator body 里执行 = 处于 ALS 上下文内（模拟宿主的真实时序）
    headersHandler(REQUEST, headers, () => headers)
    yield null
  }
  const iterator = streamHandler({ sessionId: 'sess-1' }, () => downstream())
  await iterator.next()
  assert.equal(headers.get('x-a'), '1')
})

test('规则全部因保留头被跳过时 next 仍被调用，且不写入任何头', async () => {
  const { registerStreamContext } = await import('../../lib/context.js')
  const ctx = fakeCtx()
  const store = new RuleStore(() => ({
    enabled: true,
    rules: [{ id: 'r1', match: {}, headers: { host: 'evil.example.com' } }],
  }))
  registerHeadersBackend(ctx, { store, log: fakeLog() })
  registerStreamContext(ctx)

  const headersHandler = ctx.listener('llm-pi-ai/request-headers')
  const headers = new Headers()
  let nextCalls = 0
  async function* downstream() {
    headersHandler(REQUEST, headers, () => {
      nextCalls += 1
      return headers
    })
    yield null
  }
  const iterator = ctx.listener('llm/stream')({ sessionId: 'sess-1' }, () => downstream())
  await iterator.next()
  assert.equal(nextCalls, 1)
  assert.equal(headers.has('host'), false)
})
