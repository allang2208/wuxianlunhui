"""Export peripheral rubble props and compose four-neighbor ground-layer atlases."""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
REPO = TASK.parents[2]
RAW = ROOT / "raw"
WORK = ROOT / "runtime"
ASSETS = REPO / "assets" / "terrain"
FRAME_SIZE = (384, 216)
RUNTIME_FRAME_SIZE = (192, 108)
ATLAS_GRID = (8, 8)
VARIANT_COUNT = 4
PROP_MAX = [(50, 34), (82, 26), (72, 32)]


def call(script: str, *args: object) -> None:
    subprocess.run(
        [sys.executable, str(REPO / "tools" / "ai-gen" / script), *map(str, args)],
        cwd=REPO,
        check=True,
    )


def crop_and_fit(source: Path, target: Path, max_size: tuple[int, int]) -> Image.Image:
    image = Image.open(source).convert("RGBA")
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.nonzero(alpha >= 12)
    if not len(xs):
        raise RuntimeError(f"No subject after keying: {source}")
    image = image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    scale = min(max_size[0] / image.width, max_size[1] / image.height)
    size = (max(1, round(image.width * scale)), max(1, round(image.height * scale)))
    image = image.resize(size, Image.Resampling.LANCZOS)
    rgba = np.asarray(image).copy()
    rgba[rgba[..., 3] < 4] = (0, 0, 0, 0)
    image = Image.fromarray(rgba, "RGBA")
    image.save(target, optimize=True)
    return image


def purple_variant(source: Image.Image) -> Image.Image:
    rgba = np.asarray(source.convert("RGBA")).copy()
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3]
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mineral = (
        np.clip((blue - red - 28.0) / 46.0, 0.0, 1.0)
        * np.clip((green - red - 5.0) / 38.0, 0.0, 1.0)
        * (alpha > 0)
    )
    luminance = red * 0.299 + green * 0.587 + blue * 0.114
    shell = np.stack((luminance * 0.70, luminance * 0.68, luminance * 0.76), axis=-1)
    shell = shell * 0.68 + rgb * 0.20
    shadow = np.clip((122.0 - luminance) / 100.0, 0.0, 1.0)[..., None]
    shell += shadow * np.array([12.0, 2.0, 19.0], dtype=np.float32)
    value = np.clip(np.maximum(blue, green) * 1.06, 35.0, 255.0)
    purple = np.stack((value * 0.82, value * 0.20, value), axis=-1)
    out_rgb = shell + (purple - shell) * mineral[..., None]
    out = np.dstack((np.clip(out_rgb, 0, 255).astype(np.uint8), alpha))
    out[alpha == 0] = (0, 0, 0, 0)
    return Image.fromarray(out, "RGBA")


def paste_center(frame: Image.Image, prop: Image.Image, x: float, y: float, scale: float) -> None:
    if abs(scale - 1.0) > 0.001:
        prop = prop.resize(
            (max(1, round(prop.width * scale)), max(1, round(prop.height * scale))),
            Image.Resampling.LANCZOS,
        )
    frame.alpha_composite(prop, (round(x - prop.width / 2), round(y - prop.height / 2)))


def compose_frame(mask: int, variant: int, props: list[Image.Image]) -> Image.Image:
    # Reuse the previous one-cell contact layer as the center AO, enlarged without changing its world size.
    contact = Image.open(ASSETS / f"energy_node_ground_contact_{mask}.png").convert("RGBA")
    frame = contact.resize(FRAME_SIZE, Image.Resampling.LANCZOS)
    rng = np.random.default_rng(1221001 + mask * 101 + variant * 1009)
    cx, cy = FRAME_SIZE[0] / 2, FRAME_SIZE[1] / 2
    directions = [((1.0, 0.5), 1), ((-1.0, -0.5), 2), ((-1.0, 0.5), 4), ((1.0, -0.5), 8)]
    missing = [(direction, bit) for direction, bit in directions if not mask & bit]
    for edge_index, (direction, _bit) in enumerate(missing):
        # Boundary cells get one readable prop group; isolated/end cells may get a second tiny patch.
        count = 1 + int((variant + edge_index + mask) % 4 == 0)
        for item_index in range(count):
            prop_index = int(rng.integers(0, len(props)))
            if item_index > 0: prop_index = 2  # secondary marks stay neutral and quiet
            prop = props[prop_index]
            distance = rng.uniform(0.70, 1.00) * 128
            tangent = (-direction[1], direction[0])
            tangent_len = (tangent[0] ** 2 + tangent[1] ** 2) ** 0.5
            tangent = (tangent[0] / tangent_len, tangent[1] / tangent_len)
            spread = rng.uniform(-19, 19)
            x = cx + direction[0] * distance + tangent[0] * spread
            y = cy + direction[1] * distance + tangent[1] * spread * 0.45
            paste_center(frame, prop, x, y, rng.uniform(0.78, 1.08))
    return frame


