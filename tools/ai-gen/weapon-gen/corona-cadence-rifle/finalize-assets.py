"""Finalize the accepted Corona Cadence rifle into runtime, icon and tower assets."""

from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
RAW = HERE / "corona-cadence-rifle-imagegen-raw.png"
EQUIP = ROOT / "assets" / "weapons" / "corona-cadence-rifle-equip.png"
ICON = ROOT / "assets" / "icons" / "firearms" / "corona-cadence-rifle.png"
TOWER = ROOT / "assets" / "terrain" / "tower_barrel_weapon29.png"


def alpha_crop(image: Image.Image, threshold: int = 8) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > threshold)
    if len(xs) == 0:
        raise RuntimeError("ImageGen returned an empty rifle mask")
    return image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def build_runtime(raw: Image.Image) -> Image.Image:
    weapon = alpha_crop(raw)
    target_width = round(2048 * 0.92)
    scale = target_width / weapon.width
    weapon = weapon.resize((target_width, max(1, round(weapon.height * scale))), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (2048, 2048), (0, 0, 0, 0))
    canvas.alpha_composite(weapon, ((2048 - weapon.width) // 2, round(2048 * 0.54 - weapon.height / 2)))
    return canvas


def build_icon(runtime: Image.Image) -> Image.Image:
    weapon = alpha_crop(runtime)
    alpha = weapon.getchannel("A")
    rgb = ImageEnhance.Sharpness(ImageEnhance.Contrast(weapon.convert("RGB")).enhance(1.06)).enhance(1.12)
    weapon = Image.merge("RGBA", (*rgb.split(), alpha))
    weapon = alpha_crop(weapon.rotate(35, resample=Image.Resampling.BICUBIC, expand=True))
    scale = round(1536 * 0.90) / max(weapon.size)
    weapon = weapon.resize(tuple(max(1, round(v * scale)) for v in weapon.size), Image.Resampling.LANCZOS)
    weapon = alpha_crop(weapon)
    canvas = Image.new("RGBA", (1536, 1536), (0, 0, 0, 0))
    x, y = (1536 - weapon.width) // 2, (1536 - weapon.height) // 2
    alpha = weapon.getchannel("A")
    rim_alpha = ImageChops.subtract(alpha.filter(ImageFilter.MaxFilter(7)), alpha).point(lambda v: round(v * 0.40))
    rim = Image.new("RGBA", weapon.size, (255, 153, 45, 0))
    rim.putalpha(rim_alpha)
    canvas.alpha_composite(rim, (x, y))
    canvas.alpha_composite(weapon, (x, y))
    return canvas


def build_tower(runtime: Image.Image) -> Image.Image:
    weapon = alpha_crop(runtime)
    cut = alpha_crop(weapon.crop((round(weapon.width * 0.60), 0, weapon.width, weapon.height)))
    scale = 625 / cut.width
    cut = cut.resize((625, max(1, round(cut.height * scale))), Image.Resampling.LANCZOS)
    if cut.height > 300:
        cut = cut.resize((round(cut.width * 300 / cut.height), 300), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (625, 300), (0, 0, 0, 0))
    canvas.alpha_composite(cut, (0, (300 - cut.height) // 2))
    return canvas


def main() -> None:
    runtime = build_runtime(Image.open(RAW).convert("RGBA"))
    icon = build_icon(runtime)
    tower = build_tower(runtime)
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
