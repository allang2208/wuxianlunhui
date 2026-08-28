from pathlib import Path
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[4]
TASK_DIR = Path(__file__).resolve().parent
WEAPONS = {
    "crimson-crown-settlement": TASK_DIR / "candidates" / "crimson-crown-settlement-v02.png",
    "myriad-corridor": TASK_DIR / "candidates" / "myriad-corridor-v01.png",
}

MOD_SLUGS = (
    "crimson-double-gavel",
    "crimson-fourth-judgment",
    "crimson-collateral-oathbreaker",
    "crimson-decapitation-covenant",
    "crimson-immovable-throne-grip",
    "crimson-usurper-quickbreak-grip",
    "corridor-dual-prism-shortcut",
    "corridor-fourfold-expansion",
    "corridor-return-focus-lens",
    "corridor-parallel-scatter-prism",
    "corridor-long-memory-grip",
    "corridor-instant-skirmish-grip",
)


def alpha_crop(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    bbox = rgba.getchannel("A").getbbox()
    if not bbox:
        raise ValueError("image has no visible alpha content")
    return rgba.crop(bbox)


def fit_on_canvas(image: Image.Image, size: int, max_width: int, max_height: int,
                  center_x: float = 0.5, center_y: float = 0.5) -> Image.Image:
    cropped = alpha_crop(image)
    scale = min(max_width / cropped.width, max_height / cropped.height)
    width = max(1, round(cropped.width * scale))
    height = max(1, round(cropped.height * scale))
    resized = cropped.resize((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    x = round(size * center_x - width / 2)
    y = round(size * center_y - height / 2)
    canvas.alpha_composite(resized, (x, y))
    return canvas


def save_png(image: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    image.save(path, format="PNG", optimize=True, compress_level=9)


def build_weapon_assets() -> None:
    for slug, source_path in WEAPONS.items():
        source = Image.open(source_path).convert("RGBA")
        # 与恒星圣谕的正式持有图同口径：可见枪体宽度 1764px，中心落在
        # (0.487, 0.524)；高握柄枪也优先保持相同枪身长度。
        held = fit_on_canvas(source, 2048, 1764, 1850, 0.487, 0.524)
        icon = fit_on_canvas(source, 512, 466, 430, 0.5, 0.51)
        runtime_held = held.resize((512, 512), Image.Resampling.LANCZOS)
        runtime_icon = icon.resize((128, 128), Image.Resampling.LANCZOS)
        save_png(held, ROOT / "assets" / "weapons" / f"{slug}-equip.png")
        save_png(runtime_held, ROOT / "assets" / "weapons" / "runtime" / "weapons" / f"{slug}-equip.png")
        save_png(icon, ROOT / "assets" / "icons" / "firearms" / f"{slug}.png")
        save_png(runtime_icon, ROOT / "assets" / "ui" / "runtime-icons" / "icons" / "firearms" / f"{slug}.png")


def build_mod_assets() -> list[Image.Image]:
    previews = []
    for slug in MOD_SLUGS:
        source_path = TASK_DIR / "generated" / "mods" / f"{slug}-source.png"
        if not source_path.exists():
            raise FileNotFoundError(source_path)
        source = Image.open(source_path).convert("RGBA")
        if source.getchannel("A").getextrema()[0] != 0:
            raise ValueError(f"{source_path.name} does not contain real transparency")
        icon = fit_on_canvas(source, 512, 420, 420)
        runtime_icon = icon.resize((128, 128), Image.Resampling.LANCZOS)
        save_png(icon, ROOT / "assets" / "icons" / "craft-legendary-pistols" / f"{slug}.png")
        save_png(runtime_icon, ROOT / "assets" / "ui" / "runtime-icons" / "icons" / "craft-legendary-pistols" / f"{slug}.png")
        previews.append(icon)
    return previews


def build_contact_sheet(images: list[Image.Image]) -> None:
    cell = 300
    sheet = Image.new("RGB", (cell * 4, cell * 3), (18, 22, 30))
    draw = ImageDraw.Draw(sheet)
    for index, image in enumerate(images):
        x = (index % 4) * cell
        y = (index // 4) * cell
        draw.rounded_rectangle((x + 8, y + 8, x + cell - 8, y + cell - 8), 16,
                               fill=(31, 37, 49), outline=(74, 84, 105), width=2)
        preview = image.resize((250, 250), Image.Resampling.LANCZOS)
        sheet.paste(preview, (x + 25, y + 25), preview)
    save_png(sheet.convert("RGBA"), TASK_DIR / "previews" / "legendary-pistol-mods-contact.png")


def main() -> None:
    build_weapon_assets()
    previews = build_mod_assets()
    build_contact_sheet(previews)
    print("built 2 weapon asset sets and 12 modification icon sets")


if __name__ == "__main__":
    main()
