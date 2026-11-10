/**
 * Config schema、默认值补齐与 Host 侧配置审计。
 *
 * `.volatile()` 必须落在**整个 section** 上：schemastery 禁止在数组元素内部标 volatile
 * （会抛 "volatile fields require a fixed object path without an enclosing volatile field"）。
 * 整节 volatile 的收益是配置保存后不再重启插件，下一次请求即读到新值。
 */

import Schema from '@deepseek-ai/schemastery'
import { isUsableHeaderName, isUsableHeaderValue, isReserved } from './rules.js'

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description('总开关'),
  backend: Schema.union(['auto', 'headers', 'fetch']).default('auto')
    .description('auto=优先扩展点+fetch 兜底；headers=只用扩展点；fetch=只用 fetch 包装'),
  rules: Schema.array(Schema.object({
    // 不用 required()：用户手写 patch 漏 id 时会让整个插件加载失败。
    // 用空默认值 + normalizeConfig() 补 rule-N，容错优先。
    id: Schema.string().default('').description('规则标识，用于表单定位与调试日志'),
    enabled: Schema.boolean().default(true).description('该条是否启用'),
    comment: Schema.string().default('').description('备注'),
    match: Schema.object({
      provider: Schema.string().default('').description('路由 id，留空不限，如 newapi-responses'),
      model: Schema.string().default('').description('模型 id，留空不限；支持 * 结尾前缀匹配'),
      host: Schema.string().default('').description('目标域名，留空不限；仅 fetch 后端可见'),
    }).description('匹配条件，三者同时满足才命中'),
    headers: Schema.dict(Schema.string()).description('头名 → 值模板，值支持 ${变量}'),
    order: Schema.number().default(0).description('数值小的先应用，同头名后者覆盖前者'),
  })).default([]).description('注入规则表'),
  onMissingVariable: Schema.union(['skip', 'empty', 'error']).default('skip')
    .description('占位符变量取不到时的策略'),
  debug: Schema.boolean().default(false).description('逐请求日志，默认关闭'),
}).volatile()

const BACKENDS = new Set(['auto', 'headers', 'fetch'])
const ON_MISSING = new Set(['skip', 'empty', 'error'])

/** 单条规则的默认值。id 单独处理（需按序号生成），故不放进展开链的末尾 */
const RULE_DEFAULTS = {
  enabled: true,
  comment: '',
  order: 0,
  match: { provider: '', model: '', host: '' },
  headers: {},
}

const DEFAULTS = {
  enabled: true,
  backend: 'auto',
  rules: [],
  onMissingVariable: 'skip',
  debug: false,
}

/**
 * 补齐缺失字段并做可修复的规整，不覆盖用户已给的合法值。
 *
 * 必要性：profile 里同名 id 的 Loader 行会**整体替换** config（不深合并），
 * 因此 apply 拿到的可能是缺项对象，不能假设宿主给了完整结构。
 *
 * 规整范围（Host 侧与客户端 `normalizeDraft` 对称，见 `auditConfig`）：
 * - 枚举越界回落默认值，避免 `backend: 'bogus'` 让两条后端都不工作
 * - 规则 id 重复时加后缀，保证每条规则有可定位的唯一标识
 * - `headers` 只保留字符串键与字符串值
 * @param {object | undefined} raw
 * @returns {object}
 */
export function normalizeConfig(raw) {
  const cfg = raw && typeof raw === 'object' ? raw : {}
  const rules = Array.isArray(cfg.rules) ? cfg.rules : []
  const seen = new Set()
  const normalized = []
  for (const rule of rules) {
    if (!rule || typeof rule !== 'object') continue
    const index = normalized.length
    let id = typeof rule.id === 'string' && rule.id !== '' ? rule.id : `rule-${index + 1}`
    while (seen.has(id)) id = `${id}-`
    seen.add(id)
    normalized.push({
      ...RULE_DEFAULTS,
      ...rule,
      id,
      order: Number.isFinite(rule.order) ? rule.order : index * 10,
      match: { ...RULE_DEFAULTS.match, ...(rule.match ?? {}) },
      headers: toHeaders(rule.headers),
    })
  }
  return {
    ...DEFAULTS,
    ...cfg,
    backend: BACKENDS.has(cfg.backend) ? cfg.backend : DEFAULTS.backend,
    onMissingVariable: ON_MISSING.has(cfg.onMissingVariable)
      ? cfg.onMissingVariable
      : DEFAULTS.onMissingVariable,
    rules: normalized,
  }
}

/**
 * 把任意输入规整成 `头名 → 字符串值` 的普通对象。
 * @param {unknown} headers
 * @returns {Record<string, string>}
 */
function toHeaders(headers) {
  if (!headers || typeof headers !== 'object' || Array.isArray(headers)) return {}
  const out = {}
  for (const [name, value] of Object.entries(headers)) {
    if (value === undefined || value === null) continue
    out[name] = String(value)
  }
  return out
}

/**
 * 审计配置，返回人类可读的问题清单（供 Host 侧启动/热更新时记录一次）。
 *
 * 与客户端 `headerProblems` 的分工：客户端拦截用户编辑，Host 侧拦截手写 patch。
 * 这里只报告，不改配置 —— 修复由 `normalizeConfig` 完成。
 *
 * `normalizeConfig` 只对 `backend` / `onMissingVariable` 做了白名单兜底，
 * 顶层的 `enabled` / `debug` 是直接透传的：写成字符串 "false" 时
 * `cfg.enabled === false` 与 `cfg.debug === true` 都会失效，故这里补上类型检查。
 * @param {object} cfg 已 normalize 的配置
 * @returns {string[]}
 */
export function auditConfig(cfg) {
  const problems = []
  if (cfg?.enabled !== undefined && typeof cfg.enabled !== 'boolean') {
    problems.push('enabled 不是布尔值，"false" 之类的字符串不会关闭插件')
  }
  if (cfg?.debug !== undefined && typeof cfg.debug !== 'boolean') {
    problems.push('debug 不是布尔值，"true" 之类的字符串不会打开调试日志')
  }
  const rules = Array.isArray(cfg?.rules) ? cfg.rules : []
  rules.forEach((rule, index) => {
    const where = `rules[${index}]${rule?.id ? ` (${rule.id})` : ''}`
    if (!rule || typeof rule !== 'object') {
      problems.push(`${where}: 不是对象，已忽略`)
      return
    }
    if (rule.enabled !== undefined && typeof rule.enabled !== 'boolean') {
      problems.push(`${where}: enabled 不是布尔值`)
    }
    if (!Number.isFinite(rule.order)) problems.push(`${where}: order 不是有限数字`)
    const headers = rule.headers && typeof rule.headers === 'object' ? rule.headers : {}
    for (const [name, value] of Object.entries(headers)) {
      if (isReserved(name)) {
        problems.push(`${where}: 请求头 "${name}" 是保留头，注入会被忽略`)
      } else if (!isUsableHeaderName(name)) {
        problems.push(`${where}: 请求头名 "${name}" 不是合法的 HTTP token`)
      }
      if (!isUsableHeaderValue(value)) {
        problems.push(`${where}: 请求头 "${name}" 的值含非 Latin-1 或换行字符，发送时会被 Headers 拒绝`)
      }
    }
  })
  return problems
}

export { RULE_DEFAULTS, DEFAULTS }
