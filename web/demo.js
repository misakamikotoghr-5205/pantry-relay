(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.PantryDemo = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";
  const fixture = {
    schema_version: 1,
    timezone: "Asia/Shanghai",
    sources: [
      {
        id: "label_tomato_a",
        kind: "user_label",
        text: "FICTIONAL DEMO label only: Use by 2026-11-05; after opening use within 24 hours.",
      },
      {
        id: "label_tomato_b",
        kind: "user_label",
        text: "FICTIONAL DEMO label only: Use by 2026-11-08.",
      },
      {
        id: "label_eggs",
        kind: "user_label",
        text: "FICTIONAL DEMO label only: Best before 2026-11-07.",
      },
      {
        id: "label_oats",
        kind: "user_label",
        text: "FICTIONAL DEMO label only: Best before 2026-12-01.",
      },
      {
        id: "label_milk",
        kind: "user_label",
        text: "FICTIONAL DEMO label only: Use by 2026-11-06. After-opening instruction not entered.",
      },
      {
        id: "label_conflict_a",
        kind: "user_label",
        text: "FICTIONAL DEMO label only: Transcription A: use by 2026-11-05.",
      },
      {
        id: "label_conflict_b",
        kind: "user_label",
        text: "FICTIONAL DEMO label only: Transcription B: use by 2026-11-06; user must resolve.",
      },
      {
        id: "label_packed",
        kind: "user_label",
        text: "FICTIONAL DEMO label only: Packed on 2026-11-01 only; no expiry date entered.",
      },
      {
        id: "label_peanuts",
        kind: "user_label",
        text: "FICTIONAL DEMO label only: Best before 2026-12-01. Contains peanut.",
      },
      {
        id: "opened_tomato",
        kind: "user_record",
        text: "Demo user entered opening at 2026-11-03T18:00:00+08:00.",
      },
      {
        id: "opened_milk",
        kind: "user_record",
        text: "Demo user entered opening at 2026-11-03T09:00:00+08:00.",
      },
      {
        id: "demo_confirmation",
        kind: "user_confirmation",
        text: "FICTIONAL demonstration: user asserts they checked actual labels, storage and current condition. No real observation or safety guarantee.",
      },
      {
        id: "recipe_tomato_eggs",
        kind: "user_recipe",
        text: "Original fictional demo recipe. Tomato egg plate: 200 g tomato and 2 eggs per serving. Use your own preparation method.",
      },
      {
        id: "recipe_plain_oats",
        kind: "user_recipe",
        text: "Original fictional demo recipe. Plain oats: 50 g oats per serving with kitchen water, which is not tracked. A simple single-ingredient option. Use your own preparation method.",
      },
      {
        id: "recipe_milk_oats",
        kind: "user_recipe",
        text: "Original fictional demo recipe. Milk oats: 200 ml milk and 50 g oats per serving. Milk currently needs review. Use your own preparation method.",
      },
      {
        id: "recipe_peanut_oats",
        kind: "user_recipe",
        text: "Original fictional demo recipe. Peanut oats: 20 g peanut and 50 g oats. User excludes peanut. Use your own preparation method.",
      },
      {
        id: "recipe_tomato_pasta",
        kind: "user_recipe",
        text: "Original fictional demo recipe. Tomato pasta: 200 g tomato and 100 g pasta. Pasta is absent from stock. Use your own preparation method.",
      },
    ],
    lots: [
      {
        id: "tomato_open",
        name: "已开封番茄 A（虚构）",
        ingredient: "tomato",
        quantity: "150",
        unit: "g",
        allergens: [],
        labels: [
          {
            kind: "use_by",
            date: "2026-11-05",
            source_id: "label_tomato_a",
          },
        ],
        confirmed_usable: true,
        confirmation_source_id: "demo_confirmation",
        opened_at: "2026-11-03T18:00:00+08:00",
        opened_source_id: "opened_tomato",
        after_open_hours: 24,
        after_open_source_id: "label_tomato_a",
      },
      {
        id: "tomato_sealed",
        name: "未开封番茄 B（虚构）",
        ingredient: "tomato",
        quantity: "300",
        unit: "g",
        allergens: [],
        labels: [
          {
            kind: "use_by",
            date: "2026-11-08",
            source_id: "label_tomato_b",
          },
        ],
        confirmed_usable: true,
        confirmation_source_id: "demo_confirmation",
      },
      {
        id: "eggs",
        name: "鸡蛋（虚构）",
        ingredient: "egg",
        quantity: "4",
        unit: "each",
        allergens: [],
        labels: [
          {
            kind: "best_before",
            date: "2026-11-07",
            source_id: "label_eggs",
          },
        ],
        confirmed_usable: true,
        confirmation_source_id: "demo_confirmation",
      },
      {
        id: "oats",
        name: "燕麦（虚构）",
        ingredient: "oat",
        quantity: "250",
        unit: "g",
        allergens: [],
        labels: [
          {
            kind: "best_before",
            date: "2026-12-01",
            source_id: "label_oats",
          },
        ],
        confirmed_usable: true,
        confirmation_source_id: "demo_confirmation",
      },
      {
        id: "milk_open",
        name: "开封后说明未录入的牛奶",
        ingredient: "milk",
        quantity: "500",
        unit: "ml",
        allergens: ["milk"],
        labels: [
          {
            kind: "use_by",
            date: "2026-11-06",
            source_id: "label_milk",
          },
        ],
        confirmed_usable: true,
        confirmation_source_id: "demo_confirmation",
        opened_at: "2026-11-03T09:00:00+08:00",
        opened_source_id: "opened_milk",
      },
      {
        id: "conflict_sauce",
        name: "两条日期矛盾的酱料",
        ingredient: "sauce",
        quantity: "100",
        unit: "g",
        allergens: [],
        labels: [
          {
            kind: "use_by",
            date: "2026-11-05",
            source_id: "label_conflict_a",
          },
          {
            kind: "use_by",
            date: "2026-11-06",
            source_id: "label_conflict_b",
          },
        ],
        confirmed_usable: true,
        confirmation_source_id: "demo_confirmation",
      },
      {
        id: "packed_only",
        name: "只有包装日期的豆腐",
        ingredient: "tofu",
        quantity: "200",
        unit: "g",
        allergens: [],
        labels: [],
        confirmed_usable: true,
        confirmation_source_id: "demo_confirmation",
        packed_on: {
          date: "2026-11-01",
          source_id: "label_packed",
        },
      },
      {
        id: "peanuts",
        name: "被用户排除的花生",
        ingredient: "peanut",
        quantity: "100",
        unit: "g",
        allergens: ["peanut"],
        labels: [
          {
            kind: "best_before",
            date: "2026-12-01",
            source_id: "label_peanuts",
          },
        ],
        confirmed_usable: true,
        confirmation_source_id: "demo_confirmation",
      },
    ],
    recipes: [
      {
        id: "tomato_eggs",
        name: "番茄鸡蛋（用户菜谱）",
        ingredients: [
          {
            ingredient: "tomato",
            quantity: "200",
            unit: "g",
          },
          {
            ingredient: "egg",
            quantity: "2",
            unit: "each",
          },
        ],
        allergens: [],
        source_id: "recipe_tomato_eggs",
      },
      {
        id: "plain_oats",
        name: "清水燕麦（用户菜谱）",
        ingredients: [
          {
            ingredient: "oat",
            quantity: "50",
            unit: "g",
          },
        ],
        allergens: [],
        source_id: "recipe_plain_oats",
      },
      {
        id: "milk_oats",
        name: "牛奶燕麦（待核查）",
        ingredients: [
          {
            ingredient: "milk",
            quantity: "200",
            unit: "ml",
          },
          {
            ingredient: "oat",
            quantity: "50",
            unit: "g",
          },
        ],
        allergens: ["milk"],
        source_id: "recipe_milk_oats",
      },
      {
        id: "peanut_oats",
        name: "花生燕麦（被排除）",
        ingredients: [
          {
            ingredient: "peanut",
            quantity: "20",
            unit: "g",
          },
          {
            ingredient: "oat",
            quantity: "50",
            unit: "g",
          },
        ],
        allergens: ["peanut"],
        source_id: "recipe_peanut_oats",
      },
      {
        id: "tomato_pasta",
        name: "番茄意面（缺货）",
        ingredients: [
          {
            ingredient: "tomato",
            quantity: "200",
            unit: "g",
          },
          {
            ingredient: "pasta",
            quantity: "100",
            unit: "g",
          },
        ],
        allergens: [],
        source_id: "recipe_tomato_pasta",
      },
    ],
    preferences: {
      allergens: ["peanut"],
      avoid_ingredients: [],
    },
  };
  function makeDemo(now = Date.now()) {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(now));
    const get = (type) => today.find((p) => p.type === type).value;
    const day = `${get("year")}-${get("month")}-${get("day")}`;
    const delta =
      Date.parse(day + "T00:00:00Z") - Date.parse("2026-11-04T00:00:00Z");
    const raw = JSON.stringify(fixture).replace(/2026-\d{2}-\d{2}/g, (date) =>
      new Date(Date.parse(date + "T00:00:00Z") + delta)
        .toISOString()
        .slice(0, 10),
    );
    return {
      project: JSON.parse(raw),
      settings: {
        servings: 1,
        budget_cents: 1500,
        simple_first: false,
        costs: {
          tomato_eggs: 800,
          plain_oats: 200,
          milk_oats: 500,
          peanut_oats: 350,
          tomato_pasta: 1000,
        },
      },
    };
  }
  return Object.freeze({ makeDemo });
});
