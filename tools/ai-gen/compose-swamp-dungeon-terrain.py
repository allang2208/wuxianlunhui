"""Install swamp-dungeon renders and derive the seamless wet-mud base."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps


REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "tools" / "ai-gen" / "_swamp_dungeon_terrain_20260826"
ASSETS = REPO / "assets" / "terrain"
PROP_ASSETS = ASSETS / "swamp-dungeon-props"


def clean_alpha(image: Image.Image, threshold=6) -> Image.Image:
    image = image.convert("RGBA")
    alpha = image.getchannel("A").point(lambda value: 0 if value <= threshold else value)
    image.putalpha(alpha)
    return image


def feather_diamond_edges(image: Image.Image, band=0.18) -> Image.Image:
    image = image.convert("RGBA")
    alpha = image.getchannel("A")
    mask = Image.new("L", image.size, 0)
    pixels = mask.load()
    for y in range(image.height):
        ny = abs((y + 0.5 - image.height / 2) / (image.height / 2))
        for x in range(image.width):
            nx = abs((x + 0.5 - image.width / 2) / (image.width / 2))
            inside = max(0.0, 1.0 - nx - ny)
            feather = min(1.0, inside / max(0.001, band))
            pixels[x, y] = round(255 * feather * feather * (3 - 2 * feather))
    image.putalpha(Image.composite(alpha, Image.new("L", image.size, 0), mask))
    return image


def build_wet_mud_base() -> Image.Image:
    source = Image.open(ASSETS / "floor_mud_seamless.png").convert("RGB").resize((1024, 1024))
    gray = ImageOps.grayscale(source).filter(ImageFilter.GaussianBlur(1.2))
    gray = ImageEnhance.Contrast(gray).enhance(0.70)
    base = ImageOps.colorize(gray, black=(12, 17, 10), white=(78, 76, 35), mid=(36, 43, 20))
    base = ImageEnhance.Brightness(base).enhance(0.78)
    # A blurred luminance copy supplies broad damp pools without new directional lines;
    # source is seamless, so every deterministic transform remains seamless.
    broad = gray.filter(ImageFilter.GaussianBlur(24))
    water = ImageOps.colorize(broad, black=(5, 15, 13), white=(32, 49, 29)).convert("RGBA")
    water.putalpha(broad.point(lambda value: max(0, min(52, 52 - abs(value - 92) // 2))))
    return Image.alpha_composite(base.convert("RGBA"), water).convert("RGB")


def alpha_report(path: Path):
    image = Image.open(path).convert("RGBA")
    return {
        "path": str(path.relative_to(REPO)).replace("\\", "/"),
        "size": list(image.size),
        "alphaBBox": list(image.getchannel("A").getbbox() or ()),
        "alphaExtrema": list(image.getchannel("A").getextrema()),
    }


def main():
    manifest = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
    reports = []

    base_path = ASSETS / "floor_swamp_wet_seamless.png"
    build_wet_mud_base().save(base_path, optimize=True)
    reports.append(alpha_report(base_path))

    frames = []
    for name in manifest["tiles"]:
        frame = clean_alpha(Image.open(SOURCE / "tile_frames" / f"{name}.png"))
        frame = clean_alpha(feather_diamond_edges(frame.resize((128, 64), Image.Resampling.LANCZOS)))
        frames.append(frame)
    atlas = Image.new("RGBA", (128 * len(frames), 64), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.alpha_composite(frame, (index * 128, 0))
    atlas_path = ASSETS / "swamp_dungeon_detail_tiles.png"
    atlas.save(atlas_path, optimize=True)
    reports.append(alpha_report(atlas_path))

    PROP_ASSETS.mkdir(parents=True, exist_ok=True)
    installed_props = []
    for name in manifest["props"]:
        path = PROP_ASSETS / f"{name}.png"
        clean_alpha(Image.open(SOURCE / "props" / f"{name}.png")).save(path, optimize=True)
        installed_props.append(path)
        reports.append(alpha_report(path))

    preview = Image.new("RGB", (960, 720), (16, 19, 14))
    preview.paste(Image.open(base_path).convert("RGB").resize((960, 240)), (0, 0))
    draw = ImageDraw.Draw(preview)
    for index, path in enumerate(installed_props):
        image = Image.open(path).convert("RGBA")
        image.thumbnail((148, 138), Image.Resampling.LANCZOS)
        cell_x = (index % 6) * 160
        cell_y = 240 + (index // 6) * 160
        preview.paste(image, (cell_x + (160 - image.width) // 2,
                              cell_y + (140 - image.height) // 2), image)
        draw.text((cell_x + 6, cell_y + 140),
                  path.stem.replace("swamp_prop_", "").replace("_", " "), fill=(205, 211, 178))
    preview_path = SOURCE / "preview.png"
    preview.save(preview_path, optimize=True)

    (SOURCE / "install-report.json").write_text(
        json.dumps({"version": 1, "assets": reports}, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Installed wet-mud base, {len(frames)} detail frames and {len(installed_props)} props")


if __name__ == "__main__":
    main()
