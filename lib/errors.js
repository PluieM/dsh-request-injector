/**
 * 插件内部错误类型。
 *
 * 单独定义是为了在 `catch` 里区分「插件自身的意外错误」与「用户显式要求的失败」：
 * 前者必须吞掉（否则一个配置问题会让整个对话不可用），
 * 后者（`onMissingVariable: 'error'`）必须原样上抛，让请求真的失败。
 */

/**
 * 用户选择 `onMissingVariable: 'error'` 时，占位符取不到值所抛的错误。
 * 两个后端都必须把它透传给宿主，而不是当作「注入失败」吞掉。
 */
export class MissingVariableError extends Error {
  /**
   * @param {string[]} missing 取不到的变量名
   * @param {string} headerName 出问题的头名
   */
  constructor(missing, headerName) {
    super(`missing variables for header "${headerName}": ${missing.join(', ')}`)
    this.name = 'MissingVariableError'
    this.missing = missing
    this.headerName = headerName
  }
}
