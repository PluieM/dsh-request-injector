/**
 * dsh-request-injector — Host 半侧入口。
 *
 * 职责：组装规则仓库与日志，注册四个 effect：
 *   1. 关闭 schema 自动生成的设置表单（本插件自带 client 页面）
 *   2. `llm/stream` 监听器：把请求上下文绑到 ALS
 *   3. 两个注入后端：扩展点（A）与 fetch 包装（B）
 *   4. 配置审计：加载时与每次热更新后各跑一次，把「手写 patch 的明显错误」记进日志
 */

import { normalizeConfig, auditConfig } from './schema.js'
import { RuleStore } from './rules.js'
import { createLog } from './log.js'
import { registerStreamContext } from './context.js'
import { registerHeadersBackend } from './backend-headers.js'
import { registerFetchBackend } from './backend-fetch.js'

export { Config } from './schema.js'

export const name = 'dsh-request-injector'

/** 不 inject 任何服务：两个后端都是纯事件/全局副作用，settings 是可选依赖 */
export const inject = []

/**
 * @param {object} ctx cordis 上下文
 * @param {object | undefined} config Loader 行上的 config
 */
export function apply(ctx, config) {
  // config 在整节 volatile 时是 live 引用（带 .get()），也可能是普通对象，两种都兼容
  const read = () => normalizeConfig(typeof config?.get === 'function' ? config.get() : config)
  const store = new RuleStore(read)
  const log = createLog(read, ctx.logger)

  // 关闭 schema 自动表单（本插件自带 client 页面）。
  // settings 是可选依赖：放进 inject 子级，迟加载或被替换的 settings 服务也会采用该策略。
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.effect(
      () => settingsCtx.get('settings').configure({ auto: false }, ctx.fiber),
      'request-injector settings presentation',
    )
  })

  // 三个注册函数各自返回清理函数；后端在每次请求时调用 store.match(...)，
  // 天然拿到最新配置，无需监听配置变更事件
  ctx.effect(() => registerStreamContext(ctx), 'request-injector stream context')
  ctx.effect(() => registerHeadersBackend(ctx, { store, log }), 'request-injector headers backend')
  ctx.effect(() => registerFetchBackend(ctx, { store, log }), 'request-injector fetch backend')

  // 配置审计：客户端表单只拦得住 UI 编辑，手写 cordis.patch.yml 是文档公开的回退路径，
  // 这类配置不会经过任何 UI 校验，因此 Host 侧补一次「只报告、不改配置」的审计。
  // 整节 volatile 时配置变更不重启插件，只有 loader/volatile-update 事件可感知。
  let auditedSignature = undefined
  const audit = () => {
    const cfg = read()
    const signature = JSON.stringify({ backend: cfg.backend, onMissingVariable: cfg.onMissingVariable, rules: cfg.rules })
    if (signature === auditedSignature) return
    auditedSignature = signature
    for (const problem of auditConfig(cfg)) log.warn(problem)
  }
  audit()
  ctx.on('loader/volatile-update', audit)

  log.info(`loaded (backend=${read().backend}, rules=${read().rules.length})`)
}
