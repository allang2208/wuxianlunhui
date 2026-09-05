"""Export the five silhouette-distinct energy rubble piles and contact layers.

This keeps the accepted World-122 building pipeline for chroma removal and
runtime cleanup, then normalizes every variant onto one 256x144 canvas.  The
normalization preserves aspect ratio and a shared bottom line so shape changes
do not make the one-cell resource footprint jump between variants.
"""

from __future__ import annotations

import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RAW = ROOT / "raw"
WORK = ROOT / "runtime"
ASSETS = REPO / "assets" / "terrain"

CANVAS_SIZE = (256, 144)
CONTENT_MAX = (248, 116)
CONTENT_BOTTOM = 141
LABELS = [
    "紧凑台地",
    "双峰鞍部",
    "低矮斜脊",
    "前沿散石",
    "弧形缺口",
]


def call(script: str, *args: object) -> None:
    subprocess.run(
        [sys.executable, str(REPO / "tools" / "ai-gen" / script), *map(str, args)],
        cwd=REPO,
        check=True,
    )


def clean_components(path: Path) -> None:
    """Drop only tiny chroma-key specks while retaining detached foreground stones."""
    rgba = np.asarray(Image.open(path).convert("RGBA")).copy()
    alpha = rgba[..., 3]
    labels, count = ndimage.label(alpha >= 12)
    if count:
        sizes = np.bincount(labels.ravel())
        keep_ids = np.flatnonzero(sizes >= 180)
        keep_ids = keep_ids[keep_ids != 0]
        keep = np.isin(labels, keep_ids)
        keep = ndimage.binary_dilation(keep, iterations=2)
        rgba[..., 3][~keep] = 0
    rgba[rgba[..., 3] == 0] = (0, 0, 0, 0)
    Image.fromarray(rgba, "RGBA").save(path)


