# Pantry Relay — React project for QMuse

A self-contained React + Vite implementation of the pantry workflow. This is a real component-based application: controlled inventory/recipe forms, React state, source-based holds, preference and budget controls, explicit human confirmation, inventory consumption receipts, latest-operation undo, local persistence and JSON import/export. It does not embed the separate offline HTML app in an iframe.

## Run locally

Requires Node `^20.19.0 || >=22.12.0` and npm. From this directory:

```sh
npm ci
npm run dev
```

The development server listens on `127.0.0.1:5174`. For the production bundle:

```sh
npm run verify
npm run preview
```

Preview listens on `127.0.0.1:4174`. `dist/` contains local JS/CSS assets with relative paths. Use an HTTP server; this React module build is not a `file://` ZIP. The existing parent `web/` and offline upload ZIP remain separate, unchanged artifacts.

Dependencies were resolved from the official npm registry: React / React DOM **19.3.1**, Vite **8.3.6**, React Vite plugin **6.2.1**. The lockfile records the exact dependency graph. Installation/build requires development dependencies; the built application makes no external API requests or runtime model calls.

## Workflow and boundaries

- The initial inventory, recipe text and cost estimates are fictional. Example dates shift with the current day; this is not a preservation recommendation.
- Enter batches with quantity, units, date/source text, optional packaging/opening records and your own verification. Missing, conflicting or elapsed constraints remain held. A checkbox cannot override a failed date gate.
- Apply servings, estimated budget and exact exclusion tags before review. Each candidate independently previews the same available stock and does not reserve it. Cost estimates are user-entered, not live prices.
- The review dialog shows exact batch quantities and estimates. Confirmation requires a fresh checkbox. At execution the pure core rechecks the current time, revision, settings, source text and allocations. Consumption occurs only in an explicit event handler, not in an effect or React render.
- Receipts describe local bookkeeping. Only the latest unchanged consumption can be reversed; an undo does not restore physical food. Browser reload preserves the validated ledger; a pending approval is never persisted.
- Export saves the current local project, settings and historical receipts for review. Import deliberately uses only validated project/settings and starts a **new ledger at revision 0**, without trusting imported receipt history. Maximum input is 1,000,000 UTF-8 bytes. Core/wrapper state limits prevent writing a ledger that cannot be imported later.
- Storage is scoped to this browser/origin under a React-specific key. Storage failure degrades to in-memory operation and export. Another-tab changes cancel review and require refresh; there is no cross-tab transaction, server account, shared database or tamper-resistant receipt.
- The planner is deterministic local logic. It does not determine whether food is safe, identify undeclared allergens, diagnose dietary needs, purchase items, use a payment API or invoke an LLM. The separate Python/Ollama example is **not** wired into this React app.

## Code provenance and checks

`src/vendor/{core.js,demo.js,styles.css}` are exact MIT-licensed copies of this same repository's frozen offline implementation at commit `962ceddf7171b3c92b62be12e5f950b7b199de12`. See `vendor-provenance.json` for SHA-256 values and `LICENSE`. `src/core.mjs` initializes those self-contained copies; nothing imports from the parent directory. The React UI is maintained in `src/App.jsx`. `public/LICENSE.txt` and `public/THIRD-PARTY-NOTICES.txt` retain the project and upstream React/React DOM/Scheduler/Vite license texts and are copied into each production build.

`npm run check` verifies copied source hashes, the pinned lock, local source boundaries, absence of runtime networking/iframes, ignored local/private artifacts and execution of the actual module shim. `npm run check:production` separately compiles and executes the actual core bridge with Vite production CommonJS conversion and no preexisting browser globals. This guards against a real development/production UMD-export mismatch found during production preview. `npm run build` compiles the real React application. The parent pure-core tests already cover the domain rules and are not duplicated here. Browser interaction QA is a separate check; build success alone is not a claim of UI QA or platform acceptance.

## QMuse status

This source layout targets the documented [QMuse CLI React import workflow](https://docs.qmuse.cn/docs/qmuse-cli). Its official CLI local format preflight is read-only; passing it does **not** mean authentication, import, cloud build, publishing or platform acceptance succeeded. No QMuse login/import/upload/deploy command is run by this project. Publishing authentication is distinct from application data access: this app still stores business data locally in the browser, with no QMuse user-data integration. See the parent `docs/qmuse-project.md` for independently recorded preflight/build evidence and outstanding platform steps.

`node_modules/`, `dist/`, `.qmuse/` and `.env*` are ignored. Upload/install this entire `qmuse/` source directory; no parent source, credential or Python service is needed.
