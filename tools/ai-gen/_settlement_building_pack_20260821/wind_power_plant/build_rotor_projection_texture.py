"""Repair projection gaps while retaining the selected V2 rotor appearance."""

from pathlib import Path
import argparse
import math

from PIL import Image, ImageChops, ImageFilter


ROOT = Path(__file__).resolve().parent
DEFAULT_SOURCE = (ROOT / "refine_48step_from_v02_seed122561" / "wind_power_plant"
                  / "wind_power_plant_refine_v02_raw.png")
RENDERED = ROOT / "rotor_sources"


def mask(name: str) -> Image.Image:
    image = Image.open(RENDERED / name).convert("RGBA")
    return ImageChops.multiply(image.getchannel("R"), image.getchannel("A"))


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare the accepted wind-station raw for Blender rotor projection.")
    parser.add_argument("source", nargs="?", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path,
                        default=RENDERED / "rotor_projection_texture.png")
    args = parser.parse_args()

    source = Image.open(args.source).convert("RGB")
    skins = mask("rotor_blade_skins_mask.png").filter(ImageFilter.MaxFilter(15))
    spines = mask("rotor_blade_spines_mask.png").filter(ImageFilter.MaxFilter(15))
    hubs = mask("rotor_hub_mask.png").filter(ImageFilter.MaxFilter(15))
    if not (source.size == skins.size == spines.size == hubs.size):
        raise SystemExit("projection masks must match the selected source size")

    output = source.copy()
    pixels = output.load()
    source_pixels = source.load()
    skin_pixels = skins.load()
    spine_pixels = spines.load()
    hub_pixels = hubs.load()
    width, height = source.size

    for y in range(height):
        for x in range(width):
            r, g, b = source_pixels[x, y]
            green_matte = g > 95 and g - r > 42 and g - b > 38
            cyan_intrusion = b > r * 1.28 and g > r * 1.25 and g > 82
            too_dark = max(r, g, b) < 66
            if hub_pixels[x, y] > 16:
                if green_matte or cyan_intrusion:
                    grain = int(8.0 * math.sin(x * 0.061) * math.sin(y * 0.049))
                    pixels[x, y] = (139 + grain, 103 + grain, 38 + grain // 2)
            elif spine_pixels[x, y] > 16:
                if green_matte or cyan_intrusion or too_dark:
                    grain = int(5.0 * math.sin(x * 0.071 + y * 0.043))
                    pixels[x, y] = (83 + grain, 85 + grain, 83 + grain)
            elif skin_pixels[x, y] > 16:
                neutral = max(r, g, b) - min(r, g, b) < 52
                if green_matte or cyan_intrusion or too_dark or not neutral:
                    grain = 8.0 * math.sin(x * 0.083) * math.sin(y * 0.057)
                    streak = 5.0 * math.sin((x + y) * 0.031)
                    value = int(max(78, min(154, 119 + grain + streak)))
                    pixels[x, y] = (value, value + 3, value + 2)

    destination = args.output
    destination.parent.mkdir(parents=True, exist_ok=True)
    output.save(destination, optimize=True)
    print(destination)


if __name__ == "__main__":
    main()
