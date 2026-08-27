#!/usr/bin/env python3
"""Remove cyan compression spill, refresh previews, and audit v02 werewolf sheets."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


TASK = Path(__file__).resolve().parent
REPO = TASK.parents[2]
REPORT_PATH = TASK / "werewolf-v02-sprite-build-report.json"
RIFE_MODULE = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
PREVIEW_DIR = TASK / "previews" / "sprites-v02"
KEY_COLS = {"idle": 5, "transform": 4, "run": 5, "attack": 4, "howl": 4, "dying": 4, "pounce": 4}


def load_rife_module():
    spec = importlib.util.spec_from_file_location("werewolf_v02_rife", RIFE_MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def extract_cells(path: Path, cols: int, count: int, cell: int) -> list[np.ndarray]:
    image = np.asarray(Image.open(path).convert("RGBA")).copy()
    cells = []
    for index in range(count):
        row, col = divmod(index, cols)
        cells.append(image[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell].copy())
    return cells


def compose(cells: list[np.ndarray], cols: int, cell: int) -> np.ndarray:
    rows = (len(cells) + cols - 1) // cols
    sheet = np.zeros((rows * cell, cols * cell, 4), dtype=np.uint8)
    for index, frame in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell] = frame
    return sheet


def clean_frame(frame: np.ndarray) -> int:
    rgb = frame[..., :3].astype(np.int16)
    alpha = frame[..., 3]
    cyan = (
        (alpha > 4)
        & (rgb[..., 2] > 30)
        & (rgb[..., 1] > rgb[..., 0] + 4)
        & (rgb[..., 2] > rgb[..., 0] + 8)
    )
    count = int(cyan.sum())
    if not count:
        frame[alpha == 0, :3] = 0
        return 0
    valid = (alpha > 8) & ~cyan
    if not valid.any():
        raise RuntimeError("cyan cleanup found no valid character pixels")
    _, nearest = ndimage.distance_transform_edt(~valid, return_indices=True)
    ys, xs = np.where(cyan)
    frame[ys, xs, :3] = frame[nearest[0, ys, xs], nearest[1, ys, xs], :3]
    faint = cyan & (alpha < 24)
    frame[faint] = 0
    frame[frame[..., 3] == 0, :3] = 0
    return count


def audit(cells: list[np.ndarray], cell: int) -> dict:
    boxes = []
    cyan_counts = []
    for frame in cells:
        ys, xs = np.where(frame[..., 3] > 8)
        boxes.append(None if not xs.size else [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())])
        rgb = frame[..., :3].astype(np.int16)
        alpha = frame[..., 3]
        cyan_counts.append(int((
            (alpha > 4)
            & (rgb[..., 2] > 30)
            & (rgb[..., 1] > rgb[..., 0] + 4)
            & (rgb[..., 2] > rgb[..., 0] + 8)
        ).sum()))
    touching = [
        index for index, box in enumerate(boxes)
        if box and (box[0] <= 2 or box[1] <= 2 or box[2] >= cell - 3 or box[3] >= cell - 3)
    ]
    bottoms = [box[3] for box in boxes if box]
    return {
        "emptyFrames": [index for index, box in enumerate(boxes) if box is None],
        "touchingFrames": touching,
        "alphaBottomMin": min(bottoms),
        "alphaBottomMax": max(bottoms),
        "cyanSuspectPixelsByFrame": cyan_counts,
        "cyanSuspectPixelsTotal": sum(cyan_counts),
        "nonzeroRgbInTransparentPixels": max(
            int(np.count_nonzero(frame[..., :3][frame[..., 3] == 0])) for frame in cells
        ),
    }


def main() -> None:
    report = json.loads(REPORT_PATH.read_text(encoding="utf-8"))
    rife = load_rife_module()
    requested = set(sys.argv[1:])
    unknown = requested.difference(report["actions"])
    if unknown:
        raise SystemExit(f"unknown actions: {sorted(unknown)}")
    for name, action in report["actions"].items():
        if requested and name not in requested:
            continue
        key_path = TASK / action["sourceKeySheet"]
        final_path = TASK / action["spriteSheet"]
        key_cols = KEY_COLS[name]
        out_cols = action["grid"][0]
        cell = int(action["frameSize"][0])
        key_cells = extract_cells(key_path, key_cols, len(action["sourceFrames"]), cell)
        final_cells = extract_cells(final_path, out_cols, action["frameCount"], cell)
        key_replaced = sum(clean_frame(frame) for frame in key_cells)
        final_replaced = sum(clean_frame(frame) for frame in final_cells)
        Image.fromarray(compose(key_cells, key_cols, cell), "RGBA").save(key_path, optimize=True)
        Image.fromarray(compose(final_cells, out_cols, cell), "RGBA").save(final_path, optimize=True)

        rife_report = json.loads(
            (TASK / "reports" / "sprites-v02" / f"{name}-rife.json").read_text(encoding="utf-8")
        )
        preview_name = f"red-werewolf-v02-{name}"
        rife.write_previews(
            preview_name,
            final_cells,
            float(rife_report["sourceFrameRate"]),
            action["mode"],
            PREVIEW_DIR,
        )
        action["previewGif"] = f"previews/sprites-v02/{preview_name}-interpolated.gif"
        action["contactSheet"] = f"previews/sprites-v02/{preview_name}-interpolated-contact.png"
        action["cyanSpillPixelsReplaced"] = {
            "sourceKeyframes": key_replaced,
            "interpolatedSheet": final_replaced,
        }
        action["postProcessValidation"] = audit(final_cells, cell)

    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({
        name: action["postProcessValidation"]
        for name, action in report["actions"].items()
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
