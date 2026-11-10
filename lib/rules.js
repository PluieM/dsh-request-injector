/**
 * 规则模型：匹配、保留头判定、头名/头值校验。
 *
 * 匹配语义：三个条件（provider / model / host）同时满足才命中；空字符串表示「不限」。
 * 排序语义：按 order 升序应用，同一头名后者覆盖前者（Array#sort 是稳定排序）。
 */

/** 保留头名单：这些头由宿主或 HTTP 栈管理，注入会被覆盖或破坏请求 */
const RESERVED = new Set([
  'user-agent',        // Harness 归因头，prepareHeaders 之后被 attributionHeaders() 强制覆盖
  'authorization',     // SDK 在 fetchWithTimeout 内重写，且涉及凭据
  'content-length',    // 由 fetch/undici 按实际 body 计算
  'host',              // HTTP 层由 URL 决定
  'transfer-encoding', // 传输层控制
  'connection',        // 由 HTTP 栈管理，手改会破坏连接复用语义
])

/** 宿主保留前缀 */
const RESERVED_PREFIX = 'x-dsh-'

/** RFC 7230 token：合法的头名字符集 */
const HEADER_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

/**
 * 保留头判定，大小写不敏感。
 * @param {string} name 头名
 * @returns {boolean}
 */
export function isReserved(name) {
  const key = String(name ?? '').trim().toLowerCase()
  return RESERVED.has(key) || key.startsWith(RESERVED_PREFIX)
}

/**
 * 头名是否合法（RFC 7230 token 且不是保留头）。
 * @param {string} name
 * @returns {boolean}
 */
export function isUsableHeaderName(name) {
  const key = String(name ?? '').trim()
  return HEADER_NAME.test(key) && !isReserved(key)
}

/**
 * 头值是否能被 Headers.set 接受。
 *
 * `Headers.set` 对非 Latin-1（中文、emoji）、CR、LF、NUL 都会抛 TypeError；
 * 这些值在 Host 侧提前挡掉，避免运行时抛错打断整条规则链。
 * @param {string} value
 * @returns {boolean}
 */
export function isUsableHeaderValue(value) {
  const text = String(value ?? '')
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i)
    if (code === 0 || code === 0x0a || code === 0x0d) return false
    if (code > 0xff) return false
  }
  return true
}

/**
 * 规则仓库。每次调用都从 `read()` 取最新配置，因此配置热更新无需额外监听。
 */
export class RuleStore {
  /** @param {() => object} read 返回最新配置快照的读取函数 */
  constructor(read) {
    this.read = read
  }

  /** 最新配置快照。读不到时返回空对象，等价于「无规则」，不注入 */
  config() {
    return this.read() ?? {}
  }

  /**
   * 返回命中且启用的规则，按 order 升序。
   * @param {{ provider?: string, model?: string, host?: string, contextAvailable?: boolean }} target
   * @returns {object[]}
   */
  match(target) {
    const cfg = this.config()
    const rules = Array.isArray(cfg.rules) ? cfg.rules : []
    return rules
      .filter((rule) => rule && rule.enabled !== false)
      .filter((rule) => matches(rule.match ?? {}, target))
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  }
}

/**
 * 三个条件同时满足才命中。
 *
 * `target.contextAvailable === false` 表示调用发生在 `llm/stream` 之外
 * （见 lib/context.js 的 getStore()）。此时 provider / model 根本不可知，
 * 不能把「规则没写 provider」当成「匹配任意 provider」——那会让头泄漏到
 * 进程内所有 fetch 上。只允许显式约束了 host 的规则命中。
 *
 * @param {{ provider?: string, model?: string, host?: string }} match
 * @param {{ provider?: string, model?: string, host?: string, contextAvailable?: boolean }} target
 * @returns {boolean}
 */
function matches(match, target) {
  if (target.contextAvailable === false) {
    // 无 stream 上下文：provider / model 不存在，只认显式写过的 host
    return String(match.host ?? '').trim() !== '' && matchHost(match.host, target.host)
  }
  return matchString(match.provider, target.provider)
    && matchModel(match.model, target.model)
    && matchHost(match.host, target.host)
}

/**
 * 空 = 不限；否则精确相等。两侧都 trim，避免手写配置里的空白造成「看着一样却不命中」。
 * @param {string} pattern
 * @param {string | undefined} value
 * @returns {boolean}
 */
function matchString(pattern, value) {
  const p = String(pattern ?? '').trim()
  if (p === '') return true
  return p === String(value ?? '').trim()
}

/**
 * host 匹配，大小写不敏感。
 *
 * host 由 URL 规范化产生，WHATWG 规范必然把它转成小写；用户手写 `API.Example.com`
 * 若按大小写敏感比较会永远不命中。provider / model 不在此列：它们的值由宿主传入，
 * 用户本就应当精确匹配。
 * @param {string} pattern
 * @param {string | undefined} value
 * @returns {boolean}
 */
function matchHost(pattern, value) {
  const p = String(pattern ?? '').trim().toLowerCase()
  if (p === '') return true
  return p === String(value ?? '').trim().toLowerCase()
}

/**
 * 空 = 不限；否则精确相等，或以 `*` 结尾时按前缀匹配（`deepseek-v4-*` 命中 `deepseek-v4-flash`）。
 * @param {string} pattern
 * @param {string | undefined} value
 * @returns {boolean}
 */
function matchModel(pattern, value) {
  const p = String(pattern ?? '').trim()
  if (p === '') return true
  const v = String(value ?? '').trim()
  if (p.endsWith('*')) return v.startsWith(p.slice(0, -1))
  return p === v
}

export { matches, matchString, matchModel, matchHost, HEADER_NAME }
