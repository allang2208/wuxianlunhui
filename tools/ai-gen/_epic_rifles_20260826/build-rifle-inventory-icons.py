"""Build diagonal 1536px inventory icons from finalized rifle equipment textures."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[3]
CANVAS = 1536
TARGET = round(CANVAS * 0.90)
ALPHA_THRESHOLD = 8
ROTATION_DEGREES = 35

JOBS = {
    ROOT / "assets/weapons/frontier-rifle-equip.png": ROOT / "assets/icons/firearms/frontier-rifle.png",
    ROOT / "assets/weapons/vengeance-rifle-equip.png": ROOT / "assets/icons/firearms/vengeance-rifle.png",
}


def alpha_crop(image: Image.Image) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > ALPHA_THRESHOLD)
    if len(xs) == 0:
        raise RuntimeError("source has no visible alpha-bearing pixels")
    return image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def build_icon(source: Path, output: Path) -> None:
    weapon = alpha_crop(Image.open(source).convert("RGBA"))
    alpha = weapon.getchannel("A")
    rgb = ImageEnhance.Contrast(weapon.convert("RGB")).enhance(1.05)
    rgb = ImageEnhance.Sharpness(rgb).enhance(1.10)
    weapon = Image.merge("RGBA", (*rgb.split(), alpha))
    weapon = alpha_crop(weapon.rotate(ROTATION_DEGREES, resample=Image.Resampling.BICUBIC, expand=True))
    scale = TARGET / max(weapon.size)
    weapon = weapon.resize(tuple(max(1, round(v * scale)) for v in weapon.size), Image.Resampling.LANCZOS)
    weapon = alpha_crop(weapon)

    canvas = Image.new("RGBA", (CANVAS, CANVAS), (0, 0, 0, 0))
    x = (CANVAS - weapon.width) // 2
    y = (CANVAS - weapon.height) // 2
    alpha = weapon.getchannel("A")
    expanded = alpha.filter(ImageFilter.MaxFilter(5))
    rim_alpha = ImageChops.subtract(expanded, alpha).point(lambda value: round(value * 0.30))
    rim = Image.new("RGBA", weapon.size, (126, 68, 214, 0))
    rim.putalpha(rim_alpha)
    canvas.alpha_composite(rim, (x, y))
    canvas.alpha_composite(weapon, (x, y))
    output.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(output, optimize=True)
    print(f"{output.relative_to(ROOT)} alpha_bbox={canvas.getchannel('A').getbbox()}")


for source, output in JOBS.items():
    build_icon(source, output)
