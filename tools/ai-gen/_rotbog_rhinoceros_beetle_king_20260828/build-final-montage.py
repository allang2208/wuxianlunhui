#!/usr/bin/env python3
"""Create one directly viewable runtime-animation review GIF."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageSequence


ROOT = Path(__file__).resolve().parent
SOURCES = [
    ("IDLE", ROOT / "spritesheets/final-previews/idle/rotbog-idle-interpolated.gif"),
    ("MOVE", ROOT / "spritesheets/final-previews/walking/rotbog-walking-interpolated.gif"),
    ("HORN SWEEP", ROOT / "spritesheets/final-previews/attacking/rotbog-attacking-interpolated.gif"),
    ("CHARGE ROOT-LOCK", ROOT / "spritesheets/runtime/charge-preview/rotbog-charge-runtime-interpolated.gif"),
    ("BROOD COMMAND", ROOT / "spritesheets/final-previews/summon/rotbog-summon-interpolated.gif"),
    ("ELYTRA OPEN", ROOT / "spritesheets/final-previews/phase_open/rotbog-phase_open-interpolated.gif"),
    ("ENRAGED", ROOT / "spritesheets/final-previews/enraged_idle/rotbog-enraged_idle-interpolated.gif"),
    ("DEATH", ROOT / "spritesheets/final-previews/dying/rotbog-dying-interpolated.gif"),
]


def load_frames(path: Path) -> list[Image.Image]:
    with Image.open(path) as image:
        return [frame.convert("RGBA").copy() for frame in ImageSequence.Iterator(image)]


def fit(image: Image.Image, width: int, height: int) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > 4)
    if len(xs):
        image = image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    image.thumbnail((width, height), Image.Resampling.LANCZOS)
    return image


def main() -> None:
    animations = [(label, load_frames(path)) for label, path in SOURCES]
    tile_w, tile_h = 320, 260
    cols, rows = 4, 2
    output = []
    font = ImageFont.load_default()
    for step in range(36):
        yy, xx = np.indices((rows * tile_h, cols * tile_w))
        pattern = ((xx // 24 + yy // 24) & 1)[..., None]
        lo = np.array([52, 56, 61], dtype=np.uint8)
        hi = np.array([79, 84, 91], dtype=np.uint8)
        canvas = Image.fromarray(np.where(pattern, hi, lo).astype(np.uint8), "RGB").convert("RGBA")
        draw = ImageDraw.Draw(canvas)
        for index, (label, frames) in enumerate(animations):
            row, col = divmod(index, cols)
            frame_index = min(len(frames) - 1, round(step * (len(frames) - 1) / 35))
            subject = fit(frames[frame_index], tile_w - 20, tile_h - 42)
            x = col * tile_w + (tile_w - subject.width) // 2
            y = row * tile_h + 30 + (tile_h - 40 - subject.height) // 2
            canvas.alpha_composite(subject, (x, y))
            draw.rectangle((col * tile_w, row * tile_h, (col + 1) * tile_w, row * tile_h + 28), fill=(18, 21, 24, 220))
            draw.text((col * tile_w + 10, row * tile_h + 8), label, fill=(240, 232, 205, 255), font=font)
        output.append(canvas.convert("RGB"))
    out = ROOT / "previews" / "rotbog-all-actions-final.gif"
    out.parent.mkdir(parents=True, exist_ok=True)
    output[0].save(out, save_all=True, append_images=output[1:], duration=80,
                   loop=0, disposal=2, optimize=False)
    print(out)


if __name__ == "__main__":
    main()
