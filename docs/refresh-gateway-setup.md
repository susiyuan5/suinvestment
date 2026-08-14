# 刷新网关配置

网页只调用受限网关，不接触 GitHub Token。网关只允许两个固定任务：

- `today` → `update-short-term-signals.yml`
- `universe` → `update-idea-engine.yml`

部署前在 Cloudflare Worker Secret 中设置：`GITHUB_OWNER`、`GITHUB_REPO`、`GITHUB_TOKEN`、`REFRESH_ACCESS_SECRET`，并设置变量 `ALLOWED_ORIGIN`。GitHub Token 只需要目标仓库 Actions 读写和 Contents 只读权限。不要把任何真实值写入仓库、日志、URL 或页面。

当前仓库只提交网关代码、示例配置和文档；未提供 Cloudflare 凭据，因此不声称网关已部署。部署后将网关地址填入页面设置中的“刷新网关地址”，并由用户主动保存授权码；默认只使用 sessionStorage。
