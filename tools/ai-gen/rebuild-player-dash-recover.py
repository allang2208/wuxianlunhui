#!/usr/bin/env python3
"""Build the 14-frame transparent recovery sheet for the H3 dash thrust."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


FRAME_SIZE = 512
COLS = 8
ROWS = 2
SOURCE_FRAMES = [0, 30, 32, 34, 36, 38, 40, 42, 44, 46, 48, 50, 52, 72]
TARGET_ROOT_X = 256.0
TARGET_FOOT_Y = 492.0


def decode_video(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
    if len(frames) <= max(SOURCE_FRAMES):
        raise ValueError(f"Expected at least {max(SOURCE_FRAMES) + 1} frames, got {len(frames)}")
    return frames


def filter_components(mask: np.ndarray, min_area: int = 20) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    kept = np.zeros_like(mask, dtype=np.uint8)
    for index in range(1, count):
        if stats[index, cv2.CC_STAT_AREA] >= min_area:
            kept[labels == index] = 1
    return kept


def head_height(rgba: np.ndarray) -> float:
    rgb = rgba[:, :, :3]
    alpha = rgba[:, :, 3]
    bright = ((alpha > 32) & (rgb.min(axis=2) > 155)).astype(np.uint8)
    count, _, stats, _ = cv2.connectedComponentsWithStats(bright, 8)
    candidates = []
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        if area >= 80 and y < rgba.shape[0] * 0.45:
            candidates.append((int(area), int(h)))
    if not candidates:
        raise ValueError("Could not measure the character skull for scale calibration")
    return float(max(candidates)[1])


def reference_head_heights(root: Path) -> tuple[float, float, float]:
    idle = np.asarray(Image.open(root / "assets/player/idle.png").convert("RGBA"))
    run_sheet = np.asarray(Image.open(root / "assets/character/running.png").convert("RGBA"))
    idle_height = head_height(idle)
    run_heights = [head_height(run_sheet[:, index * 512:(index + 1) * 512]) for index in range(8)]
    run_height = float(np.median(run_heights))
    return idle_height, run_height, (idle_height + run_height) * 0.5


def attack_terminal_head_height(root: Path) -> float:
    """Recover 首帧继承当前突刺末帧体量，避免切动画时再次突然缩小。"""
    sheet = np.asarray(Image.open(root / "assets/player/dash_attack_thrust.png").convert("RGBA"))
    frame_index = 14
    frame_x = (frame_index % 8) * 512
    frame_y = (frame_index // 8) * 516
    terminal = sheet[frame_y:frame_y + 516, frame_x:frame_x + 512]
    return head_height(terminal)


def keyed_rgba(rgb: np.ndarray) -> np.ndarray:
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    background = (g > 90) & (g - r > 46) & (g - b > 46)
    mask = cv2.morphologyEx((~background).astype(np.uint8), cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    mask = filter_components(mask)
    alpha = cv2.GaussianBlur((mask * 255).astype(np.uint8), (3, 3), 0.65)
    clean = rgb.copy()
    spill = (alpha > 0) & (g > np.maximum(r, b) + 8)
    clean[:, :, 1][spill] = np.maximum(r, b)[spill].astype(np.uint8)
    return np.dstack((clean, alpha))


def remove_green_residue(rgba: np.ndarray) -> tuple[np.ndarray, int]:
    cleaned = rgba.copy()
    r = cleaned[:, :, 0].astype(np.int16)
    g = cleaned[:, :, 1].astype(np.int16)
    b = cleaned[:, :, 2].astype(np.int16)
    a = cleaned[:, :, 3]
    green = (a > 0) & (g > r) & (g > b)
    count = int(np.count_nonzero(green))
    cleaned[green] = 0
    return cleaned, count


def neutralize_monochrome_and_outline_head(rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Remove the red cast, clean transparent fringe, and add a 2px skull contour."""
    cleaned = rgba.copy()
    alpha = cleaned[:, :, 3]
    rgb = cleaned[:, :, :3].astype(np.float32)
    value = rgb.max(axis=2)
    luminance = rgb[:, :, 0] * 0.2126 + rgb[:, :, 1] * 0.7152 + rgb[:, :, 2] * 0.0722
    gray = np.clip(((value * 0.8 + luminance * 0.2) - 128.0) * 1.06 + 128.0, 0, 255).astype(np.uint8)
    visible = alpha > 0
    cleaned[:, :, 0][visible] = gray[visible]
    cleaned[:, :, 1][visible] = gray[visible]
    cleaned[:, :, 2][visible] = gray[visible]

    matte_dust = alpha <= 6
    cleaned[matte_dust] = 0
    alpha = cleaned[:, :, 3]
    bright = ((alpha > 32) & (gray > 155)).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(bright, 8)
    candidates: list[tuple[int, int]] = []
    for index in range(1, count):
        x, y, w, h, area = stats[index]
        if area >= 80 and y < rgba.shape[0] * 0.45:
            candidates.append((int(area), index))
    if not candidates:
        raise ValueError("Could not locate the character skull for outline cleanup")

    skull_index = max(candidates)[1]
    x, y, w, h, _ = stats[skull_index]
    zone = np.zeros(alpha.shape, dtype=np.uint8)
    x0, y0 = max(0, x - 4), max(0, y - 4)
    x1, y1 = min(alpha.shape[1], x + w + 4), min(alpha.shape[0], y + h + 4)
    zone[y0:y1, x0:x1] = 1
    head_subject = ((alpha > 16) & (zone > 0)).astype(np.uint8)
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    outline = (cv2.dilate(head_subject, kernel, iterations=1) > 0) & (alpha <= 16) & (zone > 0)
    cleaned[outline, 0] = 8
    cleaned[outline, 1] = 8
    cleaned[outline, 2] = 8
    cleaned[outline, 3] = 255
    cleaned[cleaned[:, :, 3] == 0, :3] = 0
    return cleaned, int(np.count_nonzero(outline))


