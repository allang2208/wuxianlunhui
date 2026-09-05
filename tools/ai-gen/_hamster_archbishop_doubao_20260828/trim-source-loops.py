#!/usr/bin/env python3
"""Trim the already-cut-out loop sheets to the selected natural cycles."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
HELPER_PATH = REPO / "tools" / "ai-gen" / "_hamster_halberd_20260825" / "build-halberdier-sheets.py"
SPEC = importlib.util.spec_from_file_location("archbishop_trim_helpers", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)
BASE = HELPER.BASE


WINDOWS = {
    "idle": {
        "sourceFrameRange": [8, 112],
        "closureFrame": 116,
        "sheetStart": 2,
        "sheetEndExclusive": 29,
        "durationSeconds": 4.5,
        "seamRatio": 1.018,
    },
    "moving": {
        "sourceFrameRange": [64, 88],
        "closureFrame": 92,
        "sheetStart": 16,
        "sheetEndExclusive": 23,
        "durationSeconds": 1.1666666666666667,
        "seamRatio": 1.234,
    },
}


def extract(sheet_path: Path, spec: dict[str, object]) -> list[np.ndarray]:
    sheet = np.asarray(Image.open(sheet_path).convert("RGBA"))
    width = int(spec["frameWidth"])
    height = int(spec["frameHeight"])
    cols = int(spec["cols"])
    cells = []
    for index in range(int(spec["frameCount"])):
        row, col = divmod(index, cols)
        cells.append(sheet[row * height:(row + 1) * height, col * width:(col + 1) * width].copy())
    return cells


def main() -> None:
    report_path = ROOT / "source-sheet-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    sheet_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"

    for action, window in WINDOWS.items():
        spec = report["actions"][action]
        full_cells = extract(sheet_dir / f"{action}.png", spec)
        cells = full_cells[int(window["sheetStart"]):int(window["sheetEndExclusive"])]
        source_indices = list(range(
            int(window["sourceFrameRange"][0]),
            int(window["sourceFrameRange"][1]) + 1,
            4,
        ))
        if len(cells) != len(source_indices):
            raise RuntimeError(f"{action}: cell/source index mismatch")
        Image.fromarray(HELPER.compose(cells), "RGBA").save(
            sheet_dir / f"{action}.png", optimize=True, compress_level=9
        )
        preview_spec = HELPER.ActionSpec(
            action,
            tuple(source_indices),
            float(spec["sourceSheetFrameRate"]),
            -1,
            str(spec["horizontalMode"]),
            str(spec["verticalMode"]),
        )
        HELPER.save_previews(preview_spec, cells, preview_dir)
        validation = BASE.validate_cells(cells, -1)
        validation.update(HELPER.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        spec.update({
            "sourceIndices": source_indices,
            "sourceEndPoseFrame": int(window["closureFrame"]),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "rows": math.ceil(len(cells) / int(spec["cols"])),
            "expectedRifeFrameCount": len(cells) * 2,
            "expectedRifeFrameRate": float(spec["sourceSheetFrameRate"]) * 2,
            "validation": validation,
            "naturalCycle": {
                "sourceFrameRange": window["sourceFrameRange"],
                "closureFrame": int(window["closureFrame"]),
                "durationSeconds": float(window["durationSeconds"]),
                "seamRatio": float(window["seamRatio"]),
                "trajectoryEdited": False,
            },
        })

    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: report["actions"][key] for key in WINDOWS}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
