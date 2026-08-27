#!/usr/bin/env python3
"""Build a body-only dash-thrust sheet and matching runtime sword grip track."""

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
COLS = 8
ROWS = 2
DISPLAY_SIZE = 144.0
TARGET_FOOT_Y = 492.0
TARGET_ROOT_X = 256.0
# 旧版最终突刺帧的有效身体高度约 418px，用户确认它与奔跑体量接近，
# 只需轻微缩小。目标 400px 相当于在原方案上收约 4%，避免上一版按
# 59px 头高归一后把整体从约 418px 错压到约 324px。
TARGET_EFFECTIVE_BODY_HEIGHT = 400.0
# H3 原片中 f66 开始从跑姿直接沉身前刺，f80 已完成最大伸展。
# 保留连续帧而非稀疏抽样：15 帧按 25fps 播放为 600ms，和技能时长一致，
# 同时只比 24fps 原视频快约 4%。
SOURCE_FRAMES = list(range(66, 81))


def decode_video(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
    if len(frames) <= max(SOURCE_FRAMES):
        raise ValueError(f"Expected at least {max(SOURCE_FRAMES) + 1} frames, got {len(frames)}")
    return frames


def filter_components(mask: np.ndarray, min_area: int = 20) -> np.ndarray:
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask.astype(np.uint8), 8)
    kept = np.zeros_like(mask, dtype=np.uint8)
    for idx in range(1, count):
        if stats[idx, cv2.CC_STAT_AREA] >= min_area:
            kept[labels == idx] = 1
    return kept


def head_height(rgba: np.ndarray) -> float:
    """Measure the filled skull, a pose-independent character scale reference."""
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


def foreground_mask(rgb: np.ndarray) -> np.ndarray:
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    bg = (g > 90) & (g - r > 46) & (g - b > 46)
    mask = (~bg).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    return filter_components(mask, min_area=20)


