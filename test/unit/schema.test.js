import test from 'node:test'
import assert from 'node:assert/strict'
import { Config, normalizeConfig, auditConfig } from '../../lib/schema.js'

test('空配置解析出全部默认值', () => {
  const resolved = Config({})
  assert.deepEqual(resolved.get(), {
    enabled: true,
    backend: 'auto',
    rules: [],
    onMissingVariable: 'skip',
    debug: false,
  })
})

test('整节 volatile 后 resolve 返回 live 引用（带 get）', () => {
  assert.equal(typeof Config({}).get, 'function')
})

test('规则内嵌套默认值自动补齐', () => {
  const rule = Config({ rules: [{ id: 'r1', headers: { 'x-a': '1' } }] }).get().rules[0]
  assert.equal(rule.enabled, true)
  assert.equal(rule.comment, '')
  assert.equal(rule.order, 0)
  assert.deepEqual(rule.match, { provider: '', model: '', host: '' })
  assert.deepEqual(rule.headers, { 'x-a': '1' })
})

test('id 不是必填：手写 patch 漏 id 不会让插件加载失败', () => {
  assert.doesNotThrow(() => Config({ rules: [{ headers: { 'x-a': '1' } }] }))
  assert.equal(Config({ rules: [{ headers: { 'x-a': '1' } }] }).get().rules[0].id, '')
})

test('非法枚举值让配置校验失败', () => {
  assert.throws(() => Config({ backend: 'bogus' }), /expected "auto" \| "headers" \| "fetch"/)
  assert.throws(() => Config({ onMissingVariable: 'bogus' }), /expected "skip" \| "empty" \| "error"/)
})

test('未知字段保留，不因升级丢数据', () => {
  const resolved = Config({ futureField: 1, rules: [{ id: 'r', futureRuleField: 2 }] }).get()
  assert.equal(resolved.futureField, 1)
  assert.equal(resolved.rules[0].futureRuleField, 2)
})

test('normalizeConfig 对 undefined / null 给全套默认值', () => {
  for (const raw of [undefined, null]) {
    const cfg = normalizeConfig(raw)
    assert.equal(cfg.enabled, true)
    assert.equal(cfg.backend, 'auto')
    assert.deepEqual(cfg.rules, [])
  }
})

test('normalizeConfig 不覆盖用户已给的值', () => {
  const cfg = normalizeConfig({ enabled: false, backend: 'fetch', debug: true, onMissingVariable: 'error' })
  assert.equal(cfg.enabled, false)
  assert.equal(cfg.backend, 'fetch')
  assert.equal(cfg.debug, true)
  assert.equal(cfg.onMissingVariable, 'error')
})

test('normalizeConfig 给规则补 id 与递增 order', () => {
  const cfg = normalizeConfig({ rules: [{ headers: { a: '1' } }, { id: 'keep', headers: { b: '2' } }] })
  assert.equal(cfg.rules[0].id, 'rule-1')
  assert.equal(cfg.rules[1].id, 'keep')
  assert.equal(cfg.rules[0].order, 0)
  assert.equal(cfg.rules[1].order, 10)
})

test('normalizeConfig 保留显式 order=0', () => {
  const cfg = normalizeConfig({ rules: [{ order: 0 }, { order: 0 }] })
  assert.equal(cfg.rules[0].order, 0)
  assert.equal(cfg.rules[1].order, 0)
})

test('normalizeConfig 深拷 match，避免与默认对象共享引用', () => {
  const cfg = normalizeConfig({ rules: [{ match: { provider: 'p' } }] })
  assert.deepEqual(cfg.rules[0].match, { provider: 'p', model: '', host: '' })
  cfg.rules[0].match.provider = 'mutated'
  assert.deepEqual(normalizeConfig({ rules: [{}] }).rules[0].match, { provider: '', model: '', host: '' })
})

test('normalizeConfig 过滤非对象规则项与非法 headers', () => {
  const cfg = normalizeConfig({ rules: [null, 'x', { headers: 'not-an-object' }] })
  assert.equal(cfg.rules.length, 1)
  assert.deepEqual(cfg.rules[0].headers, {})
})

test('normalizeConfig 对非数组 rules 兜底为空数组', () => {
  assert.deepEqual(normalizeConfig({ rules: 'nope' }).rules, [])
})

test('auditConfig 报告保留头、非法头名与非法头值', () => {
  const problems = auditConfig(normalizeConfig({
    rules: [{
      id: 'r1',
      headers: {
        'x-dsh-internal': 'v',
        'bad header': 'v',
        'x-unicode': '中文',
        'x-ok': 'fine',
      },
    }],
  }))
  assert.equal(problems.length, 3, problems.join(' | '))
  assert.equal(problems.some((p) => p.includes('x-dsh-internal') && p.includes('保留头')), true)
  assert.equal(problems.some((p) => p.includes('bad header') && p.includes('合法')), true)
  assert.equal(problems.some((p) => p.includes('x-unicode') && p.includes('Latin-1')), true)
  assert.equal(problems.some((p) => p.includes('x-ok')), false)
})

test('auditConfig 对干净的配置返回空数组', () => {
  assert.deepEqual(auditConfig(normalizeConfig({
    rules: [{ id: 'r1', match: { provider: 'p' }, headers: { 'x-a': 'v' }, order: 0 }],
  })), [])
})

test('normalizeConfig 把重复 id 改成唯一 id', () => {
  const cfg = normalizeConfig({ rules: [{ id: 'dup', headers: { 'x-a': '1' } }, { id: 'dup', headers: { 'x-b': '2' } }] })
  assert.equal(cfg.rules.length, 2)
  assert.notEqual(cfg.rules[0].id, cfg.rules[1].id)
})

test('normalizeConfig 把越界的 backend / onMissingVariable 回落默认值', () => {
  const cfg = normalizeConfig({ backend: 'bogus', onMissingVariable: 'bogus' })
  assert.equal(cfg.backend, 'auto')
  assert.equal(cfg.onMissingVariable, 'skip')
})
