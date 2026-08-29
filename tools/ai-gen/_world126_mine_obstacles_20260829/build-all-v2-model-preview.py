#!/usr/bin/env python3
"""Build a five-model local approval sheet before any batch generation."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
SUPPORT = ROOT / "support_model_v2_realistic"
REMAINING = ROOT / "models_v2_realistic"
OUT = ROOT / "world126-mine-obstacles-v2-model-approval.png"
TILE = 320
HEADER = 76
MARGIN = 14


def font(size: int, bold: bool = False):
    path = Path("C:/Windows/Fonts") / ("seguisb.ttf" if bold else "segoeui.ttf")
    return ImageFont.truetype(str(path), size) if path.exists() else ImageFont.load_default()


def alpha_bottom(path: Path) -> float:
    with Image.open(path).convert("RGBA") as image:
        box = image.getchannel("A").getbbox()
        return (box[3] - 1) / max(1, image.height - 1) if box else 0.0


def main() -> None:
    items = (
        ("COLLAPSED SUPPORT", SUPPORT / "mine_obstacle_collapsed_support_v2_model_preview.png",
         SUPPORT / "mine_obstacle_collapsed_support_v2_textured_init.png"),
        ("DERAILED CART", REMAINING / "mine_obstacle_derailed_cart_v2_model_preview.png",
         REMAINING / "mine_obstacle_derailed_cart_v2_textured_init.png"),
        ("STONE PILLARS", REMAINING / "mine_obstacle_stone_pillar_v2_model_preview.png",
         REMAINING / "mine_obstacle_stone_pillar_v2_textured_init.png"),
        ("HAND WINCH", REMAINING / "mine_obstacle_hand_winch_v2_model_preview.png",
         REMAINING / "mine_obstacle_hand_winch_v2_textured_init.png"),
        ("SORTING HOPPER", REMAINING / "mine_obstacle_sorting_hopper_v2_model_preview.png",
         REMAINING / "mine_obstacle_sorting_hopper_v2_textured_init.png"),
    )
    page = Image.new("RGB", (MARGIN * 2 + TILE * len(items), MARGIN * 2 + HEADER + TILE), (17, 19, 21))
    draw = ImageDraw.Draw(page)
    for index, (label, preview_path, init_path) in enumerate(items):
        x = MARGIN + index * TILE
        draw.text((x + 8, MARGIN + 7), label, font=font(16, True), fill=(236, 238, 240))
        draw.text((x + 8, MARGIN + 40), f"bottom {alpha_bottom(init_path):.3f}",
                  font=font(14), fill=(174, 182, 190))
        with Image.open(preview_path).convert("RGBA") as source:
            bg = Image.new("RGBA", source.size, (0, 0, 0, 255))
            bg.alpha_composite(source)
            image = bg.convert("RGB").resize((TILE, TILE), Image.Resampling.LANCZOS)
        page.paste(image, (x, MARGIN + HEADER))
    page.save(OUT, optimize=True)
    print(OUT)


if __name__ == "__main__":
    main()
