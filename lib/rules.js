/**
 * 规则模型：匹配、保留头判定、头名/头值校验、规则标识。
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

/** 每次构造 RuleStore 递增，用于拼接规则去重键 */
let instanceSeq = 0

/**
 * 规则仓库。每次调用都从 `read()` 取最新配置，因此配置热更新无需额外监听。
 */
export class RuleStore {
  /** @param {() => object} read 返回最新配置快照的读取函数 */
  constructor(read) {
    this.read = read
    this.instanceId = ++instanceSeq
  }

  /** 最新配置快照。读不到时返回空对象，等价于「无规则」，不注入 */
  config() {
    return this.read() ?? {}
  }

  /**
   * 规则去重键。
   *
   * 不能直接用 `rule.id`：`normalizeConfig` 会给缺 id 的规则补 `rule-1`/`rule-2`，
   * 两个插件实例（热重载、多 profile）几乎必然撞 id，而 ALS store 里的
   * `appliedRuleIds` 是跨实例共享的 —— 撞 id 会让后装的实例误以为「已注入过」而跳过。
   * 加上实例序号后键在进程内唯一。
   * @param {string} id
   * @returns {string}
   */
  ruleKey(id) {
    return `${this.instanceId}:${id}`
  }

  /**
   * 返回命中且启用的规则，按 order 升序。
   * @param {{ provider?: string, model?: string, host?: string }} target
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
 * @param {{ provider?: string, model?: string, host?: string }} match
 * @param {{ provider?: string, model?: string, host?: string }} target
 * @returns {boolean}
 */
function matches(match, target) {
  return matchString(match.provider, target.provider)
    && matchModel(match.model, target.model)
    && matchString(match.host, target.host)
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

export { matches, matchString, matchModel, HEADER_NAME }
