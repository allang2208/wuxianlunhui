#!/usr/bin/env python3
"""Build normalized hamster-crossbow source sheets and its runtime bolt asset."""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
HELPER_PATH = REPO / "tools" / "ai-gen" / "_hamster_halberd_20260825" / "build-halberdier-sheets.py"
SPEC = importlib.util.spec_from_file_location("crossbow_sheet_helpers", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)
BASE = HELPER.BASE

SOURCES = {
    "idle": "idle-doubao-v02-loop.mp4",
    "running": "moving-doubao-v01-loop.mp4",
    "attacking": "attacking-doubao-v01.mp4",
    "dying": "dying-doubao-v01.mp4",
}

MATTE_ALPHA_CUTOFF = 24
MATTE_RELIABLE_ALPHA = 224


def uniform_indices(frame_count: int, sample_count: int) -> tuple[int, ...]:
    return tuple(np.rint(np.linspace(0, frame_count - 1, sample_count)).astype(int).tolist())


def clean_white_matte_edges(rgba: np.ndarray) -> np.ndarray:
    """Remove low-alpha white-matte debris without changing the authored pose.

    BiRefNet's soft silhouette is useful for fur and bow strings, but reversing a
    generated white backdrop makes unstable low-alpha RGB explode into white or
    coloured blocks.  Trim only the sub-visible tail, then borrow RGB from the
    nearest reliable subject pixel while retaining the remaining antialias alpha.
    """
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


