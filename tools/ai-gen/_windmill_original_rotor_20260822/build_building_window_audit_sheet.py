import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


PROJECT_ROOT = Path(__file__).resolve().parents[3]
OUTPUT = Path(__file__).resolve().parent / "building_window_audit_sheet.png"


def main() -> None:
    configs = json.loads((PROJECT_ROOT / "data" / "producer-buildings.json").read_text(encoding="utf-8"))
    entries = []
    for key, config in configs.items():
        if not isinstance(config, dict) or not config.get("tex"):
            continue
        asset = PROJECT_ROOT / (config.get("assetPath") or f"assets/terrain/{config['tex']}.png")
        if asset.exists():
            entries.append((key, asset))

    cell = (300, 270)
    columns = 4
    rows = (len(entries) + columns - 1) // columns
    sheet = Image.new("RGB", (cell[0] * columns, cell[1] * rows), (28, 31, 35))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    for index, (key, asset) in enumerate(entries):
        image = Image.open(asset).convert("RGBA")
        image.thumbnail((cell[0] - 24, cell[1] - 48), Image.Resampling.LANCZOS)
        x = (index % columns) * cell[0]
        y = (index // columns) * cell[1]
        px = x + (cell[0] - image.width) // 2
        py = y + 28 + (cell[1] - 38 - image.height) // 2
        sheet.paste(image, (px, py), image)
        draw.text((x + 8, y + 8), key, fill=(235, 239, 244), font=font)
    sheet.save(OUTPUT, optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
