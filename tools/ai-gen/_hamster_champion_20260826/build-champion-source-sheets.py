#!/usr/bin/env python3
"""Build normalized transparent source sheets for the hamster champion."""

from __future__ import annotations

import argparse
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
SPEC = importlib.util.spec_from_file_location("champion_sprite_base", BASE_SCRIPT)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {BASE_SCRIPT}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)

FRAME_HEIGHT = 512
FEET_Y = 355
TARGET_BODY_HEIGHT = 185
BODY_OPEN_KERNEL_SOURCE = 23
BODY_OPEN_KERNEL_OUTPUT = 11
MARGIN = 16


@dataclass(frozen=True)
class ActionSpec:
    name: str
    source_name: str
    indices: tuple[int, ...]
    frame_rate: float
    repeat: int
    horizontal_mode: str
    vertical_mode: str


def opened_body_bbox(rgba: np.ndarray, kernel_size: int = BODY_OPEN_KERNEL_SOURCE) -> tuple[int, int, int, int]:
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
    top = y0 + round((y1 - y0 + 1) * 0.20)
    bottom = y0 + round((y1 - y0 + 1) * 0.72)
    ys, xs = np.where(alpha[top:bottom + 1, x0:x1 + 1] > 32)
    return float(np.median(xs + x0)) if len(xs) else (x0 + x1) / 2.0


def round_width(width: float) -> int:
    return max(512, int(math.ceil(width / 128.0) * 128))


def choose_width(frames: list[np.ndarray], scale: float, mode: str) -> tuple[int, float | None]:
    if mode == "center-body":
        half_span = 0.0
        for rgba in frames:
            x0, _, x1, _ = BASE.alpha_bbox(rgba)
            anchor = body_anchor_x(rgba)
            half_span = max(half_span, (anchor - x0) * scale, (x1 - anchor + 1) * scale)
        return round_width(half_span * 2 + MARGIN * 2), None
    reference_anchor = body_anchor_x(frames[0])
    left = min((BASE.alpha_bbox(rgba)[0] - reference_anchor) * scale for rgba in frames)
    right = max((BASE.alpha_bbox(rgba)[2] + 1 - reference_anchor) * scale for rgba in frames)
    return round_width(max(abs(left), abs(right)) * 2 + MARGIN * 2), reference_anchor