def build_projectile(path: Path) -> None:
    """Draw one right-facing heavy quarrel in the standard 512px transparent cell."""
    scale = 4
    canvas = Image.new("RGBA", (512 * scale, 512 * scale), (0, 0, 0, 0))
    draw = ImageDraw.Draw(canvas)
    cy = 256 * scale
    shaft_left = 74 * scale
    shaft_right = 397 * scale
    shaft_half = 7 * scale
    # Dark outline and warm hardwood shaft.
    draw.rounded_rectangle(
        (shaft_left - 3 * scale, cy - shaft_half - 3 * scale,
         shaft_right + 4 * scale, cy + shaft_half + 3 * scale),
        radius=7 * scale, fill=(30, 22, 17, 255),
    )
    draw.rounded_rectangle(
        (shaft_left, cy - shaft_half, shaft_right, cy + shaft_half),
        radius=5 * scale, fill=(112, 66, 32, 255),
    )
    draw.line((shaft_left + 10 * scale, cy - 2 * scale,
               shaft_right - 8 * scale, cy - 2 * scale),
              fill=(181, 119, 57, 210), width=2 * scale)
    # Short, heavy steel bodkin point.
    draw.polygon([
        (389 * scale, cy - 19 * scale),
        (472 * scale, cy),
        (389 * scale, cy + 19 * scale),
        (405 * scale, cy),
    ], fill=(38, 43, 45, 255))
    draw.polygon([
        (397 * scale, cy - 12 * scale),
        (461 * scale, cy),
        (397 * scale, cy),
    ], fill=(175, 184, 181, 255))
    draw.line((397 * scale, cy, 462 * scale, cy), fill=(15, 18, 19, 255), width=2 * scale)
    # Binding and compact leather fletching for a crossbow bolt.
    draw.rectangle((81 * scale, cy - 11 * scale, 99 * scale, cy + 11 * scale),
                   fill=(70, 45, 27, 255))
    draw.polygon([
        (78 * scale, cy - 6 * scale),
        (126 * scale, cy - 30 * scale),
        (148 * scale, cy - 27 * scale),
        (119 * scale, cy - 4 * scale),
    ], fill=(94, 46, 34, 255))
    draw.polygon([
        (78 * scale, cy + 6 * scale),
        (126 * scale, cy + 30 * scale),
        (148 * scale, cy + 27 * scale),
        (119 * scale, cy + 4 * scale),
    ], fill=(68, 31, 26, 255))
    canvas.resize((512, 512), Image.Resampling.LANCZOS).save(
        path, optimize=True, compress_level=9
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--actions",
        nargs="+",
        choices=tuple(SOURCES),
        default=list(SOURCES),
        help="Only rebuild the named actions; the existing report keeps all others.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    selected = tuple(dict.fromkeys(args.actions))
    videos = {
        action: BASE.decode_video(ROOT / "videos" / filename)
        for action, filename in SOURCES.items()
        if action in selected
    }
    durations = {
        action: len(frames) / fps for action, (frames, fps) in videos.items()
    }
    all_specs = {
        "idle": lambda: HELPER.ActionSpec(
            "idle", uniform_indices(len(videos["idle"][0]), 15),
            15 / durations["idle"], -1, "center-body", "body-feet",
        ),
        "running": lambda: HELPER.ActionSpec(
            "running", uniform_indices(len(videos["running"][0]), 18),
            18 / durations["running"], -1, "center-body", "body-feet",
        ),
        "attacking": lambda: HELPER.ActionSpec(
            "attacking", tuple(range(0, len(videos["attacking"][0]), 4)),
            6.0, 0, "preserve-source", "body-feet",
        ),
        "dying": lambda: HELPER.ActionSpec(
            "dying", tuple(range(0, len(videos["dying"][0]), 4)),
            6.0, 0, "preserve-source", "content-ground",
        ),
    }
    specs = tuple(all_specs[action]() for action in selected)

    model = BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    for spec in specs:
        for source_index in spec.indices:
            cache[(spec.name, source_index)] = clean_white_matte_edges(
                BASE.cutout_rgba(videos[spec.name][0][source_index], model)
            )
            print(f"[crossbow-sheet] {spec.name} BiRefNet f{source_index}", flush=True)

    # The accepted clips use two camera distances. Normalize each clip's first
    # standing key to the same effective body height before composing cells;
    # the long crossbow is removed by opened_body_bbox and never shrinks the unit.
    source_body_heights: dict[str, int] = {}
    scale_by_action: dict[str, float] = {}
    for spec in specs:
        reference = cache[(spec.name, spec.indices[0])]
        _, body_y0, _, body_y1 = HELPER.opened_body_bbox(reference)
        source_body_heights[spec.name] = body_y1 - body_y0 + 1
        scale_by_action[spec.name] = (
            HELPER.TARGET_BODY_HEIGHT / source_body_heights[spec.name]
        )

    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "sheets"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    report_path = ROOT / "source-sheet-report.json"
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
    else:
        report = {
            "assetOnly": False,
            "runtimeIntegration": True,
            "bodyScaleReference": "hamster militia/halberd effective standing body",
            "frameHeight": HELPER.FRAME_HEIGHT,
            "feetY": HELPER.FEET_Y,
            "targetEffectiveBodyHeight": HELPER.TARGET_BODY_HEIGHT,
            "sourceBodyHeightByAction": {},
            "cameraNormalizationScaleByAction": {},
            "unifiedFinalEffectiveBodyHeight": HELPER.TARGET_BODY_HEIGHT,
            "actions": {},
        }
    report["sourceBodyHeightByAction"].update(source_body_heights)
    report["cameraNormalizationScaleByAction"].update(scale_by_action)
    report["matteCleanup"] = {
        "actions": list(selected),
        "alphaCutoff": MATTE_ALPHA_CUTOFF,
        "nearestReliableAlpha": MATTE_RELIABLE_ALPHA,
        "edgeRgb": "nearest reliable subject pixel",
    }

    for spec in specs:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        action_scale = scale_by_action[spec.name]
        frame_width, reference_anchor = HELPER.choose_width(
            rgba_frames, action_scale, spec.horizontal_mode
        )
        cells = [
            clean_white_matte_edges(
                HELPER.place_cell(
                    rgba, action_scale, frame_width, spec.horizontal_mode,
                    spec.vertical_mode, reference_anchor,
                )
            )
            for rgba in rgba_frames
        ]
        Image.fromarray(HELPER.compose(cells), "RGBA").save(
            source_dir / f"{spec.name}.png", optimize=True, compress_level=9
        )
        HELPER.save_previews(spec, cells, preview_dir)
        validation = BASE.validate_cells(cells, spec.repeat)
        validation.update(HELPER.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        report["actions"][spec.name] = {
            "source": f"videos/{SOURCES[spec.name]}",
            "sourceFrameRate": videos[spec.name][1],
            "sourceIndices": list(spec.indices),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": frame_width,
            "frameHeight": HELPER.FRAME_HEIGHT,
            "cols": HELPER.COLS,
            "rows": math.ceil(len(cells) / HELPER.COLS),
            "sourceSheetFrameRate": spec.frame_rate,
            "expectedRifeFrameCount": len(cells) * 2 if spec.repeat == -1 else len(cells) * 2 - 1,
            "expectedRifeFrameRate": spec.frame_rate * 2,
            "repeat": spec.repeat,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "validation": validation,
        }

    if set(selected) == set(SOURCES):
        build_projectile(ROOT / "projectile.png")
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
