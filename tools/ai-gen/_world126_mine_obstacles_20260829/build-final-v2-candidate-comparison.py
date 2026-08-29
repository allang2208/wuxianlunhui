#!/usr/bin/env python3
"""Build the final candidate-only comparison for all five V2 obstacles."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
WALL = REPO / "assets/terrain/abandoned_mine_wall_block_b.png"
SUPPORT = ROOT / "support_model_v2_realistic/candidates_klein_s48_from_model/mine_obstacle_collapsed_support/mine_obstacle_collapsed_support_refine_v01_raw.png"
BATCH = ROOT / "candidates_klein_s48_from_v2_models"
PILLAR_R2 = ROOT / "candidates_klein_s48_from_v2_pillar_r2/mine_obstacle_stone_pillar/mine_obstacle_stone_pillar_refine_v01_raw.png"
OUT = ROOT / "world126-mine-obstacles-v2-klein-final-candidates.png"
TILE = 300
HEADER = 76
MARGIN = 14
TARGET = 0.875


def font(size: int, bold: bool = False):
    path = Path("C:/Windows/Fonts") / ("seguisb.ttf" if bold else "segoeui.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def visible_bottom(image: Image.Image) -> float:
    rgb = image.convert("RGB")
    bottom = 0
    for y in range(rgb.height):
        for x in range(rgb.width):
            red, green, blue = rgb.getpixel((x, y))
            if not (green > red * 1.25 and green > blue * 1.25 and green > 70):
                bottom = y
    return bottom / max(1, rgb.height - 1)


def main() -> None:
    items = (
        ("MINE WALL REF", WALL, False),
        ("SUPPORT V01", SUPPORT, True),
        ("CART V01", BATCH / "mine_obstacle_derailed_cart/mine_obstacle_derailed_cart_refine_v01_raw.png", True),
        ("PILLARS R2 V01", PILLAR_R2, True),
        ("WINCH V01", BATCH / "mine_obstacle_hand_winch/mine_obstacle_hand_winch_refine_v01_raw.png", True),
        ("HOPPER V01", BATCH / "mine_obstacle_sorting_hopper/mine_obstacle_sorting_hopper_refine_v01_raw.png", True),
    )
    page = Image.new("RGB", (MARGIN * 2 + TILE * len(items), MARGIN * 2 + HEADER + TILE), (18, 20, 22))
    draw = ImageDraw.Draw(page)
    for index, (label, path, obstacle) in enumerate(items):
        x = MARGIN + index * TILE
        draw.text((x + 8, MARGIN + 7), label, font=font(16, True), fill=(236, 238, 240))
        image = Image.open(path).convert("RGB")
        if obstacle:
            draw.text((x + 8, MARGIN + 40), f"bottom {visible_bottom(image):.3f}",
                      font=font(14), fill=(174, 182, 190))
        image_y = MARGIN + HEADER
        page.paste(image.resize((TILE, TILE), Image.Resampling.LANCZOS), (x, image_y))
        if obstacle:
            target_y = image_y + round((TILE - 1) * TARGET)
            draw.line((x, target_y, x + TILE - 1, target_y), fill=(0, 230, 255), width=2)
    page.save(OUT, optimize=True)
    print(OUT)


if __name__ == "__main__":
    main()