def place_cell(rgba: np.ndarray, scale: float, frame_width: int, spec: ActionSpec, reference_anchor: float | None) -> np.ndarray:
    x0, y0, x1, y1 = BASE.alpha_bbox(rgba)
    _, _, _, body_y1 = opened_body_bbox(rgba)
    crop = rgba[y0:y1 + 1, x0:x1 + 1]
    width = max(1, round(crop.shape[1] * scale))
    height = max(1, round(crop.shape[0] * scale))
    resized = np.asarray(Image.fromarray(crop, "RGBA").resize((width, height), Image.Resampling.LANCZOS)).copy()
    resized[resized[..., 3] == 0, :3] = 0
    if spec.horizontal_mode == "center-body":
        offset_x = round(frame_width / 2 - (body_anchor_x(rgba) - x0) * scale)
    else:
        if reference_anchor is None:
            raise RuntimeError("preserve-source requires an anchor")
        offset_x = round(frame_width / 2 + (x0 - reference_anchor) * scale)
    if spec.vertical_mode == "content-ground":
        offset_y = round(FEET_Y - (y1 - y0) * scale)
    else:
        offset_y = round(FEET_Y - (body_y1 - y0) * scale)
    if offset_x < MARGIN or offset_y < MARGIN or offset_x + width > frame_width - MARGIN or offset_y + height > FRAME_HEIGHT - MARGIN:
        raise RuntimeError(f"{spec.name} placement clips: {width}x{height} at {offset_x},{offset_y} in {frame_width}x{FRAME_HEIGHT}")
    cell = np.zeros((FRAME_HEIGHT, frame_width, 4), np.uint8)
    cell[offset_y:offset_y + height, offset_x:offset_x + width] = resized
    return cell


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    frame_width = cells[0].shape[1]
    rows = math.ceil(len(cells) / cols)
    sheet = np.zeros((rows * FRAME_HEIGHT, cols * frame_width, 4), np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * FRAME_HEIGHT:(row + 1) * FRAME_HEIGHT, col * frame_width:(col + 1) * frame_width] = cell
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
    frames = [checker(cell).resize((gif_width, gif_height), Image.Resampling.LANCZOS) for cell in cells]
    duration = max(20, round(1000 / spec.frame_rate))
    playback = frames if spec.repeat == 0 else frames * 3
    durations = [duration] * len(playback)
    if spec.repeat == 0:
        durations[0] = max(durations[0], 250)
        durations[-1] = max(durations[-1], 650)
    playback[0].save(preview_dir / f"{spec.name}.gif", save_all=True, append_images=playback[1:], duration=durations, loop=0, disposal=2, optimize=False)
    thumb_w = 256
    thumb_h = round(FRAME_HEIGHT * thumb_w / frame_width)
    rows = math.ceil(len(cells) / 4)
    contact = Image.new("RGB", (1024, rows * (thumb_h + 24)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, (cell, source_index) in enumerate(zip(cells, spec.indices)):
        x = (position % 4) * thumb_w
        y = (position // 4) * (thumb_h + 24)
        contact.paste(checker(cell).resize((thumb_w, thumb_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 5, y + thumb_h + 4), f"sheet {position} / source f{source_index}", fill="white")
    contact.save(preview_dir / f"{spec.name}-contact.png")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", action="append", choices=("idle", "running", "attacking", "dying"))
    args = parser.parse_args()
    videos = {
        "idle": BASE.decode_video(ROOT / "videos" / "idle-doubao.mp4"),
        "running": BASE.decode_video(ROOT / "videos" / "running-doubao-v02.mp4"),
        "attacking": BASE.decode_video(ROOT / "videos" / "attacking-doubao-v03.mp4"),
        "dying": BASE.decode_video(ROOT / "videos" / "dying-doubao.mp4"),
    }
    specs = (
        ActionSpec("idle", "idle-doubao.mp4", BASE.visual_resample_indices(videos["idle"][0], 0, 116, 24), 8.0, -1, "center-body", "body-feet"),
        # v02 的f0..约f16为站立进入奔跑的起步段；匀速段完整同脚周期为40个原生帧。
        # f44与f84同脚同相，正式循环保留f44..83且排除重复端点f84；每2帧取关键姿态，
        # RIFE回绕补f83并输出40帧@24fps。
        ActionSpec("running", "running-doubao-v02.mp4", tuple(range(44, 84, 2)), 12.0, -1, "center-body", "body-feet"),
        ActionSpec("attacking", "attacking-doubao-v03.mp4", (0, 8, 16, 24, 30, 36, 42, 46, 48, 50, 52, 56, 60, 64, 68, 72, 76, 78, 80, 82, 84, 88, 92, 96), 12.0, 0, "preserve-source", "body-feet"),
        ActionSpec("dying", "dying-doubao.mp4", BASE.visual_resample_indices(videos["dying"][0], 16, 84, 16), 12.0, 0, "preserve-source", "content-ground"),
    )
    selected_specs = tuple(spec for spec in specs if not args.only or spec.name in args.only)
    source_dir = ROOT / "source-sheets-pre-interpolation"
    preview_dir = ROOT / "previews" / "source-sheets"
    source_dir.mkdir(parents=True, exist_ok=True)
    preview_dir.mkdir(parents=True, exist_ok=True)
    model = BASE.get_model()
    cache: dict[tuple[str, int], np.ndarray] = {}
    for spec in selected_specs:
        for source_index in spec.indices:
            key = (spec.name, source_index)
            if key not in cache:
                cache[key] = BASE.cutout_rgba(videos[spec.name][0][source_index], model)
                print(f"[champion-sheet] {spec.name} BiRefNet f{source_index}", flush=True)
    report_path = ROOT / "source-sheet-report.json"
    existing_report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else None
    fixed_scale_value = existing_report.get("fixedScaleAcrossAllActions") if existing_report else None
    if fixed_scale_value:
        fixed_scale = float(fixed_scale_value)
    else:
        reference = BASE.cutout_rgba(videos["idle"][0][specs[0].indices[0]], model)
        _, body_y0, _, body_y1 = opened_body_bbox(reference)
        fixed_scale = TARGET_BODY_HEIGHT / (body_y1 - body_y0 + 1)
    report: dict[str, object] = existing_report or {
        "runtimeIntegration": False,
        "frameHeight": FRAME_HEIGHT,
        "feetY": FEET_Y,
        "targetEffectiveBodyHeight": TARGET_BODY_HEIGHT,
        "fixedScaleAcrossAllActions": fixed_scale,
        "actions": {},
    }
    report["fixedScaleAcrossAllActions"] = fixed_scale
    for spec in selected_specs:
        rgba_frames = [cache[(spec.name, index)] for index in spec.indices]
        # v03 为长剑安全框主动缩小了视频主体；按该动作中位有效躯干高度重新归一，
        # 只修正跨来源体量，不把下蹲、跨步等单帧姿态逐帧拉伸。
        action_scale = fixed_scale
        if spec.name == "attacking" and spec.source_name == "attacking-doubao-v03.mp4":
            body_heights = [opened_body_bbox(rgba)[3] - opened_body_bbox(rgba)[1] + 1 for rgba in rgba_frames]
            action_scale = TARGET_BODY_HEIGHT / float(np.median(body_heights))
        frame_width, anchor = choose_width(rgba_frames, action_scale, spec.horizontal_mode)
        if frame_width > 1024:
            raise RuntimeError(f"{spec.name} needs unsupported frame width {frame_width}")
        cols = 4 if frame_width >= 1024 else 8
        cells = [place_cell(rgba, action_scale, frame_width, spec, anchor) for rgba in rgba_frames]
        output = source_dir / f"{spec.name}.png"
        Image.fromarray(compose(cells, cols), "RGBA").save(output, optimize=True, compress_level=9)
        save_previews(spec, cells, preview_dir)
        validation = BASE.validate_cells(cells, spec.repeat)
        validation["nonzeroRgbInTransparentPixels"] = max(int(np.count_nonzero(cell[..., :3][cell[..., 3] == 0])) for cell in cells)
        report["actions"][spec.name] = {
            "source": f"videos/{spec.source_name}",
            "sourceFrameRate": videos[spec.name][1],
            "sourceIndices": list(spec.indices),
            "frameCount": len(cells),
            "endFrame": len(cells) - 1,
            "frameWidth": frame_width,
            "frameHeight": FRAME_HEIGHT,
            "cols": cols,
            "rows": math.ceil(len(cells) / cols),
            "frameRate": spec.frame_rate,
            "repeat": spec.repeat,
            "scale": action_scale,
            "validation": validation,
        }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
