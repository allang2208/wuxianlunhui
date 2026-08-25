#!/usr/bin/env python3
"""Build transparent hamster-halberdier sprite sheets from accepted Doubao videos.

The 512px frame height and 351px body foot line match the current hamster-militia
sheet contract. Scale is derived from the armored hamster body after a large
morphological opening removes the long halberd and helmet plume; weapon reach is
handled only by adaptive frame width.
"""

from __future__ import annotations

import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
BASE_SCRIPT = REPO / "tools" / "ai-gen" / "jungle-wizard-video-rebuild.py"
SPEC = importlib.util.spec_from_file_location("halberdier_sprite_base", BASE_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {BASE_SCRIPT}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)

FRAME_HEIGHT = 512
FEET_Y = 351
TARGET_BODY_HEIGHT = 129
BODY_OPEN_KERNEL_SOURCE = 21
BODY_OPEN_KERNEL_OUTPUT = 11
COLS = 8
MARGIN = 16


@dataclass(frozen=True)
class ActionSpec:
    name: str
    indices: tuple[int, ...]
    frame_rate: float
    repeat: int
    horizontal_mode: str
    vertical_mode: str


def opened_body_bbox(
    rgba: np.ndarray, kernel_size: int = BODY_OPEN_KERNEL_SOURCE
) -> tuple[int, int, int, int]:
    """Return the largest thick body component, excluding polearm and plume."""
    mask = (rgba[..., 3] > 32).astype(np.uint8)
    kernel = cv2.getStructuringElement(
        cv2.MORPH_ELLIPSE, (kernel_size, kernel_size)
    )
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    if count <= 1:
        raise RuntimeError("Body morphology removed every component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.where(labels == largest)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def body_anchor_x(rgba: np.ndarray) -> float:
    x0, y0, x1, y1 = opened_body_bbox(rgba)
    alpha = rgba[..., 3]
    top = y0 + round((y1 - y0 + 1) * 0.20)
    bottom = y0 + round((y1 - y0 + 1) * 0.72)
    ys, xs = np.where(alpha[top:bottom + 1, x0:x1 + 1] > 32)
    return float(np.median(xs + x0)) if len(xs) else (x0 + x1) / 2.0


def round_width(width: float) -> int:
    return max(512, int(math.ceil(width / 128.0) * 128))


def choose_width(
    rgba_frames: list[np.ndarray], scale: float, horizontal_mode: str
) -> tuple[int, float | None]:
    if horizontal_mode == "center-body":
        half_span = 0.0
        for rgba in rgba_frames:
            x0, _, x1, _ = BASE.alpha_bbox(rgba)
            anchor = body_anchor_x(rgba)
            half_span = max(half_span, (anchor - x0) * scale, (x1 - anchor + 1) * scale)
        return round_width(half_span * 2 + MARGIN * 2), None

    reference_anchor = body_anchor_x(rgba_frames[0])
    left = min((BASE.alpha_bbox(rgba)[0] - reference_anchor) * scale for rgba in rgba_frames)
    right = max((BASE.alpha_bbox(rgba)[2] + 1 - reference_anchor) * scale for rgba in rgba_frames)
    half_span = max(abs(left), abs(right))
    return round_width(half_span * 2 + MARGIN * 2), reference_anchor


def place_cell(
    rgba: np.ndarray,
    scale: float,
    frame_width: int,
    horizontal_mode: str,
    vertical_mode: str,
    reference_anchor: float | None,
) -> np.ndarray:
    x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
    _, _, _, body_y1 = opened_body_bbox(rgba)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)
    ).copy()
    resized[resized[..., 3] == 0, :3] = 0

    if horizontal_mode == "center-body":
        anchor = body_anchor_x(rgba)
        offset_x = round(frame_width / 2 - (anchor - x0) * scale)
    else:
        if reference_anchor is None:
            raise RuntimeError("Global motion placement requires a reference anchor")
        offset_x = round(frame_width / 2 + (x0 - reference_anchor) * scale)

    if vertical_mode == "body-feet":
        offset_y = round(FEET_Y - (body_y1 - y0) * scale)
    elif vertical_mode == "content-ground":
        offset_y = round(FEET_Y - (y1 - y0) * scale)
    else:
        raise ValueError(f"Unknown vertical mode: {vertical_mode}")

    if (
        offset_x < MARGIN
        or offset_y < MARGIN
        or offset_x + width > frame_width - MARGIN
        or offset_y + height > FRAME_HEIGHT - MARGIN
    ):
        raise RuntimeError(
            f"Placement clips safety margin: {width}x{height} at {offset_x},{offset_y} "
            f"inside {frame_width}x{FRAME_HEIGHT}"
        )
    cell = np.zeros((FRAME_HEIGHT, frame_width, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return cell


def compose(cells: list[np.ndarray]) -> np.ndarray:
    frame_width = cells[0].shape[1]
    rows = math.ceil(len(cells) / COLS)
    sheet = np.zeros((rows * FRAME_HEIGHT, COLS * frame_width, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[
            row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT,
            col * frame_width:(col + 1) * frame_width,
        ] = cell
    return sheet


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    rgb = cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def save_previews(
    spec: ActionSpec, cells: list[np.ndarray], preview_dir: Path
) -> None:
    frame_width = cells[0].shape[1]
    gif_width = 512
    gif_height = round(FRAME_HEIGHT * gif_width / frame_width)
    frames = [
        checker(cell).resize((gif_width, gif_height), Image.Resampling.LANCZOS)
        for cell in cells
    ]
    frame_ms = max(20, round(1000 / spec.frame_rate))
    durations = [frame_ms] * len(frames)
    if spec.repeat == 0:
        durations[0] = max(durations[0], 250)
        durations[-1] = max(durations[-1], 650)
    playback = frames if spec.repeat == 0 else frames * 3
    playback_durations = durations if spec.repeat == 0 else durations * 3
    playback[0].save(
        preview_dir / f"{spec.name}.gif",
        save_all=True,
        append_images=playback[1:],
        duration=playback_durations,
        loop=0,
        disposal=2,
        optimize=False,
    )

    thumb_w = 320
    thumb_h = round(FRAME_HEIGHT * thumb_w / frame_width)
    label_h = 24
    rows = math.ceil(len(cells) / 4)
    contact = Image.new("RGB", (4 * thumb_w, rows * (thumb_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, (cell, source_index) in enumerate(zip(cells, spec.indices)):
        preview = checker(cell).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = (position % 4) * thumb_w
        y = (position // 4) * (thumb_h + label_h)
        contact.paste(preview, (x, y))
        draw.text((x + 5, y + thumb_h + 4), f"sheet {position} / source f{source_index}", fill="white")
    contact.save(preview_dir / f"{spec.name}-contact.png")


def body_metrics(cells: list[np.ndarray]) -> dict[str, object]:
    heights = []
    bottoms = []
    for cell in cells:
        _, y0, _, y1 = opened_body_bbox(cell, BODY_OPEN_KERNEL_OUTPUT)
        heights.append(y1 - y0 + 1)
        bottoms.append(y1)
    return {
        "effectiveBodyHeightMin": min(heights),
        "effectiveBodyHeightMedian": float(np.median(heights)),
        "effectiveBodyHeightMax": max(heights),
        "effectiveBodyBottomMin": min(bottoms),
        "effectiveBodyBottomMax": max(bottoms),
    }


def main() -> None:
    videos: dict[str, tuple[list[np.ndarray], float]] = {}
    for name in ("idle", "running", "attacking", "dying"):
        videos[name] = BASE.decode_video(ROOT / "videos" / f"{name}-doubao.mp4")

    idle_frames = videos["idle"][0]
    attack_frames = videos["attacking"][0]
    death_frames = videos["dying"][0]
    specs = (
        ActionSpec(
            "idle",
            BASE.visual_resample_indices(idle_frames, 7, 97, 24),
            8.0,
            -1,
            "center-body",
            "body-feet",
        ),
        ActionSpec(
            "running",
            tuple(range(46, 76, 2)),
            12.0,
            -1,
            "center-body",
            "body-feet",
        ),
        ActionSpec(
            "attacking",
            BASE.visual_resample_indices(attack_frames, 8, 113, 20),
            12.0,
            0,
            "preserve-source",
            "body-feet",
        ),
        ActionSpec(
            "dying",
            BASE.visual_resample_indices(death_frames, 8, 61, 16),
            12.0,
            0,
            "preserve-source",
            "content-ground",
        ),
    )

    runtime_dir = REPO / "assets" / "companions" / "hamster_halberdier"
    preview_dir = ROOT / "previews" / "sheets"
    runtime_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    model = BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    for spec in specs:
        source_frames = videos[spec.name][0]
        for source_index in spec.indices:
            key = (spec.name, source_index)
            if key not in cache:
                cache[key] = BASE.cutout_rgba(source_frames[source_index], model)
                print(f"[halberdier-sheet] {spec.name} BiRefNet f{source_index}", flush=True)

    idle_reference = cache[("idle", specs[0].indices[0])]
    _, body_y0, _, body_y1 = opened_body_bbox(idle_reference)
    reference_body_height = body_y1 - body_y0 + 1
    fixed_scale = TARGET_BODY_HEIGHT / reference_body_height

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "bodyScaleReference": "current hamster-militia effective standing body",
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "bodyOpenKernelAtSource": BODY_OPEN_KERNEL_SOURCE,
        "bodyMeasurementKernelAt512": BODY_OPEN_KERNEL_OUTPUT,
        "referenceSourceBodyHeight": reference_body_height,
        "fixedScaleAcrossAllActions": fixed_scale,
        "actions": {},
    }

    action_cells: dict[str, list[np.ndarray]] = {}
    for spec in specs:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        frame_width, reference_anchor = choose_width(
            rgba_frames, fixed_scale, spec.horizontal_mode
        )
        if frame_width > 1024:
            raise RuntimeError(f"{spec.name} needs unsupported frame width {frame_width}")
        cells = [
            place_cell(
                rgba,
                fixed_scale,
                frame_width,
                spec.horizontal_mode,
                spec.vertical_mode,
                reference_anchor,
            )
            for rgba in rgba_frames
        ]
        action_cells[spec.name] = cells
        output = runtime_dir / f"{spec.name}.png"
        Image.fromarray(compose(cells), "RGBA").save(output, optimize=True, compress_level=9)
        save_previews(spec, cells, preview_dir)
        validation = BASE.validate_cells(cells, spec.repeat)
        validation.update(body_metrics(cells))
        transparent_rgb = [
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        ]
        validation["nonzeroRgbInTransparentPixels"] = max(transparent_rgb)
        report["actions"][spec.name] = {
            "source": f"videos/{spec.name}-doubao.mp4",
            "sourceFrameRate": videos[spec.name][1],
            "sourceIndices": list(spec.indices),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": frame_width,
            "frameHeight": FRAME_HEIGHT,
            "cols": COLS,
            "rows": math.ceil(len(cells) / COLS),
            "previewFrameRate": spec.frame_rate,
            "repeat": spec.repeat,
            "horizontalMode": spec.horizontal_mode,
            "verticalMode": spec.vertical_mode,
            "validation": validation,
        }

    militia_sheet = Image.open(
        REPO / "assets" / "companions" / "hamster_militia" / "idle.png"
    ).convert("RGBA")
    militia_cell = np.asarray(militia_sheet.crop((0, 0, 512, 512)))
    new_cell = action_cells["idle"][0]
    compare = Image.new("RGB", (1024, 548), "#20242a")
    compare.paste(checker(militia_cell), (0, 0))
    compare.paste(checker(new_cell), (512, 0))
    draw = ImageDraw.Draw(compare)
    draw.text((12, 520), "current hamster militia / 512 cell", fill="white")
    draw.text((524, 520), "hamster halberdier / 512 cell", fill="white")
    compare.save(preview_dir / "body-scale-comparison.png")

    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