def sword_geometry(rgb: np.ndarray, subject: np.ndarray) -> tuple[np.ndarray, np.ndarray, float]:
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    h, s, v = cv2.split(hsv)
    r = rgb[:, :, 0].astype(np.int16)
    g = rgb[:, :, 1].astype(np.int16)
    b = rgb[:, :, 2].astype(np.int16)
    brown = subject.astype(bool) & (s > 42) & (v > 26) & (h < 35) & (r > b + 7)
    brown = cv2.morphologyEx(brown.astype(np.uint8), cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))

    count, labels, stats, _ = cv2.connectedComponentsWithStats(brown, 8)
    candidates: list[tuple[float, int]] = []
    for idx in range(1, count):
        area = stats[idx, cv2.CC_STAT_AREA]
        if area < 80:
            continue
        ys, xs = np.where(labels == idx)
        span = float(np.hypot(xs.max() - xs.min(), ys.max() - ys.min()))
        candidates.append((area * max(1.0, span), idx))
    if not candidates:
        raise ValueError("Could not isolate the rusty sword color component")
    component = labels == max(candidates)[1]
    ys, xs = np.where(component)
    points = np.column_stack((xs, ys)).astype(np.float64)
    center = points.mean(axis=0)
    _, _, vt = np.linalg.svd(points - center, full_matrices=False)
    axis = vt[0]
    if axis[0] < 0:
        axis = -axis
    normal = np.array([-axis[1], axis[0]])

    # Use the selected elongated sword component for longitudinal bounds. Other
    # rusty H3 pixels around the pelvis/hands must not extend the removal corridor
    # through the character body.
    near = points
    projections = (near - center) @ axis
    p_min, p_max = np.percentile(projections, [0.5, 99.5])

    near_q = (near - center) @ normal
    span = max(1.0, p_max - p_min)
    guard_candidates = []
    for bin_index in range(18, 51):
        lo = p_min + span * (bin_index / 100)
        hi = p_min + span * ((bin_index + 1) / 100)
        in_bin = (projections >= lo) & (projections < hi)
        if np.any(in_bin):
            guard_candidates.append((float(np.percentile(np.abs(near_q[in_bin]), 95)), (lo + hi) * 0.5))
    guard_projection = max(guard_candidates)[1] if guard_candidates else p_min + span * 0.32

    yy, xx = np.indices(subject.shape)
    pixels = np.stack((xx - center[0], yy - center[1]), axis=-1)
    along = pixels @ axis
    across = np.abs(pixels @ normal)
    corridor = (subject > 0) & (along >= p_min - 6) & (along <= p_max + 8) & (across <= 14)
    nearby_brown = brown.astype(bool) & (along >= p_min - 18) & (along <= p_max + 18) & (across <= 70)
    detail = cv2.dilate(nearby_brown.astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    sword_mask = (corridor | detail).astype(np.uint8)

    grip_projection = p_min + (p_max - p_min) * 0.21
    grip = center + axis * grip_projection
    angle_deg = math.degrees(math.atan2(axis[1], axis[0]))
    return sword_mask, grip, angle_deg


def body_rgba(rgb: np.ndarray, subject: np.ndarray, sword_mask: np.ndarray) -> np.ndarray:
    body = subject.copy()
    body[sword_mask > 0] = 0
    body = filter_components(body, min_area=14)
    alpha = cv2.GaussianBlur((body * 255).astype(np.uint8), (3, 3), 0.65)
    clean = rgb.copy()
    r = clean[:, :, 0].astype(np.int16)
    g = clean[:, :, 1].astype(np.int16)
    b = clean[:, :, 2].astype(np.int16)
    spill = (alpha > 0) & (g > np.maximum(r, b) + 8)
    clean[:, :, 1][spill] = np.maximum(r, b)[spill].astype(np.uint8)
    hsv = cv2.cvtColor(clean, cv2.COLOR_RGB2HSV)
    rusty = (alpha > 0) & (hsv[:, :, 1] > 38) & (hsv[:, :, 0] < 35) & (r > b + 7)
    gray = np.clip((r + g + b) / 3, 0, 255).astype(np.uint8)
    for channel in range(3):
        clean[:, :, channel][rusty] = gray[rusty]
    return np.dstack((clean, alpha))


def keyed_rgba(rgb: np.ndarray, subject: np.ndarray) -> np.ndarray:
    alpha = cv2.GaussianBlur((subject * 255).astype(np.uint8), (3, 3), 0.65)
    clean = rgb.copy()
    r = clean[:, :, 0].astype(np.int16)
    g = clean[:, :, 1].astype(np.int16)
    b = clean[:, :, 2].astype(np.int16)
    spill = (alpha > 0) & (g > np.maximum(r, b) + 8)
    clean[:, :, 1][spill] = np.maximum(r, b)[spill].astype(np.uint8)
    return np.dstack((clean, alpha))


def root_anchor(mask: np.ndarray) -> tuple[float, float, float]:
    ys, xs = np.where(mask > 32)
    if len(xs) == 0:
        raise ValueError("Body frame is empty after sword removal")
    top, bottom = float(ys.min()), float(ys.max())
    height = bottom - top + 1
    band = (ys >= top + height * 0.38) & (ys <= top + height * 0.68)
    root_x = float(np.median(xs[band])) if np.any(band) else float(np.median(xs))
    return root_x, bottom, height


def normalize_frame(rgba: np.ndarray, grip: np.ndarray, source_scale: float) -> tuple[np.ndarray, np.ndarray]:
    root_x, foot_y, _ = root_anchor(rgba[:, :, 3])
    tx = TARGET_ROOT_X - root_x * source_scale
    ty = TARGET_FOOT_Y - foot_y * source_scale
    matrix = np.array([[source_scale, 0.0, tx], [0.0, source_scale, ty]], dtype=np.float32)
    normalized = cv2.warpAffine(
        rgba,
        matrix,
        (FRAME_W, FRAME_H),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    normalized_grip = grip * source_scale + np.array([tx, ty])
    return normalized, normalized_grip


def remove_green_residue(rgba: np.ndarray) -> tuple[np.ndarray, int]:
    """Delete every alpha-bearing pixel whose green channel dominates red and blue."""
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

    # A value-weighted grayscale keeps the pale bones white after removing the
    # generated video's magenta cast. Rec.709 luminance alone would turn those
    # saturated pale-red pixels noticeably darker than the idle/run sprites.
    rgb = cleaned[:, :, :3].astype(np.float32)
    value = rgb.max(axis=2)
    luminance = rgb[:, :, 0] * 0.2126 + rgb[:, :, 1] * 0.7152 + rgb[:, :, 2] * 0.0722
    gray = np.clip(((value * 0.8 + luminance * 0.2) - 128.0) * 1.06 + 128.0, 0, 255).astype(np.uint8)
    visible = alpha > 0
    cleaned[:, :, 0][visible] = gray[visible]
    cleaned[:, :, 1][visible] = gray[visible]
    cleaned[:, :, 2][visible] = gray[visible]

    # Delete only nearly invisible extraction dust. Keep the normal antialias
    # ramp so the silhouette does not become jagged at game scale.
    matte_dust = alpha <= 6
    cleaned[matte_dust] = 0
    alpha = cleaned[:, :, 3]

    # Locate the filled skull in the upper body, then thicken the existing outer
    # silhouette by two pixels. The tight skull box prevents hands/ribs from
    # receiving the heavier head-only contour.
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


def count_green_residue(rgba: np.ndarray) -> int:
    """Count visible pixels that still have a green-dominant RGB value."""
    r = rgba[:, :, 0].astype(np.int16)
    g = rgba[:, :, 1].astype(np.int16)
    b = rgba[:, :, 2].astype(np.int16)
    a = rgba[:, :, 3]
    return int(np.count_nonzero((a > 0) & (g > r) & (g > b)))


def forward_hand_anchor(rgba: np.ndarray) -> np.ndarray:
    """Estimate the front clasped-hand pivot from the normalized body silhouette."""
    alpha = rgba[:, :, 3]
    yy, xx = np.where((alpha > 32) & (np.indices(alpha.shape)[0] < 300) & (np.indices(alpha.shape)[1] > 240))
    if len(xx) == 0:
        raise ValueError("Could not locate a forward hand candidate")
    right_edge = int(xx.max())
    hand_band = xx >= right_edge - 18
    # The rightmost upper-body cluster is the forward hand in every selected
    # right-facing frame. Pull six pixels in from the fingertips so the sword
    # origin sits inside the clasp instead of on its outer edge.
    return np.array([
        float(np.median(xx[hand_band])) - 6.0,
        float(np.median(yy[hand_band])),
    ])


def make_contact(frames: list[np.ndarray], path: Path) -> None:
    frame_h, frame_w = frames[0].shape[:2]
    rows = math.ceil(len(frames) / 4)
    canvas = Image.new("RGBA", (frame_w * 4, frame_h * rows), (28, 31, 36, 255))
    draw = ImageDraw.Draw(canvas)
    for i, frame in enumerate(frames):
        x = (i % 4) * frame_w
        y = (i // 4) * frame_h
        tile = Image.fromarray(frame, "RGBA")
        canvas.alpha_composite(tile, (x, y))
        draw.text((x + 8, y + 8), f"f{i:02d} src{SOURCE_FRAMES[i]}", fill=(255, 255, 255, 255))
    canvas.save(path)


def composite_runtime_sword(
    root: Path,
    body_frames: list[np.ndarray],
    track: list[dict[str, float]],
    debug_grip: bool = False,
) -> list[np.ndarray]:
    source = Image.open(root / "assets" / "weapons" / "1-rusty_sword_euip.png").convert("RGBA")
    alpha = np.asarray(source.getchannel("A"))
    ys, xs = np.where(alpha > 32)
    source = source.crop((int(xs.min()), int(ys.min()), int(xs.max() + 1), int(ys.max() + 1)))
    previews: list[np.ndarray] = []
    px_per_world_x = FRAME_W / DISPLAY_SIZE
    px_per_world_y = FRAME_H / DISPLAY_SIZE
    preview_w = 1024
    body_shift_x = 64
    for body, pose in zip(body_frames, track):
        display_w = 78.75 * 0.63 * pose["scale"] * pose["stretchX"]
        display_h = 78.75 * pose["scale"] * pose["stretchY"]
        sword_w = max(1, round(display_w * px_per_world_x))
        sword_h = max(1, round(display_h * px_per_world_y))
        sword = source.resize((sword_w, sword_h), Image.Resampling.LANCZOS)
        grip_x = FRAME_W / 2 + body_shift_x + pose["offsetX"] * px_per_world_x
        grip_y = FRAME_H / 2 + pose["offsetY"] * px_per_world_y
        origin_x = sword_w * 0.5
        origin_y = sword_h * (0.5 + 40.0 / max(1.0, display_h))

        layer = Image.new("RGBA", (preview_w, FRAME_H), (0, 0, 0, 0))
        layer.alpha_composite(sword, (round(grip_x - origin_x), round(grip_y - origin_y)))
        matrix = cv2.getRotationMatrix2D((grip_x, grip_y), -pose["rotation"], 1.0)
        rotated = cv2.warpAffine(
            np.asarray(layer), matrix, (preview_w, FRAME_H), flags=cv2.INTER_CUBIC,
            borderMode=cv2.BORDER_CONSTANT, borderValue=(0, 0, 0, 0),
        )
        composed = Image.new("RGBA", (preview_w, FRAME_H), (28, 31, 36, 255))
        composed.alpha_composite(Image.fromarray(body, "RGBA"), (body_shift_x, 0))
        composed.alpha_composite(Image.fromarray(rotated, "RGBA"))
        if debug_grip:
            draw = ImageDraw.Draw(composed)
            draw.ellipse(
                (grip_x - 5, grip_y - 5, grip_x + 5, grip_y + 5),
                outline=(255, 64, 64, 255),
                width=2,
            )
        previews.append(np.asarray(composed))
    return previews


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", required=True, help="accepted visible-sword video used to derive the weapon track")
    parser.add_argument("--body-video", required=True, help="body-only H3 video used to build the runtime sheet")
    parser.add_argument("--out-dir", required=True)
    args = parser.parse_args()

    root = Path(__file__).resolve().parents[2]
    video = (root / args.video).resolve()
    out_dir = (root / args.out_dir).resolve()
    out_dir.mkdir(parents=True, exist_ok=True)
    body_video = (root / args.body_video).resolve()
    frames_rgb = decode_video(video)
    body_frames_rgb = decode_video(body_video)

    prepared: list[tuple[np.ndarray, np.ndarray, float, float, float]] = []
    weapon_body_heights: list[float] = []
    for source_index in SOURCE_FRAMES:
        weapon_rgb = frames_rgb[source_index]
        weapon_subject = foreground_mask(weapon_rgb)
        sword_mask, grip, angle = sword_geometry(weapon_rgb, weapon_subject)
        weapon_body = body_rgba(weapon_rgb, weapon_subject, sword_mask)
        weapon_root_x, weapon_foot_y, _ = root_anchor(weapon_body[:, :, 3])
        weapon_body_heights.append(root_anchor(weapon_body[:, :, 3])[2])

        if body_video == video:
            rgba = weapon_body
        else:
            body_rgb = body_frames_rgb[source_index]
            body_subject = foreground_mask(body_rgb)
            rgba = keyed_rgba(body_rgb, body_subject)
        prepared.append((rgba, grip, angle, weapon_root_x, weapon_foot_y))

    idle_head_height, run_head_height, _ = reference_head_heights(root)
    source_head_heights = [head_height(item[0]) for item in prepared]
    source_body_heights = [root_anchor(item[0][:, :, 3])[2] for item in prepared]
    source_scale = TARGET_EFFECTIVE_BODY_HEIGHT / max(1.0, float(np.median(source_body_heights)))
    weapon_scale = TARGET_EFFECTIVE_BODY_HEIGHT / max(1.0, float(np.median(weapon_body_heights)))
    output_frames: list[np.ndarray] = []
    track: list[dict[str, float]] = []
    removed_green_pixels = 0
    head_outline_pixels = 0
    thrust_blur = [1.0, 1.0, 1.5, 2.0, 3.0, 4.0, 5.5, 7.0, 8.0, 7.0, 5.0, 3.0, 2.0, 1.0, 1.0]
    thrust_stretch = [1.0, 1.0, 1.0, 1.01, 1.02, 1.035, 1.05, 1.06, 1.06, 1.05, 1.04, 1.025, 1.01, 1.0, 1.0]

    for i, (rgba, grip, angle, weapon_root_x, weapon_foot_y) in enumerate(prepared):
        normalized, normalized_grip = normalize_frame(rgba, grip, source_scale)
        normalized, removed_count = remove_green_residue(normalized)
        normalized, outlined_count = neutralize_monochrome_and_outline_head(normalized)
        removed_green_pixels += removed_count
        head_outline_pixels += outlined_count
        if body_video == video:
            weapon_tx = TARGET_ROOT_X - weapon_root_x * weapon_scale
            weapon_ty = TARGET_FOOT_Y - weapon_foot_y * weapon_scale
            normalized_grip = grip * weapon_scale + np.array([weapon_tx, weapon_ty])
            runtime_rotation = 90.0 + angle
        else:
            normalized_grip = forward_hand_anchor(normalized)
            # The new action is a carried horizontal thrust, not the former
            # overhead 180-degree sweep. A stable horizontal blade removes the
            # angle jitter produced by the generation video's rusty guide sword.
            runtime_rotation = 90.0
        output_frames.append(normalized)
        track.append({
            "offsetX": round((float(normalized_grip[0]) - FRAME_W / 2) * DISPLAY_SIZE / FRAME_W, 1),
            "offsetY": round((float(normalized_grip[1]) - FRAME_H / 2) * DISPLAY_SIZE / FRAME_H, 1),
            "rotation": round(runtime_rotation, 1),
            "scale": 1.5,
            "blurX": thrust_blur[i],
            "blurY": round(thrust_blur[i] * 0.35, 1),
            "stretchX": 1.0,
            "stretchY": thrust_stretch[i],
        })

    sheet = Image.new("RGBA", (FRAME_W * COLS, FRAME_H * ROWS), (0, 0, 0, 0))
    for i, frame in enumerate(output_frames):
        sheet.alpha_composite(Image.fromarray(frame, "RGBA"), ((i % COLS) * FRAME_W, (i // COLS) * FRAME_H))
    remaining_green_pixels = count_green_residue(np.asarray(sheet))
    if remaining_green_pixels:
        raise ValueError(f"green residue remains in output sheet: {remaining_green_pixels} pixels")
    sheet.save(out_dir / "dash_attack_thrust.png")
    make_contact(output_frames, out_dir / "dash_attack_thrust_contact.png")
    weapon_previews = composite_runtime_sword(root, output_frames, track)
    make_contact(weapon_previews, out_dir / "dash_attack_thrust_weapon_preview.png")
    debug_previews = composite_runtime_sword(root, output_frames, track, debug_grip=True)
    make_contact(debug_previews, out_dir / "dash_attack_thrust_weapon_grip_debug.png")
    for index in (0, 3, 7, 11, 14):
        Image.fromarray(debug_previews[index], "RGBA").save(
            out_dir / f"dash_attack_thrust_weapon_grip_f{index:02d}.png"
        )
    gif_frames = [Image.fromarray(frame, "RGBA") for frame in output_frames]
    gif_frames[0].save(
        out_dir / "dash_attack_thrust_preview.gif",
        save_all=True,
        append_images=gif_frames[1:],
        duration=40,
        loop=0,
        disposal=2,
    )
    (out_dir / "dash_attack_thrust_track.json").write_text(
        json.dumps({
            "sourceFrames": SOURCE_FRAMES,
            "sourceScale": source_scale,
            "scaleCalibration": {
                "metric": "effective-body-height-excluding-weapon",
                "idleHeadHeight": idle_head_height,
                "runMedianHeadHeight": run_head_height,
                "targetEffectiveBodyHeight": TARGET_EFFECTIVE_BODY_HEIGHT,
                "sourceMedianEffectiveBodyHeight": float(np.median(source_body_heights)),
                "sourceMedianHeadHeight": float(np.median(source_head_heights)),
                "targetFootY": TARGET_FOOT_Y,
            },
            "anchor": "grip",
            "trackSource": "visible-sword" if body_video == video else "body-forward-hand",
            "frames": track,
        }, indent=2),
        encoding="utf-8",
    )

    print(f"weapon_video_frames={len(frames_rgb)} body_video_frames={len(body_frames_rgb)} selected={SOURCE_FRAMES}")
    print(
        f"scale_body target={TARGET_EFFECTIVE_BODY_HEIGHT:.1f} "
        f"source={np.median(source_body_heights):.1f}; "
        f"heads idle={idle_head_height:.1f} run={run_head_height:.1f} "
        f"source={np.median(source_head_heights):.1f} "
        f"source_scale={source_scale:.6f} foot_y={TARGET_FOOT_Y:.1f}"
    )
    print(f"removed_green_pixels={removed_green_pixels}")
    print(f"remaining_green_pixels={remaining_green_pixels}")
    print(f"sheet={out_dir / 'dash_attack_thrust.png'}")
    print(f"track={out_dir / 'dash_attack_thrust_track.json'}")
    print(f"head_outline_pixels={head_outline_pixels}")


if __name__ == "__main__":
    main()
