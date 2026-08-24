#!/usr/bin/env python3
"""Build a same-pixel-scale Elise state contact sheet for visual size review.

Frames are translated onto a shared 640x640 canvas with the configured foot line
mapped to y=600. No frame is resized, so apparent body-size differences remain
visible while crouching and weapon arcs keep their authored pose.
"""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
SAMPLES = {
    "idle": [0],
    "walk": [0, 9, 19],
    "run": [0, 4, 9, 16],
    "attack": [0, 4, 7, 18, 27],
    "windmill": [0, 6, 12, 18, 20, 22],
    "defend": [0, 7, 12, 18],
}
CANVAS = 640
FOOT_Y = 600


def checker(size: int) -> Image.Image:
    yy, xx = np.indices((size, size))
    v = np.where((xx // 24 + yy // 24) % 2, 58, 82).astype(np.uint8)
    return Image.fromarray(np.repeat(v[..., None], 3, axis=2), "RGB").convert("RGBA")


def alpha_bbox(frame: Image.Image) -> tuple[int, int, int, int]:
    alpha = frame.getchannel("A").point(lambda value: 255 if value > 16 else 0)
    bbox = alpha.getbbox()
    if not bbox:
        raise RuntimeError("empty frame")
    return bbox


def torso_x(frame: Image.Image) -> float:
    arr = np.asarray(frame)
    mask = arr[..., 3] > 32
    ys, xs = np.where(mask)
    if not len(xs):
        return frame.width / 2
    top, bottom = int(ys.min()), int(ys.max())
    band_top = top + round((bottom - top + 1) * 0.30)
    band_bottom = top + round((bottom - top + 1) * 0.58)
    by, bx = np.where(mask[band_top:band_bottom + 1])
    return float(np.median(bx)) if len(bx) else float(np.median(xs))


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument(
        "--override", action="append", default=[], metavar="STATE=PATH",
        help="use a candidate sheet for one state without modifying runtime assets",
    )
    args = parser.parse_args()
    overrides = {}
    for value in args.override:
        if "=" not in value:
            raise RuntimeError("--override must use STATE=PATH")
        state, raw_path = value.split("=", 1)
        overrides[state] = Path(raw_path)

    config = json.loads((ROOT / "data" / "companion-config.json").read_text(encoding="utf-8"))
    elise = next(item for item in config["companions"] if item["id"] == "warrior_bruno")
    entries: list[tuple[str, int, Image.Image]] = []
    for state, indices in SAMPLES.items():
        spec = elise["animations"][state]
        sheet_path = overrides.get(state, ROOT / spec["src"])
        sheet = Image.open(sheet_path).convert("RGBA")
        fw, fh, cols = spec["frameWidth"], spec["frameHeight"], spec["cols"]
        source_foot = round(fh * 0.9375)
        for index in indices:
            x = (index % cols) * fw
            y = (index // cols) * fh
            frame = sheet.crop((x, y, x + fw, y + fh))
            bbox = alpha_bbox(frame)
            anchor_x = torso_x(frame)
            panel = checker(CANVAS)
            dx = round(CANVAS / 2 - anchor_x)
            dy = FOOT_Y - source_foot
            panel.alpha_composite(frame, (dx, dy))
            draw = ImageDraw.Draw(panel)
            draw.line((0, FOOT_Y, CANVAS, FOOT_Y), fill=(255, 190, 40, 180), width=2)
            draw.text((8, 8), f"{state} f{index}  h={bbox[3] - bbox[1]}", fill="white")
            entries.append((state, index, panel))

    thumb = 320
    cols = 5
    rows = math.ceil(len(entries) / cols)
    contact = Image.new("RGB", (cols * thumb, rows * thumb), "#20242a")
    for position, (_, _, panel) in enumerate(entries):
        preview = panel.convert("RGB").resize((thumb, thumb), Image.Resampling.LANCZOS)
        contact.paste(preview, ((position % cols) * thumb, (position // cols) * thumb))
    args.out.parent.mkdir(parents=True, exist_ok=True)
    contact.save(args.out)
    print(f"[elise-scale-contact] {len(entries)} frames -> {args.out}")


if __name__ == "__main__":
    main()
