#!/usr/bin/env python3
"""Install Blender-rendered abandoned-mine wall/gate assets and evidence."""

from __future__ import annotations

import hashlib
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
SOURCE_DIR = ROOT / "tools" / "ai-gen" / "_abandoned_mine_wall_kit_20260828"
ASSET_DIR = ROOT / "assets" / "terrain"
WALL_KEYS = ["abandoned_mine_wall_block_a", "abandoned_mine_wall_block_b", "abandoned_mine_wall_block_c"]
GATE_KEY = "abandoned_mine_gate"
CELL = 640
FRAMES = 16


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def alpha_mask(image: Image.Image) -> Image.Image:
    alpha = image.getchannel("A")
    return Image.merge("RGBA", (alpha, alpha, alpha, alpha))


def paste_ground(canvas: Image.Image, image: Image.Image, center, geo: dict, flip=False):
    display = geo["display"]
    sx = display[0] / image.width
    sy = display[1] / image.height
    ground = geo["groundCenter"]
    resized = image.resize((round(image.width * sx), round(image.height * sy)), Image.Resampling.LANCZOS)
    if flip:
        resized = resized.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        ground_x = image.width - ground[0]
    else:
        ground_x = ground[0]
    x = round(center[0] - ground_x * sx)
    y = round(center[1] - ground[1] * sy)
    canvas.alpha_composite(resized, (x, y))


def paste_gate(canvas: Image.Image, image: Image.Image, a, b, geo: dict):
    p0, p1 = geo["base"]
    sx = (b[0] - a[0]) / (p1[0] - p0[0])
    sy = (b[1] - a[1]) / (p1[1] - p0[1])
    resized = image.resize((round(image.width * sx), round(image.height * sy)), Image.Resampling.LANCZOS)
    x = round(a[0] - p0[0] * sx)
    y = round(a[1] - p0[1] * sy)
    canvas.alpha_composite(resized, (x, y))


def gate_slice_image(image: Image.Image, x0: int, x1: int) -> Image.Image:
    """Keep one source-x slice in its original cell coordinates."""
    sliced = Image.new("RGBA", image.size, (0, 0, 0, 0))
    sliced.alpha_composite(image.crop((x0, 0, x1, image.height)), (x0, 0))
    return sliced


