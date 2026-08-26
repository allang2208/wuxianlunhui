"""Build diagonal inventory icons from the user's cleaned transparent sources."""

from __future__ import annotations

from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[3]
CANVAS = 1536
TARGET = round(CANVAS * 0.90)
ALPHA_THRESHOLD = 8
ROTATION_DEGREES = 35

JOBS = {
    "stg44": (
        ROOT / "tools/ai-gen/_new_rifles_20260826/generated/stg44-imagegen.png",
        ROOT / "assets/icons/firearms/stg44.png",
    ),
    "qbz95": (
        ROOT / "tools/ai-gen/_new_rifles_20260826/generated/qbz95-imagegen.png",
        ROOT / "assets/icons/firearms/qbz-95.png",
    ),
}


def alpha_crop(image: Image.Image) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > ALPHA_THRESHOLD)
    if len(xs) == 0:
        raise RuntimeError("source has no visible alpha-bearing pixels")
    return image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def build_icon(source: Path, output: Path) -> None:
    weapon = alpha_crop(Image.open(source).convert("RGBA"))

    # Only modest presentation grading; the user's cleaned pixels and alpha stay authoritative.
    alpha = weapon.getchannel("A")
    rgb = ImageEnhance.Contrast(weapon.convert("RGB")).enhance(1.05)
    rgb = ImageEnhance.Sharpness(rgb).enhance(1.10)
    weapon = Image.merge("RGBA", (*rgb.split(), alpha))

    weapon = weapon.rotate(ROTATION_DEGREES, resample=Image.Resampling.BICUBIC, expand=True)
    weapon = alpha_crop(weapon)
    scale = TARGET / max(weapon.size)
    resized = tuple(max(1, round(value * scale)) for value in weapon.size)
    weapon = weapon.resize(resized, Image.Resampling.LANCZOS)
    weapon = alpha_crop(weapon)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - weapon.width) // 2
    y = (CANVAS - weapon.height) // 2

    # Match the cool readable rim used by the existing firearm inventory icons.
    alpha = weapon.getchannel("A")
    expanded = alpha.filter(ImageFilter.MaxFilter(5))
    rim_alpha = ImageChops.subtract(expanded, alpha).point(lambda value: round(value * 0.30))
    rim = Image.new("RGBA", weapon.size, (46, 137, 225, 0))
    rim.putalpha(rim_alpha)
    canvas.alpha_composite(rim, (x, y))
    canvas.alpha_composite(weapon, (x, y))

    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, optimize=True)

    bbox = canvas.getchannel("A").getbbox()
    print(f"{output.relative_to(ROOT)}: {canvas.size[0]}x{canvas.size[1]}, alpha_bbox={bbox}")


def main() -> None:
    for source, output in JOBS.values():
        build_icon(source, output)


if __name__ == "__main__":
    main()
