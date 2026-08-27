#!/usr/bin/env python3
"""Convert the accepted H3 vine clip into a fixed-anchor transparent one-shot sheet."""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
VIDEO = ROOT / "vfx" / "vine-entangle-h3.mp4"
OUT_DIR = ROOT / "vfx" / "generated" / "raw"
PREVIEW_DIR = ROOT / "vfx" / "previews" / "raw"
SHEET = OUT_DIR / "vine-entangle.png"
CELL = 512
FOOT_Y = 492
COLS = 6
SOURCE_SEQUENCE = [0, 8, 16, 25, 33, 41, 49, 57, 66, 74, 74, 74, 74, 74, 74, 107, 115, 123]
MAGENTA = np.array([255.0, 0.0, 255.0], dtype=np.float32)


def load_rmbg():
    path = REPO / "tools" / "ai-gen" / "rmbg_cutout.py"
    spec = importlib.util.spec_from_file_location("vine_rmbg", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot import {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def decode() -> list[Image.Image]:
    frames = []
    with av.open(str(VIDEO)) as container:
        for frame in container.decode(video=0):
            frames.append(frame.to_image().convert("RGB"))
    if len(frames) != 124:
        raise ValueError(f"expected 124 H3 frames, got {len(frames)}")
    return frames


def largest_alpha(alpha: np.ndarray) -> np.ndarray:
    binary = (alpha >= 128).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(binary, 8)
    if count <= 1:
        return np.zeros_like(alpha, dtype=np.uint8)
    label = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = (labels == label).astype(np.uint8) * 255
    return mask


def bbox(alpha: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(alpha > 0)
    if not len(xs):
        raise ValueError("empty vine frame")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def decontaminate(rgb: np.ndarray, soft_alpha: np.ndarray) -> np.ndarray:
    a = soft_alpha.astype(np.float32)[..., None] / 255.0
    foreground = (rgb.astype(np.float32) - MAGENTA * (1.0 - a)) / np.maximum(a, 0.05)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    foreground[a[..., 0] <= 0.01] = 0
    return foreground


def checkerboard(size: tuple[int, int]) -> Image.Image:
    image = Image.new("RGB", size, (224, 224, 224))
    draw = ImageDraw.Draw(image)
    tile = 24
    for y in range(0, size[1], tile):
        for x in range(0, size[0], tile):
            if (x // tile + y // tile) % 2:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(184, 184, 184))
    return image


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    frames = decode()
    rmbg = load_rmbg()
    model = rmbg.get_model()
    unique_indices = sorted(set(SOURCE_SEQUENCE))
    cutouts: dict[int, Image.Image] = {}
    boxes = {}
    for count, index in enumerate(unique_indices, 1):
        image = frames[index]
        soft_alpha = np.asarray(rmbg.predict_alpha(model, image), dtype=np.uint8)
        hard_alpha = largest_alpha(soft_alpha)
        rgb = decontaminate(np.asarray(image, dtype=np.uint8), soft_alpha)
        rgb[hard_alpha == 0] = 0
        rgba = Image.fromarray(np.dstack([rgb, hard_alpha]), "RGBA")
        cutouts[index] = rgba
        boxes[index] = bbox(hard_alpha)
        print(f"[vine-entangle] BiRefNet {count}/{len(unique_indices)} frame={index}", flush=True)

    max_height = max(y1 - y0 for _, y0, _, y1 in boxes.values())
    scale = 438 / max_height
    normalized = []
    for sequence_index, source_index in enumerate(SOURCE_SEQUENCE):
        x0, y0, x1, y1 = boxes[source_index]
        subject = cutouts[source_index].crop((x0, y0, x1, y1))
        size = (max(1, round(subject.width * scale)), max(1, round(subject.height * scale)))
        subject = subject.resize(size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        canvas.alpha_composite(subject, ((CELL - size[0]) // 2, FOOT_Y - size[1]))
        # 最后三帧逐步透明，确保一次性束缚特效完全退场。
        if sequence_index >= len(SOURCE_SEQUENCE) - 3:
            fade = [0.72, 0.34, 0.08][sequence_index - (len(SOURCE_SEQUENCE) - 3)]
            alpha = np.asarray(canvas.getchannel("A"), dtype=np.float32)
            canvas.putalpha(Image.fromarray(np.clip(alpha * fade, 0, 255).astype(np.uint8), "L"))
            arr = np.asarray(canvas, dtype=np.uint8).copy()
            arr[arr[..., 3] == 0, :3] = 0
            canvas = Image.fromarray(arr, "RGBA")
        normalized.append(canvas)

    rows = math.ceil(len(normalized) / COLS)
    sheet = Image.new("RGBA", (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for index, frame in enumerate(normalized):
        sheet.alpha_composite(frame, ((index % COLS) * CELL, (index // COLS) * CELL))
    sheet.save(SHEET)

    preview_frames = []
    for frame in normalized:
        bg = checkerboard((CELL, CELL))
        bg.paste(frame, mask=frame.getchannel("A"))
        preview_frames.append(bg.resize((256, 256), Image.Resampling.LANCZOS))
    gif = PREVIEW_DIR / "vine-entangle.gif"
    preview_frames[0].save(gif, save_all=True, append_images=preview_frames[1:], duration=167, loop=0)
    contact = checkerboard((COLS * 256, rows * 256))
    for index, frame in enumerate(preview_frames):
        contact.paste(frame, ((index % COLS) * 256, (index // COLS) * 256))
    contact.save(PREVIEW_DIR / "vine-entangle-contact.png")

    manifest = {
        "sourceVideo": str(VIDEO.relative_to(ROOT)),
        "pipeline": "MiniMax H3 t2v -> BiRefNet-general -> fixed scale/foot anchor -> authored hold and terminal alpha fade",
        "sourceFrames": SOURCE_SEQUENCE,
        "file": str(SHEET.relative_to(ROOT)),
        "frameWidth": CELL,
        "frameHeight": CELL,
        "columns": COLS,
        "rows": rows,
        "frameCount": len(normalized),
        "frameRate": 6,
        "durationMs": len(normalized) / 6 * 1000,
        "footY": FOOT_Y,
        "repeat": 0,
        "transparentRgbZeroed": True,
    }
    (ROOT / "vfx" / "raw-sheet-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
