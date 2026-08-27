#!/usr/bin/env python3
"""Build approved heavy-machine-gunner videos into transparent source sheets."""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
BASE_PATH = REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" / "build-sniper-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("heavy_machine_gunner_sprite_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot import sprite helper: {BASE_PATH}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)

FRAME_WIDTH = 512
FRAME_HEIGHT = 512
FEET_Y = 351
TARGET_BODY_HEIGHT = 129
COLS = 8
MATTE_ALPHA_CUTOFF = 24
MATTE_RELIABLE_ALPHA = 224

VIDEO_NAMES = {
    "idle": "idle-doubao-v01.mp4",
    "running": "running-doubao-v01.mp4",
    "attacking": "attacking-doubao-v01.mp4",
    "dying": "dying-doubao-v01.mp4",
}

SPECS = (
    BASE.ActionSpec(
        "idle", VIDEO_NAMES["idle"], tuple(range(31, 83, 4)),
        6.0, -1, "center-body", "body-feet",
    ),
    BASE.ActionSpec(
        "running", VIDEO_NAMES["running"], tuple(range(40, 62, 2)),
        12.0, -1, "center-body", "body-feet",
    ),
    BASE.ActionSpec(
        "attacking", VIDEO_NAMES["attacking"], tuple(range(0, 121, 4)),
        12.0, 0, "preserve-source", "body-feet",
    ),
    BASE.ActionSpec(
        "dying", VIDEO_NAMES["dying"],
        tuple(range(0, 61, 4)) + (72, 120),
        10.0, 0, "preserve-source", "content-ground",
    ),
)


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


def strip_small_components(rgba: np.ndarray, min_source_area: int = 1000) -> tuple[np.ndarray, int]:
    output = rgba.copy()
    foreground = (output[..., 3] > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        return output, 0
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = labels == largest
    for label in range(1, count):
        if label == largest:
            continue
        if stats[label, cv2.CC_STAT_AREA] >= min_source_area:
            keep |= labels == label
    remove = (output[..., 3] > 0) & ~keep
    output[remove] = 0
    return output, int(np.count_nonzero(remove))


def remove_running_tail(rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Preserve the approved video's natural tail and rear-leg silhouette."""
    return rgba.copy(), 0


def remove_attack_smoke(rgba: np.ndarray, reference_bbox: tuple[int, int, int, int]) -> tuple[np.ndarray, int]:
    """Remove low-chroma smoke ahead of the muzzle while preserving warm muzzle flashes."""
    output = rgba.copy()
    _, _, x1, _ = reference_bbox
    yy, xx = np.indices(output.shape[:2])
    rgb = output[..., :3].astype(np.int16)
    channel_span = rgb.max(axis=2) - rgb.min(axis=2)
    brightness = rgb.mean(axis=2)
    remove = (
        (output[..., 3] > 0)
        & (xx > x1 - 16)
        & (channel_span < 34)
        & (brightness > 74)
        & (brightness < 244)
    )
    output[remove] = 0
    output[output[..., 3] == 0, :3] = 0
    return output, int(np.count_nonzero(remove))


def compose(cells: list[np.ndarray]) -> np.ndarray:
    rows = math.ceil(len(cells) / COLS)
    sheet = np.zeros((rows * FRAME_HEIGHT, COLS * FRAME_WIDTH, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT,
              col * FRAME_WIDTH:(col + 1) * FRAME_WIDTH] = cell
    return sheet


def save_compare(cell: np.ndarray, output: Path) -> None:
    reference_sheet = Image.open(REPO / "assets" / "companions" / "hamster_crossbow" / "idle.png").convert("RGBA")
    reference = np.asarray(reference_sheet.crop((0, 0, 512, 512)))
    compare = Image.new("RGB", (1024, 548), "#20242a")
    compare.paste(BASE.checker(reference), (0, 0))
    compare.paste(BASE.checker(cell), (512, 0))
    draw = ImageDraw.Draw(compare)
    draw.text((12, 520), "hamster crossbow / approved infantry body reference", fill="white")
    draw.text((524, 520), "heavy machine gunner / matched effective body height", fill="white")
    compare.save(output)


def main() -> None:
    videos = {
        name: BASE.BASE.decode_video(ROOT / "videos" / filename)
        for name, filename in VIDEO_NAMES.items()
    }
    output_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    frame_dir = ROOT / "frames" / "birefnet-source"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    frame_dir.mkdir(parents=True, exist_ok=True)

    model = BASE.BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    removed_pixels: dict[str, dict[int, dict[str, int]]] = {name: {} for name in VIDEO_NAMES}
    attack_reference_bbox: tuple[int, int, int, int] | None = None

    for spec in SPECS:
        source_frames = videos[spec.name][0]
        action_dir = frame_dir / spec.name
        action_dir.mkdir(parents=True, exist_ok=True)
        for source_index in spec.indices:
            rgba = BASE.BASE.cutout_rgba(source_frames[source_index], model)
            rgba = clean_white_matte_edges(rgba)
            rgba, removed_components = strip_small_components(rgba)
            removed_tail = 0
            removed_smoke = 0
            if spec.name == "running":
                rgba, removed_tail = remove_running_tail(rgba)
            if spec.name == "attacking":
                if attack_reference_bbox is None:
                    attack_reference_bbox = BASE.BASE.alpha_bbox(rgba)
                rgba, removed_smoke = remove_attack_smoke(rgba, attack_reference_bbox)
            rgba = clean_white_matte_edges(rgba)
            cache[(spec.name, source_index)] = rgba
            removed_pixels[spec.name][source_index] = {
                "components": removed_components,
                "tail": removed_tail,
                "attackSmoke": removed_smoke,
            }
            Image.fromarray(rgba, "RGBA").save(action_dir / f"source-{source_index:03d}.png")
            print(f"[heavy-machine-gunner-sheet] {spec.name} BiRefNet f{source_index}", flush=True)

    idle_body_heights = []
    for source_index in SPECS[0].indices:
        _, y0, _, y1 = BASE.opened_body_bbox(cache[("idle", source_index)])
        idle_body_heights.append(y1 - y0 + 1)
    reference_body_height = float(np.median(idle_body_heights))
    fixed_scale = TARGET_BODY_HEIGHT / reference_body_height

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "bodyScaleReference": "approved hamster crossbow infantry body",
        "referenceSourceBodyHeightMedian": reference_body_height,
        "fixedScaleAcrossAllActions": fixed_scale,
        "cleanup": {
            "model": "BiRefNet-general",
            "matteAlphaCutoff": MATTE_ALPHA_CUTOFF,
            "nearestReliableAlpha": MATTE_RELIABLE_ALPHA,
            "runningTail": "approved natural tail and rear-leg silhouette preserved",
            "attackSmoke": "low-chroma pixels only ahead of muzzle; warm muzzle flash retained",
            "removedAlphaPixelsBySourceFrame": removed_pixels,
        },
        "actions": {},
    }

    action_cells: dict[str, list[np.ndarray]] = {}
    for spec in SPECS:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        reference_anchor = None if spec.horizontal_mode == "center-body" else BASE.body_anchor_x(rgba_frames[0])
        cells = [clean_white_matte_edges(BASE.place_cell(
            rgba, fixed_scale, FRAME_WIDTH, spec.horizontal_mode, spec.vertical_mode, reference_anchor
        )) for rgba in rgba_frames]
        action_cells[spec.name] = cells
        Image.fromarray(compose(cells), "RGBA").save(
            output_dir / f"{spec.name}.png", optimize=True, compress_level=9
        )
        BASE.save_previews(spec, cells, preview_dir)
        validation = BASE.BASE.validate_cells(cells, spec.repeat)
        validation.update(BASE.body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        report["actions"][spec.name] = {
            "source": f"videos/{spec.video_name}",
            "sourceFrameRate": videos[spec.name][1],
            "sourceIndices": list(spec.indices),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": FRAME_WIDTH,
            "frameHeight": FRAME_HEIGHT,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "sourceSheetFrameRate": spec.frame_rate,
            "expectedRifeFrameCount": len(cells) * 2 if spec.repeat == -1 else len(cells) * 2 - 1,
            "expectedRifeFrameRate": spec.frame_rate * 2,
            "repeat": spec.repeat,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "validation": validation,
        }

    save_compare(action_cells["idle"][0], preview_dir / "body-scale-comparison.png")
    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
