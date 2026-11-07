const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const dist = path.join(root, "dist");
const files = ["index.html", "styles.css", "core.js", "demo.js", "app.js"];
fs.mkdirSync(dist, { recursive: true });
for (const file of fs.readdirSync(dist)) {
  if (!files.includes(file) && file !== "LICENSE.txt")
    throw new Error(
      `Unexpected dist file: ${file}; preserve it for review rather than deleting it.`,
    );
}
for (const file of files)
  fs.copyFileSync(path.join(root, "web", file), path.join(dist, file));
fs.copyFileSync(path.join(root, "LICENSE"), path.join(dist, "LICENSE.txt"));
fs.mkdirSync(path.join(root, "releases"), { recursive: true });
const python = String.raw`
from pathlib import Path
from zipfile import ZipFile,ZipInfo,ZIP_DEFLATED
import hashlib,json
root=Path.cwd(); dist=root/'dist'; archive=root/'releases/pantry-relay-offline-html.zip'
files=sorted(p.name for p in dist.iterdir() if p.is_file())
assert files==['LICENSE.txt','app.js','core.js','demo.js','index.html','styles.css']
with ZipFile(archive,'w',compression=ZIP_DEFLATED) as z:
 for name in files:
  info=ZipInfo(name,(2026,1,1,0,0,0));info.compress_type=ZIP_DEFLATED
  z.writestr(info,(dist/name).read_bytes())
with ZipFile(archive) as z:
 assert z.testzip() is None
 assert 'index.html' in z.namelist()
 assert all('/' not in name and '\\' not in name for name in z.namelist())
 assert all(z.read(name)==(dist/name).read_bytes() for name in files)
assert archive.stat().st_size<100_000_000
report={'archive':'releases/'+archive.name,'bytes':archive.stat().st_size,'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'root_index':True,'crc_and_source_match':True,'runtime_network_dependencies':False,'browser_qa_performed_by_this_build':False,'alipay_deployment_or_submission':False,'files':[{'path':name,'bytes':(dist/name).stat().st_size,'sha256':hashlib.sha256((dist/name).read_bytes()).hexdigest()} for name in files]}
(root/'releases/package-audit.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
print(json.dumps({k:v for k,v in report.items() if k!='files'},ensure_ascii=False,indent=2))
`;
process.stdout.write(
  execFileSync("python3", ["-c", python], { cwd: root, encoding: "utf8" }),
);
