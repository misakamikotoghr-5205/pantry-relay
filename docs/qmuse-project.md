# QMuse adapter: local checks and platform boundary

The existing `web/` application and its offline distribution remain a separate
deliverable. A QMuse project must be a real React application; adding a dependency
name or embedding the offline page in an iframe does not establish compatibility.

## Official tools checked on 2026-11-07 UTC

The [QMuse CLI documentation](https://docs.qmuse.cn/docs/qmuse-cli), linked by the
[official Emerge website](https://emerge.alipay.com/), identifies the public npm
package [`@qmuse/qmuse-cli`](https://www.npmjs.com/package/@qmuse/qmuse-cli).
Version **1.0.14** was installed in task-local tooling, not globally. Its package
metadata requires Node.js 20 or newer. `--version` and help completed successfully.
The bundled `skills/qmuse-cli/SKILL.md` and core-flow reference were read directly;
no global agent Skill was installed.

A single bounded `qmuse whoami` check returned in **1.719 seconds**, with exit
code **0** but an explicit unauthenticated status. Exit code zero is therefore
not treated as proof of login. Account output and credential values were not
published. No login, template download, space selection, app creation, import,
cloud-service activation, upload or deployment was performed.

The official `qmuse create` template command also requires login. We did not use
it as an unauthenticated template download or fabricate an application binding.

## What the local format check proves

CLI 1.0.14 has no documented independent `check` or `import --dry-run` command.
Its distributed `dist/import/preflight.js` exports a read-only
`preflightImport(directory)` function. Its implementation reads files and hashes;
it does not upload them. For the local check, network `fetch` is replaced by a
function that throws. This is a version-specific inspection of the installed
official package, not a stable public CLI command or a platform acceptance test.

The function requires a root `package.json` declaring React. It excludes
`node_modules`, `dist`, `.qmuse`, `.env*` and ignored files; it rejects unsafe
paths, symbolic links, credential-like files and statically identifiable relative
iframe sources. The official documentation describes ordinary React + Vite
projects as supported import candidates, subject to checks and possible changes.

The existing plain-static **`web/` directory was actually checked offline and
rejected** with the message `一期仅支持包含 package.json 的 React 项目`.
This is evidence that the existing static directory cannot be sent unchanged
through that CLI import path. A local preflight success does not run a Vite build,
prove behavior in QMuse, or guarantee content-security and deployment checks.

To repeat that version-specific, read-only check from the repository root, set
`QMUSE_CLI_PACKAGE_DIR` to the installed package directory (the directory that
contains its `package.json`, `dist/` and `skills/`):

```sh
node --input-type=module - <<'JS'
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const packageDir = process.env.QMUSE_CLI_PACKAGE_DIR;
if (!packageDir) throw new Error('Set QMUSE_CLI_PACKAGE_DIR to the installed official CLI package.');
globalThis.fetch = async () => { throw new Error('Network disabled for offline preflight'); };
const { preflightImport } = await import(pathToFileURL(path.join(packageDir, 'dist/import/preflight.js')));
const result = await preflightImport('./qmuse');
console.log(JSON.stringify({
  sourceHash: result.sourceHash,
  fileCount: result.fileCount,
  totalBytes: result.totalBytes,
  envKeys: result.envKeys,
  cloudProviders: result.cloudProviders,
}, null, 2));
JS
```

This calls neither `qmuse import` nor its authenticated upload path. Review the
installed function again before repeating this technique with another version.

## Frozen React candidate: independently checked on 2026-11-07 UTC

The `qmuse/` directory is a separate React 19.3.1 + Vite 8.3.6 application with a
pinned lockfile. Its forms and review state are React components; it does not
embed `web/` in an iframe. The inventory engine, fictional demo and styles are
self-contained copies documented by `qmuse/vendor-provenance.json`. All three
copies were independently compared with their recorded SHA-256 hashes and the
source files at commit `962ceddf7171b3c92b62be12e5f950b7b199de12`; they match.

The final candidate passed the installed official package's read-only preflight:

```json
{
  "cliVersion": "1.0.14",
  "sourceHash": "afc27a1cf0645d596f4ea184008cd79463021412d7965885d986cae439c2560d",
  "fileCount": 19,
  "totalBytes": 246828,
  "envKeys": [],
  "cloudProviders": [],
  "fetchCalls": 0,
  "fetchDisabled": true,
  "uploaded": false
}
```

An independent `cd qmuse && npm run verify` completed successfully with Node.js
24.22.0. It checked the lockfile, vendor hashes, self-contained imports, ignored
private/build files and core-module initialization. The added production regression
compiled the actual core bridge using Vite's production transformation, cleared
existing Pantry globals, imported that compiled module, and successfully created
and planned a fictional pantry. The subsequent application build compiled 20
modules. The final five production files total **387,382 bytes**. Parsing the
generated HTML found two asset references, both relative and present on disk:
`./assets/index-bohgKTnG.js` and `./assets/index-Dg3lGRtK.css`.
The two final license assets were independently compared byte-for-byte with
`public/LICENSE.txt` and `public/THIRD-PARTY-NOTICES.txt`; the project license also
matches `qmuse/LICENSE`. Notices retain the installed React, React DOM, Scheduler
and Vite packages' license text rather than substituting a generic license.

An earlier verification attempt correctly failed on a whitespace-sensitive source
assertion in the check script. That assertion and two other implementation-text
assertions were removed; the final result above uses the corrected script.
Source-pattern checks are not claimed as interaction tests. Independent code
inspection found that the entry point uses React StrictMode and consumption is
called by the explicit confirmation handler, rather than rendering or an effect.
This inspection does not certify runtime behavior in the QMuse host.

### First production failure and correction

The first actual production-browser check failed: `index-Cz_teKbu.js` displayed
`Local pantry core failed to load.` even though the development UI and build
command had passed. The unchanged UMD vendor sources take different export paths
under development and Vite's production CommonJS transformation. The previous
global-only bridge did not handle the production module exports. A successful
build and preflight had therefore not proved that the production page loaded.

The corrected bridge uses the imported module's default export when present,
with the browser global as the development fallback; vendor source bytes remain
unchanged. The production regression above covers that export difference rather
than checking source text. The main operator then independently repeated the real
production-browser flow with `index-bohgKTnG.js`: the complete UI loaded, explicit
approval consumed 300 to 100 grams and four to two items at revision 1, reload
preserved that result, and undo restored 300 grams and four items at revision 2
while retaining the receipt. There were zero new console errors after the repair
test's start timestamp. These are local production-host checks, not a remote
QMuse deployment or contest submission.

The React candidate uses local browser storage and no external runtime resources.
It has no QMuse account, cloud database or model integration. Its compiled
ES-module build requires an HTTP host; the separate offline HTML/ZIP remains the
deliverable intended for direct local-file use.

## Platform work remains separate

When the owner can authenticate, the documented sequence is login, confirm the
target space, import, inspect the generated version, and explicitly deploy the
selected version. `import` creates a version; only a successful release status
and its returned URL establish publication. App publication also does not itself
establish Emerge contest registration, completed contest submission or acceptance.

No QMuse application ID, remote version, published URL, model execution or cloud
database is claimed by these local checks. The standalone Python/Ollama evidence
is separate from browser execution. Local browser inventory and receipts must
not be described as authenticated shared cloud data.

## Actual desktop browser checks

The main operator exercised the genuine React UI through CUA: explicit review and confirmation, inventory deductions, reload, undo, budget and exclusion changes, a new held lot, real file export/import, cross-tab invalidation, and saving a cost estimate for a recipe with an out-of-stock ingredient while preserving the shortage gate. See the [sanitized browser record](evidence/qmuse-react-web-20261107.json). These are local desktop checks, separate from the official package preflight and any future remote QMuse release.
