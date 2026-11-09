/**
 * 后端 B：包装 `globalThis.fetch` 注入请求头。
 *
 * 为什么必须有一个 fetch 后端：
 * - `llm-deepseek` 路由在构造期就把 `globalThis.fetch` 捕获进 `this.fetchImpl`，
 *   不走 `llm-pi-ai/request-headers` 扩展点，扩展点对它完全没有作用
 * - pi-ai 的模型列表探测（discoverModels）自建 Headers 后直接 fetch，同样绕过扩展点
 *
 * 代价：websocket 传输不经过 fetch（握手头由 `_buildWebSocketHeaders` 直接从
 * `defaultHeaders` 拼），因此 WS 下只有后端 A 有效 —— 这是设计上已知的能力缺口。
 *
 * 多实例：`globalThis.fetch` 只有一个槽位，插件被同时加载两份（或热重载残留）时会出现
 * 链式包装。这里用「包装层链表 + 动态 inner」维护，任意顺序卸载都能重新接好链路，
 * 不会出现「卸载后全局 fetch 仍指向已释放包装」的情况。
 */

import { render } from './template.js'
import { isReserved } from './rules.js'
import { getStore } from './context.js'
import { MissingVariableError } from './errors.js'
import { probe } from './probe.js'

/** 包装标记，用于识别「已被本插件包装过」的 fetch */
const MARK = '__dshRequestInjector'

/** 已注册的包装层，按安装顺序排列（越靠后越外层） */
const layers = []

/** 第一个包装层安装时捕获的真实 fetch；全部卸载后恢复它 */
let baseFetch = undefined

/** 本插件最后一次写入 globalThis.fetch 的函数，用于判断全局槽位是否已被他人占走 */
let installedFetch = undefined

/**
 * 重新串联包装层：越晚安装的越在外层。
 * @returns {Function} 当前应写入 globalThis.fetch 的最外层函数
 */
function relink() {
  let inner = baseFetch
  for (const layer of layers) {
    layer.inner = inner
    inner = layer.wrapped
  }
  return inner
}

/** 把链表结果写回全局，并处理「别的插件在我们之后又包了一层」的情况 */
function sync() {
  if (layers.length === 0) {
    // 只有全局槽位仍是我们上次写入的（或从未写过）时才还原，
    // 否则说明别人在最外层，抹掉它会破坏对方的包装
    if (installedFetch === undefined || globalThis.fetch === installedFetch) globalThis.fetch = baseFetch
    installedFetch = undefined
    baseFetch = undefined
    return
  }
  const outer = relink()
  globalThis.fetch = outer
  installedFetch = outer
}

/**
 * 注册后端 B：包装 globalThis.fetch 并在插件卸载时还原。
 * @param {object} ctx cordis 上下文
 * @param {{ store: import('./rules.js').RuleStore, log: object }} deps
 * @returns {Function} 清理函数
 */
export function registerFetchBackend(ctx, { store, log }) {
  if (layers.length === 0) baseFetch = globalThis.fetch
  else log.warn('globalThis.fetch is already wrapped by another instance; chaining')

  const layer = { store, log, inner: baseFetch, wrapped: undefined }
  // dispatch 每次调用都读 layer.inner，因此任一层的卸载都只需更新链表即可
  const dispatch = (input, init) => layer.inner(input, init)
  layer.wrapped = createWrappedFetch(dispatch, store, log)
  layer.wrapped[MARK] = true
  layers.push(layer)
  sync()

  return () => {
    const at = layers.indexOf(layer)
    if (at === -1) return
    layers.splice(at, 1)
    sync()
  }
}

/**
 * 清空包装层链表并还原全局 fetch。**仅供测试使用**。
 *
 * 生产环境不需要它：`ctx.effect` 保证插件销毁时一定调用清理函数。
 * 但测试在单进程内串行跑多个文件（`--experimental-test-isolation=none`），
 * 模块级链表会跨文件残留，导致后续用例拿到上一个用例遗留的 baseFetch。
 * @returns {void}
 */
