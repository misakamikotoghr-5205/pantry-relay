(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PantryCore = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const clone = (value) => JSON.parse(JSON.stringify(value));
  const units = new Set(["g", "ml", "each"]);
  const sourceKinds = new Set([
    "user_label",
    "user_record",
    "user_confirmation",
    "user_recipe",
  ]);
  const idPattern = /^[a-z][a-z0-9_-]{0,63}$/;
  function fail(message) {
    throw new Error(message);
  }
  function assert(ok, message) {
    if (!ok) fail(message);
  }
  function text(value, label, max = 4000) {
    assert(
      typeof value === "string" && value.trim() && value.length <= max,
      label + "不能为空或过长。",
    );
    return value.trim();
  }
  function fields(value, required, optional = []) {
    assert(
      value && typeof value === "object" && !Array.isArray(value),
      "需要对象。",
    );
    assert(
      required.every((key) => Object.hasOwn(value, key)),
      "缺少必要字段。",
    );
    assert(
      Object.keys(value).every((key) =>
        [...required, ...optional].includes(key),
      ),
      "包含未知字段。",
    );
  }
  function utf8Length(raw) {
    return new TextEncoder().encode(raw).length;
  }
  function parseInput(raw) {
    assert(
      typeof raw === "string" && utf8Length(raw) <= 1000000,
      "JSON文件不能超过1MB。",
    );
    let i = 0;
    const space = () => {
      while (/[ \t\r\n]/.test(raw[i] || "") && i < raw.length) i++;
    };
    const string = () => {
      const start = i++;
      while (i < raw.length) {
        if (raw[i] === "\\") {
          i += 2;
          continue;
        }
        if (raw[i++] === '"') return JSON.parse(raw.slice(start, i));
      }
      fail("JSON字符串未结束。");
    };
    function value(depth) {
      assert(depth <= 40, "JSON嵌套过深。");
      space();
      if (raw[i] === '"') return string();
      if (raw[i] === "{") {
        i++;
        space();
        const out = Object.create(null),
          keys = new Set();
        if (raw[i] === "}") {
          i++;
          return out;
        }
        for (;;) {
          space();
          assert(raw[i] === '"', "JSON对象键格式不正确。");
          const key = string();
          assert(!keys.has(key), "JSON含重复字段。");
          keys.add(key);
          space();
          assert(raw[i++] === ":", "JSON缺少冒号。");
          out[key] = value(depth + 1);
          space();
          const next = raw[i++];
          if (next === "}") return out;
          assert(next === ",", "JSON对象未结束。");
        }
      }
      if (raw[i] === "[") {
        i++;
        space();
        const out = [];
        if (raw[i] === "]") {
          i++;
          return out;
        }
        for (;;) {
          out.push(value(depth + 1));
          space();
          const next = raw[i++];
          if (next === "]") return out;
          assert(next === ",", "JSON数组未结束。");
        }
      }
      const token = raw
        .slice(i)
        .match(
          /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/,
        );
      assert(token, "JSON值格式不正确。");
      i += token[0].length;
      const parsed = JSON.parse(token[0]);
      assert(
        typeof parsed !== "number" || Number.isFinite(parsed),
        "不接受非有限数字。",
      );
      return parsed;
    }
    const result = value(0);
    space();
    assert(i === raw.length, "JSON存在多余内容。");
    return result;
  }
  function identifier(value) {
    assert(
      typeof value === "string" && idPattern.test(value),
      "标识格式不正确。",
    );
  }
  function quantity(value, allowZero = true) {
    assert(
      typeof value === "string" &&
        /^(?:0|[1-9]\d{0,8})(?:\.\d{1,3})?$/.test(value),
      "数量须为非负十进制，最多三位小数。",
    );
    const [whole, fraction = ""] = value.split(".");
    const n = Number(whole) * 1000 + Number(fraction.padEnd(3, "0"));
    assert(Number.isSafeInteger(n) && (allowZero || n > 0), "数量必须大于零。");
    return n;
  }
  function decimal(n) {
    assert(Number.isSafeInteger(n) && n >= 0, "数量运算越界。");
    return (
      String(Math.floor(n / 1000)) +
      (n % 1000
        ? "." +
          String(n % 1000)
            .padStart(3, "0")
            .replace(/0+$/, "")
        : "")
    );
  }
  function calendarDate(value) {
    assert(
      typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value),
      "日期须为年-月-日。",
    );
    const d = new Date(value + "T00:00:00Z");
    assert(
      Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === value,
      "日期不存在。",
    );
    return value;
  }
  function timestamp(value) {
    assert(
      typeof value === "string" &&
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(
          value,
        ),
      "时刻需要明确时区偏移。",
    );
    calendarDate(value.slice(0, 10));
    const clock = value.slice(11).match(/^(\d{2}):(\d{2})(?::(\d{2}))?/);
    assert(
      Number(clock[1]) < 24 &&
        Number(clock[2]) < 60 &&
        Number(clock[3] || 0) < 60,
      "时刻不存在。",
    );
    const time = Date.parse(value);
    assert(Number.isFinite(time), "时刻格式不正确。");
    return time;
  }
  function zonedParts(ms, timezone) {
    const format = new Intl.DateTimeFormat("en-GB", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    return Object.fromEntries(
      format
        .formatToParts(new Date(ms))
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    );
  }
  function localDate(ms, timezone) {
    const p = zonedParts(ms, timezone);
    return `${p.year}-${p.month}-${p.day}`;
  }
  function dateEndMs(day, timezone) {
    const next = new Date(day + "T00:00:00Z");
    next.setUTCDate(next.getUTCDate() + 1);
    const wall = next.getTime();
    let guess = wall;
    for (let i = 0; i < 4; i++) {
      const p = zonedParts(guess, timezone);
      const represented = Date.UTC(
        +p.year,
        +p.month - 1,
        +p.day,
        +p.hour,
        +p.minute,
        +p.second,
      );
      const correction = wall - represented;
      guess += correction;
      if (correction === 0) break;
    }
    return guess - 1;
  }
  function tags(value) {
    assert(Array.isArray(value) && value.length <= 50, "标签最多50项。");
    const result = value.map((tag) => text(tag, "标签", 80).toLowerCase());
    assert(new Set(result).size === result.length, "标签不能重复。");
    return result;
  }
  function validateProject(raw) {
    fields(raw, [
      "schema_version",
      "timezone",
      "sources",
      "lots",
      "recipes",
      "preferences",
    ]);
    const p = clone(raw);
    assert(p.schema_version === 1, "只接受版本1的库存。");
    text(p.timezone, "时区", 100);
    try {
      localDate(0, p.timezone);
    } catch (_) {
      fail("浏览器不支持该IANA时区。");
    }
    assert(
      Array.isArray(p.sources) &&
        p.sources.length >= 1 &&
        p.sources.length <= 1000,
      "来源须为1–1000条。",
    );
    const sources = new Map();
    for (const source of p.sources) {
      fields(source, ["id", "kind", "text"]);
      identifier(source.id);
      text(source.text, "来源原文");
      assert(
        sourceKinds.has(source.kind) && !sources.has(source.id),
        "来源类型不正确或ID重复。",
      );
      sources.set(source.id, source);
    }
    const reference = (id, kinds) => {
      const source = sources.get(id);
      assert(
        source && (!kinds || kinds.includes(source.kind)),
        "来源不存在或类型不匹配。",
      );
    };
    assert(
      Array.isArray(p.lots) && p.lots.length >= 1 && p.lots.length <= 1000,
      "库存须为1–1000批。",
    );
    const ids = new Set(),
      ingredientUnits = new Map();
    for (const lot of p.lots) {
      fields(
        lot,
        [
          "id",
          "name",
          "ingredient",
          "quantity",
          "unit",
          "allergens",
          "labels",
          "confirmed_usable",
        ],
        [
          "packed_on",
          "opened_at",
          "opened_source_id",
          "after_open_hours",
          "after_open_source_id",
          "confirmation_source_id",
        ],
      );
      identifier(lot.id);
      identifier(lot.ingredient);
      text(lot.name, "食材名称", 160);
      assert(!ids.has(lot.id), "批次ID重复。");
      ids.add(lot.id);
      const n = quantity(lot.quantity);
      assert(units.has(lot.unit), "仅支持克、毫升和个。");
      assert(lot.unit !== "each" || n % 1000 === 0, "个数必须为整数。");
      assert(
        !ingredientUnits.has(lot.ingredient) ||
          ingredientUnits.get(lot.ingredient) === lot.unit,
        "同种食材不能混用单位。",
      );
      ingredientUnits.set(lot.ingredient, lot.unit);
      lot.allergens = tags(lot.allergens);
      assert(
        Array.isArray(lot.labels) && lot.labels.length <= 20,
        "标签日期最多20条。",
      );
      for (const label of lot.labels) {
        fields(label, ["kind", "date", "source_id"]);
        calendarDate(label.date);
        assert(
          ["use_by", "best_before", "user_limit"].includes(label.kind),
          "未知日期类型。",
        );
        reference(
          label.source_id,
          label.kind === "user_limit"
            ? ["user_record", "user_confirmation"]
            : ["user_label"],
        );
      }
      if (Object.hasOwn(lot, "packed_on")) {
        fields(lot.packed_on, ["date", "source_id"]);
        calendarDate(lot.packed_on.date);
        reference(lot.packed_on.source_id, ["user_label"]);
      }
      if (Object.hasOwn(lot, "opened_at")) {
        timestamp(lot.opened_at);
        reference(lot.opened_source_id, ["user_record"]);
      } else
        assert(
          !Object.hasOwn(lot, "opened_source_id"),
          "开封来源需要开封时刻。",
        );
      if (Object.hasOwn(lot, "after_open_hours")) {
        assert(
          Number.isInteger(lot.after_open_hours) &&
            lot.after_open_hours >= 1 &&
            lot.after_open_hours <= 8760,
          "开封标签小时数须为1–8760整数。",
        );
        reference(lot.after_open_source_id, ["user_label"]);
      } else
        assert(
          !Object.hasOwn(lot, "after_open_source_id"),
          "开封后来源需要小时数。",
        );
      assert(typeof lot.confirmed_usable === "boolean", "核查状态须为布尔值。");
      if (lot.confirmed_usable || Object.hasOwn(lot, "confirmation_source_id"))
        reference(lot.confirmation_source_id, ["user_confirmation"]);
    }
    fields(p.preferences, ["allergens", "avoid_ingredients"]);
    p.preferences.allergens = tags(p.preferences.allergens);
    p.preferences.avoid_ingredients = tags(p.preferences.avoid_ingredients);
    assert(
      Array.isArray(p.recipes) &&
        p.recipes.length >= 1 &&
        p.recipes.length <= 200,
      "菜谱须为1–200条。",
    );
    const recipes = new Set();
    for (const recipe of p.recipes) {
      fields(recipe, ["id", "name", "ingredients", "allergens", "source_id"]);
      identifier(recipe.id);
      text(recipe.name, "菜谱名称", 160);
      reference(recipe.source_id, ["user_recipe"]);
      assert(!recipes.has(recipe.id), "菜谱ID重复。");
      recipes.add(recipe.id);
      recipe.allergens = tags(recipe.allergens);
      assert(
        Array.isArray(recipe.ingredients) &&
          recipe.ingredients.length >= 1 &&
          recipe.ingredients.length <= 50,
        "菜谱需要1–50种食材。",
      );
      const seen = new Set();
      for (const item of recipe.ingredients) {
        fields(item, ["ingredient", "quantity", "unit"]);
        identifier(item.ingredient);
        const n = quantity(item.quantity, false);
        assert(!seen.has(item.ingredient), "菜谱食材不能重复。");
        seen.add(item.ingredient);
        assert(
          units.has(item.unit) &&
            (!ingredientUnits.has(item.ingredient) ||
              ingredientUnits.get(item.ingredient) === item.unit),
          "菜谱单位与库存不一致。",
        );
        assert(item.unit !== "each" || n % 1000 === 0, "个数须为整数。");
      }
    }
    return p;
  }
  function assessLot(lot, project, at) {
    const now = timestamp(at),
      today = localDate(now, project.timezone);
    const reasons = [],
      constraints = [],
      grouped = new Map();
    const hold = (code, detail, sourceIds = []) =>
      reasons.push({ code, detail, source_ids: sourceIds });
    for (const label of lot.labels) {
      if (!grouped.has(label.kind)) grouped.set(label.kind, new Set());
      grouped.get(label.kind).add(label.date);
      constraints.push({
        kind: label.kind,
        at: new Date(dateEndMs(label.date, project.timezone)).toISOString(),
        source_ids: [label.source_id],
      });
      if (today > label.date)
        hold(
          "label_date_passed",
          "录入的标签日期已经过，不因勾选确认而放行。",
          [label.source_id],
        );
    }
    for (const [kind, dates] of grouped)
      if (dates.size > 1)
        hold(
          "conflicting_label_dates",
          "同一类标签日期互相矛盾，请核对原文。",
          lot.labels
            .filter((label) => label.kind === kind)
            .map((label) => label.source_id),
        );
    if (!lot.labels.length)
      hold(
        "missing_label_date",
        "缺少有来源的计划日期；不从包装日期推算保质期。",
      );
    if (lot.packed_on) {
      if (lot.packed_on.date > today)
        hold("future_packaging_date", "包装日期晚于当前日期。", [
          lot.packed_on.source_id,
        ]);
      if (lot.labels.some((label) => lot.packed_on.date > label.date))
        hold("date_order_conflict", "包装日期晚于标签日期。", [
          lot.packed_on.source_id,
        ]);
    }
    if (lot.opened_at) {
      const opened = timestamp(lot.opened_at);
      if (opened > now)
        hold("future_opening_record", "开封时刻在未来。", [
          lot.opened_source_id,
        ]);
      if (
        lot.packed_on &&
        localDate(opened, project.timezone) < lot.packed_on.date
      )
        hold("date_order_conflict", "开封早于包装日期。", [
          lot.opened_source_id,
          lot.packed_on.source_id,
        ]);
      if (!Object.hasOwn(lot, "after_open_hours"))
        hold(
          "missing_opening_instruction",
          "已开封，但没有录入包装上的开封后说明；系统不猜时长。",
          [lot.opened_source_id],
        );
      else {
        const limit = opened + lot.after_open_hours * 3600000;
        constraints.push({
          kind: "after_open_label",
          at: new Date(limit).toISOString(),
          source_ids: [lot.opened_source_id, lot.after_open_source_id],
        });
        if (now >= limit)
          hold("opening_instruction_elapsed", "已经达到录入的开封后时限。", [
            lot.after_open_source_id,
          ]);
      }
    }
    if (!lot.confirmed_usable)
      hold(
        "user_confirmation_required",
        "尚未由你核对实际标签、储存记录与当前状态。",
      );
    if (
      lot.allergens.some((tag) => project.preferences.allergens.includes(tag))
    )
      hold("user_allergen_filter", "与用户排除的过敏标签匹配。");
    if (project.preferences.avoid_ingredients.includes(lot.ingredient))
      hold("user_ingredient_filter", "这项食材在用户排除列表。");
    return {
      lot_id: lot.id,
      status:
        quantity(lot.quantity) === 0
          ? "empty"
          : reasons.length
            ? "hold"
            : "eligible_user_confirmed",
      reasons,
      constraints,
      priority_at: constraints.map((c) => c.at).sort()[0] || null,
      confirmation_source_id: lot.confirmation_source_id || null,
      safety_guarantee: false,
    };
  }
  function planProject(raw, at, servings = 1) {
    const project = validateProject(raw);
    timestamp(at);
    assert(
      Number.isInteger(servings) && servings >= 1 && servings <= 20,
      "份数须为1–20整数。",
    );
    const reviews = project.lots.map((lot) => assessLot(lot, project, at));
    const byId = new Map(reviews.map((review) => [review.lot_id, review]));
    const candidates = project.recipes.map((recipe) => {
      const excluded = [];
      if (
        recipe.allergens.some((tag) =>
          project.preferences.allergens.includes(tag),
        )
      )
        excluded.push({ code: "user_allergen_filter" });
      if (
        recipe.ingredients.some((item) =>
          project.preferences.avoid_ingredients.includes(item.ingredient),
        )
      )
        excluded.push({ code: "user_ingredient_filter" });
      const allocations = [],
        shortages = [],
        shopping = [];
      for (const item of recipe.ingredients) {
        const needed = quantity(item.quantity) * servings;
        const matching = project.lots.filter(
          (lot) => lot.ingredient === item.ingredient,
        );
        const eligible = matching
          .filter(
            (lot) => byId.get(lot.id).status === "eligible_user_confirmed",
          )
          .sort(
            (a, b) =>
              (byId.get(a.id).priority_at || "9999").localeCompare(
                byId.get(b.id).priority_at || "9999",
              ) || a.id.localeCompare(b.id),
          );
        let remaining = needed;
        for (const lot of eligible) {
          const take = Math.min(remaining, quantity(lot.quantity));
          if (take) {
            const review = byId.get(lot.id);
            allocations.push({
              lot_id: lot.id,
              ingredient: lot.ingredient,
              quantity: decimal(take),
              unit: lot.unit,
              priority_at: review.priority_at,
              constraints: review.constraints,
              confirmation_source_id: review.confirmation_source_id,
            });
            remaining -= take;
          }
        }
        if (remaining)
          shortages.push({
            ingredient: item.ingredient,
            quantity: decimal(remaining),
            unit: item.unit,
            held_lot_ids: matching
              .filter((lot) => byId.get(lot.id).status === "hold")
              .map((lot) => lot.id),
          });
        const physical = matching.reduce(
          (sum, lot) => sum + quantity(lot.quantity),
          0,
        );
        if (needed > physical)
          shopping.push({
            ingredient: item.ingredient,
            quantity: decimal(needed - physical),
            unit: item.unit,
          });
      }
      return {
        recipe_id: recipe.id,
        name: recipe.name,
        servings,
        source_id: recipe.source_id,
        can_consume: !excluded.length && !shortages.length,
        excluded,
        allocations: excluded.length ? [] : allocations,
        eligible_stock_shortages: shortages,
        shopping_list: excluded.length ? [] : shopping,
        priority_at:
          allocations
            .map((a) => a.priority_at)
            .filter(Boolean)
            .sort()[0] || null,
      };
    });
    candidates.sort(
      (a, b) =>
        Number(!a.can_consume) - Number(!b.can_consume) ||
        Number(!!a.excluded.length) - Number(!!b.excluded.length) ||
        (a.priority_at || "9999").localeCompare(b.priority_at || "9999") ||
        a.recipe_id.localeCompare(b.recipe_id),
    );
    return {
      as_of: new Date(timestamp(at)).toISOString(),
      timezone: project.timezone,
      servings,
      candidates,
      lot_review: reviews,
      sources: project.sources,
      reservations_created: false,
      next_recipe_id:
        candidates.find((item) => item.can_consume)?.recipe_id || null,
      safety_guarantee: false,
    };
  }
  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object")
      return (
        "{" +
        Object.keys(value)
          .sort()
          .map((key) => JSON.stringify(key) + ":" + canonical(value[key]))
          .join(",") +
        "}"
      );
    return JSON.stringify(value);
  }
  function validateSettings(settings, project) {
    fields(settings, ["servings", "budget_cents", "simple_first", "costs"]);
    assert(
      Number.isInteger(settings.servings) &&
        settings.servings >= 1 &&
        settings.servings <= 20,
      "份数须为1–20整数。",
    );
    assert(
      Number.isInteger(settings.budget_cents) &&
        settings.budget_cents >= 0 &&
        settings.budget_cents <= 99999999,
      "成本上限须为有效金额。",
    );
    assert(typeof settings.simple_first === "boolean", "偏好格式不正确。");
    assert(
      settings.costs &&
        !Array.isArray(settings.costs) &&
        typeof settings.costs === "object",
      "成本估计格式不正确。",
    );
    for (const [id, cents] of Object.entries(settings.costs))
      assert(
        project.recipes.some((r) => r.id === id) &&
          Number.isInteger(cents) &&
          cents >= 0 &&
          cents <= 99999999,
        "菜谱估计金额不正确。",
      );
    return clone(settings);
  }
  function createState(project, settings) {
    const p = validateProject(project);
    return boundedState({
      version: 1,
      revision: 0,
      project: p,
      settings: validateSettings(settings, p),
      receipts: [],
      audit: [{ event: "INITIALIZED", detail: "本地库存初始化" }],
    });
  }
  function boundedState(state) {
    assert(
      utf8Length(JSON.stringify(state)) <= 900000,
      "本地账本接近容量上限，请导出留存并减少冗余来源后开启新账本。此次修改未保存。",
    );
    return state;
  }
  function validateState(raw) {
    boundedState(raw);
    fields(raw, [
      "version",
      "revision",
      "project",
      "settings",
      "receipts",
      "audit",
    ]);
    assert(
      raw.version === 1 &&
        Number.isSafeInteger(raw.revision) &&
        raw.revision >= 0,
      "存档版本不正确。",
    );
    const project = validateProject(raw.project),
      settings = validateSettings(raw.settings, project);
    assert(
      Array.isArray(raw.receipts) &&
        raw.receipts.length <= 200 &&
        Array.isArray(raw.audit) &&
        raw.audit.length <= 1000,
      "账本大小超出限制。",
    );
    const receiptKeys = new Set();
    for (const receipt of raw.receipts) {
      fields(receipt, [
        "id",
        "key",
        "intent",
        "recipe_id",
        "servings",
        "as_of",
        "revision_before",
        "revision_after",
        "changes",
        "reversed",
        "safety_guarantee",
        "replayed",
      ]);
      assert(
        typeof receipt.key === "string" &&
          /^[A-Za-z0-9_-]{12,128}$/.test(receipt.key) &&
          receipt.id === "use_" + receipt.key &&
          !receiptKeys.has(receipt.key),
        "回执ID或消费键不一致。",
      );
      receiptKeys.add(receipt.key);
      assert(
        Number.isInteger(receipt.revision_before) &&
          receipt.revision_before >= 0 &&
          receipt.revision_after === receipt.revision_before + 1 &&
          receipt.revision_after <= raw.revision,
        "回执版本损坏。",
      );
      assert(
        typeof receipt.reversed === "boolean" &&
          receipt.safety_guarantee === false &&
          receipt.replayed === false &&
          Array.isArray(receipt.changes),
        "回执状态损坏。",
      );
      timestamp(receipt.as_of);
      const intent = parseInput(receipt.intent),
        bound = parseInput(intent.snapshot);
      const before = createState(bound.project, bound.settings);
      before.revision = intent.revision;
      const recomputed = intentFor(before, intent.recipe_id, receipt.as_of);
      assert(
        canonical(recomputed) === canonical(intent) &&
          receipt.intent === canonical(intent) &&
          intent.revision === receipt.revision_before &&
          receipt.recipe_id === intent.recipe_id &&
          receipt.servings === intent.servings,
        "回执与审阅快照不一致。",
      );
      const expected = intent.allocations.map((allocation) => {
        const lot = before.project.lots.find(
          (item) => item.id === allocation.lot_id,
        );
        return {
          lot_id: lot.id,
          name: lot.name,
          before: decimal(quantity(lot.quantity)),
          used: allocation.quantity,
          remaining: decimal(
            quantity(lot.quantity) - quantity(allocation.quantity),
          ),
          unit: lot.unit,
          confirmation_source_id: allocation.confirmation_source_id,
        };
      });
      assert(
        canonical(expected) === canonical(receipt.changes),
        "回执数量与原始审阅分配不一致。",
      );
    }
    return { ...clone(raw), project, settings };
  }
  function planState(raw, at) {
    const state = validateState(raw),
      plan = planProject(state.project, at, state.settings.servings);
    for (const candidate of plan.candidates) {
      const estimate = state.settings.costs[candidate.recipe_id];
      candidate.estimated_cost_cents = Number.isInteger(estimate)
        ? estimate * state.settings.servings
        : null;
      candidate.budget_ok =
        candidate.estimated_cost_cents !== null &&
        candidate.estimated_cost_cents <= state.settings.budget_cents;
      candidate.can_confirm = candidate.can_consume && candidate.budget_ok;
    }
    if (state.settings.simple_first)
      plan.candidates.sort(
        (a, b) =>
          Number(!a.can_confirm) - Number(!b.can_confirm) ||
          state.project.recipes.find((r) => r.id === a.recipe_id).ingredients
            .length -
            state.project.recipes.find((r) => r.id === b.recipe_id).ingredients
              .length,
      );
    plan.revision = state.revision;
    return plan;
  }
  function intentFor(state, recipeId, at) {
    const candidate = planState(state, at).candidates.find(
      (item) => item.recipe_id === recipeId,
    );
    assert(
      candidate && candidate.can_confirm,
      "此菜谱尚未通过库存、人工核查或估计预算门禁。",
    );
    return {
      revision: state.revision,
      recipe_id: recipeId,
      servings: state.settings.servings,
      snapshot: canonical({
        project: state.project,
        settings: state.settings,
        allocations: candidate.allocations,
      }),
      allocations: clone(candidate.allocations),
      estimated_cost_cents: candidate.estimated_cost_cents,
    };
  }
  function consume(raw, intent, key, at) {
    const state = validateState(raw);
    assert(
      typeof key === "string" && /^[A-Za-z0-9_-]{12,128}$/.test(key),
      "消费键格式不正确。",
    );
    const existing = state.receipts.find((item) => item.key === key);
    if (existing) {
      assert(existing.intent === canonical(intent), "此消费键属于另一条计划。");
      return { state, receipt: { ...clone(existing), replayed: true } };
    }
    assert(
      intent && intent.revision === state.revision,
      "库存或偏好已变化，请重新审阅计划。",
    );
    const current = intentFor(state, intent.recipe_id, at);
    assert(
      canonical(current) === canonical(intent),
      "时限、来源或分配发生变化，请重新审阅。",
    );
    const next = clone(state),
      changes = [];
    assert(
      next.receipts.length < 200 && next.audit.length < 999,
      "本地账本已满，请导出后开启新库存。",
    );
    for (const allocation of current.allocations) {
      const lot = next.project.lots.find(
        (item) => item.id === allocation.lot_id,
      );
      const before = quantity(lot.quantity),
        after = before - quantity(allocation.quantity);
      assert(after >= 0, "库存不足，整笔操作取消。");
      lot.quantity = decimal(after);
      changes.push({
        lot_id: lot.id,
        name: lot.name,
        before: decimal(before),
        used: allocation.quantity,
        remaining: lot.quantity,
        unit: lot.unit,
        confirmation_source_id: allocation.confirmation_source_id,
      });
    }
    next.revision++;
    const receipt = {
      id: "use_" + key,
      key,
      intent: canonical(intent),
      recipe_id: current.recipe_id,
      servings: current.servings,
      as_of: new Date(timestamp(at)).toISOString(),
      revision_before: state.revision,
      revision_after: next.revision,
      changes,
      reversed: false,
      safety_guarantee: false,
      replayed: false,
    };
    next.receipts.push(receipt);
    next.audit.push({ event: "CONSUMED", detail: receipt.id });
    return { state: boundedState(next), receipt };
  }
  function undoConsumption(raw, receiptId) {
    const state = validateState(raw),
      receipt = state.receipts.find((item) => item.id === receiptId);
    assert(
      receipt && !receipt.reversed && receipt.revision_after === state.revision,
      "只能撤回最近一笔，且之后不能有库存或偏好修改。",
    );
    const next = clone(state);
    for (const change of receipt.changes) {
      const lot = next.project.lots.find((item) => item.id === change.lot_id);
      assert(
        lot && lot.quantity === change.remaining,
        "库存已变化，不能撤回。",
      );
      lot.quantity = change.before;
    }
    next.receipts.find((item) => item.id === receiptId).reversed = true;
    next.revision++;
    next.audit.push({ event: "REVERSED", detail: receiptId });
    return boundedState(next);
  }
  function updateState(raw, project, settings, event = "REVIEWED") {
    const state = validateState(raw),
      p = validateProject(project);
    const next = {
      ...state,
      project: p,
      settings: validateSettings(settings, p),
      revision: state.revision + 1,
    };
    assert(next.audit.length < 1000, "本地账本已满，请先导出。");
    next.audit.push({ event, detail: "修改后原审阅快照失效" });
    return boundedState(next);
  }
  return Object.freeze({
    utf8Length,
    clone,
    quantity,
    decimal,
    calendarDate,
    timestamp,
    localDate,
    parseInput,
    validateProject,
    assessLot,
    planProject,
    canonical,
    createState,
    validateState,
    planState,
    intentFor,
    consume,
    undoConsumption,
    updateState,
  });
});
