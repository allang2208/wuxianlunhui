#!/usr/bin/env python3
"""Build the approved trench-assault idle source sheet before RIFE."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from hashlib import sha256
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
BASE_BUILDER = (
    REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" /
    "build-sniper-source-sheets.py"
)
SPEC = importlib.util.spec_from_file_location("trench_assault_idle_base", BASE_BUILDER)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BASE_BUILDER}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)

VIDEO_NAME = "idle-doubao-v01.mp4"
SOURCE_INDICES = tuple(range(44, 94, 4))
DUPLICATE_ENDPOINT = 94
SOURCE_FRAME_RATE = 6.0
FIXED_SCALE = 0.20673076923076922
OUT = ROOT / "postprocess"
SOURCE_DIR = OUT / "source-sheets-pre-rife"
PREVIEW_DIR = OUT / "previews" / "source"
FRAME_DIR = OUT / "selected-cutouts" / "idle"
REPORT_PATH = OUT / "approved-idle-source-report.json"


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def alpha_iou(left: np.ndarray, right: np.ndarray, top: int = 0) -> float:
    left_mask = left[top:, :, 3] > 16
    right_mask = right[top:, :, 3] > 16
    union = np.logical_or(left_mask, right_mask).sum()
    return float(np.logical_and(left_mask, right_mask).sum() / union) if union else 1.0


def main() -> None:
    frames, decoded_frame_rate = BASE.BASE.decode_video(ROOT / "videos" / VIDEO_NAME)
    required = (*SOURCE_INDICES, DUPLICATE_ENDPOINT)
    if max(required) >= len(frames):
        raise RuntimeError(f"Idle source has {len(frames)} frames; need {max(required)}")

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    model = BASE.BASE.get_model()
    cutouts: dict[int, np.ndarray] = {}
    cleanup: dict[str, dict[str, int]] = {}
    for source_index in required:
        rgba = BASE.BASE.cutout_rgba(frames[source_index], model)
        rgba, detached_removed = BASE.strip_small_cutout_components(rgba)
        rgba[rgba[..., 3] == 0, :3] = 0
        cutouts[source_index] = rgba
        cleanup[str(source_index)] = {"detachedPixelsRemoved": detached_removed}
        Image.fromarray(rgba, "RGBA").save(FRAME_DIR / f"source-f{source_index:03d}.png")
        print(f"[trench-assault-idle] BiRefNet f{source_index}", flush=True)

    selected = [cutouts[index] for index in SOURCE_INDICES]
    endpoint = cutouts[DUPLICATE_ENDPOINT]
    frame_width, reference_anchor = BASE.choose_width(
        [*selected, endpoint], FIXED_SCALE, "center-body"
    )
    cells = [
        BASE.place_cell(
            rgba, FIXED_SCALE, frame_width, "center-body", "body-feet", reference_anchor
        )
        for rgba in selected
    ]
    endpoint_cell = BASE.place_cell(
        endpoint, FIXED_SCALE, frame_width, "center-body", "body-feet", reference_anchor
    )

    sheet_path = SOURCE_DIR / "idle.png"
    Image.fromarray(BASE.compose(cells), "RGBA").save(
        sheet_path, optimize=True, compress_level=9
    )
    preview_spec = BASE.ActionSpec(
        "idle", VIDEO_NAME, SOURCE_INDICES, SOURCE_FRAME_RATE, -1,
        "center-body", "body-feet"
    )
    BASE.save_previews(preview_spec, cells, PREVIEW_DIR)

    validation = BASE.BASE.validate_cells(cells, -1)
    validation.update(BASE.body_metrics(cells))
    validation["nonzeroRgbInTransparentPixels"] = max(
        int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
    )
    validation["firstEndpointFullAlphaIou"] = alpha_iou(cells[0], endpoint_cell)
    validation["firstEndpointLowerAlphaIou"] = alpha_iou(
        cells[0], endpoint_cell, round(BASE.FRAME_HEIGHT * 0.67)
    )
    validation["firstEndpointDelta"] = BASE.BASE.frame_delta(cells[0], endpoint_cell)

    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "trench_assault",
        "action": "idle",
        "status": "user_authorized_completion_postprocessed_pre_rife",
        "assetOnly": True,
        "runtimeIntegration": True,
        "source": f"videos/{VIDEO_NAME}",
        "sourceSha256": digest(ROOT / "videos" / VIDEO_NAME),
        "sourceFrameRate": decoded_frame_rate,
        "cycleStart": SOURCE_INDICES[0],
        "duplicateEndpoint": DUPLICATE_ENDPOINT,
        "sourceIndices": list(SOURCE_INDICES),
        "sourceFrameStep": 4,
        "selectionPolicy": (
            "loop-analysis top candidate raw [44,94); quarter-rate keys retain slow "
            "breathing while keeping the formal package inside the crowd target"
        ),
        "frameCount": len(cells),
        "endFrame": len(cells) - 1,
        "frameWidth": frame_width,
        "frameHeight": BASE.FRAME_HEIGHT,
        "cols": BASE.COLS,
        "rows": math.ceil(len(cells) / BASE.COLS),
        "frameRate": SOURCE_FRAME_RATE,
        "repeat": -1,
        "fixedScale": FIXED_SCALE,
        "feetY": BASE.FEET_Y,
        "targetEffectiveBodyHeight": BASE.TARGET_BODY_HEIGHT,
        "horizontalMode": "center-body-fixed-anchor",
        "verticalMode": "body-feet",
        "sheet": str(sheet_path.relative_to(ROOT)).replace("\\", "/"),
        "preview": str((PREVIEW_DIR / "idle.gif").relative_to(ROOT)).replace("\\", "/"),
        "contactSheet": str(
            (PREVIEW_DIR / "idle-contact.png").relative_to(ROOT)
        ).replace("\\", "/"),
        "cleanup": cleanup,
        "validation": validation,
        "sheetSha256": digest(sheet_path),
        "testsRun": False,
    }
    REPORT_PATH.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
