"""Finalize the accepted Zero Point Arbitrator render into runtime, icon and tower assets."""

from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
RAW = HERE / "zero-point-arbitrator-imagegen-raw.png"
EQUIP = ROOT / "assets" / "weapons" / "zero-point-arbitrator-equip.png"
ICON = ROOT / "assets" / "icons" / "firearms" / "zero-point-arbitrator.png"
TOWER = ROOT / "assets" / "terrain" / "tower_barrel_weapon28.png"


def alpha_crop(image: Image.Image, threshold: int = 8) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > threshold)
    if len(xs) == 0:
        raise RuntimeError("ImageGen returned an empty rifle mask")
    return image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def fit(image: Image.Image, canvas_size: int, width_ratio: float, center_y: float) -> Image.Image:
    weapon = alpha_crop(image)
    target_width = round(canvas_size * width_ratio)
    scale = target_width / weapon.width
    weapon = weapon.resize((target_width, max(1, round(weapon.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    canvas.alpha_composite(weapon, ((canvas_size - weapon.width) // 2, round(canvas_size * center_y - weapon.height / 2)))
    return canvas


def build_icon(runtime: Image.Image) -> Image.Image:
    weapon = alpha_crop(runtime)
    alpha = weapon.getchannel("A")
    rgb = ImageEnhance.Sharpness(ImageEnhance.Contrast(weapon.convert("RGB")).enhance(1.06)).enhance(1.12)
    weapon = Image.merge("RGBA", (*rgb.split(), alpha))
    weapon = alpha_crop(weapon.rotate(35, resample=Image.Resampling.BICUBIC, expand=True))
    canvas_size = 1536
    scale = round(canvas_size * 0.90) / max(weapon.size)
    weapon = weapon.resize(tuple(max(1, round(v * scale)) for v in weapon.size), Image.Resampling.LANCZOS)
    weapon = alpha_crop(weapon)
    canvas = Image.new("RGBA", (canvas_size, canvas_size), (0, 0, 0, 0))
    x, y = (canvas_size - weapon.width) // 2, (canvas_size - weapon.height) // 2
    alpha = weapon.getchannel("A")
    rim_alpha = ImageChops.subtract(alpha.filter(ImageFilter.MaxFilter(7)), alpha).point(lambda v: round(v * 0.38))
    rim = Image.new("RGBA", weapon.size, (226, 66, 216, 0))
    rim.putalpha(rim_alpha)
    canvas.alpha_composite(rim, (x, y))
    canvas.alpha_composite(weapon, (x, y))
    return canvas


def build_tower_barrel(runtime: Image.Image) -> Image.Image:
    weapon = alpha_crop(runtime)
    cut = weapon.crop((round(weapon.width * 0.60), 0, weapon.width, weapon.height))
    cut = alpha_crop(cut)
    scale = 625 / cut.width
    cut = cut.resize((625, max(1, round(cut.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (625, 300), (0, 0, 0, 0))
    if cut.height > 300:
        cut = cut.resize((round(cut.width * 300 / cut.height), 300), Image.Resampling.LANCZOS)
    canvas.alpha_composite(cut, (0, (300 - cut.height) // 2))
    return canvas


def main() -> None:
    raw = Image.open(RAW).convert("RGBA")
    runtime = fit(raw, 2048, 0.92, 0.54)
    icon = build_icon(runtime)
    tower = build_tower_barrel(runtime)
    for path in (EQUIP, ICON, TOWER):
        path.parent.mkdir(parents=True, exist_ok=True)
    runtime.save(EQUIP, optimize=True)
    icon.save(ICON, optimize=True)
    tower.save(TOWER, optimize=True)
    print(f"runtime={EQUIP.relative_to(ROOT)} bbox={runtime.getchannel('A').getbbox()}")
    print(f"icon={ICON.relative_to(ROOT)} bbox={icon.getchannel('A').getbbox()}")
    print(f"tower={TOWER.relative_to(ROOT)} bbox={tower.getchannel('A').getbbox()}")


if __name__ == "__main__":
    main()
