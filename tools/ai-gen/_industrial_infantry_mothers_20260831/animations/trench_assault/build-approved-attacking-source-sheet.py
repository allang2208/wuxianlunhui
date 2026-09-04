#!/usr/bin/env python3
"""Build the approved attack v04 one-shot source sheet before RIFE."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from hashlib import sha256
from pathlib import Path

import cv2
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
    "trench_assault_attack_base",
)
EDGE = load_module(
    ROOT.parent / "steel_shield_assault" / "build-formal-source-sheets.py",
    "trench_assault_attack_edge_cleanup",
)

VIDEO_NAME = "attacking-doubao-v04-reference-only.mp4"
SOURCE_INDICES = (0, 8, 16, 28, 38, 42, 44, 48, 56, 64, 72, 80, 88, 96, 104, 112, 120)
RELEASE_RAW_FRAME = 42
EFFECT_RAW_FRAMES = {42, 44, 48}
EFFECT_BASELINE_RAW_FRAME = 38
SOURCE_FRAME_RATE = 11.0
FINAL_FRAME_RATE = 22.0
FIXED_SCALE = 0.20673076923076922
OUT = ROOT / "postprocess"
SOURCE_DIR = OUT / "source-sheets-pre-rife"
PREVIEW_DIR = OUT / "previews" / "source"
FRAME_DIR = OUT / "selected-cutouts" / "attacking"
EFFECT_DIR = FRAME_DIR / "effect-masks"
REPORT_PATH = OUT / "approved-attacking-source-report.json"


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def compact_attack_effect(
    actor: np.ndarray, baseline_actor: np.ndarray, source_rgb: np.ndarray,
) -> tuple[np.ndarray, np.ndarray, int]:
    """Retain a readable flash/smoke puff without the generated screen-wide plume."""
    _, body_y0, _, body_y1 = BASE.opened_body_bbox(baseline_actor)
    body_h = body_y1 - body_y0 + 1
    height, width = source_rgb.shape[:2]
    yy, xx = np.indices((height, width))
    source = source_rgb.astype(np.float32)
    source_luma = source.mean(axis=2)
    gun_band = (
        (source_luma < 100.0)
        & (xx >= round(width * 0.60))
        & (yy >= round(height * 0.15))
        & (yy <= round(height * 0.50))
    )
    _, gun_xs = np.where(gun_band)
    if not len(gun_xs):
        raise RuntimeError("Cannot locate the current dark muzzle endpoint")
    muzzle_x = int(gun_xs.max())
    actor_clean = actor.copy()
    actor_clean[:, muzzle_x + 1:] = 0

    border = np.concatenate((
        source_rgb[:16].reshape(-1, 3), source_rgb[-16:].reshape(-1, 3),
        source_rgb[:, :16].reshape(-1, 3), source_rgb[:, -16:].reshape(-1, 3),
    ))
    background = np.median(border, axis=0).astype(np.float32)
    distance = np.linalg.norm(source - background, axis=2)
    roi = (
        (xx >= muzzle_x)
        & (xx <= muzzle_x + round(body_h * 0.38))
        & (yy >= body_y0 - round(body_h * 0.08))
        & (yy <= body_y0 + round(body_h * 0.58))
    )
    effect = roi & (actor_clean[..., 3] < 32) & (source_luma >= 105.0) & (distance > 6.0)
    effect = cv2.morphologyEx(
        effect.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8)
    ).astype(bool)
    work = source_rgb.astype(np.int16)
    warm = (
        (work[..., 0] > 170)
        & (work[..., 0] - work[..., 2] > 15)
        & (work[..., 1] - work[..., 2] > 4)
    )
    base_alpha = np.clip((distance - 4.0) * 7.0, 0, 230)
    effect_alpha = np.where(warm, np.maximum(base_alpha, 180), base_alpha)
    effect_alpha = np.where(effect, effect_alpha, 0).astype(np.uint8)
    visible = effect_alpha > 0
    alpha_float = np.maximum(effect_alpha.astype(np.float32) / 255.0, 1e-3)
    foreground = (
        source - (1.0 - alpha_float[..., None]) * background[None, None, :]
    ) / alpha_float[..., None]
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    output = actor_clean.copy()
    output[..., :3][visible] = foreground[visible]
    output[..., 3][visible] = np.maximum(output[..., 3][visible], effect_alpha[visible])
    output[output[..., 3] == 0, :3] = 0
    return output, effect_alpha, int(visible.sum())


def main() -> None:
    frames, decoded_frame_rate = BASE.BASE.decode_video(ROOT / "videos" / VIDEO_NAME)
    if max(SOURCE_INDICES) >= len(frames):
        raise RuntimeError(f"Attack source has {len(frames)} frames; need {max(SOURCE_INDICES)}")

    SOURCE_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    FRAME_DIR.mkdir(parents=True, exist_ok=True)
    EFFECT_DIR.mkdir(parents=True, exist_ok=True)
    model = BASE.BASE.get_model()
    cutouts: dict[int, np.ndarray] = {}
    cleanup: dict[str, dict[str, int]] = {}

    processing_order = [EFFECT_BASELINE_RAW_FRAME] + [
        index for index in SOURCE_INDICES if index != EFFECT_BASELINE_RAW_FRAME
    ]
    for source_index in processing_order:
        rgba = BASE.BASE.cutout_rgba(frames[source_index], model)
        rgba, alpha_trimmed = EDGE.trim_source_matte(frames[source_index], rgba)
        rgba, edge_recolored = EDGE.replace_semtransparent_matte_rgb(frames[source_index], rgba)
        rgba, detached_removed = BASE.strip_small_cutout_components(rgba)
        effect_pixels = 0
        if source_index in EFFECT_RAW_FRAMES:
            rgba, effect_mask, effect_pixels = compact_attack_effect(
                rgba, cutouts[EFFECT_BASELINE_RAW_FRAME], frames[source_index],
            )
            Image.fromarray(effect_mask, "L").save(
                EFFECT_DIR / f"source-f{source_index:03d}.png"
            )
        rgba[rgba[..., 3] == 0, :3] = 0
        cutouts[source_index] = rgba
        cleanup[str(source_index)] = {
            "matteAlphaPixelsTrimmed": alpha_trimmed,
            "matteEdgePixelsRecolored": edge_recolored,
            "detachedPixelsRemoved": detached_removed,
            "compactAttackEffectPixels": effect_pixels,
        }
        Image.fromarray(rgba, "RGBA").save(
            FRAME_DIR / f"source-f{source_index:03d}.png", optimize=True, compress_level=9
        )
        print(
            f"[trench-assault-attacking] BiRefNet f{source_index} effect={effect_pixels}",
            flush=True,
        )

    selected = [cutouts[index] for index in SOURCE_INDICES]
    frame_width, reference_anchor = BASE.choose_width(
        selected, FIXED_SCALE, "preserve-source"
    )
    cells = [
        BASE.place_cell(
            rgba, FIXED_SCALE, frame_width, "preserve-source", "body-feet", reference_anchor
        )
        for rgba in selected
    ]
    ground_removed: list[int] = []
    cleaned_cells = []
    for cell in cells:
        cleaned, removed = EDGE.remove_ground_contact_matte(cell)
        cleaned[cleaned[..., 3] == 0, :3] = 0
        cleaned_cells.append(cleaned)
        ground_removed.append(removed)
    cells = cleaned_cells

    sheet_path = SOURCE_DIR / "attacking.png"
    Image.fromarray(BASE.compose(cells), "RGBA").save(
        sheet_path, optimize=True, compress_level=9
    )
    preview_spec = BASE.ActionSpec(
        "attacking", VIDEO_NAME, SOURCE_INDICES, SOURCE_FRAME_RATE, 0,
        "preserve-source", "body-feet"
    )
    BASE.save_previews(preview_spec, cells, PREVIEW_DIR)

    validation = BASE.BASE.validate_cells(cells, 0)
    validation.update(BASE.body_metrics(cells))
    validation["nonzeroRgbInTransparentPixels"] = max(
        int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
    )
    final_frame_count = len(cells) * 2 - 1
    release_source_index = SOURCE_INDICES.index(RELEASE_RAW_FRAME)
    release_output_index = release_source_index * 2
    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "trench_assault",
        "action": "attacking",
        "status": "user_authorized_completion_postprocessed_pre_rife",
        "assetOnly": True,
        "runtimeIntegration": True,
        "source": f"videos/{VIDEO_NAME}",
        "sourceSha256": digest(ROOT / "videos" / VIDEO_NAME),
        "sourceFrameRate": decoded_frame_rate,
        "sourceIndices": list(SOURCE_INDICES),
        "selectionPolicy": (
            "nonuniform phase keys retain raise, single f42 release, recoil/smoke, one full "
            "pump cycle and return while compressing the 5s source to a 1.5s formal action"
        ),
        "sourceFrameCount": len(cells),
        "sourceEndFrame": len(cells) - 1,
        "finalFrameCount": final_frame_count,
        "finalEndFrame": final_frame_count - 1,
        "frameWidth": frame_width,
        "frameHeight": BASE.FRAME_HEIGHT,
        "cols": BASE.COLS,
        "rows": math.ceil(len(cells) / BASE.COLS),
        "sourceSheetFrameRate": SOURCE_FRAME_RATE,
        "finalFrameRate": FINAL_FRAME_RATE,
        "formalDurationSeconds": final_frame_count / FINAL_FRAME_RATE,
        "repeat": 0,
        "fixedScale": FIXED_SCALE,
        "feetY": BASE.FEET_Y,
        "targetEffectiveBodyHeight": BASE.TARGET_BODY_HEIGHT,
        "horizontalMode": "preserve-source-fixed-anchor",
        "verticalMode": "body-feet",
        "releaseRawSourceFrame": RELEASE_RAW_FRAME,
        "releaseSourceSheetIndex": release_source_index,
        "releaseRifeOutputIndex": release_output_index,
        "releaseDelayMs": release_output_index / FINAL_FRAME_RATE * 1000,
        "pumpPhaseRawFrames": {"start": 56, "rear": 72, "forward": 88, "locked": 96},
        "effectPolicy": "retain compact flash and nearby smoke; discard screen-wide generated plume",
        "sheet": str(sheet_path.relative_to(ROOT)).replace("\\", "/"),
        "preview": str((PREVIEW_DIR / "attacking.gif").relative_to(ROOT)).replace("\\", "/"),
        "contactSheet": str((PREVIEW_DIR / "attacking-contact.png").relative_to(ROOT)).replace("\\", "/"),
        "cleanup": cleanup,
        "groundContactMattePixelsRemovedBySourceSheetFrame": ground_removed,
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
