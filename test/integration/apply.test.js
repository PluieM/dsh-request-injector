import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, name, inject, Config } from '../../lib/index.js'

/** 最小 ctx 替身：记录 effect 标签、inject 依赖与事件监听。 */
function makeCtx() {
  const effects = []
  const injections = []
  const listeners = new Map()
  const logger = { debug() {}, info() {}, warn() {}, error() {} }
  const ctx = {
    logger,
    fiber: { entry: { options: { id: 'dsh-request-injector' } } },
    effect(factory, label) {
      effects.push(label)
      const disposer = factory()
      return () => { if (typeof disposer === 'function') disposer() }
    },
    inject(deps, callback) {
      injections.push(deps)
      const services = {}
      for (const dep of deps) {
        services[dep] = dep === 'settings' ? { configure() { return () => {} } } : {}
      }
      const child = {
        effect: (factory, label) => ctx.effect(factory, label),
        get: (key) => services[key],
        settings: services.settings,
      }
      callback(child)
    },
    on(event, listener, options) {
      listeners.set(event, { listener, options })
      return () => listeners.delete(event)
    },
    get(event) {
      return undefined
    },
  }
  return { ctx, effects, injections, listeners }
}

const baseConfig = {
  enabled: true,
  backend: 'auto',
  rules: [],
  onMissingVariable: 'skip',
  debug: false,
}

test('模块以包名导出 name，且不声明 inject 依赖', () => {
  assert.equal(name, 'dsh-request-injector')
  assert.deepEqual(inject, [])
  assert.equal(typeof apply, 'function')
})

test('导出 Config 供宿主在激活时校验行配置', () => {
  assert.ok(Config, '必须有命名导出 Config')
  // 整节 volatile：宿主传给 apply 的是带 .get() 的 live 引用
  const resolved = Config(baseConfig)
  assert.equal(typeof resolved.get, 'function')
  assert.equal(resolved.get().backend, 'auto')
  assert.equal(resolved.get().rules.length, 0)
})

test('非法配置在激活期抛错（宿主据此拒绝加载）', () => {
  assert.throws(() => Config({ ...baseConfig, backend: 'bogus' }), /backend/)
})

test('apply 注册 stream / headers / fetch 三条 effect', () => {
  const { ctx, effects } = makeCtx()
  apply(ctx, baseConfig)
  assert.ok(effects.includes('request-injector stream context'))
  assert.ok(effects.includes('request-injector headers backend'))
  assert.ok(effects.includes('request-injector fetch backend'))
})

test('apply 通过 inject 关闭 settings 自动表单', () => {
  const { ctx, injections, effects } = makeCtx()
  apply(ctx, baseConfig)
  assert.deepEqual(injections, [['settings']])
  assert.ok(effects.includes('request-injector settings presentation'))
})

test('apply 注册两个扩展点监听', () => {
  const { ctx, listeners } = makeCtx()
  apply(ctx, baseConfig)
  const headersHook = listeners.get('llm-pi-ai/request-headers')
  const streamHook = listeners.get('llm/stream')
  assert.ok(headersHook, '必须监听 llm-pi-ai/request-headers')
  assert.deepEqual(headersHook.options, { global: true })
  assert.ok(streamHook, '必须监听 llm/stream')
  assert.deepEqual(streamHook.options, { global: true })
})

test('apply 接受 volatile 的 config.get() 读取方式', () => {
  const { ctx } = makeCtx()
  // 宿主对整节 volatile 的配置传入的是带 .get() 的 live 引用
  const live = { get: () => baseConfig }
  assert.doesNotThrow(() => apply(ctx, live))
})

test('apply 在 config 缺字段时用默认值兜底（profile patch 整值替换场景）', () => {
  const { ctx, listeners } = makeCtx()
  apply(ctx, {})
  const headersHook = listeners.get('llm-pi-ai/request-headers')
  const headers = new Headers()
  const result = headersHook.listener(
    { provider: 'p', model: 'm', baseURL: 'https://api.example.com' },
    headers,
    () => headers,
  )
  assert.equal(result, headers, '空配置下仍应正常放行')
})

test('生效配置会被规则匹配使用（端到端：配置 -> 注入头）', () => {
  const { ctx, listeners } = makeCtx()
  apply(ctx, {
    ...baseConfig,
    rules: [{ id: 'r1', match: { provider: 'newapi-responses' }, headers: { 'x-api-version': '2026-11' } }],
  })
  const headersHook = listeners.get('llm-pi-ai/request-headers')
  const headers = new Headers()
  headersHook.listener(
    { provider: 'newapi-responses', model: 'deepseek-v4.1-flash', baseURL: 'https://napi.example.com/v1' },
    headers,
    () => headers,
  )
  assert.equal(headers.get('x-api-version'), '2026-11')
})

test('不匹配的 provider 不注入', () => {
  const { ctx, listeners } = makeCtx()
  apply(ctx, {
    ...baseConfig,
    rules: [{ id: 'r1', match: { provider: 'other' }, headers: { 'x-a': '1' } }],
  })
  const headers = new Headers()
  listeners.get('llm-pi-ai/request-headers').listener(
    { provider: 'newapi-responses', model: 'm', baseURL: 'https://x.example.com' },
    headers,
    () => headers,
  )
  assert.equal(headers.has('x-a'), false)
})
