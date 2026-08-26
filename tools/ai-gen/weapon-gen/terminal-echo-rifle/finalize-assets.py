"""Finalize Terminal Echo rifle and its four unique modification cards."""

from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent
RAW = HERE / "terminal-echo-rifle-imagegen-raw.png"
EQUIP = ROOT / "assets" / "weapons" / "terminal-echo-rifle-equip.png"
ICON = ROOT / "assets" / "icons" / "firearms" / "terminal-echo-rifle.png"
TOWER = ROOT / "assets" / "terrain" / "tower_barrel_weapon30.png"
MOD_RAWS = {
    "terminal_convergence_core": HERE / "terminal-convergence-core-raw.png",
    "terminal_overdrive_core": HERE / "terminal-overdrive-core-raw.png",
    "terminal_feedback_grip": HERE / "terminal-feedback-grip-raw.png",
    "terminal_singularity_mag": HERE / "terminal-singularity-mag-raw.png",
}


def alpha_crop(image: Image.Image, threshold: int = 8) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > threshold)
    if len(xs) == 0:
        raise RuntimeError("ImageGen returned an empty alpha mask")
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
    rim_alpha = ImageChops.subtract(alpha.filter(ImageFilter.MaxFilter(7)), alpha).point(lambda v: round(v * 0.42))
    rim = Image.new("RGBA", weapon.size, (80, 220, 255, 0))
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


def build_mod_card(raw: Image.Image) -> Image.Image:
    card = alpha_crop(raw)
    side = max(card.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(card, ((side - card.width) // 2, (side - card.height) // 2))
    return square.resize((256, 256), Image.Resampling.LANCZOS)


def main() -> None:
    runtime = build_runtime(Image.open(RAW).convert("RGBA"))
    outputs = {
        EQUIP: runtime,
        ICON: build_icon(runtime),
        TOWER: build_tower(runtime),
    }
    for key, raw_path in MOD_RAWS.items():
        outputs[ROOT / "assets" / "icons" / "craft-cold-steel" / f"{key}.png"] = build_mod_card(Image.open(raw_path).convert("RGBA"))
    for path, image in outputs.items():
        path.parent.mkdir(parents=True, exist_ok=True)
        image.save(path, optimize=True)
        print(f"{path.relative_to(ROOT)} size={image.size} bbox={image.getchannel('A').getbbox()}")


if __name__ == "__main__":
    main()