def normalize_body(source: Path, target: Path) -> dict:
    image = Image.open(source).convert("RGBA")
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.nonzero(alpha >= 12)
    if not len(xs):
        raise RuntimeError(f"No opaque subject after keying: {source}")
    crop = image.crop((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    scale = min(CONTENT_MAX[0] / crop.width, CONTENT_MAX[1] / crop.height)
    size = (max(1, round(crop.width * scale)), max(1, round(crop.height * scale)))
    crop = crop.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    paste_x = (CANVAS_SIZE[0] - size[0]) // 2
    paste_y = CONTENT_BOTTOM - size[1]
    canvas.alpha_composite(crop, (paste_x, paste_y))
    pixels = np.asarray(canvas).copy()
    pixels[pixels[..., 3] == 0] = (0, 0, 0, 0)
    Image.fromarray(pixels, "RGBA").save(target, optimize=True)
    return {
        "sourceCrop": [int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1],
        "contentSize": list(size),
        "contentPaste": [paste_x, paste_y],
        "canvasSize": list(CANVAS_SIZE),
    }


def purple_cavern_variant(source: Path, target: Path) -> dict:
    """Turn cyan deposits purple and seat them in a darker cavern rock shell."""
    rgba = np.asarray(Image.open(source).convert("RGBA")).copy()
    rgb = rgba[..., :3].astype(np.float32)
    alpha = rgba[..., 3]
    red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    mineral = (
        np.clip((blue - red - 28.0) / 46.0, 0.0, 1.0)
        * np.clip((green - red - 5.0) / 38.0, 0.0, 1.0)
        * (alpha > 0)
    )

    # Cool charcoal shell with a restrained violet bounce in the deep faces.
    luminance = red * 0.299 + green * 0.587 + blue * 0.114
    shell = np.stack((luminance * 0.70, luminance * 0.68, luminance * 0.76), axis=-1)
    shell = shell * 0.68 + rgb * 0.20
    shadow = np.clip((122.0 - luminance) / 100.0, 0.0, 1.0)[..., None]
    shell += shadow * np.array([12.0, 2.0, 19.0], dtype=np.float32)

    # Pure violet crystal family; retain source luminance and highlight structure.
    value = np.clip(np.maximum(blue, green) * 1.06, 35.0, 255.0)
    purple = np.stack((value * 0.82, value * 0.20, value), axis=-1)
    out_rgb = shell + (purple - shell) * mineral[..., None]
    out = np.dstack((np.clip(out_rgb, 0, 255).astype(np.uint8), alpha))
    out[alpha == 0] = (0, 0, 0, 0)
    Image.fromarray(out, "RGBA").save(target, optimize=True)
    return {
        "mineralPixels": int(np.count_nonzero(mineral >= 0.5)),
        "operation": "blue-to-pure-violet plus cavern-charcoal-shell-v2",
        "alphaPreserved": True,
    }


def diamond_point(cx: float, cy: float, direction: tuple[float, float], distance: float) -> tuple[int, int]:
    return round(cx + direction[0] * distance), round(cy + direction[1] * distance)


def make_ground_contact(mask: int, target: Path) -> None:
    """Build a subtle AO/pebble layer whose exposed edges follow four-neighbor occupancy."""
    scale = 4
    w, h = CANVAS_SIZE[0] * scale, CANVAS_SIZE[1] * scale
    layer = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    shadow = Image.new("L", (w, h), 0)
    sd = ImageDraw.Draw(shadow)
    sd.ellipse((72 * scale, 119 * scale, 184 * scale, 143 * scale), fill=54)
    sd.ellipse((44 * scale, 125 * scale, 212 * scale, 145 * scale), fill=24)
    shadow = shadow.filter(ImageFilter.GaussianBlur(7 * scale))
    layer.putalpha(shadow)

    draw = ImageDraw.Draw(layer)
    rng = np.random.default_rng(1220901 + mask * 97)
    # Screen-space directions for +i, -i, +j, -j on the 2:1 isometric grid.
    directions = [((0.894, 0.447), 1), ((-0.894, -0.447), 2), ((-0.894, 0.447), 4), ((0.894, -0.447), 8)]
    center = (128 * scale, 132 * scale)
    for (direction, bit) in directions:
        connected = bool(mask & bit)
        if connected:
            # A soft bridge keeps adjacent piles from reading as isolated stickers.
            px, py = diamond_point(center[0], center[1], direction, 50 * scale)
            bridge = Image.new("L", (w, h), 0)
            bd = ImageDraw.Draw(bridge)
            bd.ellipse((px - 30 * scale, py - 7 * scale, px + 30 * scale, py + 7 * scale), fill=19)
            bridge = bridge.filter(ImageFilter.GaussianBlur(6 * scale))
            bridge_rgba = Image.new("RGBA", (w, h), (16, 18, 21, 0))
            bridge_rgba.putalpha(bridge)
            layer.alpha_composite(bridge_rgba)
            continue
        # Exposed sides receive a few low-contrast stones and dust chips.
        for _ in range(5):
            dist = rng.uniform(66, 102) * scale
            tangent = (-direction[1], direction[0])
            spread = rng.uniform(-13, 13) * scale
            x = center[0] + direction[0] * dist + tangent[0] * spread
            y = center[1] + direction[1] * dist * 0.48 + tangent[1] * spread * 0.38
            rx = rng.uniform(1.3, 3.3) * scale
            ry = rng.uniform(0.7, 1.8) * scale
            tone = int(rng.integers(66, 94))
            draw.ellipse((x - rx, y - ry, x + rx, y + ry), fill=(tone, tone, tone + 3, int(rng.integers(34, 62))))

    layer = layer.resize(CANVAS_SIZE, Image.Resampling.LANCZOS)
    pixels = np.asarray(layer).copy()
    pixels[pixels[..., 3] == 0] = (0, 0, 0, 0)
    Image.fromarray(pixels, "RGBA").save(target, optimize=True)


def make_board(records: list[dict]) -> None:
    board = Image.new("RGB", (1440, 598), "#262b31")
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 20)
    small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 16)
    draw.text((18, 12), "能源矿脉 v4 · 五种真实轮廓 / 蓝色 / 紫色高能 / 枯竭", font=font, fill="white")
    for index, record in enumerate(records, 1):
        x = 16 + (index - 1) * 284
        draw.text((x, 46), f"{index} · {record['label']}", font=small, fill="#e9edf2")
        for row, key in enumerate(("normal", "highEnergy", "depleted")):
            path = REPO / record[key]
            image = Image.open(path).convert("RGBA")
            tile = Image.new("RGB", (256, 144), "#6b6c70" if row != 1 else "#292632")
            td = ImageDraw.Draw(tile)
            for ty in range(0, 144, 16):
                for tx in range(0, 256, 16):
                    if (tx // 16 + ty // 16) % 2:
                        td.rectangle((tx, ty, tx + 15, ty + 15), fill="#a7a8aa" if row != 1 else "#47414f")
            tile.paste(image, (0, 0), image)
            board.paste(tile, (x, 72 + row * 168))
    board.save(WORK / "runtime-art-preview.png")


def main() -> None:
    WORK.mkdir(parents=True, exist_ok=True)
    ASSETS.mkdir(parents=True, exist_ok=True)
    records = []
    for index, label in enumerate(LABELS, 1):
        source = RAW / f"energy_rubble_v4_{index}_raw.png"
        keyed = WORK / f"rubble_{index}_keyed.png"
        body = WORK / f"rubble_{index}_body.png"
        crop_meta = WORK / f"rubble_{index}_crop.json"
        normal = ASSETS / f"energy_node_rubble_{index}.png"
        high = ASSETS / f"energy_node_high_energy_{index}.png"
        depleted = ASSETS / f"energy_node_rubble_depleted_{index}.png"
        high_depleted = ASSETS / f"energy_node_high_energy_depleted_{index}.png"

        call("key-world122-building-body.py", source, keyed,
             "--threshold", 100, "--remove-all-green", "--nearest-opaque-edge-rgb")
        clean_components(keyed)
        call("finalize-building-runtime.py", keyed, body,
             "--display-width", 128, "--padding", 0, "--preserve-alpha-exact",
             "--nearest-opaque-edge-rgb", "--defringe-inner-pixels", 2,
             "--metadata", crop_meta)
        placement = normalize_body(body, normal)
        purple = purple_cavern_variant(normal, high)
        call("make-energy-vein-depleted.py", normal, depleted,
             "--metadata", WORK / f"rubble_{index}_depleted.json")
        call("make-energy-vein-depleted.py", high, high_depleted,
             "--metadata", WORK / f"rubble_{index}_high_depleted.json")
        records.append({
            "variant": index,
            "label": label,
            "raw": source.relative_to(REPO).as_posix(),
            "normal": normal.relative_to(REPO).as_posix(),
            "highEnergy": high.relative_to(REPO).as_posix(),
            "depleted": depleted.relative_to(REPO).as_posix(),
            "highEnergyDepleted": high_depleted.relative_to(REPO).as_posix(),
            "placement": placement,
            "purple": purple,
        })

    contacts = []
    for mask in range(16):
        target = ASSETS / f"energy_node_ground_contact_{mask}.png"
        make_ground_contact(mask, target)
        contacts.append(target.relative_to(REPO).as_posix())

    make_board(records)
    manifest = {
        "status": "runtime_installed",
        "date": "2026-09-01",
        "sourceGenerator": "OpenAI built-in ImageGen with accepted v03 style authority and five Blender structure references",
        "lanComfyUi": "not used; upload request was rejected because the prior standing LAN authorization was scoped to mining-guild building assets",
        "runtimeCanvas": list(CANVAS_SIZE),
        "runtimeDisplay": [128, 72],
        "sharedBottomLine": CONTENT_BOTTOM,
        "randomMirrorOrRotation": False,
        "integrationPreview": "tools/ai-gen/_energy_rubble_pile_v4_20260901/runtime/ground-integration-preview.png",
        "surroundingPropsManifest": "tools/ai-gen/_energy_rubble_pile_v4_20260901/surroundings/manifest.json",
        "variants": records,
        "groundContacts": {
            "count": len(contacts),
            "maskBits": {"1": "+i", "2": "-i", "4": "+j", "8": "-j"},
            "files": contacts,
        },
    }
    (WORK / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"variants": len(records), "contacts": len(contacts),
                      "preview": str(WORK / "runtime-art-preview.png")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
