#!/usr/bin/env python3
"""Build transparent source sheets from the four accepted bomb-zombie clips.

The character is normalized to the current miner-zombie visual contract:
512px cells, a 276px effective standing body, and a y=381 foot line.  Each
action gets one camera-normalization scale from its neutral first frame; that
scale is then fixed for the whole action so pose changes keep their natural
trajectory.

The attack video owns only the character animation.  Source frame 84 is the
release beat, so detached bomb components are removed from that frame onward;
the future runtime projectile will start there instead of being duplicated in
the actor sheet.
"""

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
HELPER_PATH = (
    REPO
    / "tools"
    / "ai-gen"
    / "_hamster_halberd_20260825"
    / "build-halberdier-sheets.py"
)
SPEC = importlib.util.spec_from_file_location("bomb_zombie_sheet_helpers", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)
BASE = HELPER.BASE


# Match assets/enemies/miner_zombie/idle.png rather than guessing from render size.
HELPER.FRAME_HEIGHT = 512
HELPER.FEET_Y = 381
HELPER.TARGET_BODY_HEIGHT = 276
HELPER.COLS = 8
HELPER.MARGIN = 16

SOURCES = {
    "idle": "idle-doubao-v01.mp4",
    "walking": "walking-doubao-v01.mp4",
    "attacking": "attacking-doubao-v01.mp4",
    "dying": "dying-doubao-v01.mp4",
}

SPECS = (
    HELPER.ActionSpec("idle", tuple(range(0, 120, 4)), 6.0, -1, "center-body", "body-feet"),
    HELPER.ActionSpec("walking", tuple(range(0, 44, 4)), 6.0, -1, "center-body", "body-feet"),
    HELPER.ActionSpec("attacking", tuple(range(0, 121, 4)), 6.0, 0, "preserve-source", "body-feet"),
    HELPER.ActionSpec("dying", tuple(range(0, 65, 4)), 6.0, 0, "preserve-source", "content-ground"),
)

ATTACK_RELEASE_SOURCE_FRAME = 84
ALPHA_CUTOFF = 24
RELIABLE_ALPHA = 224


def clean_edge_rgb(rgba: np.ndarray) -> np.ndarray:
    """Remove soft matte debris and give semitransparent edges subject RGB."""
    cleaned = rgba.copy()
    alpha = cleaned[..., 3]
    alpha[alpha <= ALPHA_CUTOFF] = 0
    visible = alpha > 0
    reliable = alpha >= RELIABLE_ALPHA
    edge = visible & ~reliable
    if reliable.any() and edge.any():
        _, nearest = ndimage.distance_transform_edt(~reliable, return_indices=True)
        cleaned[..., :3][edge] = cleaned[nearest[0][edge], nearest[1][edge], :3]
    cleaned[..., 3] = alpha
    cleaned[~visible, :3] = 0
    return cleaned


