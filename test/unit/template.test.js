import test from 'node:test'
import assert from 'node:assert/strict'
import { render } from '../../lib/template.js'

test('变量替换：已知变量取真实值', () => {
  const { value, missing } = render('${sessionId}', { sessionId: 's-1' })
  assert.equal(value, 's-1')
  assert.deepEqual(missing, [])
})

test('多个变量与字面文本混排', () => {
  const { value } = render('Bearer ${sessionId}-${random:4}', { sessionId: 'abc' })
  assert.match(value, /^Bearer abc-[0-9a-f]{4}$/)
})

test('缺失变量：返回空串并记录 missing', () => {
  const { value, missing } = render('a-${sessionId}-b', {})
  assert.equal(value, 'a--b')
  assert.deepEqual(missing, ['sessionId'])
})

test('缺失变量不重复记录', () => {
  const { missing } = render('${purpose}${purpose}', {})
  assert.deepEqual(missing, ['purpose'])
})

test('空字符串按缺失处理', () => {
  const { missing } = render('${sessionId}', { sessionId: '' })
  assert.deepEqual(missing, ['sessionId'])
})

test('转义：$$ 变字面 $', () => {
  assert.equal(render('cost $$5', {}).value, 'cost $5')
})

test('转义：$${x} 不被当作占位符', () => {
  const { value, missing } = render('$${literal}', { literal: 'NO' })
  assert.equal(value, '${literal}')
  assert.deepEqual(missing, [])
})

test('转义与占位符混用：$$${sessionId}', () => {
  assert.equal(render('$$${sessionId}', { sessionId: 'v' }).value, '$v')
})

test('不递归展开：变量值里的 ${} 按字面保留', () => {
  const { value } = render('${sessionId}', { sessionId: '${model}' })
  assert.equal(value, '${model}')
})

test('未知变量名按缺失处理', () => {
  const { value, missing } = render('${nope}', {})
  assert.equal(value, '')
  assert.deepEqual(missing, ['nope'])
})

test('random:N 生成指定位数的十六进制串', () => {
  const { value, missing } = render('${random:12}', {})
  assert.match(value, /^[0-9a-f]{12}$/)
  assert.deepEqual(missing, [])
})

test('random 非法长度按缺失处理', () => {
  for (const arg of ['0', '-1', '65', '1.5', 'abc']) {
    const { missing } = render(`\${random:${arg}}`, {})
    assert.deepEqual(missing, ['random'], `arg=${arg} 应判为缺失`)
  }
})

test('random 默认 16 位', () => {
  assert.match(render('${random}', {}).value, /^[0-9a-f]{16}$/)
})

test('uuid / date / time / timestamp 本地生成', () => {
  const { value, missing } = render('${uuid}|${date}|${time}|${timestamp}', {})
  assert.deepEqual(missing, [])
  const [uuid, date, time, ts] = value.split('|')
  assert.match(uuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  assert.match(date, /^\d{4}-\d{2}-\d{2}$/)
  assert.match(time, /^\d{2}:\d{2}:\d{2}$/)
  assert.match(ts, /^\d{13}$/)
})

test('host 变量在有值时可用，无值按缺失', () => {
  assert.equal(render('${host}', { host: 'api.example.com' }).value, 'api.example.com')
  assert.deepEqual(render('${host}', {}).missing, ['host'])
})

test('非字符串模板不抛错', () => {
  assert.equal(render(undefined, {}).value, '')
  assert.equal(render(null, {}).value, '')
  assert.equal(render(123, {}).value, '123')
})
