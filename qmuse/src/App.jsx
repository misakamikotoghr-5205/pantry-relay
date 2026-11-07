import React, { useEffect, useMemo, useRef, useState } from "react";
import { Core as C, Demo } from "./core.mjs";

const STORAGE_KEY = "pantry-relay-qmuse-react-v1";
const UNIT = { g: "克", ml: "毫升", each: "个" };
const FOOD = {
  tomato: "番茄",
  egg: "鸡蛋",
  oat: "燕麦",
  milk: "牛奶",
  peanut: "花生",
  sauce: "酱料",
  tofu: "豆腐",
  pasta: "意面",
};
const KIND = {
  use_by: "包装食用期限",
  best_before: "包装最佳赏味期",
  user_limit: "本人计划日期",
  after_open_label: "录入的开封后时限",
};
const now = () => new Date().toISOString();
const money = (value) =>
  value == null ? "未录估计" : `¥${(value / 100).toFixed(2)}`;
const uid = (prefix) =>
  `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 9)}`;
const splitTags = (raw) =>
  raw
    .split(/[,，]/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
function cents(raw) {
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(raw))
    throw new Error("金额须为非负数，最多两位小数。");
  const [whole, fraction = ""] = raw.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}
function freshSession() {
  const demo = Demo.makeDemo();
  return {
    format: "pantry-relay-react-local",
    version: 1,
    example: true,
    state: C.createState(demo.project, demo.settings),
  };
}
function loadSession() {
  let raw = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch (_) {
    return {
      session: freshSession(),
      raw,
      available: false,
      message: "存储不可用；当前页仍可操作，请导出留存。",
    };
  }
  if (raw) {
    try {
      const value = C.parseInput(raw);
      if (
        value.format !== "pantry-relay-react-local" ||
        value.version !== 1 ||
        typeof value.example !== "boolean"
      )
        throw new Error("格式不正确");
      return {
        session: { ...value, state: C.validateState(value.state) },
        raw,
        available: true,
        message: "已恢复本浏览器账本；待执行的审阅不会恢复。",
      };
    } catch (_) {
      return {
        session: freshSession(),
        raw,
        available: true,
        message: "旧存档无法通过核验，已开启虚构示例；旧数据未用于扣减。",
      };
    }
  }
  return {
    session: freshSession(),
    raw,
    available: true,
    message: "虚构示例已就绪；日期随当天平移，不是食品保鲜建议。",
  };
}
function settingDraft(state) {
  return {
    servings: String(state.settings.servings),
    budget: (state.settings.budget_cents / 100).toFixed(2),
    allergens: state.project.preferences.allergens.join(", "),
    avoid: [...state.project.preferences.avoid_ingredients],
    simple: state.settings.simple_first,
  };
}
function foodName(project, ingredient) {
  return (
    FOOD[ingredient] ||
    project.lots.find((lot) => lot.ingredient === ingredient)?.name ||
    ingredient
  );
}
function foodOptions(project) {
  return [...new Set(project.lots.map((lot) => lot.ingredient))].map((id) => [
    id,
    foodName(project, id),
  ]);
}
function addSource(project, kind, raw) {
  if (!raw.trim()) throw new Error("请填写对应的来源原文。");
  const id = uid("src");
  project.sources.push({ id, kind, text: raw.trim() });
  return id;
}
function localTimeInput(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
function download(value) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value)], { type: "application/json" }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = "pantry-relay-react-ledger.json";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function SourceDetails({ project, ids }) {
  const entries = [...new Set(ids.filter(Boolean))]
    .map((id) => project.sources.find((source) => source.id === id))
    .filter(Boolean);
  return (
    <details>
      <summary>查看来源原文</summary>
      {entries.map((source) => (
        <p className="source" key={source.id}>
          {source.text}
        </p>
      ))}
    </details>
  );
}
function Modal({ title, onClose, children }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      if (dialog.open) dialog.close();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby="dialog-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-top">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" onClick={onClose} aria-label="关闭对话框">
          ×
        </button>
      </div>
      {children}
    </dialog>
  );
}
function SettingsForm({ draft, setDraft, project, onApply, dirty }) {
  const set = (key, value) => setDraft((old) => ({ ...old, [key]: value }));
  return (
    <form
      className="settings"
      onSubmit={(event) => {
        event.preventDefault();
        onApply();
      }}
    >
      <div className="field-row">
        <label>
          份数
          <input
            type="number"
            min="1"
            max="20"
            step="1"
            required
            value={draft.servings}
            onChange={(event) => set("servings", event.target.value)}
          />
        </label>
        <label>
          估计成本上限 · 元
          <input
            type="number"
            min="0"
            step="0.01"
            required
            value={draft.budget}
            onChange={(event) => set("budget", event.target.value)}
          />
        </label>
      </div>
      <label>
        排除过敏标签<span className="hint">逗号分隔，仅匹配录入标签</span>
        <input
          value={draft.allergens}
          onChange={(event) => set("allergens", event.target.value)}
          placeholder="例如 peanut, milk"
        />
      </label>
      <label>
        不使用的食材
        <select
          multiple
          size="3"
          value={draft.avoid}
          onChange={(event) =>
            set(
              "avoid",
              [...event.target.selectedOptions].map((option) => option.value),
            )
          }
        >
          {foodOptions(project).map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.simple}
          onChange={(event) => set("simple", event.target.checked)}
        />
        同等可用时，优先食材种类少的菜谱
      </label>
      <button type="submit">应用偏好并重新计算</button>
      {dirty && (
        <small className="draft-warning">
          修改尚未应用；先保存偏好，再审阅用料。
        </small>
      )}
      <small>
        成本来自你填写的估计，不是实时价格、采购或付款。每道菜独立预览，不预留库存。
      </small>
    </form>
  );
}
function Stock({ state, plan, onReview }) {
  const count = (status) =>
    plan.lot_review.filter((review) => review.status === status).length;
  return (
    <section className="stock-panel" aria-labelledby="stock-title">
      <div className="section-top">
        <div>
          <p className="eyebrow">01 / WHAT IS HERE</p>
          <h2 id="stock-title">手边的食材</h2>
        </div>
        <span className="small">库存版本 {state.revision}</span>
      </div>
      <div className="metrics">
        {[
          [count("eligible_user_confirmed"), "通过记录门禁"],
          [count("hold"), "待核查 / 排除"],
          [count("empty"), "空批次"],
        ].map(([value, label]) => (
          <div className="metric" key={label}>
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <p className="small">
        核查时刻 {new Date(plan.as_of).toLocaleString()} · 标签按{" "}
        {state.project.timezone} 比较
      </p>
      {state.project.lots.map((lot) => {
        const review = plan.lot_review.find((item) => item.lot_id === lot.id);
        return (
          <article className="lot" key={lot.id}>
            <div className="lot-top">
              <div>
                <h3>{lot.name}</h3>
                <span
                  className={`badge ${review.status === "hold" ? "hold" : review.status === "empty" ? "empty" : ""}`}
                >
                  {review.status === "hold"
                    ? "待核查 / 已排除"
                    : review.status === "empty"
                      ? "已记为空"
                      : "用户已核查 · 通过记录门禁"}
                </span>
              </div>
              <div className="amount">
                {lot.quantity}
                <span>{UNIT[lot.unit]}</span>
              </div>
            </div>
            {review.status !== "empty" && review.reasons.length > 0 && (
              <ul className="lot-reasons">
                {review.reasons.map((reason, index) => (
                  <li key={index}>{reason.detail}</li>
                ))}
              </ul>
            )}
            <p className="small">
              {lot.labels
                .map((label) => `${KIND[label.kind]} ${label.date}`)
                .join("；") || "没有录入有来源的计划日期"}
            </p>
            <SourceDetails
              project={state.project}
              ids={[
                ...lot.labels.map((label) => label.source_id),
                lot.packed_on?.source_id,
                lot.opened_source_id,
                lot.after_open_source_id,
                lot.confirmation_source_id,
              ]}
            />
            <div className="lot-footer">
              <span className="small">
                {foodName(state.project, lot.ingredient)}
              </span>
              <button onClick={() => onReview(lot.id)}>核查 / 修正记录</button>
            </div>
          </article>
        );
      })}
    </section>
  );
}
function Candidates({ state, plan, onReview, onEdit, disabled }) {
  return (
    <div className="candidates">
      {plan.candidates.map((candidate) => {
        const recipe = state.project.recipes.find(
          (item) => item.id === candidate.recipe_id,
        );
        return (
          <article
            key={recipe.id}
            className={`candidate ${candidate.can_confirm ? "available" : ""}`}
          >
            <div className="candidate-header">
              <span className={`badge ${candidate.can_confirm ? "" : "hold"}`}>
                {candidate.can_confirm ? "可审阅" : "暂不能确认"}
              </span>
              <span>{money(candidate.estimated_cost_cents)}</span>
            </div>
            <h3>{recipe.name}</h3>
            <ul>
              {recipe.ingredients.map((item) => (
                <li key={item.ingredient}>
                  {foodName(state.project, item.ingredient)}{" "}
                  {C.decimal(
                    C.quantity(item.quantity) * state.settings.servings,
                  )}{" "}
                  {UNIT[item.unit]}
                </li>
              ))}
            </ul>
            <div className="explain">
              {candidate.excluded.length > 0 ? (
                <p>用户排除项命中；不强行放行或生成替代品。</p>
              ) : (
                <>
                  {candidate.allocations.map((allocation) => (
                    <p key={allocation.lot_id}>
                      {
                        state.project.lots.find(
                          (lot) => lot.id === allocation.lot_id,
                        ).name
                      }{" "}
                      → {allocation.quantity} {UNIT[allocation.unit]}
                    </p>
                  ))}
                  {candidate.eligible_stock_shortages.map((shortage) => (
                    <p key={shortage.ingredient}>
                      {foodName(state.project, shortage.ingredient)}可分配不足{" "}
                      {shortage.quantity} {UNIT[shortage.unit]}
                      {shortage.held_lot_ids.length > 0
                        ? "（有实物待核查，不等于需要购买）"
                        : ""}
                    </p>
                  ))}
                  {candidate.shopping_list.map((item) => (
                    <p key={item.ingredient}>
                      实物缺口：{foodName(state.project, item.ingredient)}{" "}
                      {item.quantity} {UNIT[item.unit]}，不会自动采购。
                    </p>
                  ))}
                  {candidate.can_consume && (
                    <p>按已录入的最早约束时间分批分配；日期不证明食物安全。</p>
                  )}
                </>
              )}
              {!candidate.budget_ok && (
                <p>
                  {candidate.estimated_cost_cents == null
                    ? "请先补录估计成本。"
                    : `估计成本超过本次上限 ${money(state.settings.budget_cents)}。`}
                </p>
              )}
            </div>
            <SourceDetails project={state.project} ids={[recipe.source_id]} />
            <div className="candidate-actions">
              <button
                className="primary"
                disabled={!candidate.can_confirm || disabled}
                onClick={() => onReview(recipe.id)}
              >
                审阅用料，再确认
              </button>
              <button onClick={() => onEdit(recipe.id)}>修改菜谱 / 估计</button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
function Ledger({ state, onUndo, available, conflict }) {
  return (
    <section className="ledger" aria-labelledby="ledger-title">
      <div className="section-top">
        <div>
          <p className="eyebrow">03 / YOUR DECISION TRAIL</p>
          <h2 id="ledger-title">本地回执</h2>
        </div>
        <p className="small">
          {available
            ? "仅保存于当前浏览器 · 建议导出"
            : "未保存：内存模式，请导出留存"}
        </p>
      </div>
      {!state.receipts.length && (
        <p className="small">还没有扣减；请先审阅一份候选并明确确认。</p>
      )}
      {[...state.receipts].reverse().map((receipt) => (
        <article className="receipt" key={receipt.id}>
          <div className="receipt-header">
            <strong>
              {state.project.recipes.find(
                (recipe) => recipe.id === receipt.recipe_id,
              )?.name || receipt.recipe_id}{" "}
              · {receipt.servings}份 ·{" "}
              {receipt.reversed ? "已撤回记账" : "已确认记账"}
            </strong>
            <span className="small">
              v{receipt.revision_before} → v{receipt.revision_after}
            </span>
          </div>
          <p className="small">{new Date(receipt.as_of).toLocaleString()}</p>
          <ul>
            {receipt.changes.map((change) => (
              <li key={change.lot_id}>
                {change.name}：{change.before} − {change.used} ={" "}
                {change.remaining} {UNIT[change.unit]}
              </li>
            ))}
          </ul>
          <button
            disabled={
              receipt.reversed ||
              receipt.revision_after !== state.revision ||
              conflict
            }
            onClick={() => onUndo(receipt.id)}
          >
            撤回这笔记账
          </button>
          {!receipt.reversed && receipt.revision_after !== state.revision && (
            <p className="small">仅能撤回最近一笔且之后未修改的记账。</p>
          )}
        </article>
      ))}
      <details>
        <summary>本地操作记录</summary>
        <ol>
          {state.audit.map((entry, index) => (
            <li key={index}>
              {entry.event} · {entry.detail}
            </li>
          ))}
        </ol>
      </details>
      <p className="small">
        回执只说明软件库存变化，不证明实际取用或食物安全。撤回不能恢复已消耗的实物。
      </p>
    </section>
  );
}

function LotForm({ state, lotId, onSave, onClose }) {
  const old = state.project.lots.find((lot) => lot.id === lotId),
    options = foodOptions(state.project);
  const readSource = (id) =>
    state.project.sources.find((source) => source.id === id)?.text || "";
  const [form, setForm] = useState(() => ({
    name: old?.name || "",
    ingredient: old?.ingredient || options[0]?.[0] || "__new",
    custom: "",
    quantity: old?.quantity || "",
    unit: old?.unit || state.project.lots[0]?.unit || "g",
    allergens: old?.allergens.join(", ") || "",
    labelKind: old?.labels[0]?.kind || "use_by",
    labelDate: old?.labels[0]?.date || "",
    labelSource: readSource(old?.labels[0]?.source_id),
    packed: old?.packed_on?.date || "",
    packedSource: readSource(old?.packed_on?.source_id),
    opened: localTimeInput(old?.opened_at),
    openedSource: readSource(old?.opened_source_id),
    hours: String(old?.after_open_hours || ""),
    openSource: readSource(old?.after_open_source_id),
    confirmed: false,
    confirmation: "",
  }));
  const [error, setError] = useState("");
  const set = (key, value) =>
    setForm((before) => ({ ...before, [key]: value }));
  const input = (key, props = {}) => (
    <input
      {...props}
      value={form[key]}
      onChange={(event) => set(key, event.target.value)}
    />
  );
  function submit(event) {
    event.preventDefault();
    try {
      const project = C.clone(state.project),
        current = project.lots.find((lot) => lot.id === lotId);
      if (!current && form.ingredient === "__new" && !form.custom.trim())
        throw new Error("请填写新食材名称。");
      const lot = current || {
        id: uid("lot"),
        name:
          form.ingredient === "__new"
            ? `${form.custom.trim()} · ${form.name.trim()}`
            : form.name.trim(),
        ingredient: form.ingredient === "__new" ? uid("food") : form.ingredient,
        quantity: form.quantity,
        unit: form.unit,
      };
      const originalOpened = current?.opened_at;
      for (const key of [
        "packed_on",
        "opened_at",
        "opened_source_id",
        "after_open_hours",
        "after_open_source_id",
        "confirmation_source_id",
      ])
        delete lot[key];
      lot.allergens = splitTags(form.allergens);
      // Editing the first visible date must not silently erase other constraints.
      const otherLabels = C.clone(current?.labels.slice(1) || []);
      lot.labels = [];
      lot.confirmed_usable = form.confirmed;
      if (form.labelDate)
        lot.labels.push({
          kind: form.labelKind,
          date: form.labelDate,
          source_id: addSource(
            project,
            form.labelKind === "user_limit" ? "user_record" : "user_label",
            form.labelSource,
          ),
        });
      lot.labels.push(...otherLabels);
      if (form.packed)
        lot.packed_on = {
          date: form.packed,
          source_id: addSource(project, "user_label", form.packedSource),
        };
      if (form.opened) {
        lot.opened_at =
          originalOpened && form.opened === localTimeInput(originalOpened)
            ? originalOpened
            : new Date(form.opened).toISOString();
        lot.opened_source_id = addSource(
          project,
          "user_record",
          form.openedSource,
        );
      }
      if (form.hours) {
        lot.after_open_hours = Number(form.hours);
        lot.after_open_source_id = addSource(
          project,
          "user_label",
          form.openSource,
        );
      }
      if (form.confirmed)
        lot.confirmation_source_id = addSource(
          project,
          "user_confirmation",
          form.confirmation,
        );
      if (!current) project.lots.push(lot);
      onSave(project);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <Modal
      title={old ? "核查并修正记录" : "录入新的食材批次"}
      onClose={onClose}
    >
      <form onSubmit={submit} className="dialog-form">
        <p className="small">
          {old
            ? `当前日期：${old.labels.map((label) => `${KIND[label.kind]} ${label.date}`).join("；") || "无"}。如实核对后修正，不为解除阻断而改日期。核查不能改余额或食材身份。`
            : "默认不勾本人核查。没有日期或来源时，保持待核查。"}
        </p>
        <label>
          批次名称
          {input("name", { required: true, maxLength: 160, readOnly: !!old })}
        </label>
        <div className="field-row">
          <label>
            食材
            <select
              value={form.ingredient}
              disabled={!!old}
              onChange={(event) => {
                const id = event.target.value;
                setForm((f) => ({
                  ...f,
                  ingredient: id,
                  unit:
                    state.project.lots.find((lot) => lot.ingredient === id)
                      ?.unit || f.unit,
                }));
              }}
            >
              {options.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
              <option value="__new">＋ 新食材</option>
            </select>
          </label>
          {form.ingredient === "__new" && (
            <label>
              新食材名称{input("custom", { required: true, maxLength: 60 })}
            </label>
          )}
        </div>
        <div className="field-row">
          <label>
            当前数量
            {input("quantity", {
              type: "number",
              min: "0",
              step: "0.001",
              required: true,
              readOnly: !!old,
            })}
          </label>
          <label>
            单位
            <select
              value={form.unit}
              disabled={!!old}
              onChange={(event) => set("unit", event.target.value)}
            >
              {Object.entries(UNIT).map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          已知过敏标签
          {input("allergens", { placeholder: "例如 milk；不自动识别" })}
        </label>
        <fieldset>
          <legend>日期与来源</legend>
          {old?.labels.length > 1 && (
            <p className="small">
              此表单修改第一条日期；其余 {old.labels.length - 1}{" "}
              条日期与来源保留参与核查，不会自动删除。完整修订可导出后编辑
              JSON，再作为新账本导入。
            </p>
          )}
          <div className="field-row">
            <label>
              日期类别
              <select
                value={form.labelKind}
                onChange={(event) => set("labelKind", event.target.value)}
              >
                {Object.entries(KIND)
                  .filter(([id]) => id !== "after_open_label")
                  .map(([id, label]) => (
                    <option key={id} value={id}>
                      {label}
                    </option>
                  ))}
              </select>
            </label>
            <label>录入的日期{input("labelDate", { type: "date" })}</label>
          </div>
          <label>
            标签原文／本人记录
            <textarea
              maxLength="4000"
              rows="2"
              value={form.labelSource}
              onChange={(event) => set("labelSource", event.target.value)}
            />
          </label>
          <label>包装日期（可选）{input("packed", { type: "date" })}</label>
          <label>
            包装日期原文{input("packedSource", { maxLength: 4000 })}
          </label>
        </fieldset>
        <fieldset>
          <legend>开封记录，未开封留空</legend>
          <label>
            开封时刻 · 设备本地时区{input("opened", { type: "datetime-local" })}
          </label>
          <label>
            开封记录来源{input("openedSource", { maxLength: 4000 })}
          </label>
          <label>
            标签明确写的开封后小时数
            {input("hours", {
              type: "number",
              min: 1,
              max: 8760,
              step: 1,
              placeholder: "不知道则留空，不猜时长",
            })}
          </label>
          <label>
            开封后说明原文
            <textarea
              rows="2"
              maxLength="4000"
              value={form.openSource}
              onChange={(event) => set("openSource", event.target.value)}
            />
          </label>
        </fieldset>
        <label className="check">
          <input
            type="checkbox"
            checked={form.confirmed}
            onChange={(event) => set("confirmed", event.target.checked)}
          />
          我已亲自核对标签、储存记录与当前状态
        </label>
        <label>
          核查备注
          <textarea
            rows="2"
            maxLength="4000"
            value={form.confirmation}
            onChange={(event) => set("confirmation", event.target.value)}
          />
        </label>
        <p className="small">
          确认不能覆盖缺日期、日期矛盾或已经过的时限。旧来源原文保留，不代表系统核实其真实性。
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <button className="primary" type="submit">
          保存记录并重新核查
        </button>
      </form>
    </Modal>
  );
}
function RecipeForm({ state, recipeId, onSave, onClose }) {
  const old = state.project.recipes.find((recipe) => recipe.id === recipeId),
    options = foodOptions(state.project);
  const [form, setForm] = useState(() => ({
    name: old?.name || "",
    allergens: old?.allergens.join(", ") || "",
    cost: Number.isInteger(state.settings.costs[recipeId])
      ? (state.settings.costs[recipeId] / 100).toFixed(2)
      : "",
    source:
      state.project.sources.find((s) => s.id === old?.source_id)?.text || "",
    ingredients: (
      old?.ingredients || [{ ingredient: options[0]?.[0] || "", quantity: "" }]
    ).map((item) => ({ ...item, rowKey: uid("row") })),
  }));
  const [error, setError] = useState("");
  const set = (key, value) =>
    setForm((before) => ({ ...before, [key]: value }));
  function submit(event) {
    event.preventDefault();
    try {
      const project = C.clone(state.project),
        settings = C.clone(state.settings),
        id = old?.id || uid("recipe");
      const recipe = {
        id,
        name: form.name.trim(),
        allergens: splitTags(form.allergens),
        source_id: addSource(project, "user_recipe", form.source),
        ingredients: form.ingredients.map((item) => ({
          ingredient: item.ingredient,
          quantity: item.quantity,
          unit:
            project.lots.find((lot) => lot.ingredient === item.ingredient)
              ?.unit ?? item.unit,
        })),
      };
      const index = project.recipes.findIndex((r) => r.id === id);
      if (index >= 0) project.recipes[index] = recipe;
      else project.recipes.push(recipe);
      settings.costs[id] = cents(form.cost);
      onSave(project, settings);
    } catch (e) {
      setError(e.message);
    }
  }
  function updateRow(rowKey, key, value) {
    setForm((f) => ({
      ...f,
      ingredients: f.ingredients.map((row) =>
        row.rowKey === rowKey ? { ...row, [key]: value } : row,
      ),
    }));
  }
  return (
    <Modal title="我的菜谱与成本估计" onClose={onClose}>
      <form className="dialog-form" onSubmit={submit}>
        <p className="small">
          只使用你录入的用量与做法，不生成食安或营养结论。
        </p>
        <label>
          菜谱名称
          <input
            required
            maxLength="160"
            value={form.name}
            onChange={(event) => set("name", event.target.value)}
          />
        </label>
        {form.ingredients.map((row) => (
          <div className="requirement" key={row.rowKey}>
            <label>
              食材
              <select
                value={row.ingredient}
                onChange={(event) =>
                  updateRow(row.rowKey, "ingredient", event.target.value)
                }
              >
                {!options.some(([id]) => id === row.ingredient) && (
                  <option value={row.ingredient}>
                    {foodName(state.project, row.ingredient)}（当前无库存）
                  </option>
                )}
                {options.map(([id, label]) => (
                  <option key={id} value={id}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              每份用量 ·{" "}
              {
                UNIT[
                  state.project.lots.find(
                    (lot) => lot.ingredient === row.ingredient,
                  )?.unit ?? row.unit
                ]
              }
              <input
                type="number"
                min="0.001"
                step="0.001"
                required
                value={row.quantity}
                onChange={(event) =>
                  updateRow(row.rowKey, "quantity", event.target.value)
                }
              />
            </label>
            <button
              type="button"
              aria-label="删除这项用料"
              onClick={() =>
                set(
                  "ingredients",
                  form.ingredients.filter((item) => item.rowKey !== row.rowKey),
                )
              }
            >
              −
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            set("ingredients", [
              ...form.ingredients,
              {
                rowKey: uid("row"),
                ingredient: options[0]?.[0] || "",
                quantity: "",
              },
            ])
          }
        >
          ＋ 添加一种食材
        </button>
        <label>
          已知过敏标签
          <input
            value={form.allergens}
            onChange={(event) => set("allergens", event.target.value)}
          />
        </label>
        <label>
          每份估计成本 · 元
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={form.cost}
            onChange={(event) => set("cost", event.target.value)}
          />
        </label>
        <label>
          自有菜谱来源／做法
          <textarea
            required
            rows="4"
            maxLength="4000"
            value={form.source}
            onChange={(event) => set("source", event.target.value)}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="primary">
          保存菜谱
        </button>
      </form>
    </Modal>
  );
}
function Review({ state, modal, onClose, onConfirm }) {
  const [approved, setApproved] = useState(false),
    [error, setError] = useState("");
  const recipe = state.project.recipes.find(
    (item) => item.id === modal.intent.recipe_id,
  );
  function confirm() {
    try {
      if (!approved) throw new Error("请先明确勾选确认。");
      onConfirm(modal);
    } catch (e) {
      setApproved(false);
      setError(e.message);
    }
  }
  return (
    <Modal title="最后核对这一笔" onClose={onClose}>
      <div className="review-body">
        <h3>
          {recipe.name} · {modal.intent.servings}份
        </h3>
        <p className="small">
          估计成本 {money(modal.intent.estimated_cost_cents)} / 上限{" "}
          {money(state.settings.budget_cents)}
        </p>
        {modal.intent.allocations.map((allocation) => {
          const lot = state.project.lots.find(
            (item) => item.id === allocation.lot_id,
          );
          return (
            <div className="review-allocation" key={lot.id}>
              <strong>
                {lot.name} · {allocation.quantity} {UNIT[lot.unit]}
              </strong>
              <p className="small">
                当前 {lot.quantity}，记账后{" "}
                {C.decimal(
                  C.quantity(lot.quantity) - C.quantity(allocation.quantity),
                )}{" "}
                {UNIT[lot.unit]}
              </p>
              <SourceDetails
                project={state.project}
                ids={[
                  ...allocation.constraints.flatMap(
                    (constraint) => constraint.source_ids,
                  ),
                  allocation.confirmation_source_id,
                ]}
              />
            </div>
          );
        })}
      </div>
      <label className="check">
        <input
          type="checkbox"
          checked={approved}
          onChange={(event) => setApproved(event.target.checked)}
        />
        我已核对批次、用量、份数与估计成本，同意仅扣减本地账本
      </label>
      <p className="small">
        确认时按当前设备时刻重核；数据变化或时限经过会使这次审阅失效。
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <button
        className="primary confirm-button"
        disabled={!approved}
        onClick={confirm}
      >
        确认记账
      </button>
    </Modal>
  );
}

export default function App() {
  const boot = useRef(null);
  if (!boot.current) boot.current = loadSession();
  const [session, setSession] = useState(boot.current.session),
    sessionRef = useRef(boot.current.session);
  const savedRaw = useRef(boot.current.raw),
    availableRef = useRef(boot.current.available),
    initialized = useRef(false);
  const [available, setAvailable] = useState(boot.current.available),
    [message, setMessage] = useState(boot.current.message),
    [error, setError] = useState("");
  const [conflict, setConflict] = useState(false),
    conflictRef = useRef(false);
  const [modal, setModal] = useState(null),
    [clock, setClock] = useState(now()),
    importRef = useRef(null);
  const [draft, setDraft] = useState(() =>
    settingDraft(boot.current.session.state),
  );
  const state = session.state;
  const dirty = C.canonical(draft) !== C.canonical(settingDraft(state));
  const plan = useMemo(() => C.planState(state, clock), [state, clock]);
  function persist(value) {
    if (!availableRef.current) return;
    try {
      const raw = JSON.stringify(value);
      localStorage.setItem(STORAGE_KEY, raw);
      savedRaw.current = raw;
    } catch (_) {
      availableRef.current = false;
      setAvailable(false);
    }
  }
  function guardStorage() {
    if (conflictRef.current)
      throw new Error("另一个标签页已改变库存，请先点击重新核查载入。");
    if (availableRef.current) {
      let raw;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch (_) {
        availableRef.current = false;
        setAvailable(false);
        return;
      }
      if (raw !== savedRaw.current) {
        conflictRef.current = true;
        setConflict(true);
        setModal(null);
        throw new Error("保存已变化，已取消审阅；请先重新核查。");
      }
    }
  }
  function commit(next, text, mode) {
    guardStorage();
    const checked = C.validateState(next),
      previous = sessionRef.current;
    const wrapper = {
      ...previous,
      example: typeof mode === "boolean" ? mode : previous.example,
      state: checked,
    };
    if (C.utf8Length(JSON.stringify(wrapper)) > 950000)
      throw new Error(
        "账本接近1MB上限，此次修改未保存。请导出留存后精简来源。",
      );
    sessionRef.current = wrapper;
    setSession(wrapper);
    persist(wrapper);
    setDraft(settingDraft(checked));
    setModal(null);
    setClock(now());
    setMessage(text);
    setError("");
  }
  const act = (fn) => {
    try {
      fn();
    } catch (e) {
      setError(e.message);
    }
  };
  useEffect(() => {
    if (!initialized.current) {
      initialized.current = true;
      persist(sessionRef.current);
    }
    const changed = (event) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        conflictRef.current = true;
        setConflict(true);
        setModal(null);
        setMessage("检测到其他标签页改变；请重新核查载入，避免覆盖。");
      }
    };
    const visible = () => {
      if (!document.hidden) {
        setModal((old) => (old?.kind === "review" ? null : old));
        setClock(now());
      }
    };
    window.addEventListener("storage", changed);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("storage", changed);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  function refresh() {
    act(() => {
      if (conflictRef.current) {
        const loaded = loadSession();
        sessionRef.current = loaded.session;
        setSession(loaded.session);
        savedRaw.current = loaded.raw;
        availableRef.current = loaded.available;
        setAvailable(loaded.available);
        setDraft(settingDraft(loaded.session.state));
        conflictRef.current = false;
        setConflict(false);
      }
      setModal(null);
      setClock(now());
      setMessage("已按当前时刻重核；原审阅已取消。");
      setError("");
    });
  }
  function applySettings() {
    act(() => {
      const current = sessionRef.current.state,
        project = C.clone(current.project),
        settings = C.clone(current.settings);
      project.preferences = {
        allergens: splitTags(draft.allergens),
        avoid_ingredients: [...draft.avoid],
      };
      settings.servings = Number(draft.servings);
      settings.budget_cents = cents(draft.budget);
      settings.simple_first = draft.simple;
      commit(
        C.updateState(current, project, settings, "PREFERENCES_CHANGED"),
        "偏好已应用，原审阅已失效。",
      );
    });
  }
  function review(recipeId) {
    act(() => {
      guardStorage();
      if (dirty) throw new Error("请先应用已修改的偏好，再审阅用料。");
      const intent = C.intentFor(sessionRef.current.state, recipeId, now());
      setModal({ kind: "review", intent, key: uid("consume") });
    });
  }
  function confirm(pending) {
    guardStorage();
    const result = C.consume(
      sessionRef.current.state,
      pending.intent,
      pending.key,
      now(),
    );
    commit(result.state, "已确认本地扣减；可查看回执或立即撤回最近一笔。");
  }
  async function importFile(event) {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error("文件须小于1MB。");
      const value = C.parseInput(await file.text());
      const isExport = [
        "pantry-relay-react-export",
        "pantry-relay-browser-export",
      ].includes(value.format);
      const project = C.validateProject(isExport ? value.project : value);
      const settings = isExport
        ? value.settings
        : { servings: 1, budget_cents: 1500, simple_first: false, costs: {} };
      const next = C.createState(project, settings);
      if (
        !window.confirm(
          "导入将替换当前库存并开启新账本。请先导出留存；历史回执不作为可信记录回填。继续？",
        )
      )
        return;
      commit(next, "库存已导入并重新核查；历史回执未回填。", false);
    } catch (e) {
      setError(`导入失败，原库存保留。${e.message}`);
    }
  }
  function exportData() {
    const current = sessionRef.current.state;
    download({
      format: "pantry-relay-react-export",
      version: 1,
      exported_at: now(),
      project: current.project,
      settings: current.settings,
      local_receipts: current.receipts,
      local_audit: current.audit,
      safety_guarantee: false,
    });
  }
  return (
    <>
      <a className="skip" href="#workspace">
        跳到库存与计划
      </a>
      <header className="shell masthead">
        <a href="#top" className="wordmark">
          <span className="mark" aria-hidden="true">
            ↻
          </span>
          PANTRY RELAY
        </a>
        <span className="offline">本地规则 · 由你确认</span>
      </header>
      <main className="shell" id="top">
        <section className="intro">
          <div>
            <p className="eyebrow">A SMALLER PLAN. A CLEARER TRAIL.</p>
            <h1>
              先核对，
              <br />
              <em>再接力。</em>
            </h1>
            <p className="lede">
              每批记录有来处，每次用料由你确认。
              <br />
              预览不会扣库存，确认后每一笔都有来处。
            </p>
          </div>
          <aside className="clock-note">
            <span className="ring" aria-hidden="true">
              24<span>h</span>
            </span>
            <p>
              时钟从你抄录的
              <br />
              <strong>标签说明开始。</strong>
            </p>
            <small>圆环仅为示意，不表示任何食品的建议保鲜时长。</small>
          </aside>
        </section>
        <div className="notice">
          <strong>
            {session.example
              ? "虚构示例 · 日期随当天平移"
              : "本地编辑 · 辨别示例与本人来源"}
          </strong>
          <span>
            日期与确认不证明食物安全。请自己核对标签、储存与当前状态；不确定批次保持待核查。
          </span>
        </div>
        <section className="toolbar" aria-label="库存操作">
          <div>
            <button
              className="primary"
              onClick={() => setModal({ kind: "lot" })}
            >
              ＋ 录入食材
            </button>
            <button onClick={() => setModal({ kind: "recipe" })}>
              ＋ 我的菜谱
            </button>
          </div>
          <div>
            <button onClick={exportData}>导出账本</button>
            <button onClick={() => importRef.current.click()}>导入库存</button>
            <button
              className="quiet"
              onClick={() =>
                act(() => {
                  if (
                    window.confirm(
                      "开启虚构示例并替换当前账本？请先导出需要保留的记录。",
                    )
                  )
                    commit(
                      freshSession().state,
                      "已开启虚构示例，日期不是食品保鲜建议。",
                      true,
                    );
                })
              }
            >
              重置示例
            </button>
            <input
              ref={importRef}
              type="file"
              accept=".json,application/json"
              hidden
              onChange={importFile}
            />
          </div>
        </section>
        <p className="status" role="status" aria-live="polite">
          {message}
        </p>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <div className="workspace" id="workspace">
          <Stock
            state={state}
            plan={plan}
            onReview={(id) => setModal({ kind: "lot", id })}
          />
          <section className="plan-panel" aria-labelledby="plan-title">
            <div className="section-top">
              <div>
                <p className="eyebrow">02 / ONE MEAL AT A TIME</p>
                <h2 id="plan-title">这一餐，怎么接力</h2>
              </div>
              <button className="quiet" onClick={refresh}>
                重新核查
              </button>
            </div>
            <SettingsForm
              project={state.project}
              draft={draft}
              setDraft={setDraft}
              dirty={dirty}
              onApply={applySettings}
            />
            <Candidates
              state={state}
              plan={plan}
              onReview={review}
              onEdit={(id) => setModal({ kind: "recipe", id })}
              disabled={conflict || dirty}
            />
            <p className="small">
              标签仅按输入精确过滤，不识别未标注过敏原、交叉接触或医疗禁忌。
            </p>
          </section>
        </div>
        <Ledger
          state={state}
          available={available}
          conflict={conflict}
          onUndo={(id) =>
            act(() =>
              commit(
                C.undoConsumption(sessionRef.current.state, id),
                "最近一笔记账已撤回，原回执保留；实物不会恢复。",
              ),
            )
          }
        />
      </main>
      <footer className="shell footer">
        <span>Pantry Relay / React + Vite / MIT</span>
        <span>
          本浏览器单标签本地账本，无外部API、支付或运行时LLM。
          <br />
          未登录发布QMuse，未接入支付宝；不提供跨标签事务或防篡改证明。
        </span>
      </footer>
      {modal?.kind === "lot" && (
        <LotForm
          key={`lot-${modal.id || "new"}`}
          state={state}
          lotId={modal.id}
          onClose={() => setModal(null)}
          onSave={(project) =>
            commit(
              C.updateState(
                sessionRef.current.state,
                project,
                sessionRef.current.state.settings,
                modal.id ? "LOT_REVIEWED" : "LOT_ADDED",
              ),
              "记录已保存并按当前时刻重核。",
              false,
            )
          }
        />
      )}
      {modal?.kind === "recipe" && (
        <RecipeForm
          key={`recipe-${modal.id || "new"}`}
          state={state}
          recipeId={modal.id}
          onClose={() => setModal(null)}
          onSave={(project, settings) =>
            commit(
              C.updateState(
                sessionRef.current.state,
                project,
                settings,
                "RECIPE_RECORDED",
              ),
              "菜谱与估计已保存；候选仍是独立预览。",
              false,
            )
          }
        />
      )}
      {modal?.kind === "review" && (
        <Review
          key={modal.key}
          state={state}
          modal={modal}
          onClose={() => setModal(null)}
          onConfirm={confirm}
        />
      )}
    </>
  );
}
