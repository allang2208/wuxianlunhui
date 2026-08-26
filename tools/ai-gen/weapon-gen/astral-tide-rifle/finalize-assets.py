"""Finalize the accepted Astral Tide rifle render into runtime and inventory assets."""

from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[4]
TOOLS = ROOT / "tools" / "ai-gen"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from rmbg_cutout import get_model, predict_alpha  # noqa: E402

HERE = Path(__file__).resolve().parent
RAW = HERE / "astral-tide-rifle-imagegen-raw.png"
ALPHA = HERE / "astral-tide-rifle-imagegen-alpha.png"
EQUIP = ROOT / "assets" / "weapons" / "astral-tide-rifle-equip.png"
ICON = ROOT / "assets" / "icons" / "firearms" / "astral-tide-rifle.png"


def alpha_crop(image: Image.Image, threshold: int = 8) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > threshold)
    if len(xs) == 0:
        raise RuntimeError("BiRefNet returned an empty rifle mask")
    return image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def build_runtime(cutout: Image.Image) -> Image.Image:
    weapon = alpha_crop(cutout)
    canvas_size = 2048
    target_width = round(canvas_size * 0.915)
    scale = target_width / weapon.width
    weapon = weapon.resize(
        (target_width, max(1, round(weapon.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    x = round(canvas_size * 0.5 - weapon.width / 2)
    y = round(canvas_size * 0.543 - weapon.height / 2)
    canvas.alpha_composite(weapon, (x, y))
    return canvas


def build_icon(runtime: Image.Image) -> Image.Image:
    weapon = alpha_crop(runtime)
    alpha = weapon.getchannel("A")
    rgb = ImageEnhance.Contrast(weapon.convert("RGB")).enhance(1.05)
    rgb = ImageEnhance.Sharpness(rgb).enhance(1.10)
    weapon = Image.merge("RGBA", (*rgb.split(), alpha))
    weapon = alpha_crop(weapon.rotate(35, resample=Image.Resampling.BICUBIC, expand=True))
    canvas_size = 1536
    target = round(canvas_size * 0.90)
    scale = target / max(weapon.size)
    weapon = weapon.resize(
        tuple(max(1, round(value * scale)) for value in weapon.size),
        Image.Resampling.LANCZOS,
    )
    weapon = alpha_crop(weapon)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    x = (canvas_size - weapon.width) // 2
    y = (canvas_size - weapon.height) // 2
    alpha = weapon.getchannel("A")
    expanded = alpha.filter(ImageFilter.MaxFilter(7))
    rim_alpha = ImageChops.subtract(expanded, alpha).point(lambda value: round(value * 0.34))
    rim = Image.new("RGBA", weapon.size, (82, 218, 229, 0))
    rim.putalpha(rim_alpha)
    canvas.alpha_composite(rim, (x, y))
    canvas.alpha_composite(weapon, (x, y))
    return canvas


def main() -> None:
    rgb = Image.open(RAW).convert("RGB")
    alpha_array = np.squeeze(np.asarray(predict_alpha(get_model(), rgb), dtype=np.uint8))
    alpha = Image.fromarray(alpha_array, "L")
    alpha.save(ALPHA)
    cutout = rgb.convert("RGBA")
    cutout.putalpha(alpha)
    runtime = build_runtime(cutout)
    icon = build_icon(runtime)
    EQUIP.parent.mkdir(parents=True, exist_ok=True)
    ICON.parent.mkdir(parents=True, exist_ok=True)
    runtime.save(EQUIP, optimize=True)
    icon.save(ICON, optimize=True)
    print(f"runtime={EQUIP.relative_to(ROOT)} bbox={runtime.getchannel('A').getbbox()}")
    print(f"icon={ICON.relative_to(ROOT)} bbox={icon.getchannel('A').getbbox()}")


if __name__ == "__main__":
    main()
