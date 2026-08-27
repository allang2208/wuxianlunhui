#!/usr/bin/env python3
"""Rebuild the accepted 512x516 H3 whirlwind-recover assets and provenance."""

from __future__ import annotations

import json
import argparse
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


W, H = 512, 516
FOOT_Y = 492
VISIBLE_H = 477


def decode(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    return [f.to_ndarray(format="rgb24") for f in container.decode(video=0)]


def keyed(rgb: np.ndarray) -> np.ndarray:
    r, g, b = [rgb[:, :, i].astype(np.int16) for i in range(3)]
    bg = (g > 80) & (g - r > 38) & (g - b > 38)
    mask = (~bg).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    kept = np.zeros_like(mask)
    for i in range(1, count):
        if stats[i, cv2.CC_STAT_AREA] >= 28:
            kept[labels == i] = 1
    alpha = cv2.GaussianBlur(kept * 255, (3, 3), 0.6)
    out = np.dstack((rgb.copy(), alpha.astype(np.uint8)))
    visible = alpha > 0
    gray = np.clip(
        out[:, :, :3].max(axis=2) * 0.78
        + (out[:, :, 0] * 0.2126 + out[:, :, 1] * 0.7152 + out[:, :, 2] * 0.0722) * 0.22,
        0, 255
    ).astype(np.uint8)
    out[:, :, 0][visible] = gray[visible]
    out[:, :, 1][visible] = gray[visible]
    out[:, :, 2][visible] = gray[visible]
    out[out[:, :, 3] <= 5] = 0
    return out


def normalize(rgba: np.ndarray) -> np.ndarray:
    yy, xx = np.where(rgba[:, :, 3] > 20)
    if not len(xx):
        raise ValueError("empty keyed frame")
    crop = rgba[yy.min():yy.max() + 1, xx.min():xx.max() + 1]
    scale = VISIBLE_H / crop.shape[0]
    width = max(1, round(crop.shape[1] * scale))
    resized = cv2.resize(crop, (width, VISIBLE_H), interpolation=cv2.INTER_LANCZOS4)
    canvas = np.zeros((H, W, 4), dtype=np.uint8)
    x = round(W / 2 - width / 2)
    y = FOOT_Y - VISIBLE_H
    x0, x1 = max(0, x), min(W, x + width)
    sx0, sx1 = x0 - x, x1 - x
    canvas[y:y + VISIBLE_H, x0:x1] = resized[:, sx0:sx1]
    return canvas


def split_hands(frame: np.ndarray, center, radius=(48, 38)) -> tuple[np.ndarray, np.ndarray]:
    yy, xx = np.mgrid[0:H, 0:W]
    centers = center if isinstance(center, list) else [center]
    zone = np.zeros((H, W), dtype=bool)
    for cx, cy in centers:
        zone |= ((xx - cx) / radius[0]) ** 2 + ((yy - cy) / radius[1]) ** 2 <= 1
    subject = frame[:, :, 3] > 0
    selected = zone & subject
    body = frame.copy()
    hand = np.zeros_like(frame)
    hand[selected] = frame[selected]
    body[selected] = 0
    return body, hand


def save_sheet(frames: list[np.ndarray], path: Path, cols: int, rows: int) -> None:
    sheet = Image.new("RGBA", (W * cols, H * rows), (0, 0, 0, 0))
    for i, frame in enumerate(frames):
        sheet.alpha_composite(Image.fromarray(frame, "RGBA"), ((i % cols) * W, (i // cols) * H))
    sheet.save(path)


def save_overview(video: Path, path: Path, count: int = 32, cols: int = 8) -> list[int]:
    decoded = decode(video)
    indices = np.linspace(0, len(decoded) - 1, count).round().astype(int).tolist()
    frames = [normalize(keyed(decoded[index])) for index in indices]
    rows = (count + cols - 1) // cols
    contact = Image.new("RGBA", (W * cols, H * rows), (28, 31, 36, 255))
    draw = ImageDraw.Draw(contact)
    for slot, (source_index, frame) in enumerate(zip(indices, frames)):
        x, y = (slot % cols) * W, (slot // cols) * H
        contact.alpha_composite(Image.fromarray(frame, "RGBA"), (x, y))
        draw.text((x + 8, y + 8), f"src{source_index}", fill="white")
    contact.save(path)
    return indices


def build(name: str, video: Path, formal: Path, preview_dir: Path, count: int, cols: int,
          hand_centers: list[tuple[float, float]], source_indices: list[int] | None = None,
          hand_radius: tuple[int, int] = (32, 26)) -> dict:
    decoded = decode(video)
    indices = source_indices or np.linspace(0, len(decoded) - 1, count).round().astype(int).tolist()
    frames = [normalize(keyed(decoded[i])) for i in indices]
    body, hand = [], []
    for frame, center in zip(frames, hand_centers):
        b, h = split_hands(frame, center, hand_radius)
        body.append(b)
        hand.append(h)
    save_sheet(frames, formal / f"{name}.png", cols, (count + cols - 1) // cols)
    save_sheet(body, formal / f"{name}_body.png", cols, (count + cols - 1) // cols)
    save_sheet(hand, formal / f"{name}_hand.png", cols, (count + cols - 1) // cols)
    preview = [Image.fromarray(frame, "RGBA") for frame in frames]
    preview[0].save(preview_dir / f"{name}_preview.gif", save_all=True, append_images=preview[1:],
                    duration=40, loop=0, disposal=2)
    contact = Image.new("RGBA", (W * cols, H * ((count + cols - 1) // cols)), (28, 31, 36, 255))
    draw = ImageDraw.Draw(contact)
    for i, frame in enumerate(preview):
        x, y = (i % cols) * W, (i // cols) * H
        contact.alpha_composite(frame, (x, y))
        draw.text((x + 8, y + 8), f"f{i:02d} src{indices[i]}", fill="white")
    contact.save(preview_dir / f"{name}_contact.png")
    return {
        "video": str(video),
        "sourceFrames": indices,
        "handCenters": [
            [[round(x, 2), round(y, 2)] for x, y in center]
            if isinstance(center, list) else [round(center[0], 2), round(center[1], 2)]
            for center in hand_centers
        ],
        "frameSize": [W, H],
        "footY": FOOT_Y,
        "visibleHeight": VISIBLE_H,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--inspect", action="store_true", help="save source-video overviews without replacing formal assets")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[2]
    scratch = root / "tools/ai-gen/_scratch/player_melee_refinement_20260825"
    formal = root / "assets/player"
    if args.inspect:
        inspected = {}
        video = scratch / "whirlwind_recover_h3_v2.mp4"
        if video.exists():
            inspected["recover"] = save_overview(video, scratch / "recover_v2_overview.png")
        print(json.dumps(inspected, indent=2))
        return
    recover_centers = [
        [(132, 39), (338, 48)], [(140, 43), (340, 50)], [(150, 49), (340, 57)],
        [(160, 61), (342, 66)], [(174, 78), (342, 82)], [(180, 98), (342, 102)],
        [(171, 124), (346, 124)], [(160, 151), (350, 153)], [(148, 178), (354, 180)],
        [(153, 204), (352, 207)], [(176, 231), (340, 233)], [(195, 258), (320, 260)],
        [(207, 282), (302, 282)],
    ]
    report = {
        "generator": "MiniMax H3 first/last frame I2V on RTX 5080",
        "seeds": {"whirlwind_recover": 25082512},
    }
    # The v2 124-frame source has one clean continuous recovery in src0..60,
    # followed by a held idle. Sample that action uniformly into the 520ms runtime settle.
    report["whirlwind_recover"] = build(
        "whirlwind_recover", scratch / "whirlwind_recover_h3_v2.mp4", formal, scratch,
        13, 5, recover_centers, list(range(0, 61, 5)), (25, 23)
    )
    (scratch / "provenance.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")
    print(json.dumps(report, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
