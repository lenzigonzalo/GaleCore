"""Arma el paquete ciego: rotula X/Y segun label_map.json y reemplaza menciones literales a la instruccion."""

import json
import re
from pathlib import Path

base = Path(__file__).parent
m = json.loads((base / "label_map.json").read_text())
out = base / "blind"
out.mkdir(exist_ok=True)
pat = re.compile(
    r"SKILL\.md|coverage\.md|strategy-design|[A-Za-z]:[\\/][^\s`)]*scratchpad[^\s`)]*",
    re.IGNORECASE,
)
for case in ("spy", "gold"):
    for cond, key in (("A", "A_sin"), ("B", "B_con")):
        text = (base / "raw" / f"{case}-{cond}.md").read_text(encoding="utf-8")
        red, n = pat.subn("[REF]", text)
        red, n2 = re.subn(
            r"con la instrucci[oó]n piloto `?\[REF\]`? ?0\.2\.0-draft|`[^`]*instruction/[^`]*`",
            "[REF]",
            red,
        )
        n += n2
        (out / f"{case}-{m[case][key]}.md").write_text(red, encoding="utf-8")
        print(case, cond, "->", m[case][key], "redactions:", n, "chars:", len(text))