def build_atlas(props: list[Image.Image], target: Path) -> None:
    atlas = Image.new(
        "RGBA",
        (RUNTIME_FRAME_SIZE[0] * ATLAS_GRID[0], RUNTIME_FRAME_SIZE[1] * ATLAS_GRID[1]),
        (0, 0, 0, 0),
    )
    for variant in range(VARIANT_COUNT):
        for mask in range(16):
            frame_index = variant * 16 + mask
            x = (frame_index % ATLAS_GRID[0]) * RUNTIME_FRAME_SIZE[0]
            y = (frame_index // ATLAS_GRID[0]) * RUNTIME_FRAME_SIZE[1]
            frame = compose_frame(mask, variant, props).resize(
                RUNTIME_FRAME_SIZE, Image.Resampling.LANCZOS)
            atlas.alpha_composite(frame, (x, y))
    atlas.save(target, optimize=True)


def make_preview(blue_props: list[Image.Image], purple_props: list[Image.Image]) -> None:
    board = Image.new("RGB", (1280, 590), "#252a30")
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
    small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
    draw.text((18, 14), "能源矿簇外围小物 · 原始三类与邻接组合样例", font=font, fill="white")
    for theme_index, (name, props, bg) in enumerate((
        ("普通位面", blue_props, "#68684f"),
        ("矿洞位面", purple_props, "#2c2932"),
    )):
        top = 58 + theme_index * 255
        draw.text((20, top), name, font=small, fill="#e8ebef")
        for index, prop in enumerate(props):
            tile = Image.new("RGBA", (150, 110), bg)
            paste_center(tile, prop, 75, 62, 1.8)
            board.paste(tile.convert("RGB"), (20 + index * 165, top + 30))
        for sample, (variant, mask) in enumerate(((0, 0), (1, 3), (2, 5), (3, 10))):
            tile = Image.new("RGBA", (192, 108), bg)
            frame = compose_frame(mask, variant, props).resize((192, 108), Image.Resampling.LANCZOS)
            tile.alpha_composite(frame)
            x = 535 + sample * 180
            board.paste(tile.convert("RGB").resize((170, 96)), (x, top + 38))
            draw.text((x, top + 137), f"形态{variant + 1} / mask {mask}", font=small, fill="#cdd1d6")
    board.save(ROOT / "surrounding-props-preview.png")


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    blue_props = []
    purple_props = []
    records = []
    for index, max_size in enumerate(PROP_MAX, 1):
        raw = RAW / f"surround_prop_{index}_raw.png"
        keyed = WORK / f"surround_prop_{index}_keyed.png"
        blue = WORK / f"surround_prop_{index}_blue.png"
        purple = WORK / f"surround_prop_{index}_purple.png"
        call("key-world122-building-body.py", raw, keyed,
             "--threshold", 100, "--remove-all-green", "--nearest-opaque-edge-rgb")
        blue_image = crop_and_fit(keyed, blue, max_size)
        purple_image = purple_variant(blue_image)
        purple_image.save(purple, optimize=True)
        blue_props.append(blue_image)
        purple_props.append(purple_image)
        records.append({
            "variant": index,
            "raw": raw.relative_to(REPO).as_posix(),
            "blue": blue.relative_to(REPO).as_posix(),
            "purple": purple.relative_to(REPO).as_posix(),
            "runtimeSourceSize": list(blue_image.size),
        })

    blue_atlas = ASSETS / "energy_node_ground_surround_blue_tiles.png"
    purple_atlas = ASSETS / "energy_node_ground_surround_purple_tiles.png"
    build_atlas(blue_props, blue_atlas)
    build_atlas(purple_props, purple_atlas)
    make_preview(blue_props, purple_props)
    manifest = {
        "status": "runtime_installed",
        "date": "2026-09-01",
        "generator": "OpenAI built-in ImageGen with accepted energy rubble V03 style reference",
        "composeFrameSize": list(FRAME_SIZE),
        "frameSize": list(RUNTIME_FRAME_SIZE),
        "displaySize": list(RUNTIME_FRAME_SIZE),
        "frameCount": 64,
        "frameMapping": "frame = visualVariant * 16 + fourNeighborMask",
        "visualVariants": VARIANT_COUNT,
        "atlas": {
            "blue": blue_atlas.relative_to(REPO).as_posix(),
            "purple": purple_atlas.relative_to(REPO).as_posix(),
        },
        "props": records,
        "contracts": {
            "visualOnly": True,
            "noEntity": True,
            "noCollisionOrPathfinding": True,
            "onlyMissingNeighborDirections": True,
            "fixedLightNoMirror": True,
        },
    }
    (ROOT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"blue": str(blue_atlas), "purple": str(purple_atlas)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
