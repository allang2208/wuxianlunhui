#!/usr/bin/env python3
"""Project V4 Klein material detail onto the authored zombie wall kit.

The generated candidates are material references, not geometry sources.  The
final alpha, silhouette, frame split, and portcullis motion all come from the
Blender model so image-model hallucinations cannot change gameplay geometry.
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
MODEL_OUT = ROOT / "tools" / "ai-gen" / "_zombie_dungeon_walls_20260826"
V4_OUT = ROOT / "tools" / "ai-gen" / "_zombie_dungeon_walls_v4_20260827"
GATE_SPIKE_OUT = ROOT / "tools" / "ai-gen" / "_zombie_dungeon_gate_spikes_20260827"
ASSETS = ROOT / "assets" / "terrain"

WALL_AI = V4_OUT / "zombie_wall_block_v4" / "zombie_wall_block_v4_refine_v02_body.png"
GATE_AI = GATE_SPIKE_OUT / "zombie_portcullis_v4" / "zombie_portcullis_v4_refine_v01_body.png"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def material_transfer(
    base: Image.Image,
    generated: Image.Image,
    detail_strength: float,
    dark: tuple[float, float, float] | None = None,
    light: tuple[float, float, float] | None = None,
) -> Image.Image:
    """Transfer generated wear detail while preserving authored form and alpha."""
    if generated.size != base.size:
        generated = generated.resize(base.size, Image.Resampling.LANCZOS)
    base_array = np.asarray(base, dtype=np.float32) / 255.0
    generated_array = np.asarray(generated, dtype=np.float32) / 255.0
    valid = generated_array[..., 3:4]

    # Erode then soften validity so keyed candidate borders cannot leave a
    # ghost of hallucinated windows, towers, or foundation edges.
    valid_image = Image.fromarray(np.uint8(np.clip(valid[..., 0] * 255.0, 0, 255)), "L")
    valid_image = valid_image.filter(ImageFilter.MinFilter(15)).filter(ImageFilter.GaussianBlur(3.0))
    valid = np.asarray(valid_image, dtype=np.float32)[..., None] / 255.0
    source = generated_array[..., :3]

    # Retain authored form lighting, then add only bounded high-frequency wear
    # from the Klein render.  The palette is authored explicitly so the zombie
    # dungeon remains black stone instead of inheriting pale candidate walls.
    source_image = Image.fromarray(np.uint8(np.clip(source * 255.0, 0, 255)), "RGB")
    low = np.asarray(source_image.filter(ImageFilter.GaussianBlur(5.0)), dtype=np.float32) / 255.0
    detail = np.clip(source - low, -0.20, 0.20)
    if dark is not None and light is not None:
        luminance = np.sum(base_array[..., :3] * np.array([0.2126, 0.7152, 0.0722]), axis=2, keepdims=True)
        shade = np.clip(luminance * 1.20, 0.0, 1.0)
        dark_array = np.array(dark, dtype=np.float32).reshape((1, 1, 3))
        light_array = np.array(light, dtype=np.float32).reshape((1, 1, 3))
        mixed = dark_array + (light_array - dark_array) * shade
    else:
        mixed = np.power(np.clip(base_array[..., :3], 0.0, 1.0), 1.08) * 0.82
    mixed = np.clip(mixed + detail * (detail_strength * valid), 0.0, 1.0)

    result = np.concatenate((mixed, base_array[..., 3:4]), axis=2)
    return Image.fromarray(np.uint8(np.clip(result * 255.0, 0, 255)), "RGBA")


def translated_layer(layer: Image.Image, offset: tuple[int, int]) -> Image.Image:
    """Apply the checked-in pre-fix mask correction inside the 640px cell."""
    if offset == (0, 0):
        return layer
    translated = Image.new("RGBA", layer.size, (0, 0, 0, 0))
    translated.alpha_composite(layer, offset)
    return translated


def build_gate_sheet(
    frame_layer: Image.Image,
    bars_layer: Image.Image,
    material_finalize_offset: tuple[int, int] = (0, 0),
) -> tuple[Image.Image, list[Image.Image]]:
    frame_layer = frame_layer.resize((640, 640), Image.Resampling.LANCZOS)
    bars_layer = bars_layer.resize((640, 640), Image.Resampling.LANCZOS)
    frame_layer = translated_layer(frame_layer, material_finalize_offset)
    bars_layer = translated_layer(bars_layer, material_finalize_offset)
    sheet = Image.new("RGBA", (2560, 2560), (0, 0, 0, 0))
    frames: list[Image.Image] = []
    for index in range(16):
        t = index / 15.0
        eased = t * t * (3.0 - 2.0 * t)
        lift = round(eased * 348.0)
        frame = frame_layer.copy()
        frame.alpha_composite(bars_layer, (0, -lift))
        sheet.alpha_composite(frame, ((index % 4) * 640, (index // 4) * 640))
        frames.append(frame)
    return sheet, frames


def build_preview(wall: Image.Image, frames: list[Image.Image], output: Path) -> None:
    preview = Image.new("RGBA", (1800, 1080), (13, 14, 18, 255))
    draw = ImageDraw.Draw(preview)
    draw.text((48, 32), "Zombie Dungeon V4 - Klein material projected onto authored Blender geometry", fill=(230, 226, 218, 255))
    draw.text((48, 63), "Wall-block jambs / exact six-cell 13-bar leaf / 16-frame authored lift", fill=(157, 151, 141, 255))
    wall_view = wall.copy()
    wall_view.thumbnail((820, 880), Image.Resampling.LANCZOS)
    preview.alpha_composite(wall_view, (30 + (840 - wall_view.width) // 2, 105))
    for slot, frame_index in enumerate((0, 5, 10, 15)):
        gate_view = frames[frame_index].copy()
        gate_view.thumbnail((430, 430), Image.Resampling.LANCZOS)
        x = 900 + (slot % 2) * 440
        y = 110 + (slot // 2) * 440
        preview.alpha_composite(gate_view, (x, y))
        draw.text((x + 8, y + 8), f"gate {frame_index:02d}", fill=(218, 181, 127, 255))
    preview.save(output, optimize=True)


def build_diamond_preview(wall: Image.Image, closed_gate: Image.Image, geometry: dict, output: Path) -> None:
    """Compose the 12-cell runtime ring using the final V4 sprites."""
    canvas = Image.new("RGBA", (2000, 1240), (8, 9, 12, 255))
    draw = ImageDraw.Draw(canvas)
    center = (1000.0, 560.0)
    edge_cells = 12
    rx, ry = edge_cells * 64.0, edge_cells * 32.0
    vertices = [
        (center[0], center[1] - ry),
        (center[0] + rx, center[1]),
        (center[0], center[1] + ry),
        (center[0] - rx, center[1]),
    ]
    draw.polygon(vertices, fill=(17, 18, 22, 255), outline=(65, 60, 55, 255), width=3)
    edges = list(zip(vertices, vertices[1:] + vertices[:1]))
    opening_start, opening_end = 3, 9
    pieces = []
    wall_display = wall.resize(tuple(geometry["wall"]["display"]), Image.Resampling.LANCZOS)
    wall_ground = geometry["wall"]["groundCenter"]
    ground_scaled = (
        wall_ground[0] * wall_display.width / wall.width,
        wall_ground[1] * wall_display.height / wall.height,
    )
    for edge_index, (start, end) in enumerate(edges):
        step = ((end[0] - start[0]) / edge_cells, (end[1] - start[1]) / edge_cells)
        for index in range(edge_cells):
            if edge_index == 1 and opening_start < index < opening_end:
                continue
            point = (start[0] + step[0] * index, start[1] + step[1] * index)
            pieces.append((point[1] + 4, wall_display, point[0] - ground_scaled[0], point[1] - ground_scaled[1]))

    gate_geometry = geometry["gate"]
    start, end = edges[1]
    step = ((end[0] - start[0]) / edge_cells, (end[1] - start[1]) / edge_cells)
    opening_a = (start[0] + step[0] * opening_start, start[1] + step[1] * opening_start)
    opening_b = (start[0] + step[0] * opening_end, start[1] + step[1] * opening_end)
    base = gate_geometry["base"][0]
    base_end = gate_geometry["base"][1]
    scale_x = abs(opening_b[0] - opening_a[0]) / abs(base_end[0] - base[0])
    scale_y = abs(opening_b[1] - opening_a[1]) / abs(base_end[1] - base[1])
    gate_x = opening_a[0] - (gate_geometry["canvas"][0] - base[0]) * scale_x
    gate_y = opening_a[1] - base[1] * scale_y

    # Mirror the runtime depthSlices contract: every crop keeps its original
    # position inside the flipped full sprite and sorts by its own ground span.
    slices = max(1, int(gate_geometry.get("depthSlices", 1)))
    hole_start, hole_end = gate_geometry.get("gateX", [base[0], base_end[0]])
    hole_span = hole_end - hole_start
    for index in range(slices):
        tx0 = hole_start + hole_span * index / slices
        tx1 = hole_start + hole_span * (index + 1) / slices
        left = int(tx0)
        right = int(tx1 + 0.999999)
        segment = closed_gate.crop((left, 0, right, closed_gate.height))
        segment = segment.resize(
            (max(1, round(segment.width * scale_x)), max(1, round(segment.height * scale_y))),
            Image.Resampling.LANCZOS,
        ).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        segment_x = gate_x + (gate_geometry["canvas"][0] - right) * scale_x
        t0 = (tx0 - base[0]) / (base_end[0] - base[0])
        t1 = (tx1 - base[0]) / (base_end[0] - base[0])
        y0 = opening_a[1] + (opening_b[1] - opening_a[1]) * t0
        y1 = opening_a[1] + (opening_b[1] - opening_a[1]) * t1
        if gate_geometry.get("tuckEndSlices") and index == 0:
            slice_depth = opening_a[1] + 3.9
        elif gate_geometry.get("tuckEndSlices") and index == slices - 1:
            slice_depth = opening_b[1] + 3.9
        else:
            slice_depth = max(y0, y1) + 3.9
        pieces.append((slice_depth, segment, segment_x, gate_y))

    for _, sprite, x, y in sorted(pieces, key=lambda item: item[0]):
        canvas.alpha_composite(sprite, (round(x), round(y)))
    draw.text((46, 38), "Zombie dungeon V4: wall-block jambs / exact 6-cell gate / 6 tucked depth slices", fill=(226, 221, 211, 255))
    canvas.save(output, optimize=True)


def main() -> None:
    required = [
        MODEL_OUT / "zombie_wall_block.png",
        MODEL_OUT / "zombie_gate_frame_mask_source.png",
        MODEL_OUT / "zombie_gate_bars_mask_source.png",
        WALL_AI,
        GATE_AI,
    ]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("missing V4 finalization inputs: " + ", ".join(missing))

    ASSETS.mkdir(parents=True, exist_ok=True)
    wall = material_transfer(
        rgba(required[0]), rgba(WALL_AI), 0.42,
        dark=(0.035, 0.045, 0.060), light=(0.29, 0.34, 0.40),
    )
    geometry = json.loads((MODEL_OUT / "geometry.json").read_text(encoding="utf-8"))
    gate_geometry = geometry["gate"]
    material_finalize_offset = tuple(int(value) for value in gate_geometry.get("materialFinalizeOffset", [0, 0]))
    if len(material_finalize_offset) != 2:
        raise ValueError("gate.materialFinalizeOffset must contain exactly two integers")

    gate_generated = rgba(GATE_AI)
    gate_frame = material_transfer(
        rgba(required[1]), gate_generated, 0.34,
        dark=(0.030, 0.040, 0.055), light=(0.25, 0.30, 0.36),
    )
    gate_bars = material_transfer(rgba(required[2]), gate_generated, 0.48)
    gate_sheet, frames = build_gate_sheet(gate_frame, gate_bars, material_finalize_offset)

    wall_path = ASSETS / "zombie_wall_block.png"
    gate_path = ASSETS / "zombie_gate.png"
    wall.save(wall_path, optimize=True)
    gate_sheet.save(gate_path, optimize=True)

    final_wall = V4_OUT / "zombie_wall_block_v4_final.png"
    final_gate = V4_OUT / "zombie_portcullis_v4_closed_final.png"
    preview_path = V4_OUT / "zombie_dungeon_wall_v4_preview.png"
    diamond_preview_path = V4_OUT / "zombie_dungeon_wall_v4_diamond_preview.png"
    wall.save(final_wall, optimize=True)
    frames[0].save(final_gate, optimize=True)
    build_preview(wall, frames, preview_path)
    build_diamond_preview(wall, frames[0], geometry, diamond_preview_path)

    manifest = {
        "styleVersion": "world122-building-v4",
        "model": "flux2-klein-4b-depth",
        "structure": {
            "steps": 12,
            "variants": 3,
            "selected": {"wall": "v01", "gate": "authored-green-init"},
            "gateRejected": ["v01: added gatehouse", "v02: added gatehouse", "v03: added gatehouse"],
        },
        "refine": {"steps": 48, "variants": 2, "denoise": 0.30, "selected": {"wall": "v02", "gate": "v01"}},
        "gateCandidateRoot": str(GATE_SPIKE_OUT.relative_to(ROOT)),
        "geometryPolicy": "generated material only; Blender controls silhouette, alpha, wall-block jamb separation, six-slice tucked depth order, baseline alignment, and animation",
        "gateAlignment": {
            "materialFinalizeOffset": list(material_finalize_offset),
            "reason": "checked-in masks predate the gate-leaf baseline fix; a rebuilt Blender source exports [0, 0]",
        },
        "runtimeAssets": {
            "zombie_wall_block.png": {"size": list(wall.size), "sha256": digest(wall_path)},
            "zombie_gate.png": {"size": list(gate_sheet.size), "frameSize": [640, 640], "frames": 16, "sha256": digest(gate_path)},
        },
        "preview": preview_path.name,
        "diamondPreview": diamond_preview_path.name,
    }
    manifest_path = V4_OUT / "final-manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
