import test from 'node:test'
import assert from 'node:assert/strict'

/**
 * 表单渲染冒烟测试。
 *
 * 目标不是校验 DOM 结构，而是让 React 组件体的每一条路径真正执行一遍：
 * 缺少变量、拼错 prop、访问 undefined 字段这类问题只有在渲染时才暴露。
 *
 * 这里实现一个极简 hooks 运行时：支持 useState / useEffect / useRef / useMemo，
 * 并把函数组件递归展开。组件在 useEffect 里初始化草稿，因此需要
 * 「渲染 → 执行 effects → 再渲染」两趟才能拿到完整表单。
 */

let captured = null
globalThis.window = { __ModuleLoader__: { load: (entry) => { captured = entry } } }
// 用查询串绕开 ESM 模块缓存：client.test.js 已经以裸路径导入过同一文件，
// 若这里复用缓存实例就不会再次调用 __ModuleLoader__.load，captured 会一直是 null。
await import('../../lib/client.js?render-smoke')

function createRuntime() {
  // 本插件只有 RuleFormPage 用 hooks，且它是树中最先出现的状态组件，
  // 因此单个 hooks 槽数组足以跨多趟渲染保持状态。
  const hooks = []
  let cursor = 0
  const pending = []

  const React = {
    // 与 React.createElement 一致：只有传了额外的 rest 实参才覆盖 props.children，
    // 否则保留调用方通过 props 传进来的 children（TextLine 就是这么传的）。
    createElement: (type, props, ...children) => ({
      type,
      props: children.length > 0 ? { ...(props ?? {}), children } : { ...(props ?? {}) },
    }),
    useState(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = typeof initial === 'function' ? initial() : initial
      const set = (next) => { hooks[index] = typeof next === 'function' ? next(hooks[index]) : next }
      return [hooks[index], set]
    },
    useRef(initial) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = { current: initial }
      return hooks[index]
    },
    useMemo(factory) {
      const index = cursor++
      if (!(index in hooks)) hooks[index] = factory()
      return hooks[index]
    },
    useEffect(fn, deps) {
      const index = cursor++
      const previous = hooks[index]
      const changed = !previous || !deps || deps.some((dep, at) => dep !== previous.deps[at])
      if (changed) pending.push(fn)
      hooks[index] = { deps: deps ?? null }
    },
  }

  /** 执行上一趟收集到的 effects，并清空 */
  function flush() {
    const queued = pending.splice(0, pending.length)
    for (const fn of queued) fn()
    return queued.length
  }

  /** 渲染一趟：递归展开函数组件，返回可检查的元素树 */
  function render(node) {
    cursor = 0
    return walk(node)
  }

  function walk(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return null
    if (typeof node === 'string' || typeof node === 'number') return node
    if (Array.isArray(node)) return node.map(walk)
    if (typeof node.type === 'function') return walk(node.type(node.props))
    const children = node.props?.children ?? []
    return { type: node.type, props: node.props, children: children.map(walk) }
  }

  return { React, render, flush }
}

function collectTypes(node, into = []) {
  if (!node || typeof node !== 'object') return into
  if (Array.isArray(node)) { node.forEach((child) => collectTypes(child, into)); return into }
  if (node.type) into.push(node.type)
  if (node.children) node.children.forEach((child) => collectTypes(child, into))
  return into
}

/**
 * 收集所有可见文本。
 *
 * 注意 `<input value={...}>` 的值在 props 里而不是 children 里，
 * 表单里大量真实内容（规则备注、provider、请求头名与值）都以受控 input 呈现，
 * 所以这里同时收集字符串类型的 value / placeholder。
 */
function collectText(node, into = []) {
  if (node === null || node === undefined || typeof node === 'boolean') return into
  if (typeof node === 'string' || typeof node === 'number') { into.push(String(node)); return into }
  if (Array.isArray(node)) { node.forEach((child) => collectText(child, into)); return into }
  const props = node.props ?? {}
  for (const key of ['value', 'placeholder']) {
    if (typeof props[key] === 'string' && props[key] !== '') into.push(props[key])
  }
  if (node.children) node.children.forEach((child) => collectText(child, into))
  return into
}


