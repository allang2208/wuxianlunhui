#!/usr/bin/env python3
"""Final cyan-spill cleanup, preview refresh, and static sheet audit."""

from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


TASK = Path(__file__).resolve().parent
REPO = TASK.parents[2]
BUILD_REPORT = TASK / "runtime-build-report.json"
PREVIEW_DIR = TASK / "previews" / "runtime"
RIFE_MODULE = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"


def load_rife_module():
    spec = importlib.util.spec_from_file_location("red_wolf_rife_preview", RIFE_MODULE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def extract_cells(path: Path, cell: int, cols: int, count: int) -> list[np.ndarray]:
    image = np.asarray(Image.open(path).convert("RGBA")).copy()
    cells = []
    for index in range(count):
        row, col = divmod(index, cols)
        cells.append(image[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell].copy())
    return cells


def compose(cells: list[np.ndarray], cols: int) -> np.ndarray:
    cell = cells[0].shape[0]
    rows = (len(cells) + cols - 1) // cols
    sheet = np.zeros((rows * cell, cols * cell, 4), dtype=np.uint8)
    for index, frame in enumerate(cells):
        row, col = divmod(index, cols)
        sheet[row * cell:(row + 1) * cell, col * cell:(col + 1) * cell] = frame
    return sheet


def shift_frame_x(frame: np.ndarray, dx: int) -> np.ndarray:
    if dx == 0:
        return frame
    shifted = np.zeros_like(frame)
    if dx > 0:
        shifted[:, dx:] = frame[:, :-dx]
    else:
        shifted[:, :dx] = frame[:, -dx:]
    return shifted


def clean_frame(frame: np.ndarray) -> int:
    rgb = frame[..., :3].astype(np.int16)
    visible = frame[..., 3] > 8
    cyan = (
        visible
        & (rgb[..., 1] > 45)
        & (rgb[..., 2] > 55)
        & (rgb[..., 1] - rgb[..., 0] > 15)
        & (rgb[..., 2] - rgb[..., 0] > 22)
    )
    count = int(cyan.sum())
    if not count:
        return 0
    valid = visible & ~cyan
    if not valid.any():
        raise SystemExit("cyan cleanup removed the entire frame")
    _, nearest = ndimage.distance_transform_edt(~valid, return_indices=True)
    ys, xs = np.where(cyan)
    frame[ys, xs, :3] = frame[nearest[0, ys, xs], nearest[1, ys, xs], :3]
    return count


def bbox(frame: np.ndarray) -> list[int] | None:
    ys, xs = np.where(frame[..., 3] > 8)
    if not xs.size:
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def audit(cells: list[np.ndarray]) -> dict:
    boxes = [bbox(frame) for frame in cells]
    touching = [
        index for index, box in enumerate(boxes)
        if box and (box[0] <= 2 or box[1] <= 2 or box[2] >= cells[index].shape[1] - 3 or box[3] >= cells[index].shape[0] - 3)
    ]
    cyan_counts = []
    bottoms = []
    for frame, box in zip(cells, boxes):
        rgb = frame[..., :3].astype(np.int16)
        visible = frame[..., 3] > 8
        cyan_counts.append(int((
            visible & (rgb[..., 1] > 45) & (rgb[..., 2] > 55)
            & (rgb[..., 1] - rgb[..., 0] > 15)
            & (rgb[..., 2] - rgb[..., 0] > 22)
        ).sum()))
        bottoms.append(box[3] if box else None)
    first = boxes[0]
    return {
        "emptyFrames": [index for index, box in enumerate(boxes) if box is None],
        "touchingFrames": touching,
        "firstFrameContentHeight": first[3] - first[1] + 1 if first else None,
        "alphaBottomMin": min(value for value in bottoms if value is not None),
        "alphaBottomMax": max(value for value in bottoms if value is not None),
        "cyanSuspectPixelsByFrame": cyan_counts,
        "cyanSuspectPixelsTotal": sum(cyan_counts),
        "nonzeroRgbInTransparentPixels": max(
            int(np.count_nonzero(frame[..., :3][frame[..., 3] == 0])) for frame in cells
        ),
    }


def ground_anchors(cells: list[np.ndarray], foot: int) -> list[int]:
    anchors = []
    for index, frame in enumerate(cells):
        ground_band = frame[max(0, foot - 36):min(frame.shape[0], foot + 2), :, 3] > 16
        _, xs = np.where(ground_band)
        if not xs.size:
            raise SystemExit(f"frame {index}: no grounded paw pixels")
        anchors.append(round((int(xs.min()) + int(xs.max())) / 2))
    return anchors


def lock_ground_anchors(cells: list[np.ndarray], foot: int, target: int) -> list[int]:
    shifts = [target - anchor for anchor in ground_anchors(cells, foot)]
    for index, dx in enumerate(shifts):
        cells[index] = shift_frame_x(cells[index], dx)
    return shifts


def main() -> None:
    report = json.loads(BUILD_REPORT.read_text(encoding="utf-8"))
    rife = load_rife_module()
    for name, action in report["actions"].items():
        key_path = TASK / action["sourceKeySheet"]
        runtime_path = TASK / action["runtimeSheet"]
        cell = action["frameSize"][0]
        key_cols = 4
        key_count = len(action["sourceFrames"])
        out_cols, _ = action["grid"]
        out_count = action["frameCount"]

        key_cells = extract_cells(key_path, cell, key_cols, key_count)
        runtime_cells = extract_cells(runtime_path, cell, out_cols, out_count)
        key_x_shifts = []
        runtime_x_shifts = []
        if name == "howl":
            target = 314
            key_x_shifts = lock_ground_anchors(key_cells, 513, target)
            runtime_x_shifts = lock_ground_anchors(runtime_cells, 513, target)
        key_replaced = sum(clean_frame(frame) for frame in key_cells)
        runtime_replaced = sum(clean_frame(frame) for frame in runtime_cells)
        Image.fromarray(compose(key_cells, key_cols), "RGBA").save(key_path, optimize=True)
        Image.fromarray(compose(runtime_cells, out_cols), "RGBA").save(runtime_path, optimize=True)

        keys_preserved = all(
            np.array_equal(source, runtime_cells[index * 2])
            for index, source in enumerate(key_cells)
        )
        rife_report = json.loads((TASK / "reports" / f"{name}-rife.json").read_text(encoding="utf-8"))
        rife.write_previews(
            f"red-wolf-{name}", runtime_cells,
            float(rife_report["sourceFrameRate"]), action["mode"], PREVIEW_DIR,
        )
        action["postRifeCyanSpillPixelsReplaced"] = runtime_replaced
        action["sourceKeyCyanSpillPixelsReplacedFinalPass"] = key_replaced
        action["postProcessValidation"] = audit(runtime_cells)
        action["postProcessValidation"]["sourceKeyFramesPreservedAtEvenIndices"] = keys_preserved
        if name == "howl":
            action["sourceXGroundTarget"] = target
            action["sourceXShifts"] = [
                target - anchor for anchor in action["sourceXGroundAnchors"]
            ]
            action["sourceXGroundAnchorsAfterShift"] = [
                anchor + dx
                for anchor, dx in zip(action["sourceXGroundAnchors"], action["sourceXShifts"])
            ]
            anchors = ground_anchors(runtime_cells, 513)
            action["postProcessSourceKeyGroundAnchorXShifts"] = key_x_shifts
            action["postRifeGroundAnchorXShifts"] = runtime_x_shifts
            action["postProcessValidation"]["groundAnchorXByFrame"] = anchors
            action["postProcessValidation"]["groundAnchorXMin"] = min(anchors)
            action["postProcessValidation"]["groundAnchorXMax"] = max(anchors)

    BUILD_REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({name: action["postProcessValidation"] for name, action in report["actions"].items()}, indent=2))


if __name__ == "__main__":
    main()