def root_anchor(alpha: np.ndarray) -> tuple[float, float]:
    yy, xx = np.where(alpha > 32)
    if len(xx) == 0:
        raise ValueError("Empty body frame")
    top = float(yy.min())
    height = float(yy.max() - yy.min() + 1)
    middle = (yy >= top + height * 0.38) & (yy <= top + height * 0.68)
    root_x = float(np.median(xx[middle])) if np.any(middle) else float(np.median(xx))
    return root_x, float(yy.max())


def normalize(rgba: np.ndarray, source_scale: float) -> np.ndarray:
    root_x, foot_y = root_anchor(rgba[:, :, 3])
    tx = TARGET_ROOT_X - root_x * source_scale
    ty = TARGET_FOOT_Y - foot_y * source_scale
    matrix = np.array([[source_scale, 0.0, tx], [0.0, source_scale, ty]], dtype=np.float32)
    return cv2.warpAffine(
        rgba,
        matrix,
        (FRAME_SIZE, FRAME_SIZE),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True)
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    video = (root / args.video).resolve()
    out_dir = (root / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    decoded = decode_video(video)
    keyed_frames = [keyed_rgba(decoded[index]) for index in SOURCE_FRAMES]
    idle_head, run_head, _ = reference_head_heights(root)
    attack_head = attack_terminal_head_height(root)
    source_heads = [head_height(frame) for frame in keyed_frames]
    target_heads = np.linspace(attack_head, idle_head, len(keyed_frames))
    source_scales = [float(target / source) for target, source in zip(target_heads, source_heads)]
    frames = []
    removed_green_pixels = 0
    head_outline_pixels = 0
    for frame, scale in zip(keyed_frames, source_scales):
        normalized, removed = remove_green_residue(normalize(frame, scale))
        normalized, outlined = neutralize_monochrome_and_outline_head(normalized)
        frames.append(normalized)
        removed_green_pixels += removed
        head_outline_pixels += outlined

    sheet = Image.new("RGBA", (FRAME_SIZE * COLS, FRAME_SIZE * ROWS), (0, 0, 0, 0))
    contact = Image.new("RGBA", (FRAME_SIZE * 7, FRAME_SIZE * 2), (28, 31, 36, 255))
    draw = ImageDraw.Draw(contact)
    report_frames = []
    for index, frame in enumerate(frames):
        image = Image.fromarray(frame, "RGBA")
        sheet.alpha_composite(image, ((index % COLS) * FRAME_SIZE, (index // COLS) * FRAME_SIZE))
        x = (index % 7) * FRAME_SIZE
        y = (index // 7) * FRAME_SIZE
        contact.alpha_composite(image, (x, y))
        draw.text((x + 8, y + 8), f"f{index:02d} src{SOURCE_FRAMES[index]}", fill="white")
        yy, xx = np.where(frame[:, :, 3] > 32)
        report_frames.append({
            "frame": index,
            "sourceFrame": SOURCE_FRAMES[index],
            "alphaPixels": int(len(xx)),
            "bbox": [int(xx.min()), int(yy.min()), int(xx.max() + 1), int(yy.max() + 1)],
        })

    _, remaining_green_pixels = remove_green_residue(np.asarray(sheet))
    if remaining_green_pixels:
        raise ValueError(f"green residue remains in recovery sheet: {remaining_green_pixels} pixels")
    sheet.save(out_dir / "dash_recover_thrust.png")
    contact.save(out_dir / "dash_recover_thrust_contact.png")
    gif_frames = [Image.fromarray(frame, "RGBA") for frame in frames]
    gif_frames[0].save(
        out_dir / "dash_recover_thrust_preview.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=36,
        loop=0,
        disposal=2,
    )
    attack_sheet_path = out_dir / "dash_attack_thrust.png"
    if attack_sheet_path.exists():
        attack_sheet = Image.open(attack_sheet_path).convert("RGBA")
        attack_frames = [
            attack_sheet.crop((
                (index % 8) * 512,
                (index // 8) * 516,
                (index % 8 + 1) * 512,
                (index // 8 + 1) * 516,
            ))
            for index in range(15)
        ]
        recover_frames_516 = []
        for frame in gif_frames:
            canvas = Image.new("RGBA", (512, 516), (0, 0, 0, 0))
            canvas.alpha_composite(frame, (0, 2))
            recover_frames_516.append(canvas)
        attack_and_hold = attack_frames + [attack_frames[-1]] * 12
        full_preview = attack_and_hold + recover_frames_516
        full_preview[0].save(
            out_dir / "dash_thrust_full_preview.gif",
            save_all=True,
            append_images=full_preview[1:],
            duration=[42] * len(attack_and_hold) + [36] * len(recover_frames_516),
            loop=0,
            disposal=2,
        )
    (out_dir / "dash_recover_thrust_report.json").write_text(
        json.dumps({
            "sourceFrames": SOURCE_FRAMES,
            "sourceScales": source_scales,
            "scaleCalibration": {
                "metric": "filled-skull-height",
                "idleHeadHeight": idle_head,
                "runMedianHeadHeight": run_head,
                "attackTargetHeadHeight": attack_head,
                "targetHeadHeights": target_heads.tolist(),
                "sourceHeadHeights": source_heads,
                "targetFootY": TARGET_FOOT_Y,
            },
            "frameSize": [FRAME_SIZE, FRAME_SIZE],
            "frames": report_frames,
        }, indent=2),
        encoding="utf-8",
    )
    print(f"head_outline_pixels={head_outline_pixels}")
    print(f"decoded={len(decoded)} selected={SOURCE_FRAMES}")
    print(f"removed_green_pixels={removed_green_pixels}")
    print(f"remaining_green_pixels={remaining_green_pixels}")
    print(out_dir / "dash_recover_thrust.png")


if __name__ == "__main__":
    main()
