#!/usr/bin/env python3
"""Report union alpha bounds for a shared, pixel-exact runtime crop."""

from pathlib import Path

import numpy as np
from PIL import Image


TASK_ROOT = Path(__file__).resolve().parent
SOURCE_ROOT = TASK_ROOT / "postprocess/sheets-rife"
CELL = 512
SPECS = {
    "idle": (8, 38),
    "running": (8, 48),
    "attacking": (8, 71),
    "grenade_throw": (8, 79),
    "dying": (8, 47),
}


def main() -> None:
    global_mask = np.zeros((CELL, CELL), dtype=bool)
    for name, (cols, count) in SPECS.items():
        sheet = Image.open(SOURCE_ROOT / f"{name}.png").convert("RGBA")
        union = np.zeros((CELL, CELL), dtype=bool)
        for index in range(count):
            col = index % cols
            row = index // cols
            frame = np.asarray(sheet.crop((
                col * CELL,
                row * CELL,
                (col + 1) * CELL,
                (row + 1) * CELL,
            )))
            union |= frame[:, :, 3] > 0
        ys, xs = np.where(union)
        bounds = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
        print(f"{name}: bounds={bounds} size={bounds[2] - bounds[0]}x{bounds[3] - bounds[1]}")
        global_mask |= union
    ys, xs = np.where(global_mask)
    bounds = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    print(f"all: bounds={bounds} size={bounds[2] - bounds[0]}x{bounds[3] - bounds[1]}")


if __name__ == "__main__":
    main()
