"""Make an offline cluster composition for visual review; this does not run the game."""

from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
ASSETS = REPO / "assets" / "terrain"
OUT = ROOT / "runtime" / "ground-integration-preview.png"
CELLS = [(0, 0), (1, 0), (0, 1), (1, 1), (2, 1), (1, 2), (2, 2), (3, 2), (2, 3)]
VARIANTS = [1, 2, 4, 3, 5, 1, 4, 2, 5]


def variation(i: int, j: int, variant: int) -> tuple[float, float, float, int]:
    def int32(value: int) -> int:
        value &= 0xFFFFFFFF
        return value - 0x100000000 if value & 0x80000000 else value

    def imul(a: int, b: int) -> int:
        return int32((a & 0xFFFFFFFF) * (b & 0xFFFFFFFF))

    value = int32(imul(i, 0x45D9F3B) ^ imul(j, 0x27D4EB2D))
    value = imul(int32(value ^ variant), 0x85EBCA6B)
    value = int32(value ^ ((value & 0xFFFFFFFF) >> 16)) & 0xFFFFFFFF
    return (
        [0.96, 0.98, 1.0, 1.02, 1.04][value % 5],
        [-3, -1.5, 0, 1.5, 3][(value >> 5) % 5],
        [-1, 0, 1][(value >> 11) % 3],
        (value >> 17) % 4,
    )


def background(size: tuple[int, int], cave: bool) -> Image.Image:
    base = np.empty((size[1], size[0], 3), dtype=np.int16)
    color = np.array([37, 34, 43] if cave else [92, 91, 70])
    rng = np.random.default_rng(1220912 if cave else 1220911)
    noise = rng.normal(0, 5 if cave else 7, (size[1], size[0], 1))
    base[:] = color
    base = np.clip(base + noise, 0, 255).astype(np.uint8)
    image = Image.fromarray(base, "RGB").convert("RGBA")
    draw = ImageDraw.Draw(image)
    line = (63, 56, 72, 45) if cave else (118, 111, 82, 42)
    for y in range(-size[0], size[1], 64):
        draw.line((0, y, size[0], y + size[0] // 2), fill=line, width=1)
        draw.line((0, y, size[0], y - size[0] // 2), fill=line, width=1)
    return image


def paste_center(canvas: Image.Image, sprite: Image.Image, x: float, y: float) -> None:
    canvas.alpha_composite(sprite, (round(x - sprite.width / 2), round(y - sprite.height / 2)))


def atlas_frame(atlas: Image.Image, frame_index: int) -> Image.Image:
    frame_w, frame_h = 192, 108
    x = (frame_index % 8) * frame_w
    y = (frame_index // 8) * frame_h
    return atlas.crop((x, y, x + frame_w, y + frame_h))


def render_panel(cave: bool) -> Image.Image:
    size = (760, 690)
    panel = background(size, cave)
    origin = (380, 270)
    cell_set = set(CELLS)
    atlas_name = "energy_node_ground_surround_purple_tiles.png" if cave \
        else "energy_node_ground_surround_blue_tiles.png"
    atlas = Image.open(ASSETS / atlas_name).convert("RGBA")
    nodes = []
    for (cell, variant) in zip(CELLS, VARIANTS):
        i, j = cell
        x = origin[0] + (i - j) * 64
        y = origin[1] + (i + j) * 32
        mask = 0
        if (i + 1, j) in cell_set: mask |= 1
        if (i - 1, j) in cell_set: mask |= 2
        if (i, j + 1) in cell_set: mask |= 4
        if (i, j - 1) in cell_set: mask |= 8
        nodes.append((y, x, cell, variant, mask))

    # Every contact is a true ground layer, below all bodies.
    for _, x, (i, j), variant, mask in nodes:
        scale, offset_x, offset_y, surround_variant = variation(i, j, variant)
        contact = atlas_frame(atlas, surround_variant * 16 + mask)
        contact = contact.resize((round(192 * scale), round(108 * scale)), Image.Resampling.LANCZOS)
        paste_center(panel, contact, x + offset_x, origin[1] + (i + j) * 32 - (36 * scale - 32) + offset_y)

    for _, x, (i, j), variant, _mask in sorted(nodes):
        scale, offset_x, offset_y, _surround_variant = variation(i, j, variant)
        name = "energy_node_high_energy" if cave else "energy_node_rubble"
        body = Image.open(ASSETS / f"{name}_{variant}.png").convert("RGBA")
        body = body.resize((round(128 * scale), round(72 * scale)), Image.Resampling.LANCZOS)
        center_y = origin[1] + (i + j) * 32 - (36 * scale - 32) + offset_y
        paste_center(panel, body, x + offset_x, center_y)
    return panel


def main() -> None:
    board = Image.new("RGB", (1560, 760), "#20242a")
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
    small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
    board.paste(render_panel(False).convert("RGB"), (20, 54))
    board.paste(render_panel(True).convert("RGB"), (800, 54))
    draw.text((20, 16), "普通位面：五轮廓 + 四邻接地 + 外围小物", font=font, fill="white")
    draw.text((800, 16), "矿洞位面：深岩壳纯紫高能矿 + 暗岩碎屑", font=font, fill="white")
    draw.text((20, 730), "离线合成预览；不代表游戏运行时截图", font=small, fill="#c8cbd0")
    OUT.parent.mkdir(parents=True, exist_ok=True)
    board.save(OUT)
    print(OUT)


if __name__ == "__main__":
    main()
