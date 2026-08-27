#!/usr/bin/env python3
"""Build base transparent hamster-ninja sheets from the accepted Doubao videos.

The accepted opening/continuous attack videos deliberately use a wider camera than
the idle/run sources. Each action is therefore normalized from its own thick-body
bounds to one shared 150 px body height. Thin katana pixels only affect frame width;
they never shrink the hamster body. Formal runtime sheets are produced by the
project's RIFE 2x script after this base pass.
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
SPEC = importlib.util.spec_from_file_location("ninja_sprite_base", BASE_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {BASE_SCRIPT}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)

FRAME_HEIGHT = 512
FEET_Y = 456
TARGET_BODY_HEIGHT = 150
BODY_OPEN_KERNEL_SOURCE = 17
BODY_OPEN_KERNEL_OUTPUT = 9
COLS = 8
MARGIN = 20


@dataclass(frozen=True)
class ActionSpec:
    name: str
    video: str
    indices: tuple[int, ...]
    frame_rate: float
    repeat: int
    horizontal_mode: str
    vertical_mode: str


def opened_body_bbox(rgba: np.ndarray, kernel_size: int) -> tuple[int, int, int, int]:
    """Largest thick component: excludes the katana and isolated smoke bomb."""
    mask = (rgba[..., 3] > 32).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (kernel_size, kernel_size))
    opened = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    if count <= 1:
        raise RuntimeError("Body morphology removed every foreground component")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    ys, xs = np.where(labels == largest)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def body_anchor_x(rgba: np.ndarray) -> float:
    x0, y0, x1, y1 = opened_body_bbox(rgba, BODY_OPEN_KERNEL_SOURCE)
    top = y0 + round((y1 - y0 + 1) * 0.20)
    bottom = y0 + round((y1 - y0 + 1) * 0.72)
    ys, xs = np.where(rgba[top:bottom + 1, x0:x1 + 1, 3] > 32)
    return float(np.median(xs + x0)) if len(xs) else (x0 + x1) / 2.0


def round_width(value: float) -> int:
    return max(512, int(math.ceil(value / 128.0) * 128))


def action_scale(frames: list[np.ndarray]) -> float:
    heights = []
    for rgba in frames:
        _, y0, _, y1 = opened_body_bbox(rgba, BODY_OPEN_KERNEL_SOURCE)
        heights.append(y1 - y0 + 1)
    return TARGET_BODY_HEIGHT / float(np.median(heights))


def choose_width(frames: list[np.ndarray], scale: float, mode: str) -> tuple[int, float | None]:
    if mode == "center-body":
        half_span = 0.0
        for rgba in frames:
            x0, _, x1, _ = BASE.alpha_bbox(rgba)
            anchor = body_anchor_x(rgba)
            half_span = max(half_span, (anchor - x0) * scale, (x1 + 1 - anchor) * scale)
        return round_width(half_span * 2 + MARGIN * 2), None

    reference_anchor = body_anchor_x(frames[0])
    left = min((BASE.alpha_bbox(rgba)[0] - reference_anchor) * scale for rgba in frames)
    right = max((BASE.alpha_bbox(rgba)[2] + 1 - reference_anchor) * scale for rgba in frames)
    return round_width(max(abs(left), abs(right)) * 2 + MARGIN * 2), reference_anchor


def place_cell(
    rgba: np.ndarray,
    scale: float,
    frame_width: int,
    horizontal_mode: str,
    vertical_mode: str,
    reference_anchor: float | None,
) -> np.ndarray:
    x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
    _, _, _, body_y1 = opened_body_bbox(rgba, BODY_OPEN_KERNEL_SOURCE)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(
        Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)
    ).copy()
    resized[resized[..., 3] == 0, :3] = 0

    if horizontal_mode == "center-body":
        offset_x = round(frame_width / 2 - (body_anchor_x(rgba) - x0) * scale)
    else:
        if reference_anchor is None:
            raise RuntimeError("preserve-source requires a reference anchor")
        offset_x = round(frame_width / 2 + (x0 - reference_anchor) * scale)

    if vertical_mode == "body-feet":
        offset_y = round(FEET_Y - (body_y1 - y0) * scale)
    elif vertical_mode == "content-ground":
        offset_y = round(FEET_Y - (y1 - y0) * scale)
    else:
        raise ValueError(vertical_mode)

    if (offset_x < MARGIN or offset_y < MARGIN
            or offset_x + width > frame_width - MARGIN
            or offset_y + height > FRAME_HEIGHT - MARGIN):
        raise RuntimeError(
            f"Clipped safety margin: {width}x{height} at {offset_x},{offset_y} "
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
        sheet[row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT,
              col * frame_width:(col + 1) * frame_width] = cell
    return sheet


def checker(cell: np.ndarray) -> Image.Image:
    yy, xx = np.indices(cell.shape[:2])
    shade = np.where(((xx // 24 + yy // 24) % 2)[..., None], 58, 82)
    background = np.repeat(shade, 3, axis=2).astype(np.float32)
    alpha = cell[..., 3:4].astype(np.float32) / 255.0
    rgb = cell[..., :3].astype(np.float32) * alpha + background * (1.0 - alpha)
    return Image.fromarray(np.clip(rgb, 0, 255).astype(np.uint8), "RGB")


def save_previews(spec: ActionSpec, cells: list[np.ndarray], preview_dir: Path) -> None:
    fw = cells[0].shape[1]
    gif_w = 512
    gif_h = round(FRAME_HEIGHT * gif_w / fw)
    frames = [checker(cell).resize((gif_w, gif_h), Image.Resampling.LANCZOS) for cell in cells]
    frame_ms = max(20, round(1000 / spec.frame_rate))
    durations = [frame_ms] * len(frames)
    if spec.repeat == 0:
        durations[0] = max(durations[0], 220)
        durations[-1] = max(durations[-1], 500)
    playback = frames * (3 if spec.repeat < 0 else 1)
    playback_durations = durations * (3 if spec.repeat < 0 else 1)
    playback[0].save(
        preview_dir / f"{spec.name}-base.gif", save_all=True,
        append_images=playback[1:], duration=playback_durations,
        loop=0, disposal=2, optimize=False,
    )

    thumb_w = 320
    thumb_h = round(FRAME_HEIGHT * thumb_w / fw)
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
    contact.save(preview_dir / f"{spec.name}-base-contact.png")


def main() -> None:
    video_paths = {
        "idle": "idle-doubao.mp4",
        "running": "running-doubao.mp4",
        "attack_opening": "attacking-doubao-v05-centered.mp4",
        "attack_continuous": "continuous-attacking-doubao-v04-centered.mp4",
        "dying": "dying-doubao.mp4",
        "stealth": "smoke-bomb-doubao-v02.mp4",
    }
    videos = {name: BASE.decode_video(ROOT / "videos" / filename)
              for name, filename in video_paths.items()}
    specs = (
        ActionSpec("idle", video_paths["idle"], tuple(range(0, 120, 10)), 6.0, -1, "center-body", "body-feet"),
        ActionSpec("running", video_paths["running"], tuple(range(0, 22, 2)), 12.0, -1, "center-body", "body-feet"),
        ActionSpec("attack_opening", video_paths["attack_opening"], BASE.visual_resample_indices(videos["attack_opening"][0], 0, 73, 18), 12.0, 0, "preserve-source", "body-feet"),
        ActionSpec("attack_continuous", video_paths["attack_continuous"], BASE.visual_resample_indices(videos["attack_continuous"][0], 0, 81, 18), 12.0, 0, "preserve-source", "body-feet"),
        ActionSpec("dying", video_paths["dying"], BASE.visual_resample_indices(videos["dying"][0], 0, 67, 16), 12.0, 0, "preserve-source", "content-ground"),
        ActionSpec("stealth", video_paths["stealth"], BASE.visual_resample_indices(videos["stealth"][0], 0, 106, 18), 12.0, 0, "preserve-source", "body-feet"),
    )

    base_dir = ROOT / "sprite-sheets" / "base"
    preview_dir = ROOT / "previews" / "sheets"
    base_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)

    model = BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    for spec in specs:
        source_frames = videos[spec.name][0]
        for source_index in spec.indices:
            key = (spec.name, source_index)
            if key not in cache:
                cache[key] = BASE.cutout_rgba(source_frames[source_index], model)
                print(f"[ninja-sheet] {spec.name} BiRefNet f{source_index}", flush=True)

    report: dict[str, object] = {
        "assetOnly": False,
        "formalRuntimeRequiresRife": True,
        "bodyScaleReference": "shared 150px thick-body height; katana excluded",
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "actions": {},
    }
    first_idle_cell = None
    for spec in specs:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        scale = action_scale(rgba_frames)
        frame_width, reference_anchor = choose_width(rgba_frames, scale, spec.horizontal_mode)
        if frame_width > 1024:
            raise RuntimeError(f"{spec.name} needs unsupported frame width {frame_width}")
        cells = [place_cell(frame, scale, frame_width, spec.horizontal_mode,
                            spec.vertical_mode, reference_anchor) for frame in rgba_frames]
        if spec.name == "idle":
            first_idle_cell = cells[0]
        output = base_dir / f"{spec.name}.png"
        Image.fromarray(compose(cells), "RGBA").save(output, optimize=True, compress_level=9)
        save_previews(spec, cells, preview_dir)
        validation = BASE.validate_cells(cells, spec.repeat)
        body_heights = []
        body_bottoms = []
        for cell in cells:
            _, y0, _, y1 = opened_body_bbox(cell, BODY_OPEN_KERNEL_OUTPUT)
            body_heights.append(y1 - y0 + 1)
            body_bottoms.append(y1)
        validation.update({
            "effectiveBodyHeightMin": min(body_heights),
            "effectiveBodyHeightMedian": float(np.median(body_heights)),
            "effectiveBodyHeightMax": max(body_heights),
            "effectiveBodyBottomMin": min(body_bottoms),
            "effectiveBodyBottomMax": max(body_bottoms),
            "nonzeroRgbInTransparentPixels": max(int(np.count_nonzero(
                cell[..., :3][cell[..., 3] == 0])) for cell in cells),
        })
        report["actions"][spec.name] = {
            "source": f"videos/{spec.video}",
            "sourceFrameRate": videos[spec.name][1],
            "sourceIndices": list(spec.indices),
            "baseFrameRate": spec.frame_rate,
            "formalFrameRate": spec.frame_rate * 2,
            "repeat": spec.repeat,
            "baseFrameCount": len(cells),
            "formalFrameCount": len(cells) * 2 if spec.repeat < 0 else len(cells) * 2 - 1,
            "frameWidth": frame_width,
            "frameHeight": FRAME_HEIGHT,
            "cols": COLS,
            "baseRows": math.ceil(len(cells) / COLS),
            "scaleForAcceptedVideo": scale,
            "validation": validation,
        }

    if first_idle_cell is None:
        raise RuntimeError("No idle frame for icon")
    icon_bbox = BASE.alpha_bbox(first_idle_cell)
    x0, y0, x1, y1 = icon_bbox
    icon_crop = Image.fromarray(first_idle_cell[y0:y1 + 1, x0:x1 + 1], "RGBA")
    icon = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    icon_crop.thumbnail((224, 224), Image.Resampling.LANCZOS)
    icon.alpha_composite(icon_crop, ((256 - icon_crop.width) // 2, (256 - icon_crop.height) // 2))
    icon_path = REPO / "assets" / "ui" / "unit-icons" / "hamster_ninja.png"
    icon_path.parent.mkdir(parents=True, exist_ok=True)
    icon.save(icon_path, optimize=True, compress_level=9)

    (ROOT / "source-sheet-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
