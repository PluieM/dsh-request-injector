import test from 'node:test'
import assert from 'node:assert/strict'
import { RuleStore, isReserved, isUsableHeaderName, isUsableHeaderValue, matches, matchString, matchModel, matchHost } from '../../lib/rules.js'

const storeOf = (rules) => new RuleStore(() => ({ rules }))

test('空匹配条件命中任何请求', () => {
  assert.equal(matches({}, { provider: 'p', model: 'm', host: 'h' }), true)
  assert.equal(matches({ provider: '', model: '', host: '' }, {}), true)
})

test('provider 精确匹配', () => {
  assert.equal(matchString('newapi-responses', 'newapi-responses'), true)
  assert.equal(matchString('newapi-responses', 'newapi-responses-2'), false)
  assert.equal(matchString('newapi-responses', undefined), false)
})

test('model 支持尾部 * 前缀匹配', () => {
  assert.equal(matchModel('deepseek-v4-*', 'deepseek-v4-flash'), true)
  assert.equal(matchModel('deepseek-v4-*', 'kimi-k2'), false)
  // 前缀即 * 之前的全部字符，因此 'deepseek-v4' 本身不命中 'deepseek-v4-*'
  assert.equal(matchModel('deepseek-v4-*', 'deepseek-v4'), false)
  // 想连本体一起命中应写成 'deepseek-v4*'
  assert.equal(matchModel('deepseek-v4*', 'deepseek-v4'), true)
})

test('model 无 * 时精确匹配', () => {
  assert.equal(matchModel('deepseek-v4-flash', 'deepseek-v4-flash'), true)
  assert.equal(matchModel('deepseek-v4', 'deepseek-v4-flash'), false)
})

test('host 非空时后端 A（host=undefined）不命中', () => {
  assert.equal(matches({ host: 'api.example.com' }, { host: undefined }), false)
  assert.equal(matches({ host: 'api.example.com' }, { host: 'api.example.com' }), true)
})

test('模式两侧空白被裁剪', () => {
  assert.equal(matchString('  p  ', 'p'), true)
  assert.equal(matchModel('  m*  ', 'm1'), true)
})

test('RuleStore.match 过滤 disabled 并按 order 升序', () => {
  const store = storeOf([
    { id: 'c', order: 20, match: {} },
    { id: 'a', order: 10, match: {} },
    { id: 'b', order: 0, enabled: false, match: {} },
  ])
  assert.deepEqual(store.match({}).map((r) => r.id), ['a', 'c'])
})

test('RuleStore.match 只返回命中的规则', () => {
  const store = storeOf([
    { id: 'all', order: 0, match: {} },
    { id: 'prov', order: 1, match: { provider: 'p1' } },
    { id: 'other', order: 2, match: { provider: 'p2' } },
  ])
  assert.deepEqual(store.match({ provider: 'p1' }).map((r) => r.id), ['all', 'prov'])
})

test('RuleStore 缺配置时视为无规则', () => {
  assert.deepEqual(new RuleStore(() => undefined).match({}), [])
  assert.deepEqual(new RuleStore(() => undefined).config(), {})
})

test('order 相同时保持数组顺序（V8 稳定排序）', () => {
  const store = storeOf([
    { id: 'x', order: 5, match: {} },
    { id: 'y', order: 5, match: {} },
    { id: 'z', order: 5, match: {} },
  ])
  assert.deepEqual(store.match({}).map((r) => r.id), ['x', 'y', 'z'])
})

test('保留头判定大小写不敏感', () => {
  for (const name of ['User-Agent', 'AUTHORIZATION', 'Host', 'Content-Length', 'Transfer-Encoding', 'Connection']) {
    assert.equal(isReserved(name), true, `${name} 应为保留头`)
  }
})

test('x-dsh- 前缀整体避让', () => {
  assert.equal(isReserved('x-dsh-session'), true)
  assert.equal(isReserved('X-DSH-Foo'), true)
  assert.equal(isReserved('x-opencode-session'), false)
})

test('普通头不判定为保留', () => {
  assert.equal(isReserved('x-custom'), false)
  assert.equal(isReserved('x-request-purpose'), false)
})

test('isUsableHeaderName 拒绝非法 token 与保留头', () => {
  assert.equal(isUsableHeaderName('x-opencode-session'), true)
  assert.equal(isUsableHeaderName('x-bad name'), false)
  assert.equal(isUsableHeaderName('x-bad:name'), false)
  assert.equal(isUsableHeaderName(''), false)
  assert.equal(isUsableHeaderName('host'), false)
  assert.equal(isUsableHeaderName('X-DSH-Foo'), false)
})

test('isUsableHeaderValue 拒绝非 Latin-1 与换行', () => {
  assert.equal(isUsableHeaderValue('plain-ascii'), true)
  assert.equal(isUsableHeaderValue('中文'), false)
  assert.equal(isUsableHeaderValue('a\u0000b'), false)
  assert.equal(isUsableHeaderValue('a\nb'), false)
  assert.equal(isUsableHeaderValue('a\rb'), false)
  assert.equal(isUsableHeaderValue('\u00e9'), true) // Latin-1 的 é 合法
})

test('matchString 两侧空白都被裁剪', () => {
  assert.equal(matchString('p', ' p '), true)
  assert.equal(matchString(' p ', 'p'), true)
})

test('matchHost 不计大小写，与 URL 规范化后的 host 对齐', () => {
  // URL 解析必然把 host 小写化，配置里手写大写不能让规则永不命中
  assert.equal(matchHost('API.Example.com', 'api.example.com'), true)
  assert.equal(matchHost('api.example.com', 'API.Example.COM'), true)
  assert.equal(matchHost('api.example.com:8443', 'api.example.com:8443'), true)
  assert.equal(matchHost('api.example.com', 'other.example.com'), false)
})

test('matchHost 空条件命中任何 host（含 undefined）', () => {
  assert.equal(matchHost('', 'api.example.com'), true)
  assert.equal(matchHost(undefined, undefined), true)
  assert.equal(matchHost('  ', 'h'), true)
})

test('无 llm/stream 上下文时只允许显式 host 规则命中（H1 修复）', () => {
  const noContext = { host: 'api.example.com', contextAvailable: false }
  // 全通配规则不得命中：否则会把密钥头注入进程内任意 fetch
  assert.equal(matches({}, noContext), false)
  assert.equal(matches({ provider: 'p', model: 'm', host: '' }, noContext), false)
  // 显式写了 host 的规则仍命中，供模型探测等非 stream 路径使用
  assert.equal(matches({ host: 'api.example.com' }, noContext), true)
  // host 不匹配则不命中
  assert.equal(matches({ host: 'other.example.com' }, noContext), false)
  // host 与 provider 同时写时，无上下文只按 host 判定，provider 不参与
  assert.equal(matches({ provider: 'p', host: 'api.example.com' }, noContext), true)
})

test('有 llm/stream 上下文时三个维度照常参与匹配', () => {
  const inContext = { provider: 'p', model: 'm', host: 'h', contextAvailable: true }
  assert.equal(matches({}, inContext), true)
  assert.equal(matches({ provider: 'p' }, inContext), true)
  assert.equal(matches({ provider: 'x' }, inContext), false)
  assert.equal(matches({ model: 'm', host: 'h' }, inContext), true)
})

test('contextAvailable 省略时按有上下文处理（后端 A 只在 stream 内触发）', () => {
  assert.equal(matches({}, { provider: 'p' }), true)
  assert.equal(matches({ provider: 'x' }, { provider: 'p' }), false)
})
