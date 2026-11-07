const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const C = require("../core.js");
const D = require("../demo.js");
const root = path.resolve(__dirname, "../..");
const NOW = "2026-11-04T12:00:00+08:00";
const fixture = () =>
  JSON.parse(fs.readFileSync(path.join(root, "examples/pantry.json"), "utf8"));
const settings = () => ({
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
});
const initial = () => C.createState(fixture(), settings());
const candidate = (plan, id) =>
  plan.candidates.find((item) => item.recipe_id === id);
const review = (plan, id) => plan.lot_review.find((item) => item.lot_id === id);

test("shared Python fixture has the same allocations, holds and physical shortages", () => {
  const python = JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import json;from pantry_relay.core import plan_project;p=json.load(open('examples/pantry.json'));print(json.dumps(plan_project(p,'2026-11-04T12:00:00+08:00')))",
      ],
      { cwd: root, encoding: "utf8" },
    ),
  );
  const js = C.planProject(fixture(), NOW);
  for (const p of python.candidates) {
    const j = candidate(js, p.recipe_id);
    assert.equal(j.can_consume, p.can_consume);
    assert.deepEqual(
      j.allocations.map((a) => [
        a.lot_id,
        a.quantity,
        a.unit,
        a.confirmation_source_id,
      ]),
      p.allocations.map((a) => [
        a.lot_id,
        a.quantity,
        a.unit,
        a.confirmation_source_id,
      ]),
    );
    assert.deepEqual(j.eligible_stock_shortages, p.eligible_stock_shortages);
    assert.deepEqual(j.shopping_list, p.shopping_list);
  }
  for (const p of python.lot_review) {
    const j = review(js, p.lot_id);
    assert.equal(j.status, p.status);
    assert.deepEqual(
      j.reasons.map((r) => r.code).sort(),
      p.reasons.map((r) => r.code).sort(),
    );
  }
});
test("planning is read-only; full recipe uses two FIFO-by-entered-constraint lots", () => {
  const p = fixture(),
    before = C.clone(p),
    plan = C.planProject(p, NOW);
  assert.deepEqual(p, before);
  assert.deepEqual(
    candidate(plan, "tomato_eggs").allocations.map((a) => [
      a.lot_id,
      a.quantity,
    ]),
    [
      ["tomato_open", "150"],
      ["tomato_sealed", "50"],
      ["eggs", "2"],
    ],
  );
  assert.equal(plan.reservations_created, false);
  assert.equal(plan.safety_guarantee, false);
});
test("exact thousandths and trailing zero quantities survive consume, restore and undo", () => {
  const p = fixture();
  p.lots[3].quantity = "0.300";
  p.recipes[1].ingredients[0].quantity = "0.1";
  const s = C.createState(p, { ...settings(), servings: 3 });
  const result = C.consume(
    s,
    C.intentFor(s, "plain_oats", NOW),
    "decimal_test_001",
    NOW,
  );
  assert.equal(result.state.project.lots[3].quantity, "0");
  const restored = C.validateState(JSON.parse(JSON.stringify(result.state)));
  assert.equal(
    C.undoConsumption(restored, result.receipt.id).project.lots[3].quantity,
    "0.3",
  );
});
test("opened-at elapsed boundary and missing instruction stay held despite confirmation", () => {
  const before = C.planProject(fixture(), "2026-11-04T17:59:59.999+08:00");
  const at = C.planProject(fixture(), "2026-11-04T18:00:00+08:00");
  assert.equal(review(before, "tomato_open").status, "eligible_user_confirmed");
  assert(
    review(at, "tomato_open").reasons.some(
      (r) => r.code === "opening_instruction_elapsed",
    ),
  );
  assert(
    review(at, "milk_open").reasons.some(
      (r) => r.code === "missing_opening_instruction",
    ),
  );
});
test("label day is project-local, including a DST transition day", () => {
  const p = fixture();
  p.timezone = "America/New_York";
  p.lots[1].labels[0].date = "2026-11-01";
  assert.equal(
    review(C.planProject(p, "2026-11-02T04:59:59.999Z"), "tomato_sealed")
      .status,
    "eligible_user_confirmed",
  );
  assert.equal(
    review(C.planProject(p, "2026-11-02T05:00:00Z"), "tomato_sealed").status,
    "hold",
  );
});
test("date conflict, packaging-only, future records and absent confirmation block stock", () => {
  const p = fixture();
  p.lots[0].opened_at = "2026-11-05T00:00:00Z";
  p.lots[1].confirmed_usable = false;
  const plan = C.planProject(p, NOW);
  assert(
    review(plan, "tomato_open").reasons.some(
      (r) => r.code === "future_opening_record",
    ),
  );
  assert.equal(review(plan, "tomato_sealed").status, "hold");
  assert(
    review(plan, "conflict_sauce").reasons.some(
      (r) => r.code === "conflicting_label_dates",
    ),
  );
  assert(
    review(plan, "packed_only").reasons.some(
      (r) => r.code === "missing_label_date",
    ),
  );
});
test("held physical inventory is not automatically a shopping deficit", () => {
  const plan = C.planProject(fixture(), NOW);
  assert.deepEqual(candidate(plan, "milk_oats").shopping_list, []);
  assert.deepEqual(
    candidate(plan, "milk_oats").eligible_stock_shortages[0].held_lot_ids,
    ["milk_open"],
  );
  assert.deepEqual(candidate(plan, "tomato_pasta").shopping_list, [
    { ingredient: "pasta", quantity: "100", unit: "g" },
  ]);
});
test("exact allergy/avoidance filters and estimated budget cannot be bypassed", () => {
  const s = initial();
  for (const id of ["milk_oats", "peanut_oats", "tomato_pasta"])
    assert.throws(() => C.intentFor(s, id, NOW));
  s.settings.budget_cents = 100;
  assert.throws(() => C.intentFor(s, "plain_oats", NOW));
  s.settings.budget_cents = 1500;
  delete s.settings.costs.plain_oats;
  assert.throws(() => C.intentFor(s, "plain_oats", NOW));
  s.settings.costs.plain_oats = 200;
  s.project.preferences.avoid_ingredients = ["oat"];
  assert.throws(() => C.intentFor(s, "plain_oats", NOW));
});
test("each critical preview change revokes its human-review intent", () => {
  for (const mutate of [
    (s) => s.settings.servings++,
    (s) => s.settings.budget_cents++,
    (s) => s.settings.costs.plain_oats++,
    (s) => (s.project.lots[3].quantity = "200"),
    (s) => (s.project.sources[0].text += " correction"),
    (s) => s.project.preferences.allergens.push("egg"),
  ]) {
    const s = initial(),
      intent = C.intentFor(s, "plain_oats", NOW);
    mutate(s);
    assert.throws(() => C.consume(s, intent, "stale_intent_001", NOW));
  }
});
test("confirmation recomputes expiry and fails atomically", () => {
  const s = initial();
  s.project.recipes[0].ingredients[0].quantity = "400";
  const intent = C.intentFor(s, "tomato_eggs", NOW),
    before = C.clone(s);
  assert.throws(() =>
    C.consume(s, intent, "elapsed_clock_001", "2026-11-04T18:00:00+08:00"),
  );
  assert.deepEqual(s, before);
});
test("one receipt, idempotent retry across dates, and whole allocation deduction", () => {
  const s = initial(),
    intent = C.intentFor(s, "tomato_eggs", NOW);
  const a = C.consume(s, intent, "dinner_receipt_001", NOW);
  const b = C.consume(
    a.state,
    intent,
    "dinner_receipt_001",
    "2030-01-01T00:00:00Z",
  );
  assert.equal(b.receipt.replayed, true);
  assert.deepEqual(b.state, a.state);
  assert.deepEqual(
    a.receipt.changes.map((c) => c.remaining),
    ["0", "250", "2"],
  );
  assert.throws(() =>
    C.consume(a.state, { ...intent, servings: 2 }, "dinner_receipt_001", NOW),
  );
});
test("undo is a single latest-bookkeeping correction and a metadata edit blocks it", () => {
  const s = initial(),
    done = C.consume(
      s,
      C.intentFor(s, "plain_oats", NOW),
      "undo_receipt_001",
      NOW,
    );
  const undone = C.undoConsumption(done.state, done.receipt.id);
  assert.equal(undone.project.lots[3].quantity, "250");
  assert.equal(undone.receipts[0].reversed, true);
  assert.throws(() => C.undoConsumption(undone, done.receipt.id));
  const changed = C.updateState(
    done.state,
    done.state.project,
    done.state.settings,
  );
  assert.throws(() => C.undoConsumption(changed, done.receipt.id));
});
test("forged restored before/used receipt cannot inflate quantity on undo", () => {
  const s = initial(),
    done = C.consume(
      s,
      C.intentFor(s, "plain_oats", NOW),
      "forged_receipt_001",
      NOW,
    );
  done.state.receipts[0].changes[0].before = "1000200";
  done.state.receipts[0].changes[0].used = "1000000";
  assert.throws(() => C.validateState(done.state));
  assert.throws(() => C.undoConsumption(done.state, done.receipt.id));
});
test("oversized receipt snapshot is rejected without changing the original inventory", () => {
  const p = fixture();
  for (let i = 0; i < 150; i++)
    p.sources.push({
      id: "source_" + i,
      kind: "user_record",
      text: "A".repeat(3900),
    });
  const s = C.createState(p, settings()),
    before = C.clone(s),
    intent = C.intentFor(s, "plain_oats", NOW);
  assert.throws(() => C.consume(s, intent, "large_receipt_001", NOW), /容量/);
  assert.deepEqual(s, before);
});

