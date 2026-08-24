#!/usr/bin/env python3
"""Extract one video frame, remove its background with BiRefNet, and place it on white."""

import argparse
import sys
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))

from rmbg_cutout import get_model, predict_alpha


def decode_frame(video: Path, index: int) -> np.ndarray:
    container = av.open(str(video))
    stream = container.streams.video[0]
    for current, frame in enumerate(container.decode(stream)):
        if current == index:
            rgb = np.asarray(frame.to_image().convert("RGB"))
            container.close()
            return rgb
    container.close()
    raise RuntimeError(f"frame {index} is outside video")


def keep_subject(alpha: np.ndarray) -> np.ndarray:
    mask = (alpha > 12).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count <= 1:
        raise RuntimeError("BiRefNet found no subject")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = labels == largest
    clean = alpha.copy()
    clean[~keep] = 0
    clean[clean < 4] = 0
    return clean


def cutout(rgb: np.ndarray) -> Image.Image:
    model = get_model()
    alpha = np.squeeze(np.asarray(predict_alpha(model, Image.fromarray(rgb, "RGB"))))
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255.0
    alpha = keep_subject(np.clip(alpha, 0, 255).astype(np.uint8))

    # Reverse the white video matte on soft edges so the next I2V pass does not
    # inherit a pale halo around hair, cape, sword, or boots.
    clean_rgb = rgb.astype(np.float32)
    a = alpha.astype(np.float32) / 255.0
    semi = (a > 0.02) & (a < 0.98)
    if semi.any():
        af = a[semi, None]
        clean_rgb[semi] = np.clip((clean_rgb[semi] - (1.0 - af) * 255.0) / af, 0, 255)
    clean_rgb[a <= 0.02] = 0
    return Image.fromarray(np.dstack([clean_rgb.astype(np.uint8), alpha]), "RGBA")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--frame", type=int, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--out-alpha", type=Path)
    parser.add_argument("--size", type=int, default=1024)
    parser.add_argument("--content-ratio", type=float, default=0.75)
    args = parser.parse_args()

    rgba = cutout(decode_frame(args.video, args.frame))
    bbox = rgba.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("cutout is empty")
    subject = rgba.crop(bbox)
    target_h = round(args.size * args.content_ratio)
    scale = target_h / subject.height
    target_w = round(subject.width * scale)
    if target_w > round(args.size * 0.80):
        scale = (args.size * 0.80) / subject.width
        target_w = round(subject.width * scale)
        target_h = round(subject.height * scale)
    subject = subject.resize((target_w, target_h), Image.Resampling.LANCZOS)
    x = (args.size - target_w) // 2
    y = (args.size - target_h) // 2

    if args.out_alpha:
        args.out_alpha.parent.mkdir(parents=True, exist_ok=True)
        alpha_canvas = Image.new("RGBA", (args.size, args.size), (0, 0, 0, 0))
        alpha_canvas.alpha_composite(subject, (x, y))
        alpha_canvas.save(args.out_alpha)

    canvas = Image.new("RGB", (args.size, args.size), "white")
    canvas.paste(subject.convert("RGB"), (x, y), subject.getchannel("A"))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(args.out)
    print(
        f"[video-reference] frame={args.frame} bbox={bbox} -> "
        f"content={target_w}x{target_h} at ({x},{y}) -> {args.out}"
    )


if __name__ == "__main__":
    main()

