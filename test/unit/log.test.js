import test from 'node:test'
import assert from 'node:assert/strict'
import { createLog } from '../../lib/log.js'

function fakeLogger() {
  const records = []
  const push = (level) => (message) => records.push({ level, message })
  return { records, debug: push('debug'), info: push('info'), warn: push('warn'), error: push('error') }
}

test('debug 在配置关闭时不输出', () => {
  const logger = fakeLogger()
  createLog(() => ({ debug: false }), logger).debug('x')
  assert.equal(logger.records.length, 0)
})

test('debug 在配置打开时输出', () => {
  const logger = fakeLogger()
  createLog(() => ({ debug: true }), logger).debug('x')
  assert.deepEqual(logger.records.map((r) => r.level), ['debug'])
})

test('info / warn / error 不受 debug 开关影响', () => {
  const logger = fakeLogger()
  const log = createLog(() => ({ debug: false }), logger)
  log.info('i'); log.warn('w'); log.error('e')
  assert.deepEqual(logger.records.map((r) => r.level), ['info', 'warn', 'error'])
})

test('日志带插件名前缀', () => {
  const logger = fakeLogger()
  createLog(() => ({}), logger).warn('hello')
  assert.match(logger.records[0].message, /\[dsh-request-injector\] hello/)
})

test('errorOnce 同一错误只记一次', () => {
  const logger = fakeLogger()
  const log = createLog(() => ({}), logger)
  const error = new Error('same')
  log.errorOnce(error); log.errorOnce(error); log.errorOnce(new Error('same'))
  assert.equal(logger.records.length, 1)
})

test('errorOnce 不同错误分别记录', () => {
  const logger = fakeLogger()
  const log = createLog(() => ({}), logger)
  log.errorOnce(new Error('a')); log.errorOnce(new Error('b'))
  assert.equal(logger.records.length, 2)
})

test('传入 error 时消息里带错误文本', () => {
  const logger = fakeLogger()
  createLog(() => ({}), logger).warn('failed', new Error('boom'))
  assert.match(logger.records[0].message, /failed: boom/)
})

test('logger 方法缺失时回退 console 不抛错', () => {
  const log = createLog(() => ({}), {})
  assert.doesNotThrow(() => log.info('fallback'))
})

test('logger 为 undefined 时回退 console 不抛错', () => {
  const log = createLog(() => ({}), undefined)
  assert.doesNotThrow(() => log.warn('fallback'))
})
