"""Compose and finalize the 18-piece frozen prop Dev-Depth batch.

`prepare` builds one 6x3 fixed-cell init sheet and matching Depth sheet.
`finalize --dev-raw ...` splits the single FLUX.2 Dev render, removes the
magenta matte per cell without discarding disconnected fragments, restores the
authored soft contact shadow, and creates a labeled approval sheet.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


REPO = Path(__file__).resolve().parents[2]
ROOT = REPO / "tools" / "ai-gen" / "_frozen_environment_props_20260829"
MANIFEST = ROOT / "manifest.json"
CELL = 256
COLS = 6
ROWS = 3
MATTE = (255, 0, 255)


def font(size: int):
    candidates = [Path(r"C:\Windows\Fonts\msyh.ttc"), Path(r"C:\Windows\Fonts\simhei.ttf")]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def load_manifest():
    return json.loads(MANIFEST.read_text(encoding="utf-8"))


def cell_xy(index: int):
    return (index % COLS) * CELL, (index // COLS) * CELL


def make_labeled_sheet(images, props, path: Path, title: str):
    header = 70
    label_h = 44
    canvas = Image.new("RGB", (COLS * CELL, header + ROWS * (CELL + label_h)), (20, 26, 31))
    draw = ImageDraw.Draw(canvas)
    draw.text((28, 18), title, font=font(26), fill=(226, 235, 239))
    for i, (image, prop) in enumerate(zip(images, props)):
        x = (i % COLS) * CELL
        y = header + (i // COLS) * (CELL + label_h)
        checker = Image.new("RGB", (CELL, CELL), (50, 60, 66))
        cd = ImageDraw.Draw(checker)
        step = 32
        for yy in range(0, CELL, step):
            for xx in range(0, CELL, step):
                if (xx // step + yy // step) % 2:
                    cd.rectangle((xx, yy, xx + step - 1, yy + step - 1), fill=(59, 70, 76))
        rgba = image.convert("RGBA")
        checker.paste(rgba.convert("RGB"), (0, 0), rgba.getchannel("A"))
        canvas.paste(checker, (x, y))
        label = f"{i + 1:02d}  {prop['labelZh']}"
        draw.text((x + 12, y + CELL + 8), label, font=font(17), fill=(215, 224, 228))
    path.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(path, optimize=True)


def prepare():
    manifest = load_manifest()
    props = manifest["props"]
    init = Image.new("RGB", (COLS * CELL, ROWS * CELL), MATTE)
    depth = Image.new("L", init.size, 0)
    models = []
    for i, prop in enumerate(props):
        x, y = cell_xy(i)
        model = Image.open(ROOT / prop["modelRender"]).convert("RGBA")
        body_depth = Image.open(ROOT / prop["bodyDepth"]).convert("L")
        tile = Image.new("RGB", (CELL, CELL), MATTE)
        tile.paste(model.convert("RGB"), (0, 0), model.getchannel("A"))
        init.paste(tile, (x, y))
        depth.paste(body_depth, (x, y))
        models.append(model)
    review = ROOT / "review"
    review.mkdir(parents=True, exist_ok=True)
    init.save(review / "frozen-props-dev-init-magenta.png", optimize=True)
    depth.save(review / "frozen-props-dev-depth.png", optimize=True)
    make_labeled_sheet(models, props, review / "frozen-props-model-contact-sheet.png",
                       "冰原位面 / 冰原地牢 · 18件小物模型结构总览")
    prompt = (
        "A single sprite atlas containing exactly eighteen separate small frozen-environment ground props, "
        "six columns by three rows, one prop centered in every supplied cell. Follow the supplied orthographic "
        "Body Depth and init image exactly: preserve every object's silhouette, position, scale, 30-degree "
        "isometric camera, 44.8-degree world orientation, and empty spacing between cells. Refine only materials "
        "and small surface detail into grounded semi-realistic medieval dark-fantasy game art: wind-packed snow, "
        "opaque blue-gray ice, frost-crusted slate, weathered dead wood, dull bone, oxidized dark iron, stiff frozen "
        "rope and cloth, cracked lantern glass. Low saturation, PBR-like rough surfaces, readable medium-scale wear, "
        "soft neutral upper-left top-side light, restrained contrast, no glow and no cartoon outlines. Pure perfectly "
        "uniform magenta #FF00FF background. No floor plane, scenery, walls, room, horizon, snowfield, text, labels, "
        "borders, grid lines, cast shadow, vignette, watermark, extra objects, merged cells or missing objects."
    )
    (ROOT / "prompt-dev-depth.txt").write_text(prompt, encoding="utf-8")
    print(review / "frozen-props-model-contact-sheet.png")
    print(review / "frozen-props-dev-init-magenta.png")
    print(review / "frozen-props-dev-depth.png")


def matte_cutout(tile: Image.Image, model: Image.Image):
    rgb = np.asarray(tile.convert("RGB"), dtype=np.float32)
    ring = np.concatenate([rgb[:10].reshape(-1, 3), rgb[-10:].reshape(-1, 3),
                           rgb[:, :10].reshape(-1, 3), rgb[:, -10:].reshape(-1, 3)])
    bg = np.median(ring, axis=0)
    distance = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    alpha = np.clip((distance - 34.0) / 48.0, 0.0, 1.0)
    # Dev darkens the magenta under the authored contact-shadow ellipse.  A
    # plain color-distance key mistakes that darker magenta for foreground.
    # Remove strongly magenta pixels first, then constrain the remaining body
    # to a softly dilated version of the exact authored silhouette/Depth.
    magenta = np.minimum(rgb[..., 0], rgb[..., 2]) - rgb[..., 1]
    balanced_rb = np.abs(rgb[..., 0] - rgb[..., 2]) < 92
    alpha[(magenta > 34) & balanced_rb] = 0.0
    model_alpha = model.convert("RGBA").getchannel("A")
    body = model_alpha.point(lambda value: 255 if value >= 190 else 0)
    body = body.filter(ImageFilter.MaxFilter(9)).filter(ImageFilter.GaussianBlur(0.65))
    alpha *= np.asarray(body, dtype=np.float32) / 255.0
    # Do not keep only one component: ice chips, bones, chain links and shards
    # intentionally contain multiple disconnected pieces.
    a = alpha[..., None]
    fg = (rgb - (1.0 - a) * bg) / np.maximum(a, 1e-3)
    fg = np.clip(fg, 0, 255).astype(np.uint8)
    # Re-anchor generated color to the authored PBR palette.  The magenta
    # canvas can push neutral ice/stone/iron edges toward violet or green even
    # after alpha decontamination; keep Dev's interior shading/detail but use
    # the model color more strongly at anti-aliased edges and desaturate the
    # combined result to the project's restrained realistic range.
    model_rgba = np.asarray(model.convert("RGBA"), dtype=np.float32)
    model_rgb = model_rgba[..., :3]
    model_present = (model_rgba[..., 3:4] > 8).astype(np.float32)
    edge_mix = np.where(a < 0.82, 0.72, 0.34) * model_present
    fg = fg.astype(np.float32) * (1.0 - edge_mix) + model_rgb * edge_mix
    luminance = (fg[..., 0:1] * 0.2126 + fg[..., 1:2] * 0.7152 + fg[..., 2:3] * 0.0722)
    fg = luminance + (fg - luminance) * 0.58
    fg = np.clip(fg, 0, 255).astype(np.uint8)
    rgba = np.dstack([fg, np.clip(alpha * 255, 0, 255).astype(np.uint8)])
    return Image.fromarray(rgba, "RGBA")


def authored_shadow(model: Image.Image):
    rgba = np.asarray(model.convert("RGBA"), dtype=np.uint8)
    alpha = rgba[..., 3]
    shadow_alpha = np.where((alpha > 0) & (alpha < 170), np.minimum(alpha, 62), 0).astype(np.uint8)
    layer = np.zeros_like(rgba)
    layer[..., :3] = (18, 25, 29)
    layer[..., 3] = shadow_alpha
    return Image.fromarray(layer, "RGBA")


def finalize(dev_raw: Path):
    manifest = load_manifest()
    props = manifest["props"]
    raw = Image.open(dev_raw).convert("RGB")
    if raw.size != (COLS * CELL, ROWS * CELL):
        raise SystemExit(f"Dev raw must be {COLS * CELL}x{ROWS * CELL}, got {raw.size}")
    raw_dir = ROOT / "dev-raw-cells"
    out_dir = ROOT / "candidates"
    raw_dir.mkdir(parents=True, exist_ok=True)
    out_dir.mkdir(parents=True, exist_ok=True)
    finals = []
    for i, prop in enumerate(props):
        x, y = cell_xy(i)
        tile = raw.crop((x, y, x + CELL, y + CELL))
        tile.save(raw_dir / f"{prop['key']}_dev_raw.png", optimize=True)
        model = Image.open(ROOT / prop["modelRender"]).convert("RGBA")
        cut = matte_cutout(tile, model)
        composed = Image.alpha_composite(authored_shadow(model), cut)
        out = out_dir / f"{prop['key']}.png"
        composed.save(out, optimize=True)
        finals.append(composed)
        prop["devCandidate"] = f"candidates/{prop['key']}.png"
        prop["devRawCell"] = f"dev-raw-cells/{prop['key']}_dev_raw.png"
    contact = ROOT / "review" / "frozen-props-dev-contact-sheet.png"
    make_labeled_sheet(finals, props, contact, "冰原位面 / 冰原地牢 · Dev材质候选18件")
    manifest["devGeneration"] = {
        "model": "flux2-dev-depth",
        "batchLayout": [COLS, ROWS],
        "cellSize": [CELL, CELL],
        "controlStrength": 0.82,
        "denoise": 0.28,
        "steps": 24,
        "background": "#FF00FF",
        "raw": str(dev_raw.relative_to(REPO)).replace("\\", "/"),
        "approvalContactSheet": str(contact.relative_to(REPO)).replace("\\", "/"),
    }
    MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(contact)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["prepare", "finalize"])
    parser.add_argument("--dev-raw", type=Path)
    args = parser.parse_args()
    if args.mode == "prepare":
        prepare()
    else:
        if not args.dev_raw:
            parser.error("finalize requires --dev-raw")
        finalize(args.dev_raw.resolve())


if __name__ == "__main__":
    main()
