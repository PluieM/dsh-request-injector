/**
 * 扩展点健康度探针（跨模块共享的一次性信号）。
 *
 * 背景：后端 A 依赖宿主事件 `llm-pi-ai/request-headers`。宿主升级若改名或移除该扩展点，
 * 监听器会静默不再触发 —— 插件照常「加载成功」，但后端 A 完全空转。
 * 后端 B 在每次 HTTP 请求时读这里的状态，发现「扩展点从未触发」就提示一次。
 *
 * 局限：若 profile 里根本没装 pi-ai 适配器（例如只有 llm-deepseek），后端 A 本来就不该触发，
 * 此时提示是误报。因此该提示只在 `debug: true` 时输出，且一个进程只输出一次。
 */

export const probe = {
  /** 后端 A 的监听器是否至少被宿主调用过一次 */
  headersBackendFired: false,
  /** 是否已就「扩展点疑似失效」提示过 */
  warnedMissingHeadersHook: false,
}
