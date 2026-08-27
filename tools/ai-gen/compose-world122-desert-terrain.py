"""Install desert terrain model renders and build a deterministic review image."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image


REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "tools" / "ai-gen" / "_world122_desert_terrain_20260826"
ASSETS = REPO / "assets" / "terrain"
PROP_ASSETS = ASSETS / "desert-props"


def clean_alpha(image: Image.Image, threshold=6) -> Image.Image:
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = pixels[x, y]
            if a <= threshold:
                pixels[x, y] = (0, 0, 0, 0)
    return image


def feather_diamond_edges(image: Image.Image, band=0.18) -> Image.Image:
    """Keep modeled details away from hard tile borders; the continuous sand stays visible below."""
    image = image.convert("RGBA")
    pixels = image.load()
    for y in range(image.height):
        ny = abs((y + 0.5 - image.height / 2) / (image.height / 2))
        for x in range(image.width):
            nx = abs((x + 0.5 - image.width / 2) / (image.width / 2))
            inside = max(0.0, 1.0 - nx - ny)
            feather = min(1.0, inside / max(0.001, band))
            r, g, b, a = pixels[x, y]
            pixels[x, y] = (r, g, b, round(a * feather * feather * (3 - 2 * feather)))
    return image


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
    frames = []
    reports = []
    for name in manifest["tiles"]:
        frame = clean_alpha(Image.open(SOURCE / "tile_frames" / f"{name}.png"))
        frame = frame.resize((128, 64), Image.Resampling.LANCZOS)
        frame = clean_alpha(feather_diamond_edges(frame))
        frames.append(frame)
    atlas = Image.new("RGBA", (128 * len(frames), 64), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        atlas.alpha_composite(frame, (index * 128, 0))
    atlas_path = ASSETS / "desert_terrain_detail_tiles.png"
    atlas.save(atlas_path, optimize=True)
    reports.append(alpha_report(atlas_path))

    PROP_ASSETS.mkdir(parents=True, exist_ok=True)
    installed_props = []
    for name in manifest["props"]:
        image = clean_alpha(Image.open(SOURCE / "props" / f"{name}.png"))
        path = PROP_ASSETS / f"{name}.png"
        image.save(path, optimize=True)
        installed_props.append(path)
        reports.append(alpha_report(path))

    (SOURCE / "install-report.json").write_text(
        json.dumps({"version": 4, "assets": reports}, ensure_ascii=False, indent=2),
        encoding="utf-8")
    print(f"Installed {atlas_path} and {len(installed_props)} props")


if __name__ == "__main__":
    main()
