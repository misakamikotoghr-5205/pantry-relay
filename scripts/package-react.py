"""Package the existing Vite output for the contest's static ZIP uploader."""
from pathlib import Path
from zipfile import ZipFile, ZipInfo, ZIP_DEFLATED
import hashlib
import json

root = Path(__file__).resolve().parents[1]
dist = root / "qmuse" / "dist"
source_package = json.loads((root / "qmuse" / "package.json").read_text())
metadata = {key: source_package[key] for key in ("name", "version", "private", "type", "license")}
assert metadata["name"] and metadata["version"] == "1.0.0"
entries = {
    p.relative_to(dist).as_posix(): p.read_bytes()
    for p in dist.rglob("*") if p.is_file()
}
assert "index.html" in entries and "LICENSE.txt" in entries and "THIRD-PARTY-NOTICES.txt" in entries
assert not any(name.startswith("dist/") or "node_modules" in name for name in entries)
entries["package.json"] = (json.dumps(metadata, ensure_ascii=False, indent=2) + "\n").encode()
archive = root / "releases" / "pantry-relay-react-html.zip"
with ZipFile(archive, "w", compression=ZIP_DEFLATED) as z:
    for name, content in sorted(entries.items()):
        info = ZipInfo(name, (2026, 1, 1, 0, 0, 0))
        info.compress_type = ZIP_DEFLATED
        z.writestr(info, content)
with ZipFile(archive) as z:
    assert z.testzip() is None
    assert all(z.read(name) == content for name, content in entries.items())
    assert json.loads(z.read("package.json"))["name"] == metadata["name"]
report_path = root / "releases" / "react-package-audit.json"
report = json.loads(report_path.read_text())
report.update({
    "bytes": archive.stat().st_size,
    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "root_package_metadata": metadata,
    "package_metadata_added_on": "2026-11-10",
    "runtime_files_unchanged_from_browser_verified_build": True,
    "files": [{"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()}
              for name, content in sorted(entries.items())],
})
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({key: report[key] for key in ("archive", "bytes", "sha256", "root_package_metadata")}, ensure_ascii=False))
