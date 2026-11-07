import * as coreModule from "./vendor/core.js";
import * as demoModule from "./vendor/demo.js";

// Vite production converts the unchanged UMD sources to CommonJS modules;
// native ESM development loads their browser-global branch instead.
export const Core = coreModule.default ?? globalThis.PantryCore;
export const Demo = demoModule.default ?? globalThis.PantryDemo;
if (!Core?.createState || !Demo?.makeDemo) {
  throw new Error("Local pantry core failed to load.");
}
