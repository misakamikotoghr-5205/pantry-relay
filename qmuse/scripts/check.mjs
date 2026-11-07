import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => readFile(path.join(root, name), "utf8");
const sha = (buffer) => createHash("sha256").update(buffer).digest("hex");
const provenance = JSON.parse(await read("vendor-provenance.json"));
for (const entry of provenance.files) {
  const bytes = await readFile(path.join(root, entry.vendored));
  assert.equal(
    sha(bytes),
    entry.sha256,
    `Vendored copy changed: ${entry.vendored}`,
  );
}
const pkg = JSON.parse(await read("package.json"));
const lock = JSON.parse(await read("package-lock.json"));
assert.equal(pkg.dependencies.react, "19.3.1");
assert.equal(pkg.dependencies["react-dom"], pkg.dependencies.react);
assert.equal(lock.packages[""].dependencies.react, pkg.dependencies.react);
assert.equal(
  lock.packages["node_modules/react"].version,
  pkg.dependencies.react,
);
assert.equal(
  lock.packages["node_modules/vite"].version,
  pkg.devDependencies.vite,
);
const ignored = await read(".gitignore");
for (const token of ["node_modules/", "dist/", ".qmuse/", ".env"])
  assert.ok(ignored.includes(token), `Missing private/build ignore: ${token}`);
const walk = async (dir) => {
  const files = [];
  for (const entry of await readdir(path.join(root, dir), {
    withFileTypes: true,
  })) {
    assert.equal(
      entry.isSymbolicLink(),
      false,
      "Source must not depend on symlinks",
    );
    const name = path.posix.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(name)));
    else files.push(name);
  }
  return files;
};
for (const name of await walk("src")) {
  const source = await read(name);
  assert.ok(!/<iframe\b/i.test(source), `Unexpected iframe in ${name}`);
  assert.ok(
    !/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource)\s*\(/.test(source),
    `Unexpected runtime network call in ${name}`,
  );
  assert.ok(
    !/https?:\/\//.test(source),
    `Unexpected remote URL in runtime source: ${name}`,
  );
  for (const match of source.matchAll(
    /\b(?:from\s*|import\s*)["']([^"']+)["']/g,
  )) {
    const specifier = match[1];
    if (!specifier.startsWith(".")) {
      assert.ok(
        specifier === "react" || specifier === "react-dom/client",
        `Unlisted source dependency: ${specifier}`,
      );
      continue;
    }
    const target = path.resolve(root, path.dirname(name), specifier);
    assert.ok(
      target.startsWith(`${root}${path.sep}`),
      `Import leaves QMuse upload root: ${name}`,
    );
    assert.ok(
      (await stat(target)).isFile(),
      `Missing upload source: ${specifier}`,
    );
  }
}
const { Core, Demo } = await import(path.join(root, "src/core.mjs"));
const demo = Demo.makeDemo();
const state = Core.createState(demo.project, demo.settings);
assert.ok(
  Core.planState(state, new Date().toISOString()).candidates.length > 0,
  "Vendored module shim must initialize a real plan",
);
assert.equal(Core.validateState(state).revision, 0);
console.log(
  "PASS: self-contained source imports, pinned lock, vendor hashes, offline runtime, private ignores and real core module initialization",
);