export function resetFetchBackendForTests() {
  for (const layer of layers.splice(0)) {
    if (globalThis.fetch === layer.wrapped) globalThis.fetch = layer.inner
  }
  baseFetch = undefined
  installedFetch = undefined
}

/**
 * 构造包装后的 fetch。
 * @param {Function} original 下游 fetch（真实 fetch 或更内层的包装）
 * @param {import('./rules.js').RuleStore} store 规则仓库
 * @param {object} log 日志
 * @returns {Function}
 */
export function createWrappedFetch(original, store, log) {
  return async function wrappedFetch(input, init) {
    try {
      const cfg = store.config()
      if (cfg.enabled === false) return original(input, init)
      if (cfg.backend === 'headers') return original(input, init) // 只用扩展点

      // 扩展点健康度：host 若不再触发 llm-pi-ai/request-headers，后端 A 会静默空转，
      // 这里补一条一次性提示（每个进程最多一条），避免升级后无人察觉
      if (cfg.backend !== 'fetch' && !probe.headersBackendFired && !probe.warnedMissingHeadersHook) {
        probe.warnedMissingHeadersHook = true
        log.warn('llm-pi-ai/request-headers never fired; the official extension-point backend may be unavailable on this host version')
      }

      const url = toUrl(input)
      const streamStore = getStore()
      const target = {
        // 用 host 而不是 hostname：默认端口省略、非默认端口保留，
        // 规则写 api.example.com 与 127.0.0.1:8080 都能直观命中
        host: url?.host,
        provider: streamStore?.provider,
        model: streamStore?.model,
      }
      const rules = store.match(target)
      if (rules.length === 0) return original(input, init)

      // 复制 init，不原地改调用方的对象
      const nextInit = { ...(init ?? {}) }
      const headers = new Headers(nextInit.headers ?? (input instanceof Request ? input.headers : undefined))
      // 显式列出可用变量：不能直接展开 store，否则会把 appliedRuleIds(Set) 展开成 {}
      const vars = {
        sessionId: streamStore?.sessionId,
        provider: streamStore?.provider,
        model: streamStore?.model,
        purpose: streamStore?.purpose,
        host: target.host,
      }
      const appliedRuleIds = streamStore?.appliedRuleIds

      for (const rule of rules) {
        // 后端 A 已执行过的规则不重复注入
        if (appliedRuleIds?.has(store.ruleKey(rule.id))) continue
        let touched = false
        for (const [name, template] of Object.entries(rule.headers ?? {})) {
          if (isReserved(name)) {
            log.warn(`reserved header skipped: ${name}`)
            continue
          }
          const { value, missing } = render(template, vars)
          if (missing.length > 0) {
            if (cfg.onMissingVariable === 'error') throw new MissingVariableError(missing, name)
            if (cfg.onMissingVariable !== 'empty') continue
          }
          try {
            headers.set(name, value)
          } catch (error) {
            // 同后端 A：非法头名或非 Latin-1 值只跳过该头，不影响其余规则
            log.warn(`header rejected by Headers.set: ${name}`, error)
            continue
          }
          touched = true
        }
        if (touched) appliedRuleIds?.add(store.ruleKey(rule.id))
      }
      nextInit.headers = headers
      log.debug(`fetch inject → ${url ? url.host + url.pathname : '(unknown)'}`)
      return original(input, nextInit)
    } catch (error) {
      // onMissingVariable: 'error' 是用户显式要求「本次请求失败」，必须原样上抛，
      // 不能像普通注入错误那样吞掉后照常发请求
      if (error instanceof MissingVariableError) throw error
      // 其余注入失败不能阻断请求，否则等于把 DSH 打瘫；记录后原样透传
      log.errorOnce(error)
      return original(input, init)
    }
  }
}

/**
 * 从 fetch 的入参里解析 URL。
 * @param {string | URL | Request} input
 * @returns {URL | undefined} 非法 URL 返回 undefined，交给原 fetch 报错
 */
function toUrl(input) {
  try {
    if (typeof input === 'string') return new URL(input)
    if (input instanceof URL) return input
    if (typeof Request !== 'undefined' && input instanceof Request) return new URL(input.url)
  } catch {
    // 非法 URL 交给原 fetch 报错
  }
  return undefined
}
