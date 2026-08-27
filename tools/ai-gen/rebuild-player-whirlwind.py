#!/usr/bin/env python3
"""Rebuild one natural H3 spin into player body/hand sheets and a weapon pose track."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


FRAME_W = 512
FRAME_H = 516
COLS = 5
TARGET_ROOT_X = 256.0
TARGET_FOOT_Y = 492.0
TARGET_BODY_HEIGHT = 440.0
# 440px 规范身高配合配置 displayScale=477/440，追平 idle 的 477px 有效身高。
DISPLAY_SIZE = 144.0 * 477.0 / TARGET_BODY_HEIGHT
PLAYER_CENTER_OFFSET_Y = 72.0


def decode_video(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    return [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]


def subject_mask(rgb: np.ndarray) -> np.ndarray:
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    background = (g > 90) & (g - r > 46) & (g - b > 46)
    raw = (~background).astype(np.uint8)
    raw = cv2.morphologyEx(raw, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(raw, 8)
    if count <= 1:
        raise ValueError("No foreground component found")

    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    lx, ly, lw, lh, _ = stats[largest]
    keep = labels == largest
    for index in range(1, count):
        if index == largest:
            continue
        x, y, w, h, area = stats[index]
        if area < 10:
            continue
        dx = max(lx - (x + w), x - (lx + lw), 0)
        dy = max(ly - (y + h), y - (ly + lh), 0)
        if math.hypot(dx, dy) <= 28:
            keep |= labels == index
    return keep.astype(np.uint8)


def rgba_from_green(rgb: np.ndarray, mask: np.ndarray) -> np.ndarray:
    alpha = cv2.GaussianBlur((mask * 255).astype(np.uint8), (3, 3), 0.65)
    clean = rgb.copy()
    r = clean[:, :, 0].astype(np.int16)
    g = clean[:, :, 1].astype(np.int16)
    b = clean[:, :, 2].astype(np.int16)
    spill = (alpha > 0) & (g > np.maximum(r, b) + 8)
    clean[:, :, 1][spill] = np.maximum(r, b)[spill].astype(np.uint8)

    value = clean.max(axis=2).astype(np.float32)
    luminance = (
        clean[:, :, 0] * 0.2126
        + clean[:, :, 1] * 0.7152
        + clean[:, :, 2] * 0.0722
    )
    gray = np.clip(value * 0.8 + luminance * 0.2, 0, 255).astype(np.uint8)
    clean[:, :, 0] = gray
    clean[:, :, 1] = gray
    clean[:, :, 2] = gray
    rgba = np.dstack((clean, alpha))
    rgba[rgba[:, :, 3] <= 6] = 0
    return rgba


def root_anchor(alpha: np.ndarray) -> tuple[float, float, float]:
    ys, xs = np.where(alpha > 24)
    if len(xs) == 0:
        raise ValueError("Frame is empty after keying")
    top = float(ys.min())
    bottom = float(ys.max())
    height = bottom - top + 1.0
    root_band = (ys >= top + height * 0.38) & (ys <= top + height * 0.70)
    root_x = float(np.median(xs[root_band])) if np.any(root_band) else float(np.median(xs))
    return root_x, bottom, height


def normalize_frame(rgba: np.ndarray, scale: float) -> np.ndarray:
    root_x, foot_y, _ = root_anchor(rgba[:, :, 3])
    matrix = np.array(
        [
            [scale, 0.0, TARGET_ROOT_X - root_x * scale],
            [0.0, scale, TARGET_FOOT_Y - foot_y * scale],
        ],
        dtype=np.float32,
    )
    normalized = cv2.warpAffine(
        rgba,
        matrix,
        (FRAME_W, FRAME_H),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    normalized[normalized[:, :, 3] == 0, :3] = 0
    return normalized


def weapon_track(
    frame_count: int,
    phase_offset: float,
    lower_frames: int = 0,
    rise_frames: int = 0,
    drop_y: float = 0.0,
) -> list[dict[str, float | str]]:
    track: list[dict[str, float | str]] = []
    px_to_world_x = DISPLAY_SIZE / FRAME_W
    px_to_world_y = DISPLAY_SIZE / FRAME_H
    spin_frames = max(1, frame_count - lower_frames - rise_frames)
    for index in range(frame_count):
        low_amount = 0.0
        if lower_frames + rise_frames > 0 and spin_frames < frame_count:
            if index < lower_frames:
                t = 1.0 if lower_frames <= 1 else index / (lower_frames - 1)
                low_amount = t * t * (3.0 - 2.0 * t)
                theta = 0.0
            elif index < lower_frames + spin_frames:
                low_amount = 1.0
                theta = phase_offset + math.tau * (index - lower_frames) / spin_frames
            else:
                t = 1.0 if rise_frames <= 1 else (
                    index - lower_frames - spin_frames
                ) / (rise_frames - 1)
                low_amount = (1.0 - t) ** 3
                theta = 0.0
        else:
            theta = phase_offset + math.tau * index / frame_count
        screen_axis = math.cos(theta)
        depth_axis = math.sin(theta)
        grip_x = TARGET_ROOT_X + 63.0 * screen_axis
        # H3 修正版使用高位双手持握；剑柄绕肩线而非旧尝试的腰线。
        grip_y = 150.0 + 5.0 * math.cos(theta * 2.0)
        perspective = 0.30 + 0.70 * abs(screen_axis)
        if depth_axis > 0.20:
            layer = "front"
        elif depth_axis < -0.20:
            layer = "back"
        else:
            layer = "split"
        track.append(
            {
                "offsetX": round((grip_x - FRAME_W / 2) * px_to_world_x, 2),
                "offsetY": round(
                    -PLAYER_CENTER_OFFSET_Y
                    + (grip_y - FRAME_H / 2) * px_to_world_y
                    + drop_y * low_amount,
                    2,
                ),
                "rotation": 90.0 if screen_axis >= 0 else -90.0,
                "scale": 1.5,
                "perspective": round(perspective, 3),
                "depthPhase": layer,
                "depthValue": round(depth_axis, 3),
                "splitFromTip": "front" if math.cos(theta) >= 0 else "back",
            }
        )
    return track


def split_hand_layer(frame: np.ndarray, pose: dict[str, float | str]) -> tuple[np.ndarray, np.ndarray]:
    body = frame.copy()
    hand = np.zeros_like(frame)
    grip_x = FRAME_W / 2 + float(pose["offsetX"]) * FRAME_W / DISPLAY_SIZE
    grip_y = FRAME_H / 2 + (
        float(pose["offsetY"]) + PLAYER_CENTER_OFFSET_Y
    ) * FRAME_H / DISPLAY_SIZE
    yy, xx = np.indices(frame.shape[:2])
    hand_zone = (((xx - grip_x) / 19.0) ** 2 + ((yy - grip_y) / 16.0) ** 2) <= 1.0
    hand_zone &= frame[:, :, 3] > 8
    hand[hand_zone] = frame[hand_zone]
    body[hand_zone] = 0
    return body, hand


def save_sheet(frames: list[np.ndarray], path: Path) -> None:
    rows = math.ceil(len(frames) / COLS)
    sheet = Image.new("RGBA", (FRAME_W * COLS, FRAME_H * rows), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(
            Image.fromarray(frame, "RGBA"),
            ((index % COLS) * FRAME_W, (index // COLS) * FRAME_H),
        )
    sheet.save(path)


def save_contact(frames: list[np.ndarray], path: Path) -> None:
    rows = math.ceil(len(frames) / COLS)
    canvas = Image.new("RGBA", (FRAME_W * COLS, FRAME_H * rows), (28, 31, 36, 255))
    draw = ImageDraw.Draw(canvas)
    for index, frame in enumerate(frames):
        x = (index % COLS) * FRAME_W
        y = (index // COLS) * FRAME_H
        canvas.alpha_composite(Image.fromarray(frame, "RGBA"), (x, y))
        draw.text((x + 8, y + 8), f"f{index:02d}", fill=(255, 255, 255, 255))
    canvas.save(path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--start", required=True, type=int)
    parser.add_argument("--count", default=20, type=int)
    parser.add_argument("--step", default=1, type=int)
    parser.add_argument(
        "--indices",
        help="Optional comma-separated source indices; overrides start/count/step",
    )
    parser.add_argument(
        "--scale-reference",
        choices=("median", "endpoints"),
        default="median",
    )
    parser.add_argument("--phase-deg", default=0.0, type=float)
    parser.add_argument("--lower-frames", default=0, type=int)
    parser.add_argument("--rise-frames", default=0, type=int)
    parser.add_argument("--drop-y", default=0.0, type=float)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    video = Path(args.video)
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    decoded = decode_video(video)
    indices = (
        [int(value.strip()) for value in args.indices.split(",") if value.strip()]
        if args.indices
        else [args.start + index * args.step for index in range(args.count)]
    )
    if not indices or indices[-1] >= len(decoded):
        raise ValueError(f"Selected source range {indices[:1]}..{indices[-1:]} exceeds {len(decoded)} frames")

    keyed: list[np.ndarray] = []
    heights: list[float] = []
    for index in indices:
        rgba = rgba_from_green(decoded[index], subject_mask(decoded[index]))
        keyed.append(rgba)
        heights.append(root_anchor(rgba[:, :, 3])[2])
    source_height = float(
        np.median([heights[0], heights[-1]])
        if args.scale_reference == "endpoints"
        else np.median(heights)
    )
    fixed_scale = TARGET_BODY_HEIGHT / max(1.0, source_height)
    normalized = [normalize_frame(frame, fixed_scale) for frame in keyed]
    track = weapon_track(
        len(normalized),
        math.radians(args.phase_deg),
        max(0, args.lower_frames),
        max(0, args.rise_frames),
        args.drop_y,
    )

    body_frames: list[np.ndarray] = []
    hand_frames: list[np.ndarray] = []
    for frame, pose in zip(normalized, track):
        body, hand = split_hand_layer(frame, pose)
        body_frames.append(body)
        hand_frames.append(hand)

    save_sheet(normalized, out_dir / "whirlwind.png")
    save_sheet(body_frames, out_dir / "whirlwind_body.png")
    save_sheet(hand_frames, out_dir / "whirlwind_hand.png")
    save_contact(normalized, out_dir / "whirlwind_contact.png")
    gif_frames = [Image.fromarray(frame, "RGBA") for frame in normalized]
    gif_frames[0].save(
        out_dir / "whirlwind_preview.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=40,
        loop=0,
        disposal=2,
    )
    metadata = {
        "sourceVideo": str(video),
        "sourceFrames": indices,
        "frameCount": len(normalized),
        "frameWidth": FRAME_W,
        "frameHeight": FRAME_H,
        "cols": COLS,
        "rows": math.ceil(len(normalized) / COLS),
        "sourceBodyHeightMedian": source_height,
        "targetBodyHeight": TARGET_BODY_HEIGHT,
        "fixedScale": fixed_scale,
        "scaleReference": args.scale_reference,
        "phaseDeg": args.phase_deg,
        "lowerFrames": args.lower_frames,
        "riseFrames": args.rise_frames,
        "dropY": args.drop_y,
        "frames": track,
    }
    (out_dir / "whirlwind_track.json").write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(metadata, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
