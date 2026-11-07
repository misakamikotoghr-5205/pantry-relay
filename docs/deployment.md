# 可公开演示的调用契约

另有已实现的[离线交互应用](web-application.md)：`npm run build:web`生成`dist/`与`releases/pantry-relay-offline-html.zip`，根入口`index.html`，全部资源本地。它独立运行，不调用下述Python API或模型。保留现有Sites manifest由主线程管理；HTML/ZIP准备与本人预览不能等同支付宝认可部署或提交。

本项目已有 HTTP 路由与 OpenAPI 描述，Python HTTP服务当前未部署，也没有阿宝/QMuse连接。另已发布仅所有者可访问的离线静态预览，不能当作这个后端部署或平台交件。正式赛事可按官方门户接受的 URL 或 ZIP 交付；Q Muse 为可选路线，其实际提报需后续平台验证，不能由一个通用 API 推断已接入。

本地启动：

```sh
python3 -m pantry_relay --db /absolute/path/pantry.sqlite3 init examples/pantry.json
export PANTRY_API_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
python3 -m pantry_relay --db /absolute/path/pantry.sqlite3 serve --host 127.0.0.1 --port 8799
```

数据库默认文件权限 0600。使用绝对路径和持久磁盘，一户一库；退出后回执仍在，`init` 不覆盖旧账本。复制数据库前停止写入。模型不是必需依赖，只有显式 `suggest` 或 `/v1/model-suggest` 调用；服务运行用户需能访问同机 Ollama，不能把容器内 `127.0.0.1` 误当宿主机。

公网演示应由 HTTPS 反向代理转发到 loopback 服务，为演示者配置独立 token，并仅放入匿名/虚构演示数据。标准库 HTTP 服务用于原型交互，没有多租户身份、TLS 终止、配额、速率限制或高可用部署设施。直接远程 bind 要显式 `PANTRY_ALLOW_REMOTE=1`，仍需强 token；不应把 Bearer token 放 URL、仓库或录屏中。`/health`、`/openapi.json` 公开，其余路径都检查 token；日志不记录请求详情。

评审调用顺序：鉴权 `GET /v1/plan` → 查看 `revision`/来源/待核查项 → 必要时经用户实际核查 `POST /v1/lots/{id}/review` → 再次取得计划 → `POST /v1/consume`（当前版本 + 幂等键）→ `GET /v1/receipts/{key}`。响应丢失时使用原键和原参数恢复回执，不能换新键重复扣减。HTTP 不接受模拟时刻或查询参数。日期门禁随服务器时间变化，正式演示须换为本人确认且当前有效的数据。

模型推理只负责偏好匹配，不能自动消费。未安装真实模型时 `/v1/model-suggest` 返回 503，不能将离线规则结果或测试 mock 输出作为真实 AI 展示。实际部署/模型/提报清单见 [competition.md](competition.md)。
