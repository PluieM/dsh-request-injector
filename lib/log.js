/**
 * 日志封装。
 *
 * 宿主传入的 ctx.logger 形态不完全统一，这里做一层薄封装：
 * - 始终带插件名前缀，便于在混杂日志里过滤
 * - `debug` 只在配置打开时输出，避免逐请求刷屏
 * - `errorOnce` 按错误消息去重，防止同一配置错误在每个请求上重复打印
 */

const PREFIX = '[dsh-request-injector]'

/**
 * @param {() => object} read 返回最新配置的读取函数
 * @param {{ debug?: Function, info?: Function, warn?: Function, error?: Function }} [logger] 宿主 logger
 */
export function createLog(read, logger) {
  const seen = new Set()

  const emit = (level, message, error) => {
    const line = `${PREFIX} ${message}`
    const target = typeof logger?.[level] === 'function' ? logger[level].bind(logger) : console[level].bind(console)
    if (error === undefined) target(line)
    else target(`${line}: ${error?.message ?? error}`)
  }

  return {
    /** 逐请求调试日志，仅在 cfg.debug 为真时输出 */
    debug(message, error) {
      if (read()?.debug === true) emit('debug', message, error)
    },
    info(message, error) {
      emit('info', message, error)
    },
    warn(message, error) {
      emit('warn', message, error)
    },
    error(message, error) {
      emit('error', message, error)
    },
    /** 同一错误只记录一次（按消息文本去重），用于「不该阻塞主流程」的兜底日志 */
    errorOnce(error) {
      const key = String(error?.message ?? error)
      if (seen.has(key)) return
      seen.add(key)
      emit('error', 'suppressed error (further occurrences hidden)', error)
    },
  }
}
