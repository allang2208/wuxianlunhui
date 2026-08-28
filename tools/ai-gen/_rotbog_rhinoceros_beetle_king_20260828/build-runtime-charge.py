#!/usr/bin/env python3
"""Build integer root-locked charge keys before RIFE interpolation."""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

from importlib.util import module_from_spec, spec_from_file_location


ROOT = Path(__file__).resolve().parent
spec = spec_from_file_location("rotbog_builder", ROOT / "build-rotbog-sheets.py")
builder = module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(builder)

sys.path.insert(0, str(ROOT.parent))
chroma_spec = spec_from_file_location(
    "translucent_hover_builder", ROOT.parent / "build-translucent-hover-sheet.py"
)
chroma_builder = module_from_spec(chroma_spec)
assert chroma_spec.loader
chroma_spec.loader.exec_module(chroma_builder)


def decontaminate_opaque_edges(
    rgba: np.ndarray, alpha_floor: int = 12
) -> tuple[np.ndarray, dict[str, int]]:
    """Replace blue-screen-mixed antialias RGB from the nearest opaque beetle pixel."""
    result = rgba.copy()
    alpha = result[..., 3]
    faint = (alpha > 0) & (alpha < alpha_floor)
    cleared = int(faint.sum())
    result[faint] = 0
    alpha = result[..., 3]
    opaque = alpha >= 240
    edge = (alpha >= alpha_floor) & (alpha < 240)
    if opaque.any() and edge.any():
        _, nearest = chroma_builder.ndimage.distance_transform_edt(
            ~opaque, return_indices=True
        )
        ys, xs = np.where(edge)
        result[ys, xs, :3] = result[
            nearest[0][ys, xs], nearest[1][ys, xs], :3
        ]
    result[result[..., 3] == 0, :3] = 0
    return result, {"faintAlphaCleared": cleared, "edgeRgbRecolored": int(edge.sum())}


def main() -> None:
    source_path = ROOT / "spritesheets" / "key" / "charge-mosquito-clean-v4.png"
    source = np.asarray(Image.open(source_path).convert("RGBA"))
    source_w, cell_h, source_cols, count = 1536, 640, 5, 16
    target_w, target_x = 768, 384
    cells = []
    source_centers = []
    spill_stats = []
    edge_stats = []
    for index in range(count):
        row, col = divmod(index, source_cols)
        cell = source[row * cell_h:(row + 1) * cell_h,
                      col * source_w:(col + 1) * source_w].copy()
        clean_rgb, clean_alpha, pre_stats = chroma_builder.remove_blue_chroma_spill(
            cell[..., :3].copy(), cell[..., 3].copy(), radius=6, threshold=6
        )
        cell = np.dstack([clean_rgb, clean_alpha])
        cell, frame_edge_stats = decontaminate_opaque_edges(cell)
        core_x, _, _ = builder.core_geometry(cell)
        source_centers.append(core_x)
        shift_x = int(round(target_x - core_x))
        locked = np.zeros((cell_h, target_w, 4), dtype=np.uint8)
        source_left = max(0, -shift_x)
        source_right = min(source_w, target_w - shift_x)
        if source_right <= source_left:
            raise RuntimeError(f"charge key {index}: integer crop removed the subject")
        dest_left = source_left + shift_x
        dest_right = source_right + shift_x
        locked[:, dest_left:dest_right] = cell[:, source_left:source_right]
        locked_rgb, locked_alpha, post_stats = chroma_builder.remove_blue_chroma_spill(
            locked[..., :3].copy(), locked[..., 3].copy(), radius=6, threshold=6
        )
        locked = np.dstack([locked_rgb, locked_alpha])
        locked[..., :3][locked[..., 3] == 0] = 0
        cells.append(locked)
        spill_stats.append({
            key: pre_stats[key] + post_stats[key]
            for key in pre_stats
        })
        edge_stats.append(frame_edge_stats)

    cols = 5
    rows = math.ceil(count / cols)
    sheet = np.zeros((rows * cell_h, cols * target_w, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * cell_h:(row + 1) * cell_h,
              col * target_w:(col + 1) * target_w] = cell
    out_dir = ROOT / "spritesheets" / "runtime"
    out_dir.mkdir(parents=True, exist_ok=True)
    Image.fromarray(sheet, "RGBA").save(out_dir / "charge-key.png", optimize=True)

    previews = [builder.checker(cell) for cell in cells]
    previews[0].save(out_dir / "charge-key-preview.gif", save_all=True,
                     append_images=previews[1:], duration=150, loop=0, disposal=2)
    report = {
        "source": str(source_path),
        "output": str(out_dir / "charge-key.png"),
        "frameCount": count,
        "frameWidth": target_w,
        "frameHeight": cell_h,
        "cols": cols,
        "rows": rows,
        "rootLock": "integer X translation on approved source keys before RIFE; Y unchanged",
        "sourceFrames": [0, 8, 16, 24, 32, 48, 56, 60, 64, 68, 72, 76, 80, 88, 104, 120],
        "phaseTiming": {
            "totalMs": 2400,
            "prepare": {"keyRange": [0, 6], "durationMs": 960},
            "charge": {"keyRange": [6, 12], "durationMs": 960},
            "recovery": {"keyRange": [12, 15], "durationMs": 480},
            "note": "source 56..80 is preserved across the complete runtime charge phase instead of compressed into half a second",
        },
        "sourceCoreX": [round(value, 3) for value in source_centers],
        "blueSpillCleanup": {
            "radius": 6,
            "threshold": 6,
            "pipeline": "BiRefNet source rebuild + swamp mosquito nearest-clean recolor/remote haze clear + opaque edge RGB decontamination",
            "pixels": {
                key: sum(frame_stats[key] for frame_stats in spill_stats)
                for key in spill_stats[0]
            },
        },
        "opaqueEdgeCleanup": {
            "alphaFloor": 12,
            "faintAlphaCleared": sum(item["faintAlphaCleared"] for item in edge_stats),
            "edgeRgbRecolored": sum(item["edgeRgbRecolored"] for item in edge_stats),
        },
    }
    (out_dir / "charge-key-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