/** 深度遍历元素树，收集满足条件的节点（用于点按钮、读 disabled） */
function findNodes(node, predicate, into = []) {
  if (!node || typeof node !== 'object') return into
  if (Array.isArray(node)) { node.forEach((child) => findNodes(child, predicate, into)); return into }
  if (predicate(node)) into.push(node)
  if (node.children) node.children.forEach((child) => findNodes(child, predicate, into))
  return into
}


/** 通过真实 apply 拿到注册进 slot 的组件 */
function loadBundle(React) {
  const bundle = captured.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require: ${name}`)
  })
  let registered = null
  bundle.apply({
    effect: (factory) => { factory(); return () => {} },
    locale: { register: () => () => {} },
    slots: {
      inject: (_name, factory) => { factory() },
      register: (_options, component) => { registered = component; return () => {} },
    },
  })
  return { bundle, registered }
}

function readyForm() {
  return {
    state: {
      value: {
        enabled: true,
        backend: 'auto',
        onMissingVariable: 'skip',
        debug: false,
        rules: [{
          id: 'r1',
          enabled: true,
          comment: '测试规则',
          match: { provider: 'newapi-responses', model: 'deepseek-*', host: '' },
          headers: { 'x-opencode-session': '${sessionId}', 'x-static': 'v1' },
          order: 0,
        }],
      },
      revision: 3,
      status: 'ready',
      writable: true,
    },
    mutate: async () => true,
  }
}

test('表单在完整快照下能渲染出基本卡片、规则卡片与保存按钮', () => {
  const { React, render, flush } = createRuntime()
  const { registered } = loadBundle(React)
  assert.equal(typeof registered, 'function', '必须注册组件')

  const props = { t: (key) => key, view: 'page', form: readyForm() }
  // 第一趟：useEffect 尚未执行，草稿为空，组件返回占位提示
  render(React.createElement(registered, props))
  // 执行 effects（内部 setBaseline / setDraft），再渲染一趟
  assert.ok(flush() > 0, '应有 effect 被调度')
  const output = render(React.createElement(registered, props))
  assert.ok(output, '表单应有输出')

  const types = collectTypes(output)
  assert.ok(types.includes('form'), '应渲染 form 元素')
  assert.ok(types.includes('section'), '应渲染卡片 section')
  assert.ok(types.includes('button'), '应有按钮')

  // 草稿里的真实内容应出现：规则备注、匹配值、请求头名与变量说明
  const text = collectText(output).join(' ')
  assert.match(text, /测试规则/, '应显示规则备注')
  assert.match(text, /newapi-responses/, '应显示 provider')
  assert.match(text, /x-opencode-session/, '应显示请求头名')
  assert.match(text, /\$\{sessionId\}/, '应原样显示含占位符的头值')
})

test('summary 视图只渲染一句话', () => {
  const { React, render } = createRuntime()
  const { registered } = loadBundle(React)
  const output = render(React.createElement(registered, { t: (k) => k, view: 'summary' }))
  const text = collectText(output).join(' ')
  assert.match(text, /summary/, 'summary 视图应输出一句话，不含表单控件')
  assert.ok(!collectTypes(output).includes('form'), 'summary 视图不应渲染表单')
})

test('配置不可写时表单给出只读提示而不抛错', () => {
  const { React, render, flush } = createRuntime()
  const { registered } = loadBundle(React)
  const form = { state: { value: {}, revision: 1, status: 'ready', writable: false }, mutate: async () => true }
  const props = { t: (k) => k, view: 'page', form }
  assert.doesNotThrow(() => { render(React.createElement(registered, props)); flush(); render(React.createElement(registered, props)) })
  const readonly = render(React.createElement(registered, props))
  assert.ok(readonly, '只读时仍应渲染表单结构')
})

test('status 为 loading / unavailable 时给出提示且不抛错', () => {
  const { React, render, flush } = createRuntime()
  const { registered } = loadBundle(React)
  const expectations = {
    loading: 'loading',
    unavailable: 'unavailable',
  }
  for (const [status, key] of Object.entries(expectations)) {
    const form = { state: { value: {}, revision: 0, status, writable: true }, mutate: async () => true }
    const props = { t: (k) => k, view: 'page', form }
    assert.doesNotThrow(() => { render(React.createElement(registered, props)); flush() }, `status=${status} 不应抛错`)
    const output = render(React.createElement(registered, props))
    assert.ok(collectText(output).includes(key), `status=${status} 应显示 ${key} 提示`)
  }
})

test('缺少 form / t 时不抛错', () => {
  const { React, render } = createRuntime()
  const { registered } = loadBundle(React)
  assert.doesNotThrow(() => render(React.createElement(registered, { view: 'page' })))
  assert.doesNotThrow(() => render(React.createElement(registered, {})))
})

/**
 * 两个规则、order 分别 0 与 50。点「下移」后应只交换这两条的 order，
 * 不能把整表重排成 0/10 —— 手填的 order 是有语义的（M9 回归）。
 */
test('下移规则时只交换 order，不重排整表（M9 回归）', () => {
  const { React, render, flush } = createRuntime()
  const { registered } = loadBundle(React)

  // 故意用 0 / 500 这种非 at*10 的 order：若实现把整表重排成 0/10，断言会失败
  const rule = (id, comment, header, order) => ({
    id, enabled: true, comment,
    match: { provider: '', model: '', host: '' },
    headers: { [header]: '1' },
    order,
  })
  const form = {
    state: {
      value: {
        enabled: true,
        backend: 'auto',
        onMissingVariable: 'skip',
        debug: false,
        rules: [rule('a', 'AAA', 'x-a', 0), rule('b', 'BBB', 'x-b', 500)],
      },
      revision: 1,
      status: 'ready',
      writable: true,
    },
    mutate: async () => true,
  }
  const props = { t: (k) => k, view: 'page', form }
  render(React.createElement(registered, props))
  flush()
  const first = render(React.createElement(registered, props))

  const moveDown = findNodes(first, (node) =>
    node.type === 'button' && node.props.title === 'moveDown' && node.props.disabled !== true)
  assert.equal(moveDown.length, 1, '应恰好有一个可用的下移按钮')
  moveDown[0].props.onClick()

  const after = render(React.createElement(registered, props))
  // 位置交换：B 现在在前、A 在后
  const text = collectText(after).join(' ')
  assert.ok(text.indexOf('BBB') < text.indexOf('AAA'), '交换后 B 应排在 A 之前')

  // order 只在这两条之间交换，仍为 {0, 500}，而不是被重排成 0/10
  const orders = findNodes(after, (node) => node.type === 'input' && node.props.title === 'order')
    .map((node) => node.props.value)
  assert.deepEqual(orders, ['0', '500'], `order 不应被重排，实际 ${JSON.stringify(orders)}`)
})

test('存在保留头时禁用保存（I3 回归）', () => {
  const { React, render, flush } = createRuntime()
  const { registered } = loadBundle(React)
  const form = {
    state: {
      value: {
        enabled: true,
        backend: 'auto',
        onMissingVariable: 'skip',
        debug: false,
        rules: [{
          id: 'r1', enabled: true, comment: '',
          match: { provider: '', model: '', host: '' },
          headers: { authorization: 'Bearer x' },
          order: 0,
        }],
      },
      revision: 1,
      status: 'ready',
      writable: true,
    },
    mutate: async () => true,
  }
  const props = { t: (k) => k, view: 'page', form }
  render(React.createElement(registered, props))
  flush()
  const output = render(React.createElement(registered, props))

  const save = findNodes(output, (node) => node.type === 'button' && node.props.type === 'submit')
  assert.equal(save.length, 1)
  assert.equal(save[0].props.disabled, true, '保留头必须阻止保存')
  assert.match(collectText(output).join(' '), /reservedHeader/, '应给出保留头提示')
})

test('没有问题时保存按钮仅受 dirty 约束（I3 的反面）', () => {
  const { React, render, flush } = createRuntime()
  const { registered } = loadBundle(React)
  const form = readyForm()
  const props = { t: (k) => k, view: 'page', form }
  render(React.createElement(registered, props))
  flush()
  const output = render(React.createElement(registered, props))
  const save = findNodes(output, (node) => node.type === 'button' && node.props.type === 'submit')
  assert.equal(save[0].props.disabled, true, '尚未修改时应禁用保存')
})
