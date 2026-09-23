"""Build the wheel and verify that the canonical runtime assets are packaged byte-identically.

Usage:
    python tools/verify_wheel_assets.py

Exit 0 when the wheel builds, every required module and asset is present and each packaged
asset is byte-identical to its source under config/. Exit 1 otherwise. Prints one line per check.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

REPO = Path(__file__).resolve().parents[1]
REQUIRED_MODULES = (
    "galecore_ai/adapters/cli.py",
    "galecore_ai/adapters/record_store.py",
    "galecore_ai/application/prepare_regime.py",
    "galecore_ai/application/record_regime.py",
    "galecore_ai/capabilities/regime_mapper.py",
    "galecore_ai/contracts/regime_analysis.py",
    "galecore_ai/contracts/regime_record.py",
    # GC-AI-0005: catalog, knowledge base, investigations
    "galecore_ai/adapters/frontmatter.py",
    "galecore_ai/adapters/knowledge_base.py",
    "galecore_ai/adapters/research_store.py",
    "galecore_ai/application/knowledge.py",
    "galecore_ai/contracts/research.py",
    "galecore_ai/harness/catalog.py",
)
# Every file under config/ must be packaged under galecore_ai/_assets/ unchanged.
ASSET_PREFIX = "galecore_ai/_assets/"


def main() -> int:
    dist = REPO / "dist"
    shutil.rmtree(dist, ignore_errors=True)
    build = subprocess.run([sys.executable, "-m", "build", "--wheel"], cwd=REPO, capture_output=True,
                           text=True, check=False)
    if build.returncode != 0:
        print("wheel build FAILED\n" + build.stdout[-2000:] + build.stderr[-2000:])
        return 1
    wheels = sorted(dist.glob("*.whl"))
    if len(wheels) != 1:
        print(f"expected exactly one wheel, found {[w.name for w in wheels]}")
        return 1
    wheel = wheels[0]
    print(f"wheel: {wheel.name}")
    ok = True
    with zipfile.ZipFile(wheel) as zf:
        names = set(zf.namelist())
        for module in REQUIRED_MODULES:
            present = module in names
            ok &= present
            print(f"{'ok ' if present else 'MISSING'} {module}")
        for source in sorted(p for p in (REPO / "config").rglob("*") if p.is_file()):
            packaged = ASSET_PREFIX + source.relative_to(REPO / "config").as_posix()
            if packaged not in names:
                ok = False
                print(f"MISSING {packaged}")
                continue
            same = hashlib.sha256(zf.read(packaged)).hexdigest() == hashlib.sha256(source.read_bytes()).hexdigest()
            ok &= same
            print(f"{'ok ' if same else 'DIFFERS'} {packaged} (byte-identical to config/)" if same
                  else f"DIFFERS {packaged}")
        meta = next(n for n in names if n.endswith("METADATA"))
        requires = [line for line in zf.read(meta).decode().splitlines() if line.startswith("Requires-Dist")]
        print("requires:", "; ".join(r.removeprefix("Requires-Dist: ") for r in requires))
    print("RESULT:", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
