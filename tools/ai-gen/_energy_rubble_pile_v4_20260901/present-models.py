"""Create the V4 five-model preview board at full and runtime-relative sizes."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
NAMES = [
    ("variant_1_compact_plateau", "1 · 紧凑平台"),
    ("variant_2_twin_saddle", "2 · 双丘鞍部"),
    ("variant_3_diagonal_ridge", "3 · 斜向低脊"),
    ("variant_4_front_scatter", "4 · 前沿散堆"),
    ("variant_5_crescent_notch", "5 · 月牙缺口"),
]


def checker(size):
    image = Image.new("RGB", size, "#73767a")
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], 24):
        for x in range(0, size[0], 24):
            if (x // 24 + y // 24) % 2:
                draw.rectangle((x, y, x + 23, y + 23), fill="#b7b9bc")
    return image


def main():
    board = Image.new("RGB", (1600, 710), "#20262d")
    draw = ImageDraw.Draw(board)
    title = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 27)
    label_font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 20)
    draw.text((18, 12), "能源矿脉 V4 · 五种真实低矮碎石轮廓（同相机 / 同1×1足线）", font=title, fill="white")
    for index, (directory, label) in enumerate(NAMES):
        x = 16 + index * 316
        preview = Image.open(ROOT / directory / "model_preview.png").convert("RGBA")
        depth = Image.open(ROOT / directory / "body_depth.png").convert("RGB")
        tile = checker((300, 300))
        display = preview.resize((300, 300), Image.Resampling.LANCZOS)
        tile.paste(display, (0, 0), display)
        board.paste(tile, (x, 75))
        board.paste(depth.resize((300, 300), Image.Resampling.LANCZOS), (x, 395))
        draw.text((x + 4, 49), label, font=label_font, fill="white")
        runtime = checker((128, 80))
        small = preview.resize((128, 128), Image.Resampling.LANCZOS)
        runtime.paste(small.crop((0, 24, 128, 104)), (0, 0), small.crop((0, 24, 128, 104)))
        board.paste(runtime, (x + 86, 590))
    board.save(ROOT / "model-and-depth-board.png", optimize=True)


if __name__ == "__main__":
    main()
