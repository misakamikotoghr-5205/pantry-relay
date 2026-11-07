# 数据、门禁与回执契约

本页描述Python CLI/API的v1契约。新增离线浏览器应用复用其库存结构，另有本地预算、审阅及撤回状态外层；具体差异与容量限制见[交互应用说明](web-application.md)。下文“不支持退回”的限制针对Python API，不能据此推断浏览器没有最近一笔记账撤回。

完整可运行输入是 [examples/pantry.json](../examples/pantry.json)。所有对象拒绝未知字段；JSON 拒绝重复字段、非有限数字和超过 1 MB 的输入。数量以最多三位小数的十进制**字符串**表示，避免浮点误差。`each` 必须是整数；只支持 `g`、`ml`、`each`，同一食材及其菜谱单位必须一致，不做隐式体积/重量换算。

## 项目结构

| 字段 | 内容 |
|---|---|
| `schema_version` | 整数 `1` |
| `timezone` | IANA 时区，例如 `Asia/Shanghai`；无时区时间戳被拒绝 |
| `sources` | 1–1000 条 `{id, kind, text}`，ID 唯一，文本为用户原始转录/记录 |
| `lots` | 1–1000 批库存，ID 唯一，允许余额 0 |
| `recipes` | 1–200 个用户自有菜谱，每道 1–50 种食材 |
| `preferences` | `{allergens: [标签], avoid_ingredients: [食材ID]}` |

来源种类：`user_label`（用户抄录包装标签）、`user_record`（用户记录）、`user_confirmation`（本人确认）、`user_recipe`（本人菜谱）。来源是**可追溯的用户输入**，不是系统已独立核实的证据。标签和包装日期引用 `user_label`；开封记录引用 `user_record`；确认引用 `user_confirmation`；菜谱引用 `user_recipe`。`user_limit` 是用户自行录入的计划日期，引用用户记录/确认，不得伪装成包装期限。

每批物品必需 `id/name/ingredient/quantity/unit/allergens/labels/confirmed_usable`。`confirmed_usable: true` 必需 `confirmation_source_id`。`labels` 是 `{kind,date,source_id}` 数组，`kind` 为 `use_by/best_before/user_limit`，日期严格 `YYYY-MM-DD`。不同类别可并存，按最早输入约束优先；同一类别出现不同日期则等待用户解决。

可选字段：

- `packed_on: {date,source_id}`：包装日期不产生默认保质期。
- `opened_at` + `opened_source_id`：带明确时区偏移的开封时间和记录来源。
- `after_open_hours` + `after_open_source_id`：用户从自己标签录入的整数小时（1–8760），不猜测食品种类的时长。未开封时不开始计时。
- `confirmation_source_id`：本人核查实际标签、储存和当前状态的声明来源。

每道菜必需 `{id,name,ingredients,allergens,source_id}`，其中食材为 `{ingredient,quantity,unit}`。菜谱文本/做法放在对应 `user_recipe` 来源中。本系统只使用录入菜谱，不抓取网站或让模型生成替代品。

## 时间与门禁

无标签计划日期（即使有包装/开封记录）、同类标签冲突、未来包装/开封记录、时间顺序矛盾、未输入开封后标签指示、经过输入时限、未确认、用户过滤均阻断该批物品。空余额标为 `empty`。按项目本地日期结束作为日期字段的**计划截止约定**；开封间隔达到 `opened_at + after_open_hours` 即阻断。该约定不是对标签法律含义、食物安全或可食用性的解释。发生不确定应核对包装及本人实际情况。

合格批次按最早约束时间、批次 ID 分配，允许跨批次；持有实物不等于可用于消费。`eligible_stock_shortages` 指可分配不足，包含待核查批次；`shopping_list` 仅为实物数量不足。多个菜谱是相互独立的预览，不能当成全部可同时执行的预约菜单。当前不支持进货、退货、单位转换、退回已消费数量；重新导入新库前应自行保存原账本。

## 人工核查

`POST /v1/lots/{lot_id}/review` 或 CLI `review` 接收：

```json
{"expected_revision":0,"changes":{"after_open_hours":48,"after_open_source_id":"new_label"},"sources":[{"id":"new_label","kind":"user_label","text":"仅示意：用户抄录实际标签后写入自己的说明"}]}
```

时长仅为结构示意，不能复制到真实食品。`changes` 仅允许标签、包装/开封信息、确认、过敏标签；可用 `null` 删除可选元数据。数量、物品身份和既有来源不可覆盖。整体重新校验后版本加一，审计记录变化字段与新增来源 ID；完整来源保留在库存和消费回执中。先前预览因此失效。

## 消费与恢复

消费需 `{recipe_id, servings:1..20, expected_revision}` + 12–128 位字母/数字/下划线/连字符 `Idempotency-Key`。事务中重算门禁和每批分配；不足时返回 `409 REVIEW_OR_STOCK_REQUIRED`，余额及审计不变。版本不同返回 `409 CONFLICT`。同键同参数返回持久化原回执（`replayed:true`），即使后来时间已过仍只恢复先前成功记录；同键异参数拒绝。首次失败不会保存成功回执，修复数据后可重新计划并使用新的消费意图。

回执包含原菜谱来源、消费时刻、前后版本、各批 `before/used/remaining`、标签时间约束、确认来源、完整来源快照和 `safety_guarantee:false`。这记录的是软件库存扣减，不证明实际做饭、取用或食物安全。HTTP 禁止回填时间，CLI `--as-of` 为本机模拟/回放，由本机操作者自行负责。
