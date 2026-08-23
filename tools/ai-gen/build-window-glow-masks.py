"""Build exact-size emissive window overlays from the current building PNGs.

The output keeps the source canvas and alpha alignment intact.  Only pixels in
hand-reviewed window regions can enter the mask, so roof, trim and foundations
cannot be brightened by the runtime additive blend.
"""

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "assets" / "terrain"
OUTPUT_DIR = SOURCE_DIR / "window-glow"


# Rectangles use normalized source-image coordinates.  Keeping the masks on the
# original canvases makes them follow the building sprite without offsets.
MASKS = {
    "thatch_hut": {
        "source": "thatch_hut.png",
        "mode": "warm",
        "boxes": [(0.69, 0.48, 0.82, 0.64)],
    },
    "blacksmith": {
        "source": "blacksmith.png",
        "mode": "warm",
        "boxes": [(0.09, 0.40, 0.84, 0.74)],
    },
    "church": {
        "source": "church.png",
        "mode": "stained",
        "boxes": [
            (0.22, 0.40, 0.29, 0.50),
            (0.23, 0.60, 0.30, 0.82),
            (0.36, 0.67, 0.43, 0.87),
            (0.47, 0.72, 0.54, 0.87),
            (0.71, 0.68, 0.79, 0.87),
            (0.80, 0.62, 0.90, 0.74),
            (0.79, 0.74, 0.85, 0.87),
            (0.85, 0.72, 0.92, 0.87),
        ],
    },
    "research_institute": {
        "source": "research_institute.png",
        "mode": "warm",
        "boxes": [
            (0.10, 0.25, 0.34, 0.49),
            (0.38, 0.17, 0.62, 0.46),
            (0.66, 0.25, 0.90, 0.50),
            (0.10, 0.55, 0.31, 0.83),
            (0.31, 0.57, 0.48, 0.85),
            (0.54, 0.53, 0.90, 0.84),
        ],
    },
    "cavalry_school": {
        "source": "cavalry_school.png",
        "mode": "warm",
        "boxes": [
            (0.31, 0.13, 0.43, 0.26),
            (0.47, 0.66, 0.65, 0.87),
            (0.75, 0.48, 0.94, 0.76),
            (0.88, 0.45, 0.96, 0.58),
        ],
    },
    "house_lv1": {
        "source": "house_lv1.png",
        "mode": "warm",
        "boxes": [(0.08, 0.34, 0.92, 0.84)],
    },
    "house_lv2": {
        "source": "house_lv2.png",
        "mode": "warm",
        "boxes": [(0.07, 0.29, 0.93, 0.86)],
    },
    "house_lv3": {
        "source": "house_lv3.png",
        "mode": "warm",
        "boxes": [(0.06, 0.25, 0.94, 0.87)],
    },
    "wheat_windmill_body": {
        "source": "wheat_windmill_body.png",
        "mode": "warm",
        "boxes": [(0.19, 0.35, 0.30, 0.50), (0.31, 0.38, 0.44, 0.54)],
    },
    "bank": {
        "source": "bank.png",
        "mode": "cool",
        "boxes": [
            (0.46, 0.32, 0.56, 0.48),
            (0.70, 0.17, 0.82, 0.35),
            (0.16, 0.58, 0.25, 0.75),
            (0.33, 0.64, 0.42, 0.82),
            (0.48, 0.65, 0.57, 0.82),
            (0.64, 0.50, 0.80, 0.84),
        ],
    },
    "market": {
        "source": "market.png",
        "mode": "warm",
        "boxes": [
            (0.27, 0.58, 0.42, 0.80),
            (0.27, 0.61, 0.34, 0.75),
            (0.44, 0.62, 0.53, 0.79),
            (0.79, 0.49, 0.85, 0.61),
        ],
    },
    "explorer_camp": {
        "source": "explorer_camp.png",
        "mode": "warm",
        "boxes": [
            (0.13, 0.13, 0.36, 0.29),
            (0.49, 0.61, 0.56, 0.73),
            (0.62, 0.52, 0.76, 0.69),
            (0.70, 0.53, 0.76, 0.65),
        ],
    },
    "economic_workshop": {
        "source": "economic_workshop.png",
        "mode": "warm",
        "boxes": [
            (0.56, 0.60, 0.76, 0.86),
            (0.73, 0.55, 0.90, 0.73),
            (0.07, 0.58, 0.17, 0.76),
            (0.34, 0.71, 0.43, 0.88),
            (0.52, 0.67, 0.61, 0.83),
        ],
    },
}


def region_mask(width, height, boxes):
    mask = np.zeros((height, width), dtype=bool)
    for x0, y0, x1, y1 in boxes:
        left, top = round(x0 * width), round(y0 * height)
        right, bottom = round(x1 * width), round(y1 * height)
        mask[top:bottom, left:right] = True
    return mask


