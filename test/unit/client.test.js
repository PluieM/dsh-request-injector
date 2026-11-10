import test from 'node:test'
import assert from 'node:assert/strict'

// 客户端 bundle 是惰性 CJS：(function(root){ root.__ModuleLoader__.load({id, factory}) })(window)
// 因此先在全局搭一个最小的 window 与 React 平台模块，再动态 import 去触发注册。

let captured = null
globalThis.window = {
  __ModuleLoader__: {
    load: (entry) => { captured = entry },
  },
}

/** 足够让 bundle 里的 React.createElement 调用链跑通的最小替身 */
const ReactShim = {
  createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children } }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useRef: (initial) => ({ current: initial }),
  useMemo: (factory) => factory(),
}

await import('../../lib/client.js')

const bundle = captured.factory((name) => {
  if (name === 'react') return ReactShim
  throw new Error(`unexpected require: ${name}`)
})

test('bundle 以包名注册', () => {
  assert.equal(captured.id, 'dsh-request-injector')
  assert.equal(typeof captured.factory, 'function')
})

test('导出的 inject 声明 slots / locale / configForms', () => {
  assert.deepEqual(bundle.inject, ['slots', 'locale', 'configForms'])
  assert.equal(typeof bundle.apply, 'function')
})

/** 最小 ctx 替身：configForms 可省略，用于覆盖降级路径 */
function makeCtx(options = {}) {
  const calls = { locale: [], slots: [], effects: [], namespaces: [] }
  const controller = {
    getSnapshot: () => ({ status: 'loading', value: undefined, writable: false }),
    subscribe: () => () => {},
    mutate: (ops, revision) => Promise.resolve(true),
  }
  const registrations = () => calls.slots.filter((entry) => typeof entry === 'object')
  const ctx = {
    effect: (factory, label) => { calls.effects.push(label); return factory() },
    locale: {
      register: (ns, dict) => { calls.locale.push({ ns, dict }); return () => {} },
    },
    slots: {
      inject: (name, factory) => { calls.slots.push(name); factory() },
      register: (options, component) => { calls.slots.push({ options, component }); return () => {} },
    },
  }
  if (options.configForms !== false) {
    ctx.configForms = {
      get: (namespace) => { calls.namespaces.push(namespace); return controller },
    }
  }
  return { ctx, calls, controller, registrations }
}

test('apply 注册 locale 与 plugins.row.config 槽位', () => {
  const { ctx, calls, registrations } = makeCtx()
  bundle.apply(ctx)

  assert.equal(calls.locale.length, 1)
  assert.equal(calls.locale[0].ns, 'dsh-request-injector')
  assert.ok(calls.locale[0].dict.zh && calls.locale[0].dict.en)

  assert.ok(calls.slots.includes('plugins.row.config'))
  const registration = registrations().find((entry) => entry.options.name === 'plugins.row.config')
  // 行 id 与包名相同：行详情页用行 id 作为 settings namespace 查表单
  assert.equal(registration.options.key, 'dsh-request-injector#dsh-request-injector')
  assert.equal(registration.options.locale, 'dsh-request-injector')
  assert.equal(typeof registration.component, 'function')
})

test('apply 在设置面板注册直达分区，并复用同一个配置 namespace', () => {
  const { ctx, calls, controller, registrations } = makeCtx()
  bundle.apply(ctx)

  assert.ok(calls.slots.includes('settings.section'))
  const section = registrations().find((entry) => entry.options.name === 'settings.section')
  assert.equal(section.options.id, 'dsh-request-injector')
  assert.equal(section.options.locale, 'dsh-request-injector')
  // 与行详情页共用 ROW_ID 作为 namespace，两边读写同一份配置
  assert.deepEqual(calls.namespaces, ['dsh-request-injector'])
  // label 是函数，供宿主按当前语言解析
  assert.equal(typeof section.options.label, 'function')
  assert.equal(section.options.label(), '请求头注入')

  // inject() 把控制器暴露为 hooks.configForm（宿主映射成 useConfigForm prop），
  // 并原样透传 mutate
  const injection = section.options.inject()
  assert.equal(injection.hooks.configForm, controller)
  assert.equal(injection.mutate({}, 1).constructor, Promise)
})

test('缺少 configForms 服务时跳过设置分区，不影响行详情页', () => {
  const { ctx, calls } = makeCtx({ configForms: false })
  assert.doesNotThrow(() => bundle.apply(ctx))
  assert.ok(!calls.slots.includes('settings.section'))
  assert.ok(calls.slots.includes('plugins.row.config'))
})

test('apply 在缺少 slots / locale 服务时安全退出', () => {
  assert.doesNotThrow(() => bundle.apply({ effect: (f) => f(), locale: undefined, slots: undefined }))
  assert.doesNotThrow(() => bundle.apply({}))
})

const { normalizeDraft, isReserved, HEADER_NAME } = bundle.__internals

