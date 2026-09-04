#!/usr/bin/env python3
"""Build the user-approved trench-assault death source sheet before RIFE."""

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
    REPO
    / "tools"
    / "ai-gen"
    / "_hamster_sniper_20260826"
    / "build-sniper-source-sheets.py"
)
SPEC = importlib.util.spec_from_file_location("trench_assault_death_base", BASE_BUILDER)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BASE_BUILDER}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)

VIDEO_NAME = "dying-h3-v04-first-last-right.mp4"
SOURCE_INDICES = (
    0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48,
    52, 56, 60, 64, 68, 72, 76, 80, 83, 90, 105, 123,
)
SOURCE_FRAME_RATE = 12.0
FIXED_SCALE = 0.20673076923076922
OUT = ROOT / "postprocess"
SOURCE_DIR = OUT / "source-sheets-pre-rife"
PREVIEW_DIR = OUT / "previews" / "source"
FRAME_DIR = OUT / "selected-cutouts" / "dying"
REPORT_PATH = OUT / "approved-death-source-report.json"


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def main() -> None:
    frames, decoded_frame_rate = BASE.BASE.decode_video(ROOT / "videos" / VIDEO_NAME)
    if len(frames) != 124:
        raise RuntimeError(f"Expected 124 source frames, found {len(frames)}")
    if SOURCE_INDICES[-1] >= len(frames):
        raise RuntimeError("Selected source index exceeds decoded video")

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    model = BASE.BASE.get_model()
    cutouts: list[np.ndarray] = []
    cleanup: dict[str, dict[str, int]] = {}

    for source_index in SOURCE_INDICES:
        rgba = BASE.BASE.cutout_rgba(frames[source_index], model)
        rgba, detached_removed = BASE.strip_small_cutout_components(rgba)
        rgba[rgba[..., 3] == 0, :3] = 0
        cutouts.append(rgba)
        cleanup[str(source_index)] = {"detachedPixelsRemoved": detached_removed}
        Image.fromarray(rgba, "RGBA").save(FRAME_DIR / f"source-f{source_index:03d}.png")
        print(f"[trench-assault-death] BiRefNet f{source_index}", flush=True)

    frame_width, reference_anchor = BASE.choose_width(
        cutouts, FIXED_SCALE, "preserve-source"
    )
    if frame_width > 1024:
        raise RuntimeError(f"Death action needs unsupported frame width {frame_width}")
    cells = [
        BASE.place_cell(
            rgba,
            FIXED_SCALE,
            frame_width,
            "preserve-source",
            "content-ground",
            reference_anchor,
        )
        for rgba in cutouts
    ]

    sheet_path = SOURCE_DIR / "dying.png"
    Image.fromarray(BASE.compose(cells), "RGBA").save(
        sheet_path, optimize=True, compress_level=9
    )
    preview_spec = BASE.ActionSpec(
        "dying",
        VIDEO_NAME,
        SOURCE_INDICES,
        SOURCE_FRAME_RATE,
        0,
        "preserve-source",
        "content-ground",
    )
    BASE.save_previews(preview_spec, cells, PREVIEW_DIR)

    validation = BASE.BASE.validate_cells(cells, 0)
    validation.update(BASE.body_metrics(cells))
    validation["nonzeroRgbInTransparentPixels"] = max(
        int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
    )
    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "trench_assault",
        "action": "dying",
        "status": "user_approved_postprocessed_pre_rife",
        "assetOnly": True,
        "runtimeIntegration": True,
        "approvalEvidence": "用户查看方向修正后的死亡v04后回复：可用，继续。",
        "source": f"videos/{VIDEO_NAME}",
        "sourceSha256": digest(ROOT / "videos" / VIDEO_NAME),
        "sourceFrameRate": decoded_frame_rate,
        "sourceIndices": list(SOURCE_INDICES),
        "selectionPolicy": (
            "dense four-frame sampling through the right-facing buckle and side fall, "
            "then sparse stable-corpse keys; no tail-to-head wrap"
        ),
        "frameCount": len(cells),
        "endFrame": len(cells) - 1,
        "frameWidth": frame_width,
        "frameHeight": BASE.FRAME_HEIGHT,
        "cols": BASE.COLS,
        "rows": math.ceil(len(cells) / BASE.COLS),
        "frameRate": SOURCE_FRAME_RATE,
        "repeat": 0,
        "mode": "one-shot",
        "fixedScale": FIXED_SCALE,
        "feetY": BASE.FEET_Y,
        "targetEffectiveBodyHeight": BASE.TARGET_BODY_HEIGHT,
        "horizontalMode": "preserve-source",
        "verticalMode": "content-ground",
        "sheet": str(sheet_path.relative_to(ROOT)).replace("\\", "/"),
        "preview": str((PREVIEW_DIR / "dying.gif").relative_to(ROOT)).replace("\\", "/"),
        "contactSheet": str(
            (PREVIEW_DIR / "dying-contact.png").relative_to(ROOT)
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
