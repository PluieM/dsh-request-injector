import test from 'node:test'
import assert from 'node:assert/strict'
import { registerStreamContext, getStore } from '../../lib/context.js'

/** 最小假 ctx：只提供 ctx.on */
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

/** 造一个 async generator 作为下游 */
async function* downstream() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  yield 'a'
  yield 'b'
}

/** 模拟宿主：waterfall 里调用监听器，拿回迭代器 */
function runThrough(handler, options = {}) {
  return handler(options, () => downstream())
}

test('监听器注册在 llm/stream 上', () => {
  const ctx = fakeCtx()
  registerStreamContext(ctx)
  assert.equal(ctx.handlers.has('llm/stream'), true)
})

test('监听器以 { global: true } 注册（否则拿不到别的 fiber 上的 stream）', () => {
  const ctx = fakeCtx()
  registerStreamContext(ctx)
  assert.deepEqual(ctx.optionsOf('llm/stream'), { global: true })
})

test('监听器返回可 for-await 的迭代器', async () => {
  const ctx = fakeCtx()
  registerStreamContext(ctx)
  const iterator = runThrough(ctx.listener('llm/stream'), { sessionId: 's1' })
  const seen = []
  for await (const chunk of iterator) seen.push(chunk)
  assert.deepEqual(seen, ['a', 'b'])
})

test('迭代器在消费时仍能取到 ALS 上下文（核心断言）', async () => {
  const ctx = fakeCtx()
  registerStreamContext(ctx)
  const iterator = runThrough(ctx.listener('llm/stream'), {
    sessionId: 's1',
    provider: 'p1',
    model: 'm1',
    purpose: 'chat',
  })
  assert.equal(getStore(), undefined, '监听器返回时上下文应已退出')
  await iterator.next()
  // next() 返回后上下文同样退出，说明只在执行期间可见
  assert.equal(getStore(), undefined)
})

test('generator body 内的 getStore 能拿到完整上下文', async () => {
  const ctx = fakeCtx()
  registerStreamContext(ctx)

  const observed = []
  async function* capturing() {
    await new Promise((resolve) => setTimeout(resolve, 0))
    observed.push(getStore())
    yield 1
    await new Promise((resolve) => setTimeout(resolve, 0))
    observed.push(getStore())
    yield 2
  }

  const iterator = ctx.listener('llm/stream')(
    { sessionId: 's1', provider: 'p1', model: 'm1', purpose: 'chat' },
    () => capturing(),
  )
  for await (const _ of iterator) { /* 消费完 */ }

  assert.equal(observed.length, 2)
  assert.equal(observed[0].sessionId, 's1')
  assert.equal(observed[0].provider, 'p1')
  assert.equal(observed[0].model, 'm1')
  assert.equal(observed[0].purpose, 'chat')
  assert.equal(observed[1].sessionId, 's1')
})

test('嵌套 await 之后的 fetch 仍在上下文内（模拟真实延迟执行）', async () => {
  const ctx = fakeCtx()
  registerStreamContext(ctx)

  async function helper1() {
    await new Promise((resolve) => setTimeout(resolve, 1))
    return helper2()
  }
  async function helper2() {
    await new Promise((resolve) => setTimeout(resolve, 1))
    return getStore()?.sessionId
  }
  async function* deep() {
    yield await helper1()
  }

  const iterator = ctx.listener('llm/stream')({ sessionId: 'deep-session' }, () => deep())
  const first = await iterator.next()
  assert.equal(first.value, 'deep-session')
})

test('store 是每个请求独立的对象', async () => {
  const ctx = fakeCtx()
  registerStreamContext(ctx)
  const handler = ctx.listener('llm/stream')

  const stores = []
  async function* capture() {
    stores.push(getStore())
    yield 1
  }
  const a = handler({ sessionId: 'a' }, () => capture())
  const b = handler({ sessionId: 'b' }, () => capture())
  await a.next()
  await b.next()
  assert.notEqual(stores[0], stores[1])
  assert.equal(stores[0].sessionId, 'a')
  assert.equal(stores[1].sessionId, 'b')
})

test('return() 在上下文内执行', async () => {
  const ctx = fakeCtx()
  registerStreamContext(ctx)
  const seen = []
  async function* gen() {
    try {
      yield 1
      yield 2
    } finally {
      seen.push(getStore()?.sessionId)
    }
  }
  const iterator = ctx.listener('llm/stream')({ sessionId: 'ret-1' }, () => gen())
  await iterator.next()
  await iterator.return()
  assert.deepEqual(seen, ['ret-1'])
})

test('下游无 return/throw 时给出安全兜底', async () => {
  const ctx = fakeCtx()
  registerStreamContext(ctx)
  const iterator = ctx.listener('llm/stream')({}, () => ({ next: async () => ({ done: true, value: undefined }) }))
  assert.deepEqual(await iterator.return(), { done: true, value: undefined })
  await assert.rejects(() => iterator.throw(new Error('boom')), /boom/)
})

test('选项缺失时不抛错', async () => {
  const ctx = fakeCtx()
  registerStreamContext(ctx)
  const iterator = ctx.listener('llm/stream')(undefined, () => ({ next: async () => ({ done: true }) }))
  await iterator.next()
})
