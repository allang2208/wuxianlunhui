#!/usr/bin/env python3
"""Derive a small right-facing pounce reference from rejected v01 source f60."""

from __future__ import annotations

import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
TOOLS_DIR = ROOT.parent
if str(TOOLS_DIR) not in sys.path:
    sys.path.insert(0, str(TOOLS_DIR))

from rmbg_cutout import get_model, predict_alpha  # noqa: E402


VIDEO = ROOT / "videos" / "pounce-doubao-v01.mp4"
OUTPUT = ROOT / "references" / "werewolf-king-pounce-v02-directional-safe-1024x576.png"
SOURCE_FRAME = 48


def decode_frame() -> np.ndarray:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        for index, frame in enumerate(container.decode(stream)):
            if index == SOURCE_FRAME:
                return np.asarray(frame.to_image().convert("RGB"))
    raise RuntimeError(f"source frame {SOURCE_FRAME} missing")


def main_actor_alpha(raw: np.ndarray) -> np.ndarray:
    alpha = np.asarray(raw).squeeze()
    if alpha.dtype != np.uint8:
        if float(alpha.max()) <= 1.0:
            alpha = alpha * 255.0
        alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    alpha[alpha <= 3] = 0
    count, labels, stats, _ = cv2.connectedComponentsWithStats(
        (alpha > 12).astype(np.uint8), 8
    )
    if count <= 1:
        raise RuntimeError("BiRefNet produced no foreground")
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate((labels == main).astype(np.uint8), np.ones((5, 5), np.uint8)) > 0
    alpha[~keep] = 0
    return alpha


def decontaminate_white(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    output = rgb.astype(np.float32).copy()
    a = alpha.astype(np.float32) / 255.0
    semi = (a > 0.01) & (a < 0.995)
    if semi.any():
        inverse = 1.0 - a[semi]
        foreground = (output[semi] - inverse[:, None] * 255.0) / np.maximum(
            a[semi][:, None], 1e-3
        )
        output[semi] = np.clip(foreground, 0, 255)
    output[alpha == 0] = 0
    return np.clip(output, 0, 255).astype(np.uint8)


def main() -> None:
    rgb = decode_frame()
    alpha = main_actor_alpha(predict_alpha(get_model(), Image.fromarray(rgb, "RGB")))
    ys, xs = np.where(alpha > 12)
    if not xs.size:
        raise RuntimeError("directional frame has no actor")
    margin = 8
    x0, y0 = max(0, int(xs.min()) - margin), max(0, int(ys.min()) - margin)
    x1 = min(rgb.shape[1], int(xs.max()) + 1 + margin)
    y1 = min(rgb.shape[0], int(ys.max()) + 1 + margin)
    clean_rgb = decontaminate_white(rgb, alpha)
    rgba = np.dstack([clean_rgb, alpha])[y0:y1, x0:x1]

    target_height = 240
    target_width = round(rgba.shape[1] * target_height / rgba.shape[0])
    subject = Image.fromarray(rgba, "RGBA").resize(
        (target_width, target_height), Image.Resampling.LANCZOS
    )
    canvas = Image.new("RGB", (1024, 576), "white")
    center_x = 250
    baseline_y = 470
    x = round(center_x - target_width / 2)
    y = baseline_y - target_height
    white = Image.new("RGB", subject.size, "white")
    white.paste(subject.convert("RGB"), mask=subject.getchannel("A"))
    canvas.paste(white, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT, quality=100)
    print(
        f"saved {OUTPUT} sourceFrame={SOURCE_FRAME} sourceBBox={(x0, y0, x1, y1)} "
        f"outputBBox={(x, y, x + target_width, baseline_y)}"
    )


if __name__ == "__main__":
    main()