test('normalizeDraft 补齐默认值并分配唯一 id', () => {
  const draft = normalizeDraft({
    rules: [
      { headers: { 'x-a': '1', 'x-b': '2' } },
      { id: 'rule-1', headers: {} },
    ],
  })
  assert.equal(draft.enabled, true)
  assert.equal(draft.backend, 'auto')
  assert.equal(draft.onMissingVariable, 'skip')
  assert.equal(draft.rules[0].id, 'rule-1')
  // 第二条与第一条撞 id，必须被改写成唯一值
  assert.notEqual(draft.rules[1].id, 'rule-1')
  assert.equal(draft.rules[0].order, 0)
  assert.equal(draft.rules[1].order, 10)
})

test('normalizeDraft 把请求头字典转成有序数组', () => {
  const draft = normalizeDraft({ rules: [{ headers: { 'x-a': '1' } }] })
  assert.deepEqual(draft.rules[0].headers, [{ name: 'x-a', value: '1' }])
})

test('normalizeDraft 清理非法输入', () => {
  const draft = normalizeDraft({ backend: 'bogus', onMissingVariable: 'nope', rules: [null, 3, {}] })
  assert.equal(draft.backend, 'auto')
  assert.equal(draft.onMissingVariable, 'skip')
  assert.equal(draft.rules.length, 1, '非对象规则被丢弃')
  assert.deepEqual(draft.rules[0].match, { provider: '', model: '', host: '' })
})

test('isReserved 与宿主侧规则一致', () => {
  assert.equal(isReserved('User-Agent'), true)
  assert.equal(isReserved('authorization'), true)
  assert.equal(isReserved('x-dsh-anything'), true)
  assert.equal(isReserved('x-custom'), false)
  assert.equal(isReserved(''), false)
})

test('HEADER_NAME 接受合法头名并拒绝非法字符', () => {
  assert.equal(HEADER_NAME.test('x-opencode-session'), true)
  assert.equal(HEADER_NAME.test('bad name'), false)
  assert.equal(HEADER_NAME.test('bad:name'), false)
})

const { toConfig, headerProblems, sameDraft, cloneDraft, formUsable } = bundle.__internals

test('toConfig 把有序数组折回字典并跳过空名称', () => {
  const config = toConfig({
    enabled: false,
    backend: 'fetch',
    onMissingVariable: 'error',
    debug: true,
    rules: [{
      id: 'r1',
      enabled: true,
      comment: 'c',
      match: { provider: 'p', model: 'm', host: 'h' },
      headers: [
        { name: 'x-a', value: '1' },
        { name: '  ', value: 'skipped' },
        { name: ' x-b ', value: '2' },
      ],
      order: 5,
    }],
  })
  assert.deepEqual(config, {
    enabled: false,
    backend: 'fetch',
    onMissingVariable: 'error',
    debug: true,
    rules: [{
      id: 'r1',
      enabled: true,
      comment: 'c',
      match: { provider: 'p', model: 'm', host: 'h' },
      headers: { 'x-a': '1', 'x-b': '2' },
      order: 5,
    }],
  })
})

test('toConfig 对同名请求头取后者（与下游 Headers.set 语义一致）', () => {
  const config = toConfig({
    rules: [{ id: 'r1', headers: [{ name: 'x-a', value: '1' }, { name: 'x-a', value: '2' }] }],
  })
  assert.equal(config.rules[0].headers['x-a'], '2')
})

test('headerProblems 报出非法 / 保留 / 重复三类问题', () => {
  const problems = headerProblems({
    headers: [
      { name: 'bad name', value: '' },
      { name: 'authorization', value: '' },
      { name: 'x-dup', value: '1' },
      { name: 'X-Dup', value: '2' },
      { name: '', value: 'ignored' },
    ],
  })
  const reasons = problems.map((p) => `${p.name}:${p.reason}`).sort()
  // 同名请求头只在后出现的那条上报 duplicate：先出现的那条本身是合法的
  assert.deepEqual(reasons, [
    'X-Dup:duplicate',
    'authorization:reserved',
    'bad name:invalid',
  ])
})

test('sameDraft 做结构比较而非引用比较', () => {
  const draft = normalizeDraft({ rules: [{ headers: { 'x-a': '1' } }] })
  const copy = cloneDraft(draft)
  assert.equal(sameDraft(draft, copy), true)
  copy.rules[0].headers[0].value = '2'
  assert.equal(sameDraft(draft, copy), false)
})

test('cloneDraft 是深拷贝，改副本不影响原件', () => {
  const draft = normalizeDraft({ rules: [{ match: { provider: 'p' }, headers: { 'x-a': '1' } }] })
  const copy = cloneDraft(draft)
  copy.rules[0].match.provider = 'changed'
  copy.rules[0].headers[0].value = 'changed'
  assert.equal(draft.rules[0].match.provider, 'p')
  assert.equal(draft.rules[0].headers[0].value, '1')
})

test('formUsable 要求 mutate 与 state 同时存在', () => {
  assert.equal(formUsable(undefined), false)
  assert.equal(formUsable({ state: {} }), false)
  assert.equal(formUsable({ mutate: () => {}, state: {} }), true)
})
