#!/usr/bin/env python3
"""Replace one visually rejected death middle frame with its authored key."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
RIFE_PATH = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
SPEC = importlib.util.spec_from_file_location("black_lung_rife_helpers", RIFE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import RIFE helper: {RIFE_PATH}")
RIFE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = RIFE
SPEC.loader.exec_module(RIFE)


def main() -> None:
    sheet_path = ROOT / "sheets" / "interpolated" / "dying.png"
    report_path = ROOT / "interpolation-reports" / "dying.json"
    preview_dir = ROOT / "previews" / "interpolated"
    frames = RIFE.extract_cells(sheet_path, 640, 640, 8, 41)

    # Visual contact-sheet review found a transient red block in generated f23
    # (between authored f22/f24).  Keep the earlier source key for this single
    # middle frame; every other generated frame remains RIFE output.
    frames[23] = frames[22].copy()
    Image.fromarray(RIFE.compose(frames, 8), "RGBA").save(
        sheet_path, optimize=True, compress_level=9
    )
    RIFE.write_previews("dying", frames, 6.0, "one-shot", preview_dir)

    report = json.loads(report_path.read_text(encoding="utf-8"))
    report["validation"]["middleFrameHeldSourceKeyFallbacks"] = [17, 23]
    report["validation"]["manualVisualRepair"] = {
        "outputFrame": 23,
        "replacement": "authored output frame 22",
        "reason": "transient red interpolation block on settled boot/head edge",
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    combined_path = ROOT / "interpolation-report.json"
    if combined_path.exists():
        combined = json.loads(combined_path.read_text(encoding="utf-8"))
        combined["actions"]["dying"] = report
        combined_path.write_text(
            json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
        )
    print("[black-lung-dying] held output f23 to authored f22 after visual review")


if __name__ == "__main__":
    main()
