#!/usr/bin/env python3
"""Build profiles/*.export.json from .cfg + .Dockerfile for Import / Export."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "profiles"


def parse_cfg(path: Path) -> dict[str, str]:
    out: dict[str, str] = {}
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        k, v = k.strip(), v.strip()
        if len(v) >= 2 and v[0] == v[-1] and v[0] in "\"'":
            v = v[1:-1]
        out[k] = v
    return out


def main() -> None:
    for name in ("fern-sim", "opencode-mobile", "thisprop"):
        cfg = parse_cfg(ROOT / f"{name}.cfg")
        df = (ROOT / f"{name}.Dockerfile").read_text(encoding="utf-8")
        if not df.endswith("\n"):
            df += "\n"
        bundle = {
            "format": "ci-runner-farm-export",
            "version": 1,
            "profile": name,
            "settings": cfg,
            "dockerfile": df,
        }
        out = ROOT / f"{name}.export.json"
        out.write_text(
            json.dumps(bundle, indent=2, ensure_ascii=False) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        print(f"wrote {out} ({out.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
