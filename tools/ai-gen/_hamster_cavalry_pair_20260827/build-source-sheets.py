#!/usr/bin/env python3
"""Build transparent source sheets for the approved cavalry pair videos."""

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
HELPER_PATH = REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" / "build-sniper-source-sheets.py"
HELPER_SPEC = importlib.util.spec_from_file_location("cavalry_pair_sprite_helper", HELPER_PATH)
if HELPER_SPEC is None or HELPER_SPEC.loader is None:
    raise RuntimeError(f"cannot import sprite helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(HELPER_SPEC)
sys.modules[HELPER_SPEC.name] = HELPER
HELPER_SPEC.loader.exec_module(HELPER)

FRAME_HEIGHT = 512
FEET_Y = 375
TARGET_MOUNTED_BODY_HEIGHT = 236
COLS = 8
BODY_OPEN_KERNEL_SOURCE = 21
BODY_OPEN_KERNEL_OUTPUT = 11
MATTE_ALPHA_CUTOFF = 20


@dataclass(frozen=True)
class Action:
    key: str
    indices: tuple[int, ...]
    frame_rate: float
    repeat: int
    horizontal_mode: str
    vertical_mode: str


VIDEO_NAME = {
    "idle": "idle-doubao-v01.mp4",
    "running": "running-doubao-v01.mp4",
    "attacking": "attacking-doubao-v01.mp4",
    "dying": "dying-doubao-v01.mp4",
}


def opened_mounted_body_bbox(
    rgba: np.ndarray, kernel_size: int = BODY_OPEN_KERNEL_SOURCE
) -> tuple[int, int, int, int]:
    """Measure rider and mount while rejecting thin lance, reins, feathers and shadows."""
    mask = (rgba[..., 3] > 40).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    if count <= 1:
        raise RuntimeError("mounted-body morphology removed every component")

    # The rider and cat are the dominant compact mass. Thin lance and wing-rack
    # connections are broken by the opening, so they cannot inflate body scale.
    candidates = sorted(
        range(1, count), key=lambda label: int(stats[label, cv2.CC_STAT_AREA]), reverse=True
    )
    largest = candidates[0]
    keep = labels == largest
    lx = int(stats[largest, cv2.CC_STAT_LEFT])
    ly = int(stats[largest, cv2.CC_STAT_TOP])
    lw = int(stats[largest, cv2.CC_STAT_WIDTH])
    lh = int(stats[largest, cv2.CC_STAT_HEIGHT])
    expanded = (lx - 48, ly - 96, lx + lw + 48, ly + lh + 48)
    for label in candidates[1:]:
        if int(stats[label, cv2.CC_STAT_AREA]) < 180:
            continue
        x = int(stats[label, cv2.CC_STAT_LEFT])
        y = int(stats[label, cv2.CC_STAT_TOP])
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        if x < expanded[2] and x + w > expanded[0] and y < expanded[3] and y + h > expanded[1]:
            keep |= labels == label
    ys, xs = np.where(keep)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def body_anchor_x(rgba: np.ndarray) -> float:
    x0, y0, x1, y1 = opened_mounted_body_bbox(rgba)
    alpha = rgba[..., 3]
    top = y0 + round((y1 - y0 + 1) * 0.30)
    bottom = y0 + round((y1 - y0 + 1) * 0.78)
    ys, xs = np.where(alpha[top:bottom + 1, x0:x1 + 1] > 40)
    return float(np.median(xs + x0)) if len(xs) else (x0 + x1) / 2.0


def clean_alpha(rgba: np.ndarray) -> np.ndarray:
    cleaned = rgba.copy()
    cleaned[..., 3][cleaned[..., 3] <= MATTE_ALPHA_CUTOFF] = 0
    cleaned[cleaned[..., 3] == 0, :3] = 0
    return cleaned


def round_width(width: float) -> int:
    return max(512, int(math.ceil(width / 128.0) * 128))


def choose_width(
    rgba_frames: list[np.ndarray], scale: float, horizontal_mode: str
) -> tuple[int, float | None]:
    if horizontal_mode == "center-body":
        half_span = 0.0
        for rgba in rgba_frames:
            x0, _, x1, _ = HELPER.BASE.alpha_bbox(rgba)
            anchor = body_anchor_x(rgba)
            half_span = max(half_span, (anchor - x0) * scale, (x1 + 1 - anchor) * scale)
        return round_width(half_span * 2 + 40), None

    reference_anchor = body_anchor_x(rgba_frames[0])
    left = min((HELPER.BASE.alpha_bbox(rgba)[0] - reference_anchor) * scale for rgba in rgba_frames)
    right = max((HELPER.BASE.alpha_bbox(rgba)[2] + 1 - reference_anchor) * scale for rgba in rgba_frames)
    return round_width(max(abs(left), abs(right)) * 2 + 40), reference_anchor


def place_cell(
    rgba: np.ndarray,
    scale: float,
    frame_width: int,
    horizontal_mode: str,
    vertical_mode: str,
    reference_anchor: float | None,
) -> np.ndarray:
    x0, y0, x1, y1 = HELPER.BASE.alpha_bbox(rgba)
    _, _, _, body_y1 = opened_mounted_body_bbox(rgba)
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
            raise RuntimeError("preserve-source requires a fixed source anchor")
        offset_x = round(frame_width / 2 + (x0 - reference_anchor) * scale)

    if vertical_mode == "body-feet":
        offset_y = round(FEET_Y - (body_y1 - y0) * scale)
    elif vertical_mode == "content-ground":
        offset_y = round(FEET_Y - (y1 - y0) * scale)
    else:
        raise ValueError(vertical_mode)

    margin = 12
    if offset_x < margin or offset_y < margin or offset_x + width > frame_width - margin or offset_y + height > FRAME_HEIGHT - margin:
        raise RuntimeError(
            f"placement clips margin: {width}x{height} at {offset_x},{offset_y} "
            f"inside {frame_width}x{FRAME_HEIGHT}"
        )
    cell = np.zeros((FRAME_HEIGHT, frame_width, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return clean_alpha(cell)


def compose(cells: list[np.ndarray]) -> np.ndarray:
    width = cells[0].shape[1]
    rows = math.ceil(len(cells) / COLS)
    sheet = np.zeros((rows * FRAME_HEIGHT, COLS * width, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, COLS)
        sheet[row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT, col * width:(col + 1) * width] = cell
    return sheet


def checker(cell: np.ndarray) -> Image.Image:
    return HELPER.checker(cell)


def save_previews(unit: str, action: Action, cells: list[np.ndarray], output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    width = cells[0].shape[1]
    preview_width = 512
    preview_height = round(FRAME_HEIGHT * preview_width / width)
    frames = [checker(cell).resize((preview_width, preview_height), Image.Resampling.LANCZOS) for cell in cells]
    duration = max(20, round(1000 / action.frame_rate))
    durations = [duration] * len(frames)
    if action.repeat == 0:
        durations[0] = max(250, durations[0])
        durations[-1] = max(650, durations[-1])
    playback = frames * 3 if action.repeat == -1 else frames
    playback_durations = durations * 3 if action.repeat == -1 else durations
    playback[0].save(
        output_dir / f"{action.key}.gif", save_all=True, append_images=playback[1:],
        duration=playback_durations, loop=0, disposal=2, optimize=False,
    )

    thumb_w = 256
    thumb_h = round(FRAME_HEIGHT * thumb_w / width)
    label_h = 24
    rows = math.ceil(len(cells) / 4)
    contact = Image.new("RGB", (4 * thumb_w, rows * (thumb_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, (cell, source_index) in enumerate(zip(cells, action.indices)):
        x = position % 4 * thumb_w
        y = position // 4 * (thumb_h + label_h)
        contact.paste(checker(cell).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 4, y + thumb_h + 3), f"key {position} / source f{source_index}", fill="white")
    contact.save(output_dir / f"{action.key}-contact.png")


def action_specs(unit: str, videos: dict[str, tuple[list[np.ndarray], float]]) -> tuple[Action, ...]:
    idle = HELPER.BASE.visual_resample_indices(videos["idle"][0], 0, 121, 24)
    if unit == "cavalry":
        running = tuple(range(54, 85, 2))
        attacking = HELPER.BASE.visual_resample_indices(videos["attacking"][0], 8, 114, 20)
        dying = HELPER.BASE.visual_resample_indices(videos["dying"][0], 10, 95, 19) + (120,)
    else:
        # One complete native gait cycle: f62 and f80 are the same leg phase,
        # so f80 is the omitted duplicate endpoint. Sampling every second
        # 24 fps source frame yields nine natural keys at 12 fps.
        running = tuple(range(62, 80, 2))
        attacking = HELPER.BASE.visual_resample_indices(videos["attacking"][0], 5, 114, 20)
        dying = HELPER.BASE.visual_resample_indices(videos["dying"][0], 8, 97, 19) + (120,)
    return (
        Action("idle", idle, 12.0, -1, "center-body", "body-feet"),
        Action("running", running, 12.0, -1, "center-body", "body-feet"),
        Action("attacking", attacking, 12.0, 0, "preserve-source", "body-feet"),
        Action("dying", dying, 12.0, 0, "preserve-source", "content-ground"),
    )


def body_metrics(cells: list[np.ndarray]) -> dict[str, object]:
    heights: list[int] = []
    bottoms: list[int] = []
    for cell in cells:
        _, y0, _, y1 = opened_mounted_body_bbox(cell, BODY_OPEN_KERNEL_OUTPUT)
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
    source_root = ROOT / "videos"
    output_root = ROOT / "source-sheets-pre-interpolation"
    preview_root = ROOT / "previews" / "source-sheets"
    frame_root = ROOT / "frames" / "birefnet-source"
    model = None
    combined: dict[str, object] = {
        "assetOnly": True,
        "runtimeIntegration": False,
        "bodyScaleReference": "hamster light cavalry mounted-body height",
        "targetMountedBodyHeight": TARGET_MOUNTED_BODY_HEIGHT,
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "scalePolicy": "one shared fixed scale for both units from cavalry running-body median; this keeps the rider/cat core equal while thin lance and wing racks cannot shrink the winged unit",
        "actions": {},
    }

    shared_scale: float | None = None

    for unit in ("cavalry", "winged_hussar"):
        videos = {
            key: HELPER.BASE.decode_video(source_root / unit / filename)
            for key, filename in VIDEO_NAME.items()
        }
        specs = action_specs(unit, videos)
        cache: dict[tuple[str, int], np.ndarray] = {}
        for action in specs:
            action_frames = videos[action.key][0]
            frame_dir = frame_root / unit / action.key
            frame_dir.mkdir(parents=True, exist_ok=True)
            for index in action.indices:
                frame_path = frame_dir / f"source-{index:03d}.png"
                if frame_path.exists():
                    rgba = np.asarray(Image.open(frame_path).convert("RGBA")).copy()
                else:
                    if model is None:
                        model = HELPER.BASE.get_model()
                    rgba = clean_alpha(HELPER.BASE.cutout_rgba(action_frames[index], model))
                    Image.fromarray(rgba, "RGBA").save(frame_path)
                cache[(action.key, index)] = rgba
                print(f"[cavalry-pair] {unit} {action.key} BiRefNet f{index}", flush=True)

        running_heights = []
        for index in specs[1].indices:
            _, y0, _, y1 = opened_mounted_body_bbox(cache[("running", index)])
            running_heights.append(y1 - y0 + 1)
        source_body_height = float(np.median(running_heights))
        if shared_scale is None:
            shared_scale = TARGET_MOUNTED_BODY_HEIGHT / source_body_height
        fixed_scale = shared_scale
        unit_report: dict[str, object] = {
            "runningSourceMountedBodyHeightMedian": source_body_height,
            "fixedScaleAcrossActions": fixed_scale,
            "actions": {},
        }

        for action in specs:
            rgba_frames = [cache[(action.key, index)] for index in action.indices]
            frame_width, reference_anchor = choose_width(rgba_frames, fixed_scale, action.horizontal_mode)
            if frame_width > 1024:
                raise RuntimeError(f"{unit} {action.key} needs unsupported frame width {frame_width}")
            cells = [
                place_cell(
                    rgba, fixed_scale, frame_width, action.horizontal_mode,
                    action.vertical_mode, reference_anchor,
                )
                for rgba in rgba_frames
            ]
            output_dir = output_root / unit
            output_dir.mkdir(parents=True, exist_ok=True)
            Image.fromarray(compose(cells), "RGBA").save(
                output_dir / f"{action.key}.png", optimize=True, compress_level=9
            )
            save_previews(unit, action, cells, preview_root / unit)
            validation = HELPER.BASE.validate_cells(cells, action.repeat)
            validation.update(body_metrics(cells))
            validation["nonzeroRgbInTransparentPixels"] = max(
                int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells
            )
            unit_report["actions"][action.key] = {
                "source": f"videos/{unit}/{VIDEO_NAME[action.key]}",
                "sourceFrameRate": videos[action.key][1],
                "sourceIndices": list(action.indices),
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
        combined["actions"][unit] = unit_report

    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(combined, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(combined, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
