#!/usr/bin/env python3
"""Apply pair-local authored-key holds found by visual interpolation review."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
RIFE_PATH = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SPEC = importlib.util.spec_from_file_location("sealed_wraith_rife_helpers", RIFE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import RIFE helper: {RIFE_PATH}")
RIFE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RIFE
SPEC.loader.exec_module(RIFE)


def repair_borequake() -> None:
    sheet_path = ROOT / "sheets" / "interpolated" / "borequake.png"
    report_path = ROOT / "interpolation-reports" / "borequake.json"
    preview_dir = ROOT / "previews" / "interpolated"
    frames = RIFE.extract_cells(sheet_path, 768, 672, 8, 61)

    # Contact-sheet review found small but high-contrast magenta/white codec
    # blocks in these generated odd frames. Preserve the preceding authored key
    # for each pair; no authored even frame or action trajectory is changed.
    holds = [7, 31]
    for index in holds:
        frames[index] = frames[index - 1].copy()
    Image.fromarray(RIFE.compose(frames, 8), "RGBA").save(
        sheet_path, optimize=True, compress_level=9
    )
    RIFE.write_previews("borequake", frames, 6.0, "one-shot", preview_dir)

    report = json.loads(report_path.read_text(encoding="utf-8"))
    existing = set(report["validation"].get("middleFrameHeldSourceKeyFallbacks", []))
    report["validation"]["middleFrameHeldSourceKeyFallbacks"] = sorted(existing | set(holds))
    report["validation"]["visibleRedOutlierFrames"] = {}
    report["validation"]["manualVisualRepairs"] = [
        {
            "outputFrame": index,
            "replacement": f"authored output frame {index - 1}",
            "reason": "high-contrast chroma block in generated odd frame",
        }
        for index in holds
    ]
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")


def refresh_combined() -> None:
    combined_path = ROOT / "interpolation-report.json"
    combined = json.loads(combined_path.read_text(encoding="utf-8"))
    for action in ("borequake", "drillRush"):
        combined["actions"][action] = json.loads(
            (ROOT / "interpolation-reports" / f"{action}.json").read_text(encoding="utf-8")
        )
    combined_path.write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> None:
    repair_borequake()
    refresh_combined()
    print("[sealed-wraith-rife] repaired borequake f7/f31 and refreshed combined report")


if __name__ == "__main__":
    main()
