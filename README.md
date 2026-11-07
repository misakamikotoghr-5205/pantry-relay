# Pantry Relay · 开封时钟与食材接力

把用户录入的包装标签、开封记录、库存和自有菜谱，变成**有来源的先用计划和可重放的库存消费回执**。Python 3.11+ 标准库，默认离线运行，不需要付费 API。

现有 **可操作的离线浏览器应用 + CLI + 鉴权 JSON API**。浏览器版可录入批次和自有菜谱、修改份数/估计预算/精确排除项、查看来源与阻断原因、人工审阅确认用料、刷新恢复、撤回最近一笔并导出账本。它独立运行确定性规则，不调用LLM、支付或外部API。

2026-11-06，Python生产选择器曾实际调用本地 Ollama 0.40.15 / Qwen2.5 0.5B，记录两次虚构场景运行及偏好误选局限，见[真实运行证据](docs/evidence/local-model-20261106.json)。这项Python证据不代表浏览器版调用了模型。支付宝/阿宝接入、认可平台部署与赛事提交均未完成。

## 打开交互应用

无需前端框架或运行时依赖。可直接打开 `web/index.html` 使用classic JS；如果浏览器对`file://`存储有限制，会降级为当前页内存并提示导出。也可构建后通过loopback静态服务运行：

```sh
npm run verify:web
npm run dev
```

访问 `http://127.0.0.1:5173`。`dist/`只含六个离线文件；[上传ZIP](releases/pantry-relay-offline-html.zip)根目录含`index.html`，附[字节/CRC/SHA审计](releases/package-audit.json)。准备HTML/ZIP不代表已被赛事后台接受。

初始数据明确是虚构示例，日期按当前日期平移；示例时长不是食品保鲜建议。真实使用前自行录入和核对。浏览器版已在本轮完成实际浏览器交互检查，详见[交互应用说明](docs/web-application.md)与[真实核验记录](docs/evidence/offline-web-20261107.json)。本机HTTP体验不等于支付宝部署或手机WebView验收。

## 一分钟运行 Python CLI

系统需有 IANA 时区数据（Linux 通常由 `tzdata` 提供）。在本目录执行：

```sh
python3 -m pantry_relay --db /tmp/pantry-demo.sqlite3 init examples/pantry.json
python3 -m pantry_relay --db /tmp/pantry-demo.sqlite3 plan --as-of 2026-11-04T12:00:00+08:00
python3 -m pantry_relay --db /tmp/pantry-demo.sqlite3 consume \
  --recipe tomato_eggs --key demo-dinner-20261104 --expected-revision 0 \
  --as-of 2026-11-04T12:00:00+08:00
python3 -m pantry_relay --db /tmp/pantry-demo.sqlite3 receipt demo-dinner-20261104
python3 -m pantry_relay --db /tmp/pantry-demo.sqlite3 inventory
python3 scripts/check.py
```

请使用新的数据库路径；`init` 不会覆盖已有余额或回执。`--as-of` 是 CLI 的演示/回放参数，HTTP API 始终使用服务器当前时间。固定示例的标签日期属于 **2026-11-04 的虚构数据**，不是保鲜建议。实际使用须替换为本人真实标签、记录及确认。

示例中番茄鸡蛋先分配已开封 A 批次 150 g，再分配 B 批次 50 g 和鸡蛋 2 个。缺少开封后说明的牛奶、日期冲突的酱料、只有包装日期的豆腐均保留待核查；用户排除花生后，相关菜谱无法消费。牛奶仍有实物库存，输出区分“可用库存不足”和“实物补货不足”，避免未经核查就重复购买。

## 从核查到消费

1. `plan` 展示每批物品的来源、时间约束、待核查原因和独立菜谱候选；预览不预留库存。
2. 用户核对实际包装、储存与当前状态后，用 `review --lot milk_open --input examples/review-milk.json` 补录标签信息。示例更新要求 revision 0，应在消费之前另用新数据库试验。更新只能修改来源/标签/确认等元数据，不允许偷偷改余额。
3. 消费必须带当前 `expected_revision` 和唯一幂等键。SQLite 事务重新检查时钟、过滤和库存，整道菜全部扣减或全部回滚。
4. 网络重试沿用**原参数和原幂等键**，返回同一回执，不再次扣减。数据已变化则重新取得计划。`audit` 可读取初始化、核查和消费记录。

日期只用于排序与阻断，**不能证明食物可安全食用**。系统不会从包装日期推算保质期、猜开封后时长，或把未过期等同可食用。用户确认也不会覆盖缺日期、冲突日期和经过的标签时限。日期类别不会被转换为医学或食品安全结论。过敏/忌口是用户输入标签的精确过滤，不识别未标注过敏原、交叉接触或医疗禁忌。

## 可选的真实 AI

规则角色负责标签核查、配料分配和账本；它们明确标为 `deterministic-rules`。AI 部分负责理解“清淡、步骤少、只用一种配料”等自然语言偏好，**只在已经通过门禁的自有菜谱中选择 ID**。输出严格校验，不能新增菜谱、改数量、绕过用户过滤或宣称安全。推理后检查版本与资格，真正消费时再检查一次。

