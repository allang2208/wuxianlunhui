"""Finalize the two original legendary LMGs and their modification icons."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[4]
HERE = Path(__file__).resolve().parent

WEAPONS = {
    "celestial-cartographer-lmg": {
        "runtime": ROOT / "assets" / "weapons" / "celestial-cartographer-lmg-equip.png",
        "tower": ROOT / "assets" / "terrain" / "tower_barrel_weapon37.png",
    },
    "grave-covenant-cantor-lmg": {
        "runtime": ROOT / "assets" / "weapons" / "grave-covenant-cantor-lmg-equip.png",
        "tower": ROOT / "assets" / "terrain" / "tower_barrel_weapon38.png",
    },
}

MODS = [
    "celestial_snapshot_astrolabe",
    "celestial_deep_exposure_dial",
    "celestial_wide_meridian_prism",
    "celestial_zenith_pinhole",
    "celestial_cold_afterglow_brake",
    "celestial_parallax_carry_relay",
    "litany_double_inscription_needle",
    "litany_gravestone_burin",
    "litany_congregation_dome",
    "litany_execution_clapper",
    "litany_soul_migration_tract",
    "litany_ember_gospel",
]

MOD_GROUPS = {
    "celestial-mod-preview.png": [
        ("celestial_snapshot_astrolabe", "SNAPSHOT ASTROLABE"),
        ("celestial_deep_exposure_dial", "DEEP EXPOSURE DIAL"),
        ("celestial_wide_meridian_prism", "WIDE MERIDIAN PRISM"),
        ("celestial_zenith_pinhole", "ZENITH PINHOLE"),
        ("celestial_cold_afterglow_brake", "COLD AFTERGLOW"),
        ("celestial_parallax_carry_relay", "PARALLAX RELAY"),
    ],
    "litany-mod-preview.png": [
        ("litany_double_inscription_needle", "DOUBLE INSCRIPTION"),
        ("litany_gravestone_burin", "GRAVESTONE BURIN"),
        ("litany_congregation_dome", "CONGREGATION DOME"),
        ("litany_execution_clapper", "EXECUTION CLAPPER"),
        ("litany_soul_migration_tract", "SOUL MIGRATION"),
        ("litany_ember_gospel", "EMBER GOSPEL"),
    ],
}


def alpha_crop(image: Image.Image, threshold: int = 8) -> Image.Image:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > threshold)
    if len(xs) == 0:
        raise RuntimeError("ImageGen returned an empty alpha mask")
    return image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))


def build_tower(runtime: Image.Image) -> Image.Image:
    weapon = alpha_crop(runtime)
    muzzle_section = alpha_crop(weapon.crop((round(weapon.width * 0.60), 0, weapon.width, weapon.height)))
    scale = min(625 / muzzle_section.width, 300 / muzzle_section.height)
    muzzle_section = muzzle_section.resize(
        tuple(max(1, round(value * scale)) for value in muzzle_section.size),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (625, 300), (0, 0, 0, 0))
    canvas.alpha_composite(muzzle_section, (0, (300 - muzzle_section.height) // 2))
    return canvas


def build_mod_icon(raw: Image.Image) -> Image.Image:
    module = alpha_crop(raw)
    side = max(module.size)
    square = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    square.alpha_composite(module, ((side - module.width) // 2, (side - module.height) // 2))
    return square.resize((256, 256), Image.Resampling.LANCZOS)


def save(path: Path, image: Image.Image) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, optimize=True)
    print(f"{path.relative_to(ROOT)} size={image.size} bbox={image.getchannel('A').getbbox()}")


def build_preview(entries: list[tuple[str, str]], icons: dict[str, Image.Image]) -> Image.Image:
    cell_w, cell_h = 256, 292
    preview = Image.new("RGB", (cell_w * 3, cell_h * 2), (12, 15, 22))
    draw = ImageDraw.Draw(preview)
    for index, (mod_id, label) in enumerate(entries):
        x = (index % 3) * cell_w
        y = (index // 3) * cell_h
        checker = (24, 29, 40) if (index + index // 3) % 2 == 0 else (19, 24, 34)
        draw.rectangle((x, y, x + cell_w - 1, y + cell_h - 1), fill=checker, outline=(74, 88, 112))
        preview.paste(icons[mod_id], (x, y), icons[mod_id])
        text_box = draw.textbbox((0, 0), label)
        draw.text((x + (cell_w - (text_box[2] - text_box[0])) // 2, y + 266), label, fill=(225, 231, 242))
    return preview


def main() -> None:
    for weapon_id, paths in WEAPONS.items():
        runtime = Image.open(paths["runtime"]).convert("RGBA")
        save(paths["tower"], build_tower(runtime))

    icons = {}
    for mod_id in MODS:
        raw = Image.open(HERE / "raw" / f"{mod_id}.png").convert("RGBA")
        icons[mod_id] = build_mod_icon(raw)
        save(ROOT / "assets" / "icons" / "craft-cold-steel" / f"{mod_id}.png", icons[mod_id])
    for filename, entries in MOD_GROUPS.items():
        output = HERE / filename
        output.parent.mkdir(parents=True, exist_ok=True)
        build_preview(entries, icons).save(output, optimize=True)
        print(f"{output.relative_to(ROOT)} size=768x584")


if __name__ == "__main__":
    main()
