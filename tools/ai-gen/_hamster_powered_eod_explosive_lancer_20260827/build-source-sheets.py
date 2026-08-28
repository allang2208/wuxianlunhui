#!/usr/bin/env python3
"""Build five approved videos into fixed-scale transparent source sheets."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
PAIR_PATH = REPO / "tools" / "ai-gen" / "_hamster_cavalry_pair_20260827" / "build-source-sheets.py"
PAIR_SPEC = importlib.util.spec_from_file_location("powered_lancer_cavalry_helper", PAIR_PATH)
if PAIR_SPEC is None or PAIR_SPEC.loader is None:
    raise RuntimeError(f"cannot import cavalry helper: {PAIR_PATH}")
PAIR = importlib.util.module_from_spec(PAIR_SPEC)
sys.modules[PAIR_SPEC.name] = PAIR
PAIR_SPEC.loader.exec_module(PAIR)

FRAME_HEIGHT = 512
FEET_Y = 375
TARGET_MOUNTED_BODY_HEIGHT = 236
COLS = 8
MATTE_ALPHA_CUTOFF = 20
MATTE_RELIABLE_ALPHA = 224

VIDEO_NAMES = {
    "idle": "idle-h3-v02.mp4",
    "running": "running-h3-v01.mp4",
    "charge_attacking": "charge-attacking-doubao-v01.mp4",
    "lance_attacking": "lance-attacking-doubao-v01.mp4",
    "dying": "dying-doubao-v01.mp4",
}


def clean_white_matte_edges(rgba: np.ndarray) -> np.ndarray:
    cleaned = rgba.copy()
    alpha = cleaned[..., 3]
    alpha[alpha <= MATTE_ALPHA_CUTOFF] = 0
    visible = alpha > 0
    reliable = alpha >= MATTE_RELIABLE_ALPHA
    edge = visible & ~reliable
    if reliable.any() and edge.any():
        _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
        cleaned[..., :3][edge] = cleaned[nearest[0][edge], nearest[1][edge], :3]
    cleaned[..., 3] = alpha
    cleaned[~visible, :3] = 0
    return cleaned


def restore_charge_tail_flame(rgb: np.ndarray, rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Retain approved blue-cyan booster flame without recovering gray floor smoke."""
    output = rgba.copy()
    source = rgb.astype(np.int16)
    red, green, blue = source[..., 0], source[..., 1], source[..., 2]
    yy, xx = np.indices(red.shape)
    blue_flame = (
        (xx < round(rgb.shape[1] * 0.78))
        & (yy > round(rgb.shape[0] * 0.20))
        & (yy < round(rgb.shape[0] * 0.88))
        & (blue > 105)
        & ((blue - red) > 16)
        & ((green - red) > 2)
    )
    flame_alpha = np.where(
        blue_flame,
        np.clip((blue - red) * 4 + np.maximum(green - red, 0) * 2, 0, 230),
        0,
    ).astype(np.uint8)
    recovered = flame_alpha > output[..., 3]
    output[..., :3][recovered] = rgb[recovered]
    output[..., 3] = np.maximum(output[..., 3], flame_alpha)
    return output, int(np.count_nonzero(recovered))


def action_specs(videos: dict[str, tuple[list[np.ndarray], float]]) -> tuple[object, ...]:
    base = PAIR.HELPER.BASE
    return (
        # f44 and f84 are the same clean idle phase; omit duplicate f84.
        PAIR.Action("idle", tuple(range(44, 84, 4)), 6.0, -1, "center-body", "body-feet"),
        # Native gallop phase repeats after 21 source frames (f62 -> f83).
        PAIR.Action("running", tuple(range(62, 83, 2)), 12.0, -1, "center-body", "body-feet"),
        PAIR.Action(
            "charge_attacking",
            base.visual_resample_indices(videos["charge_attacking"][0], 0, 121, 25),
            12.0,
            0,
            "preserve-source",
            "body-feet",
        ),
        PAIR.Action(
            "lance_attacking",
            base.visual_resample_indices(videos["lance_attacking"][0], 0, 121, 20),
            12.0,
            0,
            "preserve-source",
            "body-feet",
        ),
        PAIR.Action(
            "dying",
            base.visual_resample_indices(videos["dying"][0], 0, 73, 17) + (120,),
            10.0,
            0,
            "preserve-source",
            "content-ground",
        ),
    )


