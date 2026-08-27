"""Compose the newest road reference with isolated energy-vein candidates."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "tools" / "ai-gen" / "_energy_vein_roadstyle_20260826"
ROAD_SHEET = REPO / "assets" / "terrain" / "building_road_tiles.png"
PREVIEW = OUT / "energy_vein_roadstyle_comparison.png"


def fit(image: Image.Image, size: tuple[int, int]) -> Image.Image:
    image = image.convert("RGBA")
    image.thumbnail(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", size, (0, 0, 0, 0))
    canvas.alpha_composite(image, ((size[0] - image.width) // 2,
                                   (size[1] - image.height) // 2))
    return canvas


def runtime_scale(image: Image.Image, scale: int = 5) -> Image.Image:
    runtime = image.convert("RGBA").resize((130, 65), Image.Resampling.LANCZOS)
    return runtime.resize((130 * scale, 65 * scale), Image.Resampling.NEAREST)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    canvas = Image.new("RGBA", (1500, 1420), (38, 36, 33, 255))
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.load_default()
    draw.text((52, 28), "Latest modeled road reference", fill=(232, 225, 210, 255), font=font)

    road_sheet = Image.open(ROAD_SHEET).convert("RGBA")
    road_frame = road_sheet.crop((0, 0, 128, 64)).resize((512, 256), Image.Resampling.NEAREST)
    canvas.alpha_composite(road_frame, (494, 56))
    draw.text((52, 340), "Road-style energy vein candidates (actual 130x65 runtime scale, enlarged 5x)",
              fill=(232, 225, 210, 255), font=font)

    for index in range(1, 4):
        name = f"energy_vein_roadstyle_{index}"
        root = OUT / name
        live = runtime_scale(Image.open(root / f"{name}_live.png"))
        depleted = runtime_scale(Image.open(root / f"{name}_depleted.png"))
        y = 390 + (index - 1) * 335
        canvas.alpha_composite(live, (65, y))
        canvas.alpha_composite(depleted, (815, y))
        draw.text((65, y - 22), f"V{index} LIVE", fill=(148, 224, 224, 255), font=font)
        draw.text((815, y - 22), f"V{index} DEPLETED", fill=(190, 194, 190, 255), font=font)

    canvas.convert("RGB").save(PREVIEW, quality=94)
    print(PREVIEW)


if __name__ == "__main__":
    main()
