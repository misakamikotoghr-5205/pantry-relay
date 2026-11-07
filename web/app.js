(function () {
  "use strict";
  const C = window.PantryCore,
    D = window.PantryDemo;
  const $ = (id) => document.getElementById(id);
  const KEY = "pantry-relay-local-v1";
  const names = {
    tomato: "番茄",
    egg: "鸡蛋",
    oat: "燕麦",
    milk: "牛奶",
    peanut: "花生",
    sauce: "酱料",
    tofu: "豆腐",
    pasta: "意面",
  };
  const units = { g: "克", ml: "毫升", each: "个" };
  const kinds = {
    use_by: "包装食用期限",
    best_before: "包装最佳赏味期",
    user_limit: "本人计划日期",
    after_open_label: "录入的开封后时限",
  };
  let state,
    example = true,
    storageAvailable = true,
    lastSaved = null,
    externalConflict = false;
  let editingLot = null,
    editingRecipe = null,
    pending = null,
    opener = null,
    settingsDirty = false;
  const now = () => new Date().toISOString();
  const fresh = () => {
    const d = D.makeDemo();
    return C.createState(d.project, d.settings);
  };
  function el(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  const money = (cents) =>
    cents === null || cents === undefined
      ? "未录估计"
      : "¥" + (cents / 100).toFixed(2);
  const ingredientName = (id) =>
    names[id] ||
    state.project.lots.find((lot) => lot.ingredient === id)?.name ||
    id;
  const quantityText = (q, unit) => q + " " + units[unit];
  function splitTags(value) {
    return value
      .split(/[,，]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  function cents(value) {
    if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,2})?$/.test(value))
      throw new Error("金额须为非负数，最多两位小数。");
    const [whole, fraction = ""] = value.split(".");
    return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
  }
  function status(message) {
    $("status").textContent = message;
    $("error").hidden = true;
  }
  function error(message, target = "error") {
    $(target).textContent = message;
    $(target).hidden = false;
  }
  function key(prefix) {
    return (
      prefix +
      "_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).slice(2, 9)
    );
  }
  function source(project, kind, text) {
    if (!text.trim()) throw new Error("请填写这条记录的来源原文。");
    const id = key("src");
    project.sources.push({ id, kind, text: text.trim() });
    return id;
  }
  function checkStorage() {
    if (externalConflict)
      throw new Error(
        "另一个标签页改变了库存。请点击重新核查以重新载入，当前审阅已失效。",
      );
    if (storageAvailable) {
      let current;
      try {
        current = localStorage.getItem(KEY);
      } catch (_) {
        storageAvailable = false;
        return;
      }
      if (current !== lastSaved) {
        externalConflict = true;
        pending = null;
        throw new Error("本地保存已变化，请先点击重新核查载入。");
      }
    }
  }
  function save() {
    if (storageAvailable) {
      try {
        lastSaved = JSON.stringify({
          format: "pantry-relay-local",
          version: 1,
          example,
          state,
        });
        localStorage.setItem(KEY, lastSaved);
      } catch (_) {
        storageAvailable = false;
      }
    }
    $("save-status").textContent = storageAvailable
      ? "仅保存于当前浏览器 · 建议导出留存"
      : "存储不可用：当前页可继续，请导出留存";
  }
  function load() {
    let raw;
    try {
      raw = localStorage.getItem(KEY);
      lastSaved = raw;
    } catch (_) {
      storageAvailable = false;
    }
    if (raw) {
      try {
        const wrapper = C.parseInput(raw);
        if (
          wrapper.format !== "pantry-relay-local" ||
          wrapper.version !== 1 ||
          typeof wrapper.example !== "boolean"
        )
          throw new Error("存档格式不匹配。");
        state = C.validateState(wrapper.state);
        example = wrapper.example;
        return;
      } catch (_) {
        try {
          localStorage.removeItem(KEY);
          lastSaved = null;
        } catch (_) {
          storageAvailable = false;
        }
        status("原存档无法通过核验，已开启新的虚构示例；损坏存档未用于扣减。");
      }
    }
    state = fresh();
    example = true;
    if (!storageAvailable) status("浏览器存储不可用，当前页仍可操作并导出。");
  }
  function commit(next, message, mode) {
    checkStorage();
    const checked = C.validateState(next);
    const nextExample = typeof mode === "boolean" ? mode : example;
    if (
      C.utf8Length(
        JSON.stringify({
          format: "pantry-relay-local",
          version: 1,
          example: nextExample,
          state: checked,
        }),
      ) > 950000
    )
      throw new Error(
        "本地账本接近1MB上限。请导出留存，再导入当前库存开启新账本。",
      );
    state = checked;
    example = nextExample;
    pending = null;
    save();
    render();
    status(message);
  }
  function button(text, action, id, className) {
    const node = el("button", text, className);
    node.type = "button";
    node.dataset.action = action;
    if (id) node.dataset.id = id;
    return node;
  }
  function sourceDetails(ids) {
    const details = el("details"),
      summary = el("summary", "查看来源原文");
    details.append(summary);
    const unique = [...new Set(ids.filter(Boolean))];
    for (const id of unique) {
      const entry = state.project.sources.find((s) => s.id === id);
      if (entry) details.append(el("p", entry.text, "source"));
    }
    return details;
  }
  function renderLots(plan) {
    const counts = { eligible_user_confirmed: 0, hold: 0, empty: 0 };
    for (const review of plan.lot_review) counts[review.status]++;
    $("metrics").replaceChildren(
      ...[
        [counts.eligible_user_confirmed, "通过记录门禁"],
        [counts.hold, "待核查 / 已排除"],
        [counts.empty, "空批次"],
      ].map(([n, label]) => {
        const metric = el("div", undefined, "metric");
        metric.append(el("strong", String(n)), el("span", label));
        return metric;
      }),
    );
    const lots = [];
    for (const lot of state.project.lots) {
      const review = plan.lot_review.find((r) => r.lot_id === lot.id);
      const article = el("article", undefined, "lot"),
        top = el("div", undefined, "lot-top"),
        text = el("div");
      text.append(
        el("h3", lot.name),
        el(
          "span",
          review.status === "hold"
            ? "待核查 / 排除"
            : review.status === "empty"
              ? "已记为空"
              : "用户已核查 · 通过记录门禁",
          "badge " +
            (review.status === "hold"
              ? "hold"
              : review.status === "empty"
                ? "empty"
                : ""),
        ),
      );
      const amount = el("div", lot.quantity, "amount");
      amount.append(el("span", units[lot.unit]));
      top.append(text, amount);
      article.append(top);
      if (review.reasons.length && review.status !== "empty") {
        const list = el("ul", undefined, "lot-reasons");
        for (const reason of review.reasons)
          list.append(el("li", reason.detail));
        article.append(list);
      }
      const dates = lot.labels
        .map((label) => `${kinds[label.kind]} ${label.date}`)
        .join("；");
      article.append(el("p", dates || "没有录入有来源的计划日期", "small"));
      const ids = [
        ...lot.labels.map((label) => label.source_id),
        lot.packed_on?.source_id,
        lot.opened_source_id,
        lot.after_open_source_id,
        lot.confirmation_source_id,
      ];
      article.append(sourceDetails(ids));
      const footer = el("div", undefined, "lot-footer");
      footer.append(
        el("span", ingredientName(lot.ingredient), "small"),
        button("核查 / 修正记录", "review-lot", lot.id),
      );
      article.append(footer);
      lots.push(article);
    }
    $("lots").replaceChildren(...lots);
  }
  function renderCandidates(plan) {
    const nodes = [];
    for (const candidate of plan.candidates) {
      const recipe = state.project.recipes.find(
        (r) => r.id === candidate.recipe_id,
      );
      const article = el(
        "article",
        undefined,
        "candidate" + (candidate.can_confirm ? " available" : ""),
      );
      const head = el("div", undefined, "candidate-header");
      head.append(
        el(
          "span",
          candidate.can_confirm ? "可审阅" : "暂不能确认",
          "badge" + (candidate.can_confirm ? "" : " hold"),
        ),
        el("span", money(candidate.estimated_cost_cents)),
      );
      article.append(head, el("h3", candidate.name));
      const list = el("ul");
      for (const item of recipe.ingredients)
        list.append(
          el(
            "li",
            `${ingredientName(item.ingredient)} ${quantityText(C.decimal(C.quantity(item.quantity) * state.settings.servings), item.unit)}`,
          ),
        );
      article.append(list);
      const explanation = el("div", undefined, "explain");
      if (candidate.excluded.length)
        explanation.append(
          el("p", "用户的过敏标签或食材排除项命中；不提供替代或强行放行。"),
        );
      else {
        for (const allocation of candidate.allocations) {
          const lot = state.project.lots.find(
            (l) => l.id === allocation.lot_id,
          );
          explanation.append(
            el(
              "p",
              `${lot.name} → ${quantityText(allocation.quantity, allocation.unit)}`,
            ),
          );
        }
        for (const shortage of candidate.eligible_stock_shortages)
          explanation.append(
            el(
              "p",
              `${ingredientName(shortage.ingredient)}可分配不足 ${quantityText(shortage.quantity, shortage.unit)}${shortage.held_lot_ids.length ? "（有实物批次待核查，不等同需要购买）" : ""}`,
            ),
          );
        for (const shopping of candidate.shopping_list)
          explanation.append(
            el(
              "p",
              `实物数量缺口：${ingredientName(shopping.ingredient)} ${quantityText(shopping.quantity, shopping.unit)}。不会自动采购。`,
            ),
          );
        if (candidate.can_consume)
          explanation.append(
            el(
              "p",
              "依据：已核查批次按最早录入时间约束分配；日期不构成食安保证。",
            ),
          );
      }
      if (!candidate.budget_ok)
        explanation.append(
          el(
            "p",
            candidate.estimated_cost_cents === null
              ? "未填写本菜谱的估计成本。"
              : `估计成本超过本次上限 ${money(state.settings.budget_cents)}。`,
          ),
        );
      article.append(explanation, sourceDetails([recipe.source_id]));
      const actions = el("div", undefined, "candidate-actions"),
        review = button("审阅用料，再确认", "review-use", recipe.id, "primary");
      review.disabled = !candidate.can_confirm || externalConflict;
      actions.append(
        review,
        button("修改菜谱 / 估计", "edit-recipe", recipe.id),
      );
      article.append(actions);
      nodes.push(article);
    }
    $("candidates").replaceChildren(...nodes);
  }
  function renderReceipts() {
    if (!state.receipts.length)
      $("receipts").replaceChildren(
        el("p", "还没有扣减。先审阅一份候选，再由你确认。", "small"),
      );
    else
      $("receipts").replaceChildren(
        ...[...state.receipts].reverse().map((receipt) => {
          const node = el("article", undefined, "receipt"),
            head = el("div", undefined, "receipt-header");
          const recipe = state.project.recipes.find(
            (r) => r.id === receipt.recipe_id,
          );
          head.append(
            el(
              "strong",
              `${recipe?.name || receipt.recipe_id} · ${receipt.servings}份 · ${receipt.reversed ? "已撤回记账" : "已确认记账"}`,
            ),
            el(
              "span",
              `v${receipt.revision_before} → v${receipt.revision_after}`,
              "small",
            ),
          );
          node.append(
            head,
            el("p", new Date(receipt.as_of).toLocaleString(), "small"),
          );
          const list = el("ul");
          for (const change of receipt.changes)
            list.append(
              el(
                "li",
                `${change.name}：${change.before} − ${change.used} = ${change.remaining} ${units[change.unit]}`,
              ),
            );
          node.append(list);
          const undo = button("撤回这笔记账", "undo", receipt.id);
          undo.disabled =
            receipt.reversed ||
            receipt.revision_after !== state.revision ||
            externalConflict;
          node.append(undo);
          if (undo.disabled && !receipt.reversed)
            node.append(
              el(
                "p",
                "仅支持最近一笔且之后没有修改的撤回；历史回执仍保留。",
                "small",
              ),
            );
          return node;
        }),
      );
    $("audit").replaceChildren(
      ...state.audit.map((entry, i) =>
        el("li", `${i + 1}. ${entry.event} · ${entry.detail}`),
      ),
    );
  }
  function renderSettings() {
    $("servings").value = state.settings.servings;
    $("budget").value = (state.settings.budget_cents / 100).toFixed(2);
    $("simple-first").checked = state.settings.simple_first;
    $("allergens").value = state.project.preferences.allergens.join(", ");
    $("avoid").replaceChildren(
      ...ingredientOptions().map(([id, name]) => {
        const option = el("option", name);
        option.value = id;
        option.selected =
          state.project.preferences.avoid_ingredients.includes(id);
        return option;
      }),
    );
    settingsDirty = false;
  }
  function render() {
    const active = document.activeElement?.dataset;
    const focus = active?.action
      ? { action: active.action, id: active.id }
      : null;
    const plan = C.planState(state, now());
    $("revision").textContent = `库存版本 ${state.revision}`;
    $("data-mode").textContent = example
      ? "虚构示例库存 · 日期随当天平移"
      : "本地编辑库存 · 请辨别示例与本人来源";
    $("clock").textContent =
      `核查时刻 ${new Date(plan.as_of).toLocaleString()} · 标签日期按 ${state.project.timezone} 比较`;
    renderLots(plan);
    renderCandidates(plan);
    renderReceipts();
    renderSettings();
    if (focus)
      [...document.querySelectorAll("[data-action]")]
        .find(
          (n) => n.dataset.action === focus.action && n.dataset.id === focus.id,
        )
        ?.focus();
  }
  function openDialog(id) {
    opener = document.activeElement;
    $(id).showModal();
  }
  function closeDialog(id) {
    $(id).close();
    if (id === "review-dialog") pending = null;
    if (opener?.isConnected) opener.focus();
    else $("add-lot").focus();
  }
  function ingredientOptions() {
    return [...new Set(state.project.lots.map((lot) => lot.ingredient))].map(
      (id) => [id, ingredientName(id)],
    );
  }
  function inputLocalTime(iso) {
    if (!iso) return "";
    const date = new Date(iso);
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    return date.toISOString().slice(0, 16);
  }
  function readSource(id) {
    return state.project.sources.find((s) => s.id === id)?.text || "";
  }
  function openLot(id) {
    editingLot = id || null;
    const lot = state.project.lots.find((l) => l.id === id);
    $("lot-form").reset();
    $("lot-error").hidden = true;
    $("lot-dialog-title").textContent = lot
      ? "核查并修正记录"
      : "录入新的食材批次";
    $("lot-context").textContent = lot
      ? `现有标签：${lot.labels.map((l) => `${kinds[l.kind]} ${l.date}`).join("；") || "无"}。修正当前转录时请依据真实原文，不为解除阻断而改日期。`
      : "同种食材可分多批录入。默认不勾选本人核查，不填日期则保持待核查。";
    const options = ingredientOptions();
    $("lot-ingredient").replaceChildren(
      ...options.map(([value, name]) => {
        const o = el("option", name);
        o.value = value;
        return o;
      }),
    );
    const custom = el("option", "＋ 新食材");
    custom.value = "__new";
    $("lot-ingredient").append(custom);
    $("lot-ingredient").value = lot?.ingredient || options[0]?.[0] || "__new";
    if (!lot)
      $("lot-unit").value =
        state.project.lots.find(
          (l) => l.ingredient === $("lot-ingredient").value,
        )?.unit || "g";
    $("lot-ingredient").disabled = !!lot;
    $("lot-unit").disabled = !!lot;
    $("lot-name").readOnly = !!lot;
    $("lot-quantity").readOnly = !!lot;
    $("custom-name-label").hidden = $("lot-ingredient").value !== "__new";
    if (lot) {
      $("lot-name").value = lot.name;
      $("lot-quantity").value = lot.quantity;
      $("lot-unit").value = lot.unit;
      $("lot-allergens").value = lot.allergens.join(", ");
      if (lot.labels[0]) {
        $("label-kind").value = lot.labels[0].kind;
        $("label-date").value = lot.labels[0].date;
        $("label-source").value = readSource(lot.labels[0].source_id);
      }
      $("packed-date").value = lot.packed_on?.date || "";
      $("packed-source").value = readSource(lot.packed_on?.source_id);
      $("opened-at").value = inputLocalTime(lot.opened_at);
      $("opened-source").value = readSource(lot.opened_source_id);
      $("open-hours").value = lot.after_open_hours || "";
      $("open-label-source").value = readSource(lot.after_open_source_id);
      $("lot-confirmed").checked = false;
      $("confirmation-source").value = "";
    }
    openDialog("lot-dialog");
  }
  $("lot-ingredient").addEventListener("change", () => {
    $("custom-name-label").hidden = $("lot-ingredient").value !== "__new";
    const matching = state.project.lots.find(
      (lot) => lot.ingredient === $("lot-ingredient").value,
    );
    if (matching) $("lot-unit").value = matching.unit;
  });
  $("lot-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      checkStorage();
      const project = C.clone(state.project);
      const old = project.lots.find((l) => l.id === editingLot);
      const originalOpenedAt = old?.opened_at;
      const ingredient =
        old?.ingredient ||
        ($("lot-ingredient").value === "__new"
          ? key("food")
          : $("lot-ingredient").value);
      const lot = old || {
        id: key("lot"),
        name: $("lot-name").value.trim(),
        ingredient,
        quantity: $("lot-quantity").value,
        unit: $("lot-unit").value,
      };
      if (
        !old &&
        $("lot-ingredient").value === "__new" &&
        !$("custom-name").value.trim()
      )
        throw new Error("请填写新食材名称。");
      if (!old && $("lot-ingredient").value === "__new")
        lot.name = $("custom-name").value.trim() + " · " + lot.name;
      lot.allergens = splitTags($("lot-allergens").value);
      lot.labels = [];
      for (const field of [
        "packed_on",
        "opened_at",
        "opened_source_id",
        "after_open_hours",
        "after_open_source_id",
        "confirmation_source_id",
      ])
        delete lot[field];
      if ($("label-date").value) {
        const kind = $("label-kind").value;
        lot.labels.push({
          kind,
          date: $("label-date").value,
          source_id: source(
            project,
            kind === "user_limit" ? "user_record" : "user_label",
            $("label-source").value,
          ),
        });
      }
      if ($("packed-date").value)
        lot.packed_on = {
          date: $("packed-date").value,
          source_id: source(project, "user_label", $("packed-source").value),
        };
      if ($("opened-at").value) {
        lot.opened_at =
          originalOpenedAt &&
          $("opened-at").value === inputLocalTime(originalOpenedAt)
            ? originalOpenedAt
            : new Date($("opened-at").value).toISOString();
        lot.opened_source_id = source(
          project,
          "user_record",
          $("opened-source").value,
        );
      }
      if ($("open-hours").value) {
        lot.after_open_hours = Number($("open-hours").value);
        lot.after_open_source_id = source(
          project,
          "user_label",
          $("open-label-source").value,
        );
      }
      lot.confirmed_usable = $("lot-confirmed").checked;
      if (lot.confirmed_usable)
        lot.confirmation_source_id = source(
          project,
          "user_confirmation",
          $("confirmation-source").value,
        );
      if (!old) project.lots.push(lot);
      commit(
        C.updateState(
          state,
          project,
          state.settings,
          old ? "LOT_REVIEWED" : "LOT_ADDED",
        ),
        "记录已保存；已按当前时刻重算门禁，旧审阅失效。",
        false,
      );
      closeDialog("lot-dialog");
    } catch (e) {
      error(e.message, "lot-error");
    }
  });
  function requirementRow(item) {
    const row = el("div", undefined, "requirement"),
      ingredient = el("select"),
      q = el("input"),
      remove = el("button", "−");
    ingredient.setAttribute("aria-label", "菜谱食材");
    ingredient.dataset.field = "ingredient";
    for (const [id, name] of ingredientOptions()) {
      const o = el("option", name);
      o.value = id;
      ingredient.append(o);
    }
    if (item) ingredient.value = item.ingredient;
    q.type = "number";
    q.min = "0.001";
    q.step = "0.001";
    q.required = true;
    q.dataset.field = "quantity";
    q.value = item?.quantity || "";
    q.setAttribute("aria-label", "每份用量，单位与该食材库存相同");
    const a = el("label", "食材"),
      b = el("label", "每份用量（库存单位）");
    a.append(ingredient);
    b.append(q);
    remove.type = "button";
    remove.setAttribute("aria-label", "删除这条用料");
    remove.addEventListener("click", () => row.remove());
    row.append(a, b, remove);
    return row;
  }
  function openRecipe(id) {
    editingRecipe = id || null;
    const recipe = state.project.recipes.find((r) => r.id === id);
    $("recipe-form").reset();
    $("recipe-error").hidden = true;
    $("recipe-name").value = recipe?.name || "";
    $("recipe-allergens").value = recipe?.allergens.join(", ") || "";
    $("recipe-cost").value = Number.isInteger(state.settings.costs[id])
      ? (state.settings.costs[id] / 100).toFixed(2)
      : "";
    $("recipe-source").value = recipe ? readSource(recipe.source_id) : "";
    $("recipe-ingredients").replaceChildren(
      ...(recipe?.ingredients || [null]).map(requirementRow),
    );
    openDialog("recipe-dialog");
  }
  $("add-requirement").addEventListener("click", () =>
    $("recipe-ingredients").append(requirementRow()),
  );
  $("recipe-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      checkStorage();
      const project = C.clone(state.project),
        settings = C.clone(state.settings),
        id = editingRecipe || key("recipe");
      const ingredients = [...$("recipe-ingredients").children].map((row) => {
        const ingredient = row.querySelector('[data-field="ingredient"]').value;
        return {
          ingredient,
          quantity: row.querySelector('[data-field="quantity"]').value,
          unit: project.lots.find((lot) => lot.ingredient === ingredient).unit,
        };
      });
      const recipe = {
        id,
        name: $("recipe-name").value.trim(),
        ingredients,
        allergens: splitTags($("recipe-allergens").value),
        source_id: source(project, "user_recipe", $("recipe-source").value),
      };
      const index = project.recipes.findIndex((r) => r.id === id);
      if (index >= 0) project.recipes[index] = recipe;
      else project.recipes.push(recipe);
      settings.costs[id] = cents($("recipe-cost").value);
      commit(
        C.updateState(state, project, settings, "RECIPE_RECORDED"),
        "菜谱与估计已保存；每个候选仍是独立预览。",
        false,
      );
      closeDialog("recipe-dialog");
    } catch (e) {
      error(e.message, "recipe-error");
    }
  });
  $("settings-form").addEventListener("submit", (event) => {
    event.preventDefault();
    try {
      const project = C.clone(state.project),
        settings = C.clone(state.settings);
      project.preferences = {
        allergens: splitTags($("allergens").value),
        avoid_ingredients: [...$("avoid").selectedOptions].map((o) => o.value),
      };
      settings.servings = Number($("servings").value);
      settings.budget_cents = cents($("budget").value);
      settings.simple_first = $("simple-first").checked;
      commit(
        C.updateState(state, project, settings, "PREFERENCES_CHANGED"),
        "偏好已生效；之前的审阅不能再确认。",
      );
    } catch (e) {
      error(e.message);
    }
  });
  for (const type of ["input", "change"])
    $("settings-form").addEventListener(type, () => {
      settingsDirty = true;
      pending = null;
      status("偏好修改尚未应用。请先点击应用偏好，再审阅用料。");
    });
  function openReview(id) {
    if (settingsDirty)
      throw new Error("请先应用已修改的份数、预算或偏好，再审阅。");
    checkStorage();
    pending = { intent: C.intentFor(state, id, now()), key: key("consume") };
    $("approve-check").checked = false;
    $("confirm-use").disabled = true;
    $("review-error").hidden = true;
    const recipe = state.project.recipes.find((r) => r.id === id),
      nodes = [
        el("h3", `${recipe.name} · ${pending.intent.servings}份`),
        el(
          "p",
          `估计成本 ${money(pending.intent.estimated_cost_cents)} / 本次上限 ${money(state.settings.budget_cents)}`,
          "small",
        ),
      ];
    for (const allocation of pending.intent.allocations) {
      const lot = state.project.lots.find((l) => l.id === allocation.lot_id),
        node = el("div", undefined, "review-allocation");
      node.append(
        el(
          "strong",
          `${lot.name} · ${quantityText(allocation.quantity, allocation.unit)}`,
        ),
        el(
          "p",
          `当前 ${lot.quantity}，记账后 ${C.decimal(C.quantity(lot.quantity) - C.quantity(allocation.quantity))} ${units[lot.unit]}`,
          "small",
        ),
      );
      node.append(
        sourceDetails([
          ...allocation.constraints.flatMap((c) => c.source_ids),
          allocation.confirmation_source_id,
        ]),
      );
      nodes.push(node);
    }
    $("review-content").replaceChildren(...nodes);
    openDialog("review-dialog");
  }
  $("approve-check").addEventListener("change", () => {
    $("confirm-use").disabled = !$("approve-check").checked || !pending;
  });
  $("confirm-use").addEventListener("click", () => {
    try {
      if (!pending || !$("approve-check").checked)
        throw new Error("请先审阅并明确勾选确认。");
      checkStorage();
      const result = C.consume(state, pending.intent, pending.key, now());
      commit(
        result.state,
        "已确认一笔本地扣减。请查看回执；如误记，可立即撤回最近一笔。",
      );
      closeDialog("review-dialog");
      $("ledger-title").tabIndex = -1;
      $("ledger-title").focus();
    } catch (e) {
      pending = null;
      $("confirm-use").disabled = true;
      error(e.message, "review-error");
    }
  });
  document.addEventListener("click", (event) => {
    const close = event.target.closest("[data-close]");
    if (close) {
      closeDialog(close.dataset.close);
      return;
    }
    const target = event.target.closest("[data-action]");
    if (!target) return;
    try {
      if (target.dataset.action === "review-lot") openLot(target.dataset.id);
      if (target.dataset.action === "edit-recipe")
        openRecipe(target.dataset.id);
      if (target.dataset.action === "review-use") openReview(target.dataset.id);
      if (target.dataset.action === "undo")
        commit(
          C.undoConsumption(state, target.dataset.id),
          "最近一笔记账已撤回，原回执保留为已撤回；不代表恢复实物。",
        );
    } catch (e) {
      error(e.message);
    }
  });
  for (const id of ["lot-dialog", "recipe-dialog", "review-dialog"])
    $(id).addEventListener("cancel", () => {
      if (id === "review-dialog") pending = null;
    });
  $("add-lot").addEventListener("click", () => openLot());
  $("add-recipe").addEventListener("click", () => openRecipe());
  $("refresh").addEventListener("click", () => {
    try {
      pending = null;
      if (externalConflict) {
        externalConflict = false;
        load();
      }
      render();
      status("已按当前时刻重新核查。任何旧审阅都已取消。");
    } catch (e) {
      error(e.message);
    }
  });
  function download(data, filename) {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data)], { type: "application/json" }),
    );
    const link = el("a");
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  $("export").addEventListener("click", () =>
    download(
      {
        format: "pantry-relay-browser-export",
        version: 1,
        exported_at: now(),
        project: state.project,
        settings: state.settings,
        local_receipts: state.receipts,
        local_audit: state.audit,
        safety_guarantee: false,
      },
      "pantry-relay-local-ledger.json",
    ),
  );
  $("import").addEventListener("click", () => $("import-file").click());
  $("import-file").addEventListener("change", async () => {
    const file = $("import-file").files[0];
    $("import-file").value = "";
    if (!file) return;
    try {
      if (file.size > 1000000) throw new Error("文件请小于1MB。");
      const data = C.parseInput(await file.text());
      const project = C.validateProject(
        data.format === "pantry-relay-browser-export" ? data.project : data,
      );
      const settings =
        data.format === "pantry-relay-browser-export"
          ? data.settings
          : { servings: 1, budget_cents: 1500, simple_first: false, costs: {} };
      const next = C.createState(project, settings);
      if (
        !window.confirm(
          "导入将开启新账本并替换当前库存。请先导出留存。旧回执不会作为可信历史导入，未录成本的菜谱需补估计。继续？",
        )
      )
        return;
      checkStorage();
      commit(
        next,
        "库存已导入并重新核查。导出文件内的历史回执未回填，当前为新账本。",
        false,
      );
    } catch (e) {
      error("导入失败，原库存保留。" + e.message);
    }
  });
  $("reset").addEventListener("click", () => {
    if (
      !window.confirm(
        "开启新的虚构示例并替换当前账本？请先导出需要保留的记录。",
      )
    )
      return;
    try {
      checkStorage();
      commit(
        fresh(),
        "已载入新的虚构示例。日期按当天平移，不构成任何食品保鲜建议。",
        true,
      );
    } catch (e) {
      error(e.message);
    }
  });
  window.addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) {
      externalConflict = true;
      pending = null;
      $("confirm-use").disabled = true;
      status(
        "检测到其他标签页改动。为避免覆盖，请点击重新核查载入；当前审阅已取消。",
      );
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      pending = null;
      $("confirm-use").disabled = true;
      render();
    }
  });
  load();
  render();
  save();
})();
