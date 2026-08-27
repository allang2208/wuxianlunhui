#!/usr/bin/env python3
"""Build approved hamster-assault Doubao videos into transparent source sheets."""

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
SPEC = importlib.util.spec_from_file_location("hamster_assault_sprite_base", BASE_PATH)
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
        "idle", VIDEO_NAMES["idle"],
        (0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110),
        8.0, -1, "center-body", "body-feet",
    ),
    BASE.ActionSpec(
        "running", VIDEO_NAMES["running"],
        tuple(range(28, 48, 2)),
        12.0, -1, "center-body", "body-feet",
    ),
    BASE.ActionSpec(
        "attacking", VIDEO_NAMES["attacking"],
        (0, 8, 16, 24, 32, 40, 48, 56, 64, 70, 72, 74, 76, 78, 80, 84, 88, 96, 104, 112, 120),
        12.0, 0, "preserve-source", "body-feet",
    ),
    BASE.ActionSpec(
        "dying", VIDEO_NAMES["dying"],
        (0, 4, 8, 12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 64, 84, 120),
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
    removed = int(np.count_nonzero(remove))
    output[remove] = 0
    return output, removed


def remove_running_tail(rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Delete only the warm narrow Seedance tail in the fixed rear-lower ROI."""
    output = rgba.copy()
    rgb = output[..., :3].astype(np.int16)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    warm_fur = (
        (r > 72) & (r < 242)
        & (r - g > 5) & (g - b > 7) & (r - b > 20)
    )
    yy, xx = np.indices(output.shape[:2])
    # Full-resolution review frames place the invented tail left of the holster
    # and rear thigh. Keep the mask entirely left of x=332 so the backpack,
    # holster, trousers, knee and boots remain outside the editable region.
    roi = (xx >= 260) & (xx <= 332) & (yy >= 430) & (yy <= 560)
    mask = ((output[..., 3] > 0) & warm_fur & roi).astype(np.uint8)
    mask = cv2.dilate(mask, np.ones((3, 3), np.uint8), iterations=1).astype(bool)
    removed = int(np.count_nonzero(mask))
    output[mask] = 0
    output[output[..., 3] == 0, :3] = 0
    return output, removed


def remove_attack_artifacts(
    rgba: np.ndarray,
    reference_bbox: tuple[int, int, int, int],
) -> tuple[np.ndarray, int]:
    """Remove detached debris and low-chroma smoke only ahead of the rifle muzzle."""
    x0, y0, x1, y1 = reference_bbox
    output = rgba.copy()
    yy, xx = np.indices(output.shape[:2])
    alpha = output[..., 3]
    rgb = output[..., :3].astype(np.int16)
    channel_span = rgb.max(axis=2) - rgb.min(axis=2)
    brightness = rgb.mean(axis=2)
    forward = xx > x1 - 16
    gray_smoke = forward & (channel_span < 34) & (brightness > 74) & (brightness < 244)

    safe = (
        (xx >= max(0, x0 - 80))
        & (xx <= min(output.shape[1] - 1, x1 + 105))
        & (yy >= max(0, y0 - 70))
        & (yy <= min(output.shape[0] - 1, y1 + 90))
    )
    remove = (alpha > 0) & (~safe | gray_smoke)
    output[remove] = 0

    foreground = (output[..., 3] > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count > 1:
        largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
        keep = labels == largest
        detached = (output[..., 3] > 0) & ~keep
        remove |= detached
        output[detached] = 0
    output[output[..., 3] == 0, :3] = 0
    return output, int(np.count_nonzero(remove))


def place(
    rgba: np.ndarray,
    scale: float,
    horizontal_mode: str,
    vertical_mode: str,
    reference_anchor: float | None,
) -> np.ndarray:
    return BASE.place_cell(
        rgba,
        scale,
        FRAME_WIDTH,
        horizontal_mode,
        vertical_mode,
        reference_anchor,
    )


def compose(cells: list[np.ndarray]) -> np.ndarray:
    rows = math.ceil(len(cells) / COLS)
    sheet = np.zeros((rows * FRAME_HEIGHT, COLS * FRAME_WIDTH, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[
            row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT,
            col * FRAME_WIDTH:(col + 1) * FRAME_WIDTH,
        ] = cell
    return sheet


def save_compare(cell: np.ndarray, output: Path) -> None:
    reference_sheet = Image.open(
        REPO / "assets" / "companions" / "hamster_crossbow" / "idle.png"
    ).convert("RGBA")
    reference = np.asarray(reference_sheet.crop((0, 0, 512, 512)))
    compare = Image.new("RGB", (1024, 548), "#20242a")
    compare.paste(BASE.checker(reference), (0, 0))
    compare.paste(BASE.checker(cell), (512, 0))
    draw = ImageDraw.Draw(compare)
    draw.text((12, 520), "hamster crossbow / approved compact body reference", fill="white")
    draw.text((524, 520), "hamster assault / matched effective body height", fill="white")
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
            removed_attack = 0
            if spec.name == "running":
                rgba, removed_tail = remove_running_tail(rgba)
            if spec.name == "attacking":
                if attack_reference_bbox is None:
                    attack_reference_bbox = BASE.BASE.alpha_bbox(rgba)
                rgba, removed_attack = remove_attack_artifacts(rgba, attack_reference_bbox)
            rgba = clean_white_matte_edges(rgba)
            cache[(spec.name, source_index)] = rgba
            removed_pixels[spec.name][source_index] = {
                "components": removed_components,
                "tail": removed_tail,
                "attackForward": removed_attack,
            }
            Image.fromarray(rgba, "RGBA").save(action_dir / f"source-{source_index:03d}.png")
            print(f"[hamster-assault-sheet] {spec.name} BiRefNet f{source_index}", flush=True)

    idle_reference = cache[("idle", SPECS[0].indices[0])]
    _, body_y0, _, body_y1 = BASE.opened_body_bbox(idle_reference)
    reference_body_height = body_y1 - body_y0 + 1
    fixed_scale = TARGET_BODY_HEIGHT / reference_body_height
    running_body_heights = []
    for source_index in SPECS[1].indices:
        _, run_y0, _, run_y1 = BASE.opened_body_bbox(cache[("running", source_index)])
        running_body_heights.append(run_y1 - run_y0 + 1)
    running_reference_body_height = float(np.median(running_body_heights))
    running_fixed_scale = TARGET_BODY_HEIGHT / running_reference_body_height

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "bodyScaleReference": "approved hamster crossbow compact body",
        "referenceSourceBodyHeight": reference_body_height,
        "fixedScaleForOneShotActions": fixed_scale,
        "runningReferenceBodyHeightMedian": running_reference_body_height,
        "runningFixedScale": running_fixed_scale,
        "loopScaleMode": "idle uses low-drift per-frame body normalization; running uses one median-body fixed scale to preserve authored stride and prevent size pumping",
        "cleanup": {
            "model": "BiRefNet-general",
            "matteAlphaCutoff": MATTE_ALPHA_CUTOFF,
            "nearestReliableAlpha": MATTE_RELIABLE_ALPHA,
            "runningTail": "warm fur pixels only in fixed rear-lower ROI; body/weapon/camera trajectory unchanged",
            "attackSmoke": "low-chroma smoke only in muzzle-forward ROI; dark rifle and warm muzzle flash protected",
            "removedAlphaPixelsBySourceFrame": removed_pixels,
        },
        "actions": {},
    }

    action_cells: dict[str, list[np.ndarray]] = {}
    for spec in SPECS:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        reference_anchor = None if spec.horizontal_mode == "center-body" else BASE.body_anchor_x(rgba_frames[0])
        cells: list[np.ndarray] = []
        scales: list[float] = []
        for rgba in rgba_frames:
            if spec.name == "idle":
                _, y0, _, y1 = BASE.opened_body_bbox(rgba)
                scale = TARGET_BODY_HEIGHT / max(1, y1 - y0 + 1)
            elif spec.name == "running":
                scale = running_fixed_scale
            else:
                scale = fixed_scale
            scales.append(scale)
            cells.append(clean_white_matte_edges(place(
                rgba, scale, spec.horizontal_mode, spec.vertical_mode, reference_anchor
            )))

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
            "scaleMin": min(scales),
            "scaleMax": max(scales),
            "validation": validation,
        }

    save_compare(action_cells["idle"][0], preview_dir / "body-scale-comparison.png")
    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
