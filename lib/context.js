/**
 * 请求上下文传递（AsyncLocalStorage）。
 *
 * 后端 B（fetch 包装）在 fetch 层面拿不到 `llm-pi-ai` 的请求元数据，必须靠
 * `llm/stream` 事件把 {sessionId, provider, model, purpose} 送进去。
 *
 * 关键点：**只在外层监听器里 als.run(store, next) 不够**。next() 返回的是
 * async generator，函数体要到消费者 await 时才执行，那时 ALS 上下文已丢失。
 * 因此必须包装迭代器代理，让每次 next()/return()/throw() 都在 als.run 内执行。
 */

import { AsyncLocalStorage } from 'node:async_hooks'

const als = new AsyncLocalStorage()

/**
 * 注册 `llm/stream` 监听器，把请求上下文绑到 ALS 上。
 * @param {object} ctx cordis 上下文
 * @returns {Function} 清理函数（ctx.on 自带 effect 清理，这里直接返回它）
 */
export function registerStreamContext(ctx) {
  return ctx.on('llm/stream', (options, next) => {
    const store = {
      sessionId: options?.sessionId,
      provider: options?.provider,
      model: options?.model,
      purpose: options?.purpose,
      /** 后端 A 实际注入过的规则 id，供后端 B 去重 */
      appliedRuleIds: new Set(),
    }
    const iterator = als.run(store, next)
    // 逐次调用都包在 als.run 内：generator body 在 await 时才跑，彼时上下文已丢
    return {
      get store() {
        return store
      },
      next: () => als.run(store, () => iterator.next()),
      return: (value) => (typeof iterator.return === 'function'
        ? als.run(store, () => iterator.return(value))
        : Promise.resolve({ done: true, value })),
      throw: (error) => (typeof iterator.throw === 'function'
        ? als.run(store, () => iterator.throw(error))
        : Promise.reject(error)),
      [Symbol.asyncIterator]() {
        return this
      },
    }
  }, { global: true })
}

/** 当前 ALS 上下文；不在 `llm/stream` 链路上时为 undefined */
export const getStore = () => als.getStore()
