"""Install swamp-dungeon renders and derive the seamless wet-mud base."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter, ImageOps


REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "tools" / "ai-gen" / "_swamp_dungeon_terrain_20260826"
ASSETS = REPO / "assets" / "terrain"
PROP_ASSETS = ASSETS / "swamp-dungeon-props"
POND_BLUR_RADIUS = 38
POND_DARK_THRESHOLD = 168
POND_MASK_GAIN = 14


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


def build_wet_mud_base() -> tuple[Image.Image, dict]:
    source = Image.open(ASSETS / "floor_mud_seamless.png").convert("RGB").resize((1024, 1024))
    gray = ImageOps.grayscale(source).filter(ImageFilter.GaussianBlur(1.2))
    gray = ImageEnhance.Contrast(gray).enhance(0.70)
    base = ImageOps.colorize(gray, black=(12, 17, 10), white=(78, 76, 35), mid=(36, 43, 20))
    base = ImageEnhance.Brightness(base).enhance(0.78)

    # Keep the previous all-over damp veil so the material stays recognisably
    # wet mud instead of becoming dry ground with isolated painted puddles.
    broad = gray.filter(ImageFilter.GaussianBlur(24))
    damp = ImageOps.colorize(broad, black=(5, 15, 13), white=(32, 49, 29)).convert("RGBA")
    damp.putalpha(broad.point(lambda value: max(0, min(52, 52 - abs(value - 92) // 2))))
    wet_mud = Image.alpha_composite(base.convert("RGBA"), damp)

    # A second, much broader field turns only the naturally dark basins of the
    # source into readable shallow ponds. It preserves the old pond language,
    # avoids geometric ellipse stamps and never introduces artificial cracks.
    pond_field = gray.filter(ImageFilter.GaussianBlur(POND_BLUR_RADIUS))
    pond = ImageOps.colorize(
        pond_field,
        black=(5, 24, 24),
        mid=(18, 48, 40),
        white=(38, 62, 38),
    ).convert("RGBA")
    pond_alpha = pond_field.point(
        lambda value: max(0, min(108, (POND_DARK_THRESHOLD - value) * POND_MASK_GAIN))
    )
    pond.putalpha(pond_alpha)
    result = Image.alpha_composite(wet_mud, pond).convert("RGB")
    return result, {
        "style": "continuous wet mud with source-derived broad shallow ponds",
        "projection": "runtime textureScaleY 0.5774 / continuous-wall 30 degrees",
        "pondFieldBlurRadius": POND_BLUR_RADIUS,
        "pondDarkThreshold": POND_DARK_THRESHOLD,
        "pondMaskGain": POND_MASK_GAIN,
        "artificialCracks": False,
        "artificialGeometricPonds": False,
    }


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
    base_image, base_style = build_wet_mud_base()
    base_image.save(base_path, optimize=True)
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
        json.dumps({"version": 2, "baseStyle": base_style, "assets": reports},
                   ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Installed wet-mud base, {len(frames)} detail frames and {len(installed_props)} props")


if __name__ == "__main__":
    main()
