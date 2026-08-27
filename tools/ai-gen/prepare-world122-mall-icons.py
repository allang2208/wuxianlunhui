"""Normalize accepted ImageGen mall icons to their runtime sizes without altering artwork."""
from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
GENERATED = ROOT / "tools/ai-gen/_grand_mall_icons_20260825/raw"
ASSETS = {
    "grand-mall-showcase.png": ("assets/ui/building-upgrades/grand-mall-showcase.png", 256, False),
    "grand-mall-energy-atrium.png": ("assets/ui/building-upgrades/grand-mall-energy-atrium.png", 256, False),
    "grand-mall-business-radius.png": ("assets/ui/building-upgrades/grand-mall-business-radius.png", 256, False),
    "grand-mall-staff.png": ("assets/ui/building-upgrades/grand-mall-staff.png", 256, False),
    "grand_commerce.png": ("assets/ui/technology-icons/grand_commerce.png", 1024, False),
    "mall_standardization.png": ("assets/ui/technology-icons/mall_standardization.png", 1024, True),
}


def apply_hex_alpha(image):
    scale = 4
    mask = Image.new("L", (image.width * scale, image.height * scale), 0)
    points = [(0.5, 0.004), (0.91, 0.22), (0.92, 0.75),
              (0.5, 0.99), (0.08, 0.75), (0.078, 0.225)]
    ImageDraw.Draw(mask).polygon(
        [(round(x * image.width * scale), round(y * image.height * scale))
         for x, y in points],
        fill=255,
    )
    mask = mask.resize(image.size, Image.Resampling.LANCZOS)
    source_alpha = image.getchannel("A")
    image.putalpha(Image.frombytes("L", image.size, bytes(
        min(a, b) for a, b in zip(source_alpha.tobytes(), mask.tobytes())
    )))
    return image


def main():
    for source_name, (relative_target, size, force_hex_alpha) in ASSETS.items():
        source = GENERATED / source_name
        target = ROOT / relative_target
        image = Image.open(source).convert("RGBA")
        side = min(image.size)
        left = (image.width - side) // 2
        top = (image.height - side) // 2
        image = image.crop((left, top, left + side, top + side))
        image = image.resize((size, size), Image.Resampling.LANCZOS)
        if force_hex_alpha:
            image = apply_hex_alpha(image)
        target.parent.mkdir(parents=True, exist_ok=True)
        image.save(target, optimize=True)
        print(f"{relative_target}: {image.size[0]}x{image.size[1]}")


if __name__ == "__main__":
    main()
