from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = Path(r"C:\Users\allan\.codex\generated_images\01a04632-078b-7121-b164-0711e1f08c99\exec-2480f55e-21bb-4c8f-b8c3-8afd34b04dd3.png")
MASK = ROOT / "poison-maggot-mother-v01-birefnet-mask.png"
OUTPUT = ROOT / "poison-maggot-mother-v01.png"
PREVIEW = ROOT / "poison-maggot-mother-v01-preview.png"

CANVAS = 1254
TARGET_WIDTH = 704  # about 56% of the canvas, leaving animation-safe margins


def main() -> None:
    rgb = np.asarray(Image.open(SOURCE).convert("RGB"), dtype=np.float32)
    alpha_u8 = np.asarray(Image.open(MASK).convert("L"), dtype=np.uint8)
    alpha = alpha_u8.astype(np.float32) / 255.0

    checker = np.asarray(((254, 254, 254), (245, 245, 245)), dtype=np.float32)
    distances = ((rgb[:, :, None, :] - checker[None, None, :, :]) ** 2).sum(axis=3)
    background = checker[distances.argmin(axis=2)]

    a = alpha[:, :, None]
    foreground = (rgb - (1.0 - a) * background) / np.maximum(a, 0.06)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    foreground[alpha_u8 == 0] = 0

    rgba = np.dstack((foreground, alpha_u8))
    ys, xs = np.where(alpha_u8 > 8)
    if not len(xs):
        raise RuntimeError("BiRefNet mask is empty")
    x0, x1 = int(xs.min()), int(xs.max()) + 1
    y0, y1 = int(ys.min()), int(ys.max()) + 1
    subject = Image.fromarray(rgba[y0:y1, x0:x1], "RGBA")

    target_height = max(1, round(subject.height * TARGET_WIDTH / subject.width))
    subject = subject.resize((TARGET_WIDTH, target_height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    canvas.alpha_composite(subject, ((CANVAS - TARGET_WIDTH) // 2, (CANVAS - target_height) // 2))

    pixels = np.asarray(canvas).copy()
    pixels[pixels[:, :, 3] == 0, :3] = 0
    final = Image.fromarray(pixels, "RGBA")
    final.save(OUTPUT)
    preview = Image.new("RGBA", (CANVAS, CANVAS), (72, 72, 78, 255))
    preview.alpha_composite(final)
    preview.convert("RGB").save(PREVIEW)
    print(f"saved {OUTPUT} subject={TARGET_WIDTH}x{target_height}")


if __name__ == "__main__":
    main()
