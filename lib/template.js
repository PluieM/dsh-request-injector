/**
 * 占位符引擎。
 *
 * 语法：`${name}` 单层引用，不做表达式求值；`${random:N}` 生成 N 位十六进制随机串。
 * 转义：`$$` 表示一个字面 `$`，因此字面 `${x}` 要写成 `$${x}`。
 *
 * 设计约束：
 * - 不递归展开：变量值里即使出现 `${y}` 也按字面保留，避免配置构造出无限展开。
 * - 未定义变量不做静默空串：由上层按 `onMissingVariable` 策略决定「整条头跳过 / 置空 / 报错」。
 */

/**
 * 单次扫描同时识别「转义 `$$`」与「占位符」。
 *
 * 早先用「先替换成 NUL 哨兵、再还原」的两段式实现，但哨兵串是固定文本，
 * 用户模板里出现同样文本就会被误判成转义（`"a\u0000DOLLAR\u0000b"` 会渲染成 `a$b`）。
 * 一个正则一次替换即可，既没有哨兵也没有二次替换。
 */
const TOKEN = /\$\$|\$\{([a-zA-Z][a-zA-Z0-9_]*)(?::([^}]*))?\}/g

/** 随机串的长度上限，防止 `${random:1000000}` 生成巨型头值被网关拒绝 */
const RANDOM_MAX = 64

/**
 * 渲染模板。
 * @param {string} template 值模板
 * @param {Record<string, unknown>} vars 变量表，缺失的键按「取不到」处理
 * @returns {{ value: string, missing: string[] }} 渲染结果与取不到的变量名（去重、保持出现顺序）
 */
export function render(template, vars) {
  const missing = []
  const value = String(template ?? '').replace(TOKEN, (match, name, arg) => {
    // `$$` 整体匹配时 name 为 undefined，按字面 `$` 输出
    if (name === undefined) return '$'
    const resolved = resolve(name, arg, vars)
    if (resolved === undefined) {
      if (!missing.includes(name)) missing.push(name)
      return ''
    }
    return resolved
  })
  return { value, missing }
}

/**
 * 求值单个变量。返回 undefined 表示「取不到」。
 * @param {string} name 变量名
 * @param {string | undefined} arg 冒号后的参数（目前只有 random 使用）
 * @param {Record<string, unknown>} vars 变量表
 * @returns {string | undefined}
 */
function resolve(name, arg, vars) {
  switch (name) {
    case 'sessionId':
    case 'provider':
    case 'model':
    case 'baseURL':
    case 'purpose':
    case 'host': {
      const value = vars?.[name]
      return value === undefined || value === null || value === '' ? undefined : String(value)
    }
    case 'date':
      return formatDate(new Date())
    case 'time':
      return formatTime(new Date())
    case 'timestamp':
      return String(Date.now())
    case 'uuid':
      return globalThis.crypto.randomUUID()
    case 'random': {
      const n = arg === undefined || arg === '' ? 16 : Number(arg)
      if (!Number.isInteger(n) || n <= 0 || n > RANDOM_MAX) return undefined
      const bytes = new Uint8Array(Math.ceil(n / 2))
      globalThis.crypto.getRandomValues(bytes)
      let s = ''
      for (const byte of bytes) s += byte.toString(16).padStart(2, '0')
      return s.slice(0, n)
    }
    default:
      return undefined
  }
}

/**
 * 本地时区的 `YYYY-MM-DD`。
 * 用本地时区而不是 UTC：注入的时间戳通常给人看，也用于「当天」这类语义。
 * @param {Date} date
 * @returns {string}
 */
function formatDate(date) {
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

/**
 * 本地时区的 `HH:mm:ss`。
 * @param {Date} date
 * @returns {string}
 */
function formatTime(date) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