def filter_components(rgba: np.ndarray, keep_nearby_props: bool) -> np.ndarray:
    """Keep the actor; optionally retain nearby fuse/bomb pieces before release."""
    alpha = rgba[..., 3]
    foreground = (alpha > ALPHA_CUTOFF).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        raise RuntimeError("BiRefNet produced no visible actor component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = labels == largest

    if keep_nearby_props:
        lx = int(stats[largest, cv2.CC_STAT_LEFT])
        ly = int(stats[largest, cv2.CC_STAT_TOP])
        lw = int(stats[largest, cv2.CC_STAT_WIDTH])
        lh = int(stats[largest, cv2.CC_STAT_HEIGHT])
        expanded = (lx - 96, ly - 96, lx + lw + 96, ly + lh + 32)
        actor_bottom = ly + lh - 1
        for label in range(1, count):
            if label == largest or int(stats[label, cv2.CC_STAT_AREA]) < 10:
                continue
            x = int(stats[label, cv2.CC_STAT_LEFT])
            y = int(stats[label, cv2.CC_STAT_TOP])
            w = int(stats[label, cv2.CC_STAT_WIDTH])
            h = int(stats[label, cv2.CC_STAT_HEIGHT])
            center_y = y + (h - 1) / 2
            intersects = (
                x < expanded[2]
                and x + w > expanded[0]
                and y < expanded[3]
                and y + h > expanded[1]
            )
            if intersects and center_y <= actor_bottom + 16:
                keep |= labels == label

    keep = cv2.dilate(keep.astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    out = rgba.copy()
    out[~keep, 3] = 0
    out[out[..., 3] == 0, :3] = 0
    return clean_edge_rgb(out)


def cutout_action_frame(
    action: str, source_index: int, rgb: np.ndarray, model
) -> np.ndarray:
    rgba = BASE.cutout_rgba(rgb, model)
    keep_nearby_props = action == "attacking" and source_index < ATTACK_RELEASE_SOURCE_FRAME
    return filter_components(rgba, keep_nearby_props)


def main() -> None:
    videos = {
        action: BASE.decode_video(ROOT / "videos" / filename)
        for action, filename in SOURCES.items()
    }
    for action, (frames, fps) in videos.items():
        if len(frames) != 121 or abs(fps - 24.0) > 0.01:
            raise RuntimeError(
                f"Unexpected {action} source contract: {len(frames)} frames at {fps}"
            )

    model = BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    for spec in SPECS:
        source_frames = videos[spec.name][0]
        for source_index in spec.indices:
            cache[(spec.name, source_index)] = cutout_action_frame(
                spec.name, source_index, source_frames[source_index], model
            )
            print(
                f"[bomb-zombie-sheet] {spec.name} BiRefNet f{source_index}",
                flush=True,
            )

    source_body_heights: dict[str, int] = {}
    scale_by_action: dict[str, float] = {}
    for spec in SPECS:
        reference = cache[(spec.name, spec.indices[0])]
        _, body_y0, _, body_y1 = HELPER.opened_body_bbox(reference)
        source_body_heights[spec.name] = body_y1 - body_y0 + 1
        scale_by_action[spec.name] = (
            HELPER.TARGET_BODY_HEIGHT / source_body_heights[spec.name]
        )

    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    frame_dir = ROOT / "frames" / "birefnet-source"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    frame_dir.mkdir(parents=True, exist_ok=True)

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegrationActive": False,
        "pipeline": "accepted Doubao source -> BiRefNet-general -> component filtering -> fixed per-action camera scale",
        "bodyScaleReference": "assets/enemies/miner_zombie/idle.png effective standing body",
        "frameHeight": HELPER.FRAME_HEIGHT,
        "feetY": HELPER.FEET_Y,
        "targetEffectiveBodyHeight": HELPER.TARGET_BODY_HEIGHT,
        "sourceBodyHeightByAction": source_body_heights,
        "cameraNormalizationScaleByAction": scale_by_action,
        "attackProjectileOwnership": {
            "owner": "future runtime projectile",
            "releaseSourceFrame": ATTACK_RELEASE_SOURCE_FRAME,
            "detachedBombRemovedFromSourceFrameInclusive": ATTACK_RELEASE_SOURCE_FRAME,
            "landingFuseMs": 2000,
        },
        "actions": {},
    }

    for spec in SPECS:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        action_scale = scale_by_action[spec.name]
        frame_width, reference_anchor = HELPER.choose_width(
            rgba_frames, action_scale, spec.horizontal_mode
        )
        if frame_width > 1024:
            raise RuntimeError(f"{spec.name} needs unsupported frame width {frame_width}")
        cells = [
            HELPER.place_cell(
                rgba,
                action_scale,
                frame_width,
                spec.horizontal_mode,
                spec.vertical_mode,
                reference_anchor,
            )
            for rgba in rgba_frames
        ]
        for source_index, rgba in zip(spec.indices, rgba_frames):
            Image.fromarray(rgba, "RGBA").save(
                frame_dir / f"{spec.name}-f{source_index:03d}.png",
                optimize=True,
                compress_level=9,
            )

        sheet_path = source_dir / f"{spec.name}.png"
        Image.fromarray(HELPER.compose(cells), "RGBA").save(
            sheet_path, optimize=True, compress_level=9
        )
        HELPER.save_previews(spec, cells, preview_dir)
        validation = BASE.validate_cells(cells, spec.repeat)
        validation.update(HELPER.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0]))
            for cell in cells
        )
        report["actions"][spec.name] = {
            "source": f"videos/{SOURCES[spec.name]}",
            "sourceIndices": list(spec.indices),
            "frameCount": len(cells),
            "frameWidth": frame_width,
            "frameHeight": HELPER.FRAME_HEIGHT,
            "cols": HELPER.COLS,
            "rows": math.ceil(len(cells) / HELPER.COLS),
            "sourceSheetFrameRate": spec.frame_rate,
            "expectedRifeFrameCount": (
                len(cells) * 2 if spec.repeat == -1 else len(cells) * 2 - 1
            ),
            "expectedRifeFrameRate": spec.frame_rate * 2,
            "repeat": spec.repeat,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "validation": validation,
        }

    report["actions"]["idle"]["naturalCycle"] = {
        "sourceFrameRange": [0, 116],
        "closureSourceFrame": 120,
        "durationSeconds": 5.0,
        "trajectoryEdited": False,
    }
    report["actions"]["walking"]["naturalCycle"] = {
        "sourceFrameRange": [0, 40],
        "closureSourceFrame": 44,
        "durationSeconds": 44 / 24,
        "trajectoryEdited": False,
    }
    release_source_sheet_frame = SPECS[2].indices.index(ATTACK_RELEASE_SOURCE_FRAME)
    report["actions"]["attacking"]["releaseMapping"] = {
        "sourceVideoFrame": ATTACK_RELEASE_SOURCE_FRAME,
        "sourceSheetFrameZeroBased": release_source_sheet_frame,
        "rifeOutputFrameZeroBased": release_source_sheet_frame * 2,
        "futureConfigReleaseFrameOneBased": release_source_sheet_frame * 2 + 1,
    }
    report["actions"]["dying"]["stableCorpseSourceFrame"] = 64

    report_path = ROOT / "source-sheet-report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
