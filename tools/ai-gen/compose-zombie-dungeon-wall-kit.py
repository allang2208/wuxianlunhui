#!/usr/bin/env python3
"""Assemble Blender wall-kit renders into runtime assets and a contact sheet."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools" / "ai-gen" / "_zombie_dungeon_walls_20260826"
ASSETS = ROOT / "assets" / "terrain"


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def build_diamond_preview(wall: Image.Image, closed_gate: Image.Image, geometry: dict, output: Path):
    """Compose the runtime-sized 12-cell ring without launching the game."""
    canvas = Image.new("RGBA", (2000, 1240), (8, 9, 12, 255))
    draw = ImageDraw.Draw(canvas)
    center = (1000.0, 560.0)
    edge_cells = 12
    rx, ry = edge_cells * 64.0, edge_cells * 32.0
    top = (center[0], center[1] - ry)
    right = (center[0] + rx, center[1])
    bottom = (center[0], center[1] + ry)
    left = (center[0] - rx, center[1])
    draw.polygon([top, right, bottom, left], fill=(17, 18, 22, 255), outline=(65, 60, 55, 255), width=3)

    # Faint square-brick guide lines make the shared integer grid legible.
    for index in range(-11, 12):
        offset_x, offset_y = index * 64, index * 32
        draw.line([(center[0] - rx + abs(offset_x), center[1] + offset_y),
                   (center[0] + rx - abs(offset_x), center[1] + offset_y)], fill=(32, 33, 38, 255), width=1)

    vertices = [top, right, bottom, left]
    edges = list(zip(vertices, vertices[1:] + vertices[:1]))
    start_index, end_index = 3, 9
    pieces = []
    wall_display = wall.resize(tuple(geometry["wall"]["display"]), Image.Resampling.LANCZOS)
    ground = geometry["wall"]["groundCenter"]
    ground_scaled = (
        ground[0] * wall_display.width / wall.width,
        ground[1] * wall_display.height / wall.height,
    )
    for edge_index, (start, end) in enumerate(edges):
        step = ((end[0] - start[0]) / edge_cells, (end[1] - start[1]) / edge_cells)
        for index in range(edge_cells):
            if edge_index == 1 and start_index < index < end_index:
                continue
            point = (start[0] + step[0] * index, start[1] + step[1] * index)
            pieces.append((point[1] + 4, wall_display, point[0] - ground_scaled[0], point[1] - ground_scaled[1]))

    gate_geo = geometry["gate"]
    rb_start, rb_end = edges[1]
    rb_step = ((rb_end[0] - rb_start[0]) / edge_cells, (rb_end[1] - rb_start[1]) / edge_cells)
    opening_a = (rb_start[0] + rb_step[0] * start_index, rb_start[1] + rb_step[1] * start_index)
    opening_b = (rb_start[0] + rb_step[0] * end_index, rb_start[1] + rb_step[1] * end_index)
    p0 = gate_geo["base"][0]
    p1 = gate_geo["base"][1]
    scale_x = abs(opening_b[0] - opening_a[0]) / abs(p1[0] - p0[0])
    scale_y = abs(opening_b[1] - opening_a[1]) / abs(p1[1] - p0[1])
    gate_x = opening_a[0] - (gate_geo["canvas"][0] - p0[0]) * scale_x
    gate_y = opening_a[1] - p0[1] * scale_y
    slices = max(1, int(gate_geo.get("depthSlices", 1)))
    hole_start, hole_end = gate_geo.get("gateX", [p0[0], p1[0]])
    hole_span = hole_end - hole_start
    for index in range(slices):
        tx0 = hole_start + hole_span * index / slices
        tx1 = hole_start + hole_span * (index + 1) / slices
        left = int(tx0)
        right = int(tx1 + 0.999999)
        gate = closed_gate.crop((left, 0, right, closed_gate.height))
        gate = gate.resize(
            (max(1, round(gate.width * scale_x)), max(1, round(gate.height * scale_y))),
            Image.Resampling.LANCZOS,
        ).transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        segment_x = gate_x + (gate_geo["canvas"][0] - right) * scale_x
        t0 = (tx0 - p0[0]) / (p1[0] - p0[0])
        t1 = (tx1 - p0[0]) / (p1[0] - p0[0])
        y0 = opening_a[1] + (opening_b[1] - opening_a[1]) * t0
        y1 = opening_a[1] + (opening_b[1] - opening_a[1]) * t1
        pieces.append((max(y0, y1) + 3.9, gate, segment_x, gate_y))

    for _, sprite, x, y in sorted(pieces, key=lambda item: item[0]):
        canvas.alpha_composite(sprite, (round(x), round(y)))
    draw.text((46, 38), "Zombie dungeon standard: wall-block jambs / exact 6-cell gate / 3 depth slices", fill=(226, 221, 211, 255))
    draw.text((46, 68), "Static assembly preview; collision follows the same base segments.", fill=(153, 147, 139, 255))
    canvas.save(output, optimize=True)


def main():
    wall_src = OUT / "zombie_wall_block.png"
    frame_paths = [OUT / "gate_frames" / f"gate_{index:02d}.png" for index in range(16)]
    geometry_path = OUT / "geometry.json"
    required = [wall_src, geometry_path, *frame_paths]
    missing = [str(path) for path in required if not path.exists()]
    if missing:
        raise FileNotFoundError("missing Blender outputs: " + ", ".join(missing))

    ASSETS.mkdir(parents=True, exist_ok=True)
    wall_dst = ASSETS / "zombie_wall_block.png"
    gate_dst = ASSETS / "zombie_gate.png"
    wall = Image.open(wall_src).convert("RGBA")
    wall.save(wall_dst, optimize=True)

    sheet = Image.new("RGBA", (640 * 4, 640 * 4), (0, 0, 0, 0))
    frames = []
    for index, path in enumerate(frame_paths):
        frame = Image.open(path).convert("RGBA")
        if frame.size != (640, 640):
            raise ValueError(f"unexpected frame size {path}: {frame.size}")
        frames.append(frame)
        sheet.alpha_composite(frame, ((index % 4) * 640, (index // 4) * 640))
    sheet.save(gate_dst, optimize=True)

    preview = Image.new("RGBA", (1600, 920), (14, 15, 19, 255))
    draw = ImageDraw.Draw(preview)
    draw.text((40, 28), "Zombie Dungeon Wall Kit - modeled geometry / runtime renders", fill=(224, 226, 232, 255))
    wall_preview = wall.copy()
    wall_preview.thumbnail((700, 780), Image.Resampling.LANCZOS)
    preview.alpha_composite(wall_preview, (40 + (700 - wall_preview.width) // 2, 95))
    for slot, frame_index in enumerate((0, 5, 10, 15)):
        frame = frames[frame_index].copy()
        frame.thumbnail((400, 400), Image.Resampling.LANCZOS)
        x = 800 + (slot % 2) * 390
        y = 95 + (slot // 2) * 390
        preview.alpha_composite(frame, (x, y))
        draw.text((x + 12, y + 12), f"gate frame {frame_index}", fill=(210, 181, 131, 255))
    preview_path = OUT / "preview.png"
    preview.save(preview_path, optimize=True)
    geometry = json.loads(geometry_path.read_text(encoding="utf-8"))
    diamond_preview_path = OUT / "diamond-preview.png"
    build_diamond_preview(wall, frames[0], geometry, diamond_preview_path)

    manifest = {
        "pipeline": "Blender geometry -> transparent render -> spritesheet assembly",
        "editableModel": "zombie_dungeon_wall_kit.blend",
        "gatePolicy": "bare six-cell iron leaf; matching endpoint jambs come from runtime zombie wall blocks; three depth slices",
        "geometry": geometry,
        "modelRenderAssets": {
            "zombie_wall_block.png": {"size": list(wall.size), "sha256": digest(wall_dst)},
            "zombie_gate.png": {"size": list(sheet.size), "frameSize": [640, 640], "frames": 16, "sha256": digest(gate_dst)},
        },
        "preview": preview_path.name,
        "diamondPreview": diamond_preview_path.name,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