def main():
    geometry_path = SOURCE_DIR / "geometry.json"
    if not geometry_path.exists():
        raise FileNotFoundError("run abandoned-mine-wall-kit-blender.py first")
    geometry = json.loads(geometry_path.read_text(encoding="utf-8"))
    wall_geos = geometry["walls"]
    gate_geo = geometry["gate"]
    ASSET_DIR.mkdir(parents=True, exist_ok=True)

    walls = []
    runtime = {}
    for index, key in enumerate(WALL_KEYS):
        src = SOURCE_DIR / f"{key}.png"
        dst = ASSET_DIR / f"{key}.png"
        image = Image.open(src).convert("RGBA")
        image.save(dst, optimize=True)
        alpha_mask(image).save(SOURCE_DIR / f"{key}_alpha.png", optimize=True)
        walls.append(image)
        runtime[key] = {"path": dst.relative_to(ROOT).as_posix(), "size": list(image.size), "sha256": sha256(dst)}

    gate_frames = [Image.open(SOURCE_DIR / "gate_frames" / f"gate_{i:02d}.png").convert("RGBA") for i in range(FRAMES)]
    sheet = Image.new("RGBA", (CELL * 4, CELL * 4), (0, 0, 0, 0))
    for index, frame in enumerate(gate_frames):
        sheet.alpha_composite(frame, ((index % 4) * CELL, (index // 4) * CELL))
    gate_dst = ASSET_DIR / f"{GATE_KEY}.png"
    sheet.save(gate_dst, optimize=True)
    alpha_mask(gate_frames[0]).save(SOURCE_DIR / "abandoned_mine_gate_closed_alpha.png", optimize=True)
    alpha_mask(gate_frames[-1]).save(SOURCE_DIR / "abandoned_mine_gate_open_alpha.png", optimize=True)
    runtime[GATE_KEY] = {
        "path": gate_dst.relative_to(ROOT).as_posix(),
        "sheetSize": list(sheet.size),
        "frameSize": [CELL, CELL],
        "frames": FRAMES,
        "sha256": sha256(gate_dst),
    }

    preview = Image.new("RGB", (1900, 1180), (12, 13, 15))
    draw = ImageDraw.Draw(preview)
    draw.text((34, 24), "Abandoned Mine - modeled 1x1 wall variants and independent lift gate", fill=(230, 220, 200))
    for index, (wall, geo) in enumerate(zip(walls, wall_geos)):
        scaled = wall.copy()
        scaled.thumbnail((520, 520), Image.Resampling.LANCZOS)
        x = 30 + index * 620
        preview.paste(scaled, (x, 70), scaled)
        draw.text((x + 10, 560), f"wall {chr(65 + index)} | 128x64 footprint | same anchor", fill=(194, 177, 145))
    for slot, frame_index in enumerate((0, 7, 15)):
        gate = gate_frames[frame_index].copy()
        gate.thumbnail((520, 520), Image.Resampling.LANCZOS)
        x = 30 + slot * 620
        preview.paste(gate, (x, 640), gate)
        draw.text((x + 10, 1128), f"gate frame {frame_index:02d}", fill=(194, 177, 145))
    preview_path = SOURCE_DIR / "abandoned-mine-modeled-kit-preview.png"
    preview.save(preview_path, optimize=True)

    # Runtime-math seam proof: adjacent wall centres advance one isometric grid
    # edge step (64,32); the gate spans six such steps and uses the same endpoints.
    proof_layer = Image.new("RGBA", (1900, 1050), (0, 0, 0, 0))
    chain = [(270 + i * 64, 300 + i * 32) for i in range(7)]
    for index, center in enumerate(chain):
        variant = index % 3
        paste_ground(proof_layer, walls[variant], center, wall_geos[variant], flip=bool((index // 3) % 2))
    gate_a = (500, 700)
    gate_b = (gate_a[0] + 6 * 64, gate_a[1] + 6 * 32)
    # Match the runtime's depth ordering instead of pasting the whole gate as
    # one sprite.  Each of the six grid cells owns its own cropped visual slice;
    # endpoint wall columns use +4 and gate slices +3.9 depth bias.
    slice_count = int(gate_geo.get("depthSlices", 1))
    hole_x0, hole_x1 = gate_geo["gateX"]
    layered = [
        (gate_a[1] + 4, "wall", (walls[1], gate_a, wall_geos[1], False)),
        (gate_b[1] + 4, "wall", (walls[2], gate_b, wall_geos[2], True)),
    ]
    for index in range(slice_count):
        tx0 = hole_x0 + (hole_x1 - hole_x0) * index / slice_count
        tx1 = hole_x0 + (hole_x1 - hole_x0) * (index + 1) / slice_count
        x0, x1 = math.floor(tx0), math.ceil(tx1)
        world_y1 = gate_a[1] + (tx1 - gate_geo["base"][0][0]) / (
            gate_geo["base"][1][0] - gate_geo["base"][0][0]) * (gate_b[1] - gate_a[1])
        layered.append((world_y1 + 3.9, "gate", gate_slice_image(gate_frames[0], x0, x1)))
    for _, kind, payload in sorted(layered, key=lambda item: item[0]):
        if kind == "gate":
            paste_gate(proof_layer, payload, gate_a, gate_b, gate_geo)
        else:
            wall, center, geo, flip = payload
            paste_ground(proof_layer, wall, center, geo, flip=flip)
    corner = (1450, 650)
    paste_ground(proof_layer, walls[0], corner, wall_geos[0], flip=False)
    paste_ground(proof_layer, walls[1], (corner[0] + 64, corner[1] + 32), wall_geos[1], flip=True)
    paste_ground(proof_layer, walls[2], (corner[0] - 64, corner[1] + 32), wall_geos[2], flip=False)

    proof = Image.new("RGB", proof_layer.size, (10, 11, 13))
    proof.paste(proof_layer, (0, 0), proof_layer)
    draw = ImageDraw.Draw(proof)
    draw.text((34, 24), "Runtime seam proof: A/B/C repeat, six-cell gate endpoints, shared corner", fill=(230, 220, 200))
    draw.text((34, 50), "centres use exact (+64,+32) 1x1 grid steps; no scale or position jitter", fill=(162, 169, 174))
    for label, point in (("gate A", gate_a), ("gate B", gate_b), ("corner", corner)):
        x, y = point
        draw.ellipse((x - 6, y - 6, x + 6, y + 6), outline=(255, 193, 88), width=2)
        draw.text((x + 10, y - 20), label, fill=(255, 193, 88))
    proof_path = SOURCE_DIR / "abandoned-mine-modeled-seam-proof.png"
    proof.save(proof_path, optimize=True)

    shared_anchor = all(w["groundCenter"] == wall_geos[0]["groundCenter"] for w in wall_geos)
    manifest = {
        "version": 3,
        "pipeline": "Blender editable geometry -> transparent runtime renders",
        "model": (SOURCE_DIR / "abandoned_mine_wall_kit.blend").relative_to(ROOT).as_posix(),
        "modelSha256": sha256(SOURCE_DIR / "abandoned_mine_wall_kit.blend"),
        "runtime": runtime,
        "geometry": geometry,
        "variantPolicy": {
            "keys": WALL_KEYS,
            "selection": "deterministic grid-coordinate hash",
            "safeTransforms": ["horizontal mirror"],
            "forbiddenTransforms": ["runtime scale jitter", "runtime position jitter", "runtime rotation"],
            "sharedGroundAnchor": shared_anchor,
            "sharedFootprint": [128, 64],
        },
        "gateContract": {
            "independentMovingLeaf": True,
            "jambs": "endpoint 1x1 wall blocks",
            "frame0": "closed",
            "frame15": "open",
            "depthSlices": gate_geo.get("depthSlices", 1),
            "layering": "one cropped source-x slice per gate cell; slice maxY+3.9, endpoint wall maxY+4",
        },
        "preview": preview_path.relative_to(ROOT).as_posix(),
        "seamProof": proof_path.relative_to(ROOT).as_posix(),
    }
    (SOURCE_DIR / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
