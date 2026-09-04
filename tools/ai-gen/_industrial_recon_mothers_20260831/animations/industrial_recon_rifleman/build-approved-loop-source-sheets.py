#!/usr/bin/env python3
"""Build approved idle/running transparent source sheets before RIFE."""

from __future__ import annotations

import importlib.util
import json
import math
import statistics
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
BASE_BUILDER = REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" / "build-sniper-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("industrial_recon_sheet_base", BASE_BUILDER)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BASE_BUILDER}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)

OUT = ROOT / "postprocess"
SOURCE_DIR = OUT / "source-sheets-pre-rife"
PREVIEW_DIR = OUT / "previews" / "source"
REPORT_PATH = OUT / "approved-loop-source-report.json"


@dataclass(frozen=True)
class LoopSpec:
    action: str
    video: str
    start: int
    endpoint: int
    step: int
    frame_rate: float

    @property
    def indices(self) -> tuple[int, ...]:
        return tuple(range(self.start, self.endpoint, self.step))


SPECS = (
    LoopSpec("idle", "idle-doubao-v01.mp4", 70, 109, 2, 12.0),
    LoopSpec("running", "running-doubao-v01.mp4", 46, 63, 1, 24.0),
)


def alpha_iou(left: np.ndarray, right: np.ndarray, top: int = 0) -> float:
    lm = left[top:, :, 3] > 16
    rm = right[top:, :, 3] > 16
    union = np.logical_or(lm, rm).sum()
    return float(np.logical_and(lm, rm).sum() / union) if union else 1.0


def main() -> None:
    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    decoded = {
        spec.action: BASE.BASE.decode_video(ROOT / "videos" / spec.video)
        for spec in SPECS
    }
    model = BASE.BASE.get_model()
    cutouts: dict[tuple[str, int], np.ndarray] = {}
    for spec in SPECS:
        source_frames = decoded[spec.action][0]
        for source_index in sorted(set([*spec.indices, spec.endpoint])):
            cutouts[(spec.action, source_index)] = BASE.BASE.cutout_rgba(source_frames[source_index], model)
            print(f"[industrial-recon-source] {spec.action} BiRefNet f{source_index}", flush=True)

    idle_body_heights = []
    for source_index in SPECS[0].indices:
        _, y0, _, y1 = BASE.opened_body_bbox(cutouts[("idle", source_index)])
        idle_body_heights.append(y1 - y0 + 1)
    reference_body_height = float(statistics.median(idle_body_heights))
    fixed_scale = BASE.TARGET_BODY_HEIGHT / reference_body_height

    report: dict[str, object] = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "industrial_recon_rifleman",
        "assetOnly": True,
        "runtimeIntegration": False,
        "bodyScaleReference": "hamster ranger/sniper route standard",
        "frameHeight": BASE.FRAME_HEIGHT,
        "feetY": BASE.FEET_Y,
        "targetEffectiveBodyHeight": BASE.TARGET_BODY_HEIGHT,
        "referenceIdleBodyHeightMedian": reference_body_height,
        "fixedScaleAcrossApprovedActions": fixed_scale,
        "actions": {},
    }

    for spec in SPECS:
        rgba_frames = [cutouts[(spec.action, index)] for index in spec.indices]
        endpoint_rgba = cutouts[(spec.action, spec.endpoint)]
        frame_width, reference_anchor = BASE.choose_width(rgba_frames + [endpoint_rgba], fixed_scale, "center-body")
        cells = [
            BASE.place_cell(rgba, fixed_scale, frame_width, "center-body", "body-feet", reference_anchor)
            for rgba in rgba_frames
        ]
        endpoint_cell = BASE.place_cell(
            endpoint_rgba, fixed_scale, frame_width, "center-body", "body-feet", reference_anchor
        )
        sheet_path = SOURCE_DIR / f"{spec.action}.png"
        Image.fromarray(BASE.compose(cells), "RGBA").save(sheet_path, optimize=True, compress_level=9)
        preview_spec = BASE.ActionSpec(
            spec.action,
            spec.video,
            spec.indices,
            spec.frame_rate,
            -1,
            "center-body",
            "body-feet",
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
        report["actions"][spec.action] = {
            "status": "user_approved_source_postprocessed_pre_rife",
            "source": f"videos/{spec.video}",
            "sourceFrameRate": decoded[spec.action][1],
            "cycleStart": spec.start,
            "duplicateEndpoint": spec.endpoint,
            "includedSourceFrames": list(spec.indices),
            "sourceFrameStep": spec.step,
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": frame_width,
            "frameHeight": BASE.FRAME_HEIGHT,
            "cols": BASE.COLS,
            "rows": math.ceil(len(cells) / BASE.COLS),
            "frameRate": spec.frame_rate,
            "repeat": -1,
            "horizontalMode": "center-body",
            "verticalMode": "body-feet",
            "sheet": str(sheet_path.relative_to(ROOT)).replace("\\", "/"),
            "preview": str((PREVIEW_DIR / f"{spec.action}.gif").relative_to(ROOT)).replace("\\", "/"),
            "contactSheet": str((PREVIEW_DIR / f"{spec.action}-contact.png").relative_to(ROOT)).replace("\\", "/"),
            "validation": validation,
        }

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
