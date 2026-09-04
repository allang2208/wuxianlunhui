#!/usr/bin/env python3
"""Build deterministic source contacts and GIFs for steel-shield videos."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent
BASE_PATH = ROOT.parent / "trench_assault" / "build-source-reviews.py"
SPEC = importlib.util.spec_from_file_location("steel_shield_source_review_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BASE_PATH}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)
BASE.TASK = ROOT
BASE.VIDEOS = ROOT / "videos"
BASE.PREVIEWS = ROOT / "previews"


def main() -> None:
    paths = sorted(BASE.VIDEOS.glob("*.mp4"))
    if not paths:
        raise RuntimeError("no source videos found")
    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "steel_shield_assault",
        "takes": [BASE.review(path) for path in paths],
    }
    BASE.PREVIEWS.mkdir(parents=True, exist_ok=True)
    output = BASE.PREVIEWS / "source-review-report.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
