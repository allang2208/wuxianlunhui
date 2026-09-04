#!/usr/bin/env python3
"""Build the approved movement-only v05 loop source sheet before RIFE."""

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


def load_module(path: Path, name: str):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


BASE = load_module(
    REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" /
    "build-sniper-source-sheets.py",
    "trench_assault_running_base",
)
EDGE = load_module(
    ROOT.parent / "steel_shield_assault" / "build-formal-source-sheets.py",
    "trench_assault_running_edge_cleanup",
)

VIDEO_NAME = "running-doubao-v05-reference-only.mp4"
SOURCE_INDICES = tuple(range(15, 51, 2))
DUPLICATE_ENDPOINT = 51
SOURCE_FRAME_RATE = 12.0
FIXED_SCALE = 0.20673076923076922
OUT = ROOT / "postprocess"
SOURCE_DIR = OUT / "source-sheets-pre-rife"
PREVIEW_DIR = OUT / "previews" / "source"
FRAME_DIR = OUT / "selected-cutouts" / "running"
REPORT_PATH = OUT / "approved-running-source-report.json"


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
        raise RuntimeError(f"Running source has {len(frames)} frames; need {max(required)}")

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    model = BASE.BASE.get_model()
    cutouts: dict[int, np.ndarray] = {}
    cleanup: dict[str, dict[str, int]] = {}
    for source_index in required:
        rgba = BASE.BASE.cutout_rgba(frames[source_index], model)
        rgba, alpha_trimmed = EDGE.trim_source_matte(frames[source_index], rgba)
        rgba, edge_recolored = EDGE.replace_semtransparent_matte_rgb(frames[source_index], rgba)
        rgba, detached_removed = BASE.strip_small_cutout_components(rgba)
        rgba[rgba[..., 3] == 0, :3] = 0
        cutouts[source_index] = rgba
        cleanup[str(source_index)] = {
            "matteAlphaPixelsTrimmed": alpha_trimmed,
            "matteEdgePixelsRecolored": edge_recolored,
            "detachedPixelsRemoved": detached_removed,
        }
        Image.fromarray(rgba, "RGBA").save(
            FRAME_DIR / f"source-f{source_index:03d}.png", optimize=True, compress_level=9
        )
        print(f"[trench-assault-running] BiRefNet f{source_index}", flush=True)

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
    ground_removed: list[int] = []
    cleaned_cells = []
    for cell in cells:
        cleaned, removed = EDGE.remove_ground_contact_matte(cell)
        cleaned[cleaned[..., 3] == 0, :3] = 0
        cleaned_cells.append(cleaned)
        ground_removed.append(removed)
    cells = cleaned_cells
    endpoint_cell, endpoint_ground_removed = EDGE.remove_ground_contact_matte(endpoint_cell)
    endpoint_cell[endpoint_cell[..., 3] == 0, :3] = 0

    sheet_path = SOURCE_DIR / "running.png"
    Image.fromarray(BASE.compose(cells), "RGBA").save(
        sheet_path, optimize=True, compress_level=9
    )
    preview_spec = BASE.ActionSpec(
        "running", VIDEO_NAME, SOURCE_INDICES, SOURCE_FRAME_RATE, -1,
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
        "action": "running",
        "status": "user_authorized_completion_postprocessed_pre_rife",
        "assetOnly": True,
        "runtimeIntegration": True,
        "source": f"videos/{VIDEO_NAME}",
        "sourceSha256": digest(ROOT / "videos" / VIDEO_NAME),
        "sourceFrameRate": decoded_frame_rate,
        "cycleStart": SOURCE_INDICES[0],
        "duplicateEndpoint": DUPLICATE_ENDPOINT,
        "sourceIndices": list(SOURCE_INDICES),
        "sourceFrameStep": 2,
        "selectionPolicy": (
            "raw [15,51) is the highest-ranked stable complete two-step cycle; "
            "f51 is the same-phase seam reference and is excluded"
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
        "horizontalMode": "center-body",
        "verticalMode": "body-feet",
        "sheet": str(sheet_path.relative_to(ROOT)).replace("\\", "/"),
        "preview": str((PREVIEW_DIR / "running.gif").relative_to(ROOT)).replace("\\", "/"),
        "contactSheet": str((PREVIEW_DIR / "running-contact.png").relative_to(ROOT)).replace("\\", "/"),
        "cleanup": cleanup,
        "groundContactMattePixelsRemovedBySourceSheetFrame": ground_removed,
        "duplicateEndpointGroundContactMattePixelsRemoved": endpoint_ground_removed,
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
