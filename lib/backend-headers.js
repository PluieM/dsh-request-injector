/**
 * 后端 A：监听 `llm-pi-ai/request-headers` 扩展点注入请求头。
 *
 * 该扩展点的契约（宿主源码 llm-pi-ai.index.js:1811-1850）：
 * - 回调签名 (request, headers, next)，`headers` 是**可变的 Headers 实例**
 * - `request` 是冻结对象，只含 provider / model / baseURL / sessionId / purpose
 * - 回调抛错会让本次推理以 REQUEST_HEADERS 失败，所以必须自己 try/catch
 * - `next()` 只能调一次，且必须返回它的返回值（否则否决整条链）
 */

import { render } from './template.js'
import { isReserved } from './rules.js'
import { MissingVariableError } from './errors.js'
import { probe } from './probe.js'

/** 宿主扩展点名。DSH 升级若改名，后端 A 会静默失效（见 README 已知限制） */
export const HEADERS_EVENT = 'llm-pi-ai/request-headers'

/**
 * 注册后端 A。
 * @param {object} ctx cordis 上下文
 * @param {{ store: import('./rules.js').RuleStore, log: object }} deps
 * @returns {Function} 清理函数
 */
export function registerHeadersBackend(ctx, { store, log }) {
  return ctx.on(HEADERS_EVENT, (request, headers, next) => {
    // next() 只允许调用一次，重复调用抛 `next() called multiple times`。
    // 先置位再调用，catch 分支据此区分「自家注入出错」与「下游 next() 出错」。
    let nextCalled = false
    const proceed = () => {
      nextCalled = true
      return next()
    }

    // 探针：宿主只要还在触发这个扩展点，后端 B 就能据此判定「后端 A 仍然有效」
    probe.headersBackendFired = true

    try {
      const cfg = store.config()
      if (cfg.enabled === false) return proceed()
      if (cfg.backend === 'fetch') return proceed() // 只用 fetch 后端

      const rules = store.match({
        provider: request.provider,
        model: request.model,
        // 后端 A 拿不到真实目标 URL，带 host 的规则在这里不命中，交由后端 B 处理
        host: undefined,
      })
      let appliedAny = false

      for (const rule of rules) {
        let ruleApplied = false
        for (const [name, template] of Object.entries(rule.headers ?? {})) {
          if (applyHeader(headers, name, template, request, cfg, log)) ruleApplied = true
        }
        if (ruleApplied) appliedAny = true
      }
      if (appliedAny) log.debug(`headers injected for ${request.provider}/${request.model}`)
      return proceed()
    } catch (error) {
      // onMissingVariable: 'error' 是用户显式要求「本次请求失败」。
      // 宿主会把这里的异常包成 REQUEST_HEADERS 错误，正是期望行为。
      if (error instanceof MissingVariableError) throw error
      // 其余注入失败必须吞掉并继续：抛错会让本次推理失败，
      // 一个配置错误不该让整个对话不可用。仅记录并上报一次。
      log.errorOnce(error)
      // next() 已调用后抛错 = 下游链路出错，此时不能再调一次，原样上抛
      if (nextCalled) throw error
      return proceed()
    }
  }, { global: true })
}

/**
 * 应用单个头。
 * @param {Headers} headers 可变 Headers 实例
 * @param {string} name 头名
 * @param {string} template 值模板
 * @param {object} request 冻结的请求元数据
 * @param {object} cfg 配置快照
 * @param {object} log 日志
 * @returns {boolean} 是否真的写入了该头
 */
function applyHeader(headers, name, template, request, cfg, log) {
  if (isReserved(name)) {
    log.warn(`reserved header skipped: ${name}`)
    return false
  }
  const vars = {
    sessionId: request.sessionId,
    provider: request.provider,
    model: request.model,
    baseURL: request.baseURL,
    purpose: request.purpose,
    // 不提供 host：后端 A 无真实目标 URL
  }
  const { value, missing } = render(template, vars)
  if (missing.length > 0) {
    if (cfg.onMissingVariable === 'error') throw new MissingVariableError(missing, name)
    if (cfg.onMissingVariable !== 'empty') {
      log.debug(`skip header ${name}: missing ${missing.join(',')}`)
      return false
    }
  }
  try {
    headers.set(name, value)
  } catch (error) {
    // Headers.set 对非 Latin-1 字符（中文/emoji）、CR/LF、非法头名会抛 TypeError。
    // 只跳过这一个头：若让它冒泡到外层 catch，同一请求里其后的所有规则都会被废掉。
    log.warn(`header rejected by Headers.set: ${name}`, error)
    return false
  }
  log.debug(`set header ${name}`)
  return true
}