test("UTF-8 byte limit prevents a Chinese-source ledger from becoming unimportable", () => {
  const p = fixture();
  for (let i = 0; i < 100; i++)
    p.sources.push({
      id: "cnsource_" + i,
      kind: "user_record",
      text: "菜".repeat(1900),
    });
  const s = C.createState(p, settings()),
    before = C.clone(s);
  assert(C.utf8Length(JSON.stringify(s)) < 900000);
  assert.throws(
    () =>
      C.consume(s, C.intentFor(s, "plain_oats", NOW), "chinese_size_001", NOW),
    /容量/,
  );
  assert.deepEqual(s, before);
  assert.throws(
    () => C.parseInput(JSON.stringify({ text: "菜".repeat(340000) })),
    /1MB/,
  );
});
test("schema rejects null optional objects, incompatible sources/units and fractional each", () => {
  for (const value of [null, false, 0]) {
    const p = fixture();
    p.lots[0].packed_on = value;
    assert.throws(() => C.validateProject(p));
  }
  for (const mutate of [
    (p) => (p.lots[0].labels[0].source_id = "recipe_plain_oats"),
    (p) => (p.lots[0].unit = "ml"),
    (p) => (p.lots[2].quantity = "1.5"),
  ]) {
    const p = fixture();
    mutate(p);
    assert.throws(() => C.validateProject(p));
  }
});
test("strict JSON rejects duplicate keys, nonfinite numbers, excess depth and size", () => {
  for (const raw of [
    '{"a":1,"a":2}',
    '{"a":1e999}',
    "[".repeat(42) + "0" + "]".repeat(42),
    "x".repeat(1000001),
    '\u00a0{"a":1}',
  ])
    assert.throws(() => C.parseInput(raw));
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(C.parseInput('{"x":[true,null,"text\\\\value"]}')),
    ),
    { x: [true, null, "text\\value"] },
  );
});
test("invalid calendar values and timezone-less opening timestamps are rejected", () => {
  for (const value of ["2026-02-30", "2026-13-01", "2026-1-01"])
    assert.throws(() => C.calendarDate(value));
  for (const value of [
    "2026-11-04T25:00:00Z",
    "2026-11-04T12:00:00",
    "2026-11-04T12:00:00+99:00",
  ])
    assert.throws(() => C.timestamp(value));
});
test("fictional demo shifts dates, stays a valid project and includes no online dependency", () => {
  const d = D.makeDemo(Date.parse("2027-02-15T04:00:00Z"));
  const s = C.createState(d.project, d.settings),
    p = C.planState(s, "2027-02-15T04:00:00Z");
  assert(p.candidates.some((r) => r.can_confirm));
  assert.equal(d.project.lots[0].labels[0].date, "2027-02-16");
  assert(d.project.sources.some((source) => source.text.includes("FICTIONAL")));
});
