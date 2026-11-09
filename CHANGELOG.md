# Changelog

## 0.1.0

首个版本。

- 按 `provider` / `model` / `host` 匹配注入请求头，`model` 支持尾部 `*` 前缀匹配
- 请求头值支持 `${变量}` 占位符（含 `random:N`）与 `$$` 转义，不做递归展开
- 两条注入后端：`llm-pi-ai/request-headers` 扩展点与 `globalThis.fetch` 包装，`backend: auto` 同时启用并按规则去重
- 变量缺失策略 `skip` / `empty` / `error`
- 保留请求头保护（`user-agent`、`authorization`、`x-dsh-*` 等）
- 插件行配置页：基本设置 + 规则卡片（增删、排序、逐头校验）+ 变量速查表，整表提交
- 配置整节 `volatile`，保存后立即生效，无需重启
- 单个请求头写入失败（非法头名或非 Latin-1 值）只跳过该头，不影响同一请求的其余规则
- 多实例链式包装 `globalThis.fetch` 时按层链表卸载，全部卸载后回到原始实现
- `onMissingVariable: error` 会让本次请求失败（此前的实现会吞掉错误继续请求）
- 配置审计：启动与热更新时对手写 patch 中的越界枚举、非法头名、非 Latin-1 头值给出告警
- 扩展点疑似失效（宿主升级后 `llm-pi-ai/request-headers` 不再触发）时输出一次性提示
