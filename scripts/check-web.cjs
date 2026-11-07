const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, "web", file), "utf8");
const html = read("index.html"),
  app = read("app.js"),
  css = read("styles.css");
for (const file of ["app.js", "core.js", "demo.js"]) {
  const result = spawnSync(
    process.execPath,
    ["--check", path.join(root, "web", file)],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
assert.equal(new Set(ids).size, ids.length, "Unique HTML IDs");
const refs = [...app.matchAll(/\$\((["'])([^"']+)\1\)/g)].map(
  (match) => match[2],
);
assert(refs.length > 40, "Inspect actual DOM references");
for (const id of refs) assert(ids.includes(id), `Missing DOM element: ${id}`);
for (const file of [
  "index.html",
  "app.js",
  "core.js",
  "demo.js",
  "styles.css",
]) {
  const content = read(file);
  assert(
    !/https?:\/\/|@import|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon/.test(
      content,
    ),
    `Offline boundary: ${file}`,
  );
}
assert(
  !/\.innerHTML\s*=|insertAdjacentHTML|eval\s*\(/.test(app),
  "Untrusted input is rendered as text",
);
assert(html.includes('aria-live="polite"') && html.includes('role="alert"'));
assert(css.includes("focus-visible") && css.includes("prefers-reduced-motion"));
for (const asset of [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(
  (m) => m[1],
))
  assert(
    fs.existsSync(path.join(root, "web", asset)),
    `Missing local asset ${asset}`,
  );
console.log(
  `Classic JS syntax, ${refs.length} DOM references, assets, accessibility hooks and offline boundary PASS.`,
);
console.log("This static check is not browser interaction or layout QA.");