def select_emissive_pixels(rgba, mode, allowed):
    rgb = rgba[..., :3].astype(np.int16)
    source_alpha = rgba[..., 3].astype(np.float32)
    r, g, b = rgb[..., 0], rgb[..., 1], rgb[..., 2]

    if mode == "cool":
        selected = (
            (b >= 82)
            & (b - r >= 12)
            & (b - g >= 3)
            & (r + g + b >= 185)
        )
        strength = np.clip((b - r + b - g + b - 80) / 260.0, 0.18, 1.0)
    elif mode == "stained":
        warm = (
            (r >= 145)
            & (g >= 50)
            & (r - g >= 18)
            & (g - b >= 12)
            & (r - b >= 60)
        )
        cool = (
            (b >= 82)
            & (b - r >= 12)
            & (b - g >= 3)
        )
        selected = (warm | cool) & (r + g + b >= 180)
        channel_max = np.maximum(np.maximum(r, g), b)
        channel_min = np.minimum(np.minimum(r, g), b)
        chroma = channel_max - channel_min
        strength = np.clip((channel_max + chroma * 1.25 - 110) / 260.0, 0.18, 1.0)
    else:
        selected = (
            (r >= 150)
            & (g >= 55)
            & (r - g >= 22)
            & (g - b >= 16)
            & (r - b >= 70)
            & (r + g >= 230)
        )
        strength = np.clip((r + g * 0.65 - b * 1.15 - 80) / 220.0, 0.18, 1.0)

    selected &= allowed & (source_alpha > 24)
    core_alpha = np.where(selected, source_alpha * strength, 0).astype(np.uint8)
    return selected, core_alpha


def build_mask(spec):
    source = Image.open(SOURCE_DIR / spec["source"]).convert("RGBA")
    rgba = np.asarray(source)
    allowed = region_mask(source.width, source.height, spec["boxes"])
    selected, core_alpha = select_emissive_pixels(rgba, spec["mode"], allowed)

    # One restrained blurred fringe removes hard pixel edges while the sharp
    # core still matches the window mullions from the source art.
    radius = max(1.0, min(source.width, source.height) / 700.0)
    blur = Image.fromarray(core_alpha, "L").filter(ImageFilter.GaussianBlur(radius=radius))
    blur_alpha = np.asarray(blur, dtype=np.float32)
    out_alpha = np.maximum(core_alpha.astype(np.float32) * 0.92, blur_alpha * 0.62)

    out = np.zeros_like(rgba)
    out[..., :3] = rgba[..., :3]
    # The blur fringe needs a stable emissive hue outside the selected core.
    if spec["mode"] == "cool":
        out[..., 0] = np.where(selected, out[..., 0], 88)
        out[..., 1] = np.where(selected, out[..., 1], 148)
        out[..., 2] = np.where(selected, out[..., 2], 255)
    else:
        out[..., 0] = np.where(selected, out[..., 0], 255)
        out[..., 1] = np.where(selected, out[..., 1], 164)
        out[..., 2] = np.where(selected, out[..., 2], 58)
    out[..., 3] = np.clip(out_alpha, 0, 255).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("assets", nargs="*", help="Optional mask names; omit to rebuild every mask")
    args = parser.parse_args()
    targets = args.assets or list(MASKS)
    unknown = [key for key in targets if key not in MASKS]
    if unknown:
        raise SystemExit(f"unknown window-glow masks: {', '.join(unknown)}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    previews = []
    for key in targets:
        spec = MASKS[key]
        output = OUTPUT_DIR / f"{key}.png"
        mask = build_mask(spec)
        mask.save(output, optimize=True)
        source = Image.open(SOURCE_DIR / spec["source"]).convert("RGBA")
        preview = Image.alpha_composite(source, mask)
        preview.thumbnail((280, 220), Image.Resampling.LANCZOS)
        previews.append((key, preview))
        print(output.relative_to(ROOT))

    if args.assets:
        return

    sheet = Image.new("RGB", (1200, ((len(previews) + 3) // 4) * 260), (23, 27, 31))
    for index, (key, preview) in enumerate(previews):
        cell_x = (index % 4) * 300
        cell_y = (index // 4) * 260
        checker = Image.new("RGBA", preview.size, (23, 27, 31, 255))
        checker.alpha_composite(preview)
        sheet.paste(checker.convert("RGB"), (cell_x + (300 - preview.width) // 2, cell_y + 28))
        # Default Pillow font is intentionally used to keep this helper dependency-free.
        from PIL import ImageDraw
        ImageDraw.Draw(sheet).text((cell_x + 8, cell_y + 8), key, fill=(238, 241, 245))
    sheet.save(ROOT / "tools" / "ai-gen" / "window-glow-mask-preview.png", optimize=True)


if __name__ == "__main__":
    main()
