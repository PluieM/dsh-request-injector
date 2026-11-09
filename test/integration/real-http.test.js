import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { apply } from '../../lib/index.js'

/**
 * 用真实 HTTP 服务器验证后端 B：不是 mock fetch，而是真发请求、真收头。
 * 这是「包装 globalThis.fetch 能生效」最接近生产的验证。
 */

function listen() {
  return new Promise((resolve) => {
    const received = []
    const server = http.createServer((req, res) => {
      received.push({ url: req.url, headers: req.headers })
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end('ok')
    })
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address()
      resolve({
        port,
        received,
        // undici 会保持 keep-alive 连接，只调 close() 会一直等；先断开全部连接
        close: () => new Promise((done) => {
          server.closeAllConnections()
          server.close(done)
        }),
      })
    })
  })
}

function makeCtx() {
  const logger = { debug() {}, info() {}, warn() {}, error() {} }
  return {
    logger,
    fiber: { entry: { options: { id: 'dsh-request-injector' } } },
    effect: (factory) => {
      const disposer = factory()
      return () => typeof disposer === 'function' && disposer()
    },
    inject: (_deps, callback) => {
      callback({
        effect: (factory) => { const d = factory(); return () => typeof d === 'function' && d() },
        get: () => ({ configure: () => () => {} }),
        settings: { configure: () => () => {} },
      })
    },
    on: () => () => {},
  }
}

test('真实请求上按 host 注入请求头（后端 B）', async () => {
  const server = await listen()
  const original = globalThis.fetch
  const ctx = makeCtx()

  apply(ctx, {
    enabled: true,
    backend: 'fetch',
    onMissingVariable: 'skip',
    debug: false,
    rules: [{
      id: 'r1',
      match: { host: `127.0.0.1:${server.port}` },
      headers: {
        'x-injected': 'yes',
        'x-uuid-like': '${uuid}',
        'x-literal': 'cost $$9',
      },
      order: 0,
    }],
  })

  try {
    const response = await globalThis.fetch(`http://127.0.0.1:${server.port}/probe`)
    assert.equal(response.status, 200)
    await response.text()
  } finally {
    globalThis.fetch = original
  }

  await server.close()
  assert.equal(server.received.length, 1)
  const headers = server.received[0].headers
  assert.equal(headers['x-injected'], 'yes')
  assert.match(headers['x-uuid-like'], /^[0-9a-f-]{36}$/)
  assert.equal(headers['x-literal'], 'cost $9')
})

test('真实请求上未命中的 host 不注入', async () => {
  const server = await listen()
  const original = globalThis.fetch
  const ctx = makeCtx()

  apply(ctx, {
    enabled: true,
    backend: 'auto',
    onMissingVariable: 'skip',
    debug: false,
    rules: [{ id: 'r1', match: { host: 'example.invalid' }, headers: { 'x-injected': 'yes' }, order: 0 }],
  })

  try {
    const response = await globalThis.fetch(`http://127.0.0.1:${server.port}/probe`)
    await response.text()
  } finally {
    globalThis.fetch = original
  }

  await server.close()
  assert.equal(server.received[0].headers['x-injected'], undefined)
})

test('保留头不会被真实写入', async () => {
  const server = await listen()
  const original = globalThis.fetch
  const ctx = makeCtx()

  apply(ctx, {
    enabled: true,
    backend: 'fetch',
    onMissingVariable: 'skip',
    debug: false,
    rules: [{
      id: 'r1',
      match: { host: `127.0.0.1:${server.port}` },
      headers: { 'x-injected': 'yes', 'user-agent': 'from-plugin', 'x-dsh-internal': 'nope' },
      order: 0,
    }],
  })

  try {
    const response = await globalThis.fetch(`http://127.0.0.1:${server.port}/probe`)
    await response.text()
  } finally {
    globalThis.fetch = original
  }

  await server.close()
  const headers = server.received[0].headers
  assert.equal(headers['x-injected'], 'yes')
  assert.notEqual(headers['user-agent'], 'from-plugin')
  assert.equal(headers['x-dsh-internal'], undefined)
})