def main() -> None:
    videos = {
        name: PAIR.HELPER.BASE.decode_video(ROOT / "videos" / filename)
        for name, filename in VIDEO_NAMES.items()
    }
    specs = action_specs(videos)
    output_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    frame_dir = ROOT / "frames" / "birefnet-source"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    frame_dir.mkdir(parents=True, exist_ok=True)

    model = PAIR.HELPER.BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    flame_recovery: dict[int, int] = {}
    for action in specs:
        source_frames = videos[action.key][0]
        action_dir = frame_dir / action.key
        action_dir.mkdir(parents=True, exist_ok=True)
        for source_index in action.indices:
            frame_path = action_dir / f"source-{source_index:03d}.png"
            if frame_path.exists():
                rgba = np.asarray(Image.open(frame_path).convert("RGBA")).copy()
            else:
                rgba = PAIR.HELPER.BASE.cutout_rgba(source_frames[source_index], model)
                if action.key == "charge_attacking":
                    rgba, recovered = restore_charge_tail_flame(source_frames[source_index], rgba)
                    flame_recovery[source_index] = recovered
                rgba = clean_white_matte_edges(rgba)
                Image.fromarray(rgba, "RGBA").save(frame_path)
            cache[(action.key, source_index)] = rgba
            print(f"[powered-lancer-sheet] {action.key} BiRefNet f{source_index}", flush=True)

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "targetMountedBodyHeight": TARGET_MOUNTED_BODY_HEIGHT,
        "scalePolicy": "each differently framed source action uses one fixed scale derived from its neutral mounted-body height; no per-frame scaling; lance and booster flame do not participate in body measurement",
        "motionPolicy": "idle/running remove source camera translation through mounted-body anchoring; attacks and death preserve source-space trajectory; death is grounded without per-frame enlargement",
        "cleanup": {
            "model": "BiRefNet-general",
            "matteAlphaCutoff": MATTE_ALPHA_CUTOFF,
            "nearestReliableAlpha": MATTE_RELIABLE_ALPHA,
            "approvedChargeTailFlame": "blue-cyan booster flame retained; low-chroma floor smoke is not recovered",
            "chargeTailFlameRecoveredPixelsBySourceFrame": flame_recovery,
        },
        "actions": {},
    }

    for action in specs:
        rgba_frames = [cache[(action.key, index)] for index in action.indices]
        measurement_frames = rgba_frames if action.key in {"idle", "running"} else rgba_frames[:3]
        body_heights = []
        for rgba in measurement_frames:
            _, y0, _, y1 = PAIR.opened_mounted_body_bbox(rgba)
            body_heights.append(y1 - y0 + 1)
        source_body_height = float(np.median(body_heights))
        fixed_scale = TARGET_MOUNTED_BODY_HEIGHT / source_body_height
        frame_width, reference_anchor = PAIR.choose_width(
            rgba_frames, fixed_scale, action.horizontal_mode
        )
        if frame_width > 2048:
            raise RuntimeError(f"{action.key} requires unsupported frame width {frame_width}")
        cells = [
            clean_white_matte_edges(
                PAIR.place_cell(
                    rgba,
                    fixed_scale,
                    frame_width,
                    action.horizontal_mode,
                    action.vertical_mode,
                    reference_anchor,
                )
            )
            for rgba in rgba_frames
        ]
        Image.fromarray(PAIR.compose(cells), "RGBA").save(
            output_dir / f"{action.key}.png", optimize=True, compress_level=9
        )
        PAIR.save_previews("powered_eod_explosive_lancer", action, cells, preview_dir)
        validation = PAIR.HELPER.BASE.validate_cells(cells, action.repeat)
        validation.update(PAIR.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        report["actions"][action.key] = {
            "source": f"videos/{VIDEO_NAMES[action.key]}",
            "sourceFrameRate": videos[action.key][1],
            "sourceIndices": list(action.indices),
            "sourceNeutralBodyHeightMedian": source_body_height,
            "fixedScaleForAction": fixed_scale,
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": frame_width,
            "frameHeight": FRAME_HEIGHT,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "sourceSheetFrameRate": action.frame_rate,
            "expectedRifeFrameCount": len(cells) * 2 if action.repeat == -1 else len(cells) * 2 - 1,
            "expectedRifeFrameRate": action.frame_rate * 2,
            "repeat": action.repeat,
            "horizontalMode": action.horizontal_mode,
            "verticalMode": action.vertical_mode,
            "validation": validation,
        }

    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
