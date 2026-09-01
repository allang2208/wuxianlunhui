#!/usr/bin/env python3
"""Run the validated same-foot cycle analyzer on Frostbound Spearman."""

from pathlib import Path


ROOT = Path(__file__).resolve().parent
template = ROOT.parent / "_abyss_rime_beast_h3_20260901" / "analyze-running-cycle.py"
source = template.read_text(encoding="utf-8")
source = source.replace("Abyss Rime Beast", "Frostbound Spearman")
source = source.replace("abyss-rime-beast-running-h3-v01.mp4", "frostbound-spearman-running-h3-v01.mp4")
scope = {"__file__": str(Path(__file__).resolve()), "__name__": "__main__"}
exec(compile(source, str(template), "exec"), scope)
