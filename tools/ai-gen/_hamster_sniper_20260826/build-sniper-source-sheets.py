#!/usr/bin/env python3
"""Build transparent hamster-sniper source sheets from accepted Doubao videos."""

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
SPEC = importlib.util.spec_from_file_location("sniper_sprite_base", BASE_SCRIPT)
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
    video_name: str
    indices: tuple[int, ...]
    frame_rate: float
    repeat: int
    horizontal_mode: str
    vertical_mode: str


def opened_body_bbox(
    rgba: np.ndarray, kernel_size: int = BODY_OPEN_KERNEL_SOURCE
) -> tuple[int, int, int, int]:
    """Find the thick hamster body while excluding rifle barrel and ghillie strands."""
    mask = (rgba[..., 3] > 32).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
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
    top = y0 + round((y1 - y0 + 1) * 0.18)
    bottom = y0 + round((y1 - y0 + 1) * 0.72)
    ys, xs = np.where(alpha[top:bottom + 1, x0:x1 + 1] > 32)
    return float(np.median(xs + x0)) if len(xs) else (x0 + x1) / 2.0


def strip_small_cutout_components(
    rgba: np.ndarray, min_source_area: int = 1000
) -> tuple[np.ndarray, int]:
    """Remove small detached Doubao watermark glyphs while retaining body and rifle."""
    foreground = (rgba[..., 3] > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(foreground, 8)
    if count <= 1:
        return rgba, 0
    keep = np.zeros(foreground.shape, np.uint8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    for label in range(1, count):
        area = int(stats[label, cv2.CC_STAT_AREA])
        if label == largest or area >= min_source_area:
            keep[labels == label] = 1
    keep = cv2.dilate(keep, np.ones((3, 3), np.uint8)) > 0
    cleaned = rgba.copy()
    removed = int(np.count_nonzero((rgba[..., 3] > 0) & ~keep))
    cleaned[~keep] = 0
    return cleaned, removed


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
            raise RuntimeError("Source-motion placement requires a reference anchor")
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


def save_previews(spec: ActionSpec, cells: list[np.ndarray], preview_dir: Path) -> None:
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
    frames_out = preview_dir / f"{spec.name}.gif"
    playback[0].save(
        frames_out,
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
    video_names = {
        "idle": "idle-doubao.mp4",
        "running": "running-doubao-v02.mp4",
        "attacking": "attacking-doubao.mp4",
        "dying": "dying-doubao.mp4",
    }
    videos = {
        name: BASE.decode_video(ROOT / "videos" / video_name)
        for name, video_name in video_names.items()
    }
    idle_frames = videos["idle"][0]
    specs = (
        ActionSpec(
            "idle",
            video_names["idle"],
            BASE.visual_resample_indices(idle_frames, 20, 105, 24),
            8.0,
            -1,
            "center-body",
            "body-feet",
        ),
        ActionSpec(
            "running",
            video_names["running"],
            tuple(range(40, 65, 2)),
            12.0,
            -1,
            "center-body",
            "body-feet",
        ),
        ActionSpec(
            "attacking",
            video_names["attacking"],
            (4, 12, 20, 28, 36, 44, 52, 58, 60, 64, 70, 76, 82, 86, 90, 94, 98, 104, 108, 112),
            12.0,
            0,
            "preserve-source",
            "body-feet",
        ),
        ActionSpec(
            "dying",
            video_names["dying"],
            (4, 12, 20, 28, 36, 42, 48, 54, 58, 62, 66, 70, 74, 80, 88, 96, 104, 112, 116, 120),
            12.0,
            0,
            "preserve-source",
            "content-ground",
        ),
    )

    output_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "sheets"
    output_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    model = BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    cleanup_removed: dict[str, dict[int, int]] = {"dying": {}}
    for spec in specs:
        source_frames = videos[spec.name][0]
        for source_index in spec.indices:
            key = (spec.name, source_index)
            if key not in cache:
                rgba = BASE.cutout_rgba(source_frames[source_index], model)
                if spec.name == "dying":
                    rgba, removed = strip_small_cutout_components(rgba)
                    cleanup_removed["dying"][source_index] = removed
                cache[key] = rgba
                print(f"[sniper-sheet] {spec.name} BiRefNet f{source_index}", flush=True)

    idle_reference = cache[("idle", specs[0].indices[0])]
    _, body_y0, _, body_y1 = opened_body_bbox(idle_reference)
    reference_body_height = body_y1 - body_y0 + 1
    fixed_scale = TARGET_BODY_HEIGHT / reference_body_height

    report: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "bodyScaleReference": "hamster-ranger route standard",
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "referenceSourceBodyHeight": reference_body_height,
        "fixedScaleAcrossAllActions": fixed_scale,
        "smallComponentCleanup": {
            "scope": "dying only",
            "purpose": "remove detached Doubao watermark glyphs without editing the accepted motion",
            "minimumSourceComponentArea": 1000,
            "removedAlphaPixelsBySourceFrame": cleanup_removed["dying"],
        },
        "actions": {},
    }

    action_cells: dict[str, list[np.ndarray]] = {}
    for spec in specs:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        frame_width, reference_anchor = choose_width(rgba_frames, fixed_scale, spec.horizontal_mode)
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
        Image.fromarray(compose(cells), "RGBA").save(
            output_dir / f"{spec.name}.png", optimize=True, compress_level=9
        )
        save_previews(spec, cells, preview_dir)
        validation = BASE.validate_cells(cells, spec.repeat)
        validation.update(body_metrics(cells))
        validation["nonzeroRgbInTransparentPixels"] = max(
            int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
        )
        report["actions"][spec.name] = {
            "source": f"videos/{spec.video_name}",
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

    ranger_sheet = Image.open(
        REPO / "assets" / "companions" / "hamster_ranger" / "idle.png"
    ).convert("RGBA")
    ranger_cell = np.asarray(ranger_sheet.crop((0, 0, 512, 512)))
    sniper_cell = action_cells["idle"][0]
    compare = Image.new("RGB", (1024, 548), "#20242a")
    compare.paste(checker(ranger_cell), (0, 0))
    compare.paste(checker(sniper_cell), (512, 0))
    draw = ImageDraw.Draw(compare)
    draw.text((12, 520), "hamster ranger / 512 cell", fill="white")
    draw.text((524, 520), "hamster sniper / 512 cell", fill="white")
    compare.save(preview_dir / "body-scale-comparison.png")

    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
