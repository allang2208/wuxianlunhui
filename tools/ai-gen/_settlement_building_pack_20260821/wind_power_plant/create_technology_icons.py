from pathlib import Path

from PIL import Image, ImageDraw, ImageEnhance, ImageFilter


ROOT = Path(__file__).resolve().parents[4]
ICON_DIR = ROOT / "assets" / "ui" / "technology-icons"
FRAME_PATH = ICON_DIR / "steam_industry_standardization.png"
BUILDING_PATH = ROOT / "assets" / "terrain" / "wind_power_plant.png"
ROTOR_PATH = ROOT / "assets" / "terrain" / "wind_power_plant_rotor.png"


def cover_inner(canvas: Image.Image) -> None:
    draw = ImageDraw.Draw(canvas, "RGBA")
    inner = [(512, 76), (906, 296), (906, 728), (512, 949), (118, 728), (118, 296)]
    draw.polygon(inner, fill=(7, 25, 43, 255))
    for inset, alpha in ((0, 150), (28, 95), (56, 55)):
        points = [
            (512, 112 + inset), (870 - inset, 315), (870 - inset, 709),
            (512, 910 - inset), (154 + inset, 709), (154 + inset, 315),
        ]
        draw.line(points + [points[0]], fill=(37, 182, 236, alpha), width=3)
    for x in range(260, 765, 84):
        draw.line((x, 225, x, 800), fill=(32, 137, 191, 40), width=2)
    for y in range(270, 775, 84):
        draw.line((205, y, 819, y), fill=(32, 137, 191, 40), width=2)


def fit_rgba(image: Image.Image, max_w: int, max_h: int) -> Image.Image:
    image = image.convert("RGBA")
    bbox = image.getbbox()
    if bbox:
        image = image.crop(bbox)
    scale = min(max_w / image.width, max_h / image.height)
    return image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)


def paste_glow(canvas: Image.Image, art: Image.Image, xy: tuple[int, int]) -> None:
    alpha = art.getchannel("A")
    glow = Image.new("RGBA", art.size, (28, 210, 255, 0))
    glow.putalpha(alpha.filter(ImageFilter.GaussianBlur(18)).point(lambda value: min(175, value)))
    canvas.alpha_composite(glow, (xy[0], xy[1] - 3))
    canvas.alpha_composite(art, xy)


def make_wind_power() -> Image.Image:
    canvas = Image.open(FRAME_PATH).convert("RGBA")
    cover_inner(canvas)
    building = fit_rgba(Image.open(BUILDING_PATH), 760, 690)
    building = ImageEnhance.Contrast(building).enhance(1.08)
    paste_glow(canvas, building, ((1024 - building.width) // 2, 222))
    return canvas


def make_standardization() -> Image.Image:
    canvas = Image.open(FRAME_PATH).convert("RGBA")
    cover_inner(canvas)
    draw = ImageDraw.Draw(canvas, "RGBA")
    center = (512, 512)
    for radius, width, alpha in ((292, 7, 170), (236, 4, 125), (178, 3, 90)):
        draw.ellipse((center[0] - radius, center[1] - radius,
                      center[0] + radius, center[1] + radius),
                     outline=(25, 206, 255, alpha), width=width)
    for angle in range(0, 360, 45):
        import math
        dx = math.cos(math.radians(angle))
        dy = math.sin(math.radians(angle))
        draw.line((512 + dx * 190, 512 + dy * 190,
                   512 + dx * 300, 512 + dy * 300),
                  fill=(45, 194, 238, 130), width=5)
    sheet = Image.open(ROTOR_PATH).convert("RGBA")
    rotor = fit_rgba(sheet.crop((0, 0, 512, 512)), 610, 610)
    paste_glow(canvas, rotor, ((1024 - rotor.width) // 2, (1024 - rotor.height) // 2 - 8))
    draw = ImageDraw.Draw(canvas, "RGBA")
    draw.rounded_rectangle((335, 768, 689, 835), radius=22,
                           fill=(8, 35, 55, 225), outline=(46, 211, 255, 210), width=4)
    for x in (390, 512, 634):
        draw.ellipse((x - 22, 779, x + 22, 823), fill=(234, 184, 67, 255),
                     outline=(255, 229, 145, 255), width=4)
    return canvas


def main() -> None:
    ICON_DIR.mkdir(parents=True, exist_ok=True)
    make_wind_power().save(ICON_DIR / "wind_power.png", optimize=True)
    make_standardization().save(ICON_DIR / "wind_power_standardization.png", optimize=True)


if __name__ == "__main__":
    main()