先自行安装 [Ollama](https://docs.ollama.com/api/chat)、运行本地服务并安装适合机器的模型，再显式配置其已有名称：

```sh
export PANTRY_OLLAMA_MODEL=your-installed-model
python3 -m pantry_relay --db /tmp/pantry-demo.sqlite3 suggest \
  --as-of 2026-11-04T12:00:00+08:00 --prompt '只用一种配料的简单早餐'
```

此命令才会调用 `http://127.0.0.1:11434/api/chat`。请求使用 [JSON Schema 结构化输出](https://docs.ollama.com/capabilities/structured-outputs)，不使用云端付费模型、代理环境变量或 HTTP 重定向。不自动安装/下载模型。未配置、无合格菜谱、网络错误、结构错误或越权 ID 都会明确失败，余额保持不变。模型会收到用户偏好及合格自有菜谱的文本；不发送完整家庭库存。2026-11-06 的两次实际推理使用固定的 11 月 4 日虚构标签回放：第一次“一种配料”请求仍返回两道菜，其中番茄鸡蛋不符合该自然语言偏好；第二次指定燕麦粥时返回 `plain_oats`。两次均未改变库存。结构校验不保证偏好理解，须保留人工复核；这些单例不是模型质量评测。赛事所需完整公开演示视频尚未录制。

## JSON API

```sh
export PANTRY_API_TOKEN="$(python3 -c 'import secrets; print(secrets.token_urlsafe(32))')"
python3 -m pantry_relay --db /tmp/pantry-demo.sqlite3 serve
```

```sh
curl -H "Authorization: Bearer $PANTRY_API_TOKEN" http://127.0.0.1:8799/v1/plan
curl -X POST -H "Authorization: Bearer $PANTRY_API_TOKEN" \
  -H 'Content-Type: application/json' -H 'Idempotency-Key: next-dinner-20261104' \
  --data '{"recipe_id":"plain_oats","servings":1,"expected_revision":1}' \
  http://127.0.0.1:8799/v1/consume
```

固定示例日期过去后，这些 API 可能返回待核查结果，不能用客户端时间绕过门禁。只有 `/health` 和 `/openapi.json` 公开；库存、计划、回执、审计、人工核查及模型选择均需 Bearer token。Token 至少 32 个 ASCII 字符，不出现在响应或请求日志中。接口规范见 [openapi.json](openapi.json)，输入见 [docs/schema.md](docs/schema.md)。这是一户一库的服务，没有多租户账户隔离。

远程监听须显式设置 `PANTRY_ALLOW_REMOTE=1`，强 token 仍必需。公开演示部署说明见 [docs/deployment.md](docs/deployment.md)；这里没有已上线 URL，也没有阿宝私有 API。Q Muse 为赛事推荐但可选工具，后续平台提报与真实交互验证尚未完成。

## 核验与来源

`python3 scripts/check.py` 运行 26 项本地测试及独立临时 CLI 演示，生成 `output/verification.json`。测试覆盖来源/单位校验、时区和开封边界、FEFO、十进制余额、并发、幂等、事务回滚、核查版本、HTTP 鉴权和模型输出约束。单元测试中的模型 HTTP 响应是模拟值；另存的两次真实模型运行只证明相应调用及门禁结果，不代表模型质量通过验证，也不证明支付宝平台已联通。

家庭库存、临期提醒、菜谱和购物单已有成熟实现。对 Grocy（MIT）、Mealie（AGPL-3.0）的固定提交比较及本项目实际差异见 [docs/landscape.md](docs/landscape.md)。本项目独立实现，仅借鉴产品组织方式，未复制两者代码或资源。

赛事为支付宝「智能体涌现奖」第一赛季“AI 生活好帮手”方向。最新延期公告写 **2026-12-06 零点（北京时间）**，按 **2026-12-05 16:00 UTC** 准备；规则正文另有时刻冲突，须最终核对门户。个人身份/实名认证资格尚待使用者确认，具体规则和交付差距见 [docs/competition.md](docs/competition.md)。本作品专为该赛事候选准备，不能将同一作品重复投其他大赛。

MIT，见 [LICENSE](LICENSE)。

## QMuse React 工程

`qmuse/`新增可独立构建的真实React+Vite版本，保留同一核心门禁逻辑；原离线HTML包不变。运行 `cd qmuse && npm ci && npm run dev`。官方CLI的只读本地格式预检、构建和桌面浏览器交互已完成，仍未登录QMuse、导入、发布或交件。详见[工程核查](docs/qmuse-project.md)和[真实React浏览器记录](docs/evidence/qmuse-react-web-20261107.json)。

可上传体验包另有[React生产HTML ZIP](releases/pantry-relay-react-html.zip)（约97KB，含原始许可）与[打包校验](releases/react-package-audit.json)。该包已在本地生产预览实跑，不代表支付宝后台接受上传。
