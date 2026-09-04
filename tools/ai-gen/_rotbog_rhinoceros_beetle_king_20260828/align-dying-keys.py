#!/usr/bin/env python3
"""Remove only horizontal root drift from approved death keys.

The fall/collapse Y trajectory and every source pixel are preserved.  Each key
receives one integer X translation before RIFE, avoiding a second resample and
keeping interpolation between already-aligned poses.
"""

from __future__ import annotations

import json
import math
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
spec = spec_from_file_location("rotbog_builder", ROOT / "build-rotbog-sheets.py")
builder = module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(builder)


def main() -> None:
    source_path = ROOT / "spritesheets" / "key" / "dying.png"
    source = np.asarray(Image.open(source_path).convert("RGBA"))
    cell_w, cell_h, cols, count = 896, 640, 5, 14
    target_x = 448
    cells: list[np.ndarray] = []
    source_centers: list[float] = []
    shifts: list[int] = []

    for index in range(count):
        row, col = divmod(index, cols)
        cell = source[row * cell_h:(row + 1) * cell_h,
                      col * cell_w:(col + 1) * cell_w].copy()
        core_x, _, _ = builder.core_geometry(cell)
        shift_x = int(round(target_x - core_x))
        aligned = np.zeros_like(cell)
        source_left = max(0, -shift_x)
        source_right = min(cell_w, cell_w - shift_x)
        dest_left = source_left + shift_x
        dest_right = source_right + shift_x
        aligned[:, dest_left:dest_right] = cell[:, source_left:source_right]
        aligned[..., :3][aligned[..., 3] == 0] = 0
        cells.append(aligned)
        source_centers.append(core_x)
        shifts.append(shift_x)

    rows = math.ceil(count / cols)
    sheet = np.zeros((rows * cell_h, cols * cell_w, 4), dtype=np.uint8)
    for index, cell in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * cell_h:(row + 1) * cell_h,
              col * cell_w:(col + 1) * cell_w] = cell

    output = ROOT / "spritesheets" / "key" / "dying-horizontal-aligned.png"
    Image.fromarray(sheet, "RGBA").save(output, optimize=True)
    previews = [builder.checker(cell) for cell in cells]
    preview = ROOT / "spritesheets" / "previews" / "dying-horizontal-aligned-key.gif"
    previews[0].save(preview, save_all=True, append_images=previews[1:],
                     duration=129, loop=0, disposal=2)
    report = {
        "source": str(source_path),
        "output": str(output),
        "frameCount": count,
        "frameWidth": cell_w,
        "frameHeight": cell_h,
        "cols": cols,
        "horizontalAlignment": "integer body-core X to 448 on source keys; Y unchanged",
        "sourceCoreX": [round(value, 3) for value in source_centers],
        "integerShiftX": shifts,
    }
    report_path = ROOT / "spritesheets" / "reports" / "dying-horizontal-align.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
