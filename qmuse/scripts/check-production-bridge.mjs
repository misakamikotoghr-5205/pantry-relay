import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = await mkdtemp(
  path.join(os.tmpdir(), "pantry-production-bridge-"),
);
try {
  // Compile the actual module bridge with Vite's production CommonJS conversion.
  // Source-only Node loading cannot expose the UMD/production export difference.
  await build({
    root,
    configFile: false,
    logLevel: "silent",
    build: {
      outDir: output,
      emptyOutDir: true,
      minify: true,
      lib: {
        entry: path.join(root, "src/core.mjs"),
        formats: ["es"],
        fileName: () => "bridge.mjs",
      },
    },
  });
  delete globalThis.PantryCore;
  delete globalThis.PantryDemo;
  const { Core, Demo } = await import(
    pathToFileURL(path.join(output, "bridge.mjs"))
  );
  const example = Demo.makeDemo();
  const state = Core.createState(example.project, example.settings);
  assert.equal(Core.validateState(state).revision, 0);
  assert.ok(
    Core.planState(state, new Date().toISOString()).candidates.length > 0,
  );
  console.log(
    "PASS: Vite-compiled production bridge initializes Core/Demo without preexisting browser globals",
  );
} finally {
  await rm(output, { recursive: true, force: true });
}
