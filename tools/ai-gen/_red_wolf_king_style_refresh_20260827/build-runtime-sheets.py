#!/usr/bin/env python3
"""Build size-normalized, RIFE-interpolated RedWolfKing wolf-form sheets."""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


TASK = Path(__file__).resolve().parent
REPO = TASK.parents[2]
REBUILD = REPO / "tools" / "ai-gen" / "rebuild-h3-birefnet.py"
RIFE_SHEET = REPO / "tools" / "ai-gen" / "rife-spritesheet-interpolate.py"
RIFE_EXE = (
    REPO.parent / "_tmp" / "elise_audit" / "rife"
    / "rife-ncnn-vulkan-20221029-windows" / "rife-ncnn-vulkan.exe"
)
MEASUREMENTS = TASK / "source-video-measurements.json"
KEY_DIR = TASK / "sheets" / "source-keyframes"
FINAL_DIR = TASK / "sheets" / "interpolated"
PREVIEW_DIR = TASK / "previews" / "runtime"
REPORT_DIR = TASK / "reports"

SPECS = {
    "idle": {
        "video": "red-wolf-idle-h3-v01.mp4",
        "runtime": "idle.png",
        "frames": [0, 10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110],
        "cell": 512, "center": 256, "foot": 410, "scale": 262 / 370,
        "uniform": True, "keep_dx": False, "mode": "loop", "source_fps": 2.5,
        "key_cols": 4, "out_cols": 6,
    },
    "running": {
        "video": "red-wolf-running-h3-v01.mp4",
        "runtime": "running.png",
        "frames": list(range(44, 60)),
        "cell": 640, "center": 320, "foot": 513, "scale": 262 / 320,
        "uniform": True, "keep_dx": False, "mode": "loop", "source_fps": 24.0,
        "key_cols": 4, "out_cols": 8,
    },
    "attack": {
        "video": "red-wolf-attack-bite-h3-v01.mp4",
        "runtime": "attack.png",
        "frames": [0, 16, 22, 26, 32, 45, 58, 71, 84, 91, 104],
        "cell": 640, "center": 300, "foot": 513, "scale": 262 / 320,
        "uniform": False, "keep_dx": True, "mode": "one-shot", "source_fps": 10.0,
        "key_cols": 4, "out_cols": 5,
    },
    "pounce": {
        "video": "red-wolf-pounce-h3-v01.mp4",
        "runtime": "pounce.png",
        "frames": [0, 6, 13, 19, 26, 32, 39, 45, 52, 58, 65, 71],
        "cell": 960, "center": 300, "foot": 769, "scale": 262 / 224,
        "uniform": False, "keep_dx": True, "mode": "one-shot", "source_fps": 23 / 3.6,
        "key_cols": 4, "out_cols": 5, "restore_source_y": True,
    },
    "howl": {
        "video": "red-wolf-howl-h3-v01.mp4",
        "runtime": "howl.png",
        "frames": [0, 16, 25, 33, 41, 49, 57, 74, 90, 98, 107, 115],
        "cell": 640, "center": 320, "foot": 513, "scale": 262 / 370,
        "uniform": False, "keep_dx": False, "mode": "one-shot", "source_fps": 23 / 6,
        "key_cols": 4, "out_cols": 5, "lock_ground_x": True,
        "ground_x_target": 314,
    },
    "dying": {
        "video": "red-wolf-dying-h3-v01.mp4",
        "runtime": "dying.png",
        "frames": [0, 6, 13, 19, 23, 26, 32, 39, 52, 78, 104, 123],
        "cell": 640, "center": 300, "foot": 513, "scale": 262 / 370,
        "uniform": False, "keep_dx": True, "mode": "one-shot", "source_fps": 23 / 4,
        "key_cols": 4, "out_cols": 5,
    },
}


def run(command: list[str]) -> None:
    print("[red-wolf-build]", " ".join(command), flush=True)
    subprocess.run(command, check=True)


def shift_cell(frame: np.ndarray, dy: int) -> np.ndarray:
    if dy == 0:
        return frame
    shifted = np.zeros_like(frame)
    if dy > 0:
        shifted[dy:] = frame[:-dy]
    else:
        shifted[:dy] = frame[-dy:]
    return shifted


def shift_cell_x(frame: np.ndarray, dx: int) -> np.ndarray:
    if dx == 0:
        return frame
    shifted = np.zeros_like(frame)
    if dx > 0:
        shifted[:, dx:] = frame[:, :-dx]
    else:
        shifted[:, :dx] = frame[:, -dx:]
    return shifted


def lock_ground_horizontal(sheet_path: Path, spec: dict) -> tuple[list[int], list[int]]:
    """Keep the grounded paw span centered so silhouette changes cannot slide the body."""
    cell = spec["cell"]
    cols = spec["key_cols"]
    foot = spec["foot"]
    image = np.asarray(Image.open(sheet_path).convert("RGBA")).copy()
    anchors: list[int] = []
    cells: list[tuple[int, int]] = []
    for index in range(len(spec["frames"])):
        row, col = divmod(index, cols)
        y0, x0 = row * cell, col * cell
        frame = image[y0:y0 + cell, x0:x0 + cell]
        ground_band = frame[max(0, foot - 36):min(cell, foot + 2), :, 3] > 16
        _, xs = np.where(ground_band)
        if not xs.size:
            raise SystemExit(f"{sheet_path.name} frame {index}: no grounded paw pixels")
        anchors.append(round((int(xs.min()) + int(xs.max())) / 2))
        cells.append((y0, x0))

    target = spec.get("ground_x_target", round(float(np.median(anchors))))
    shifts = [target - anchor for anchor in anchors]
    for (y0, x0), dx in zip(cells, shifts):
        frame = image[y0:y0 + cell, x0:x0 + cell]
        image[y0:y0 + cell, x0:x0 + cell] = shift_cell_x(frame, dx)
    Image.fromarray(image, "RGBA").save(sheet_path, optimize=True)
    return anchors, shifts


def clean_cyan_spill(sheet_path: Path, spec: dict) -> int:
    """Replace opaque cyan compression fringe with nearest valid wolf fur."""
    cell = spec["cell"]
    cols = spec["key_cols"]
    image = np.asarray(Image.open(sheet_path).convert("RGBA")).copy()
    replaced = 0
    for index in range(len(spec["frames"])):
        row, col = divmod(index, cols)
        y0, x0 = row * cell, col * cell
        frame = image[y0:y0 + cell, x0:x0 + cell]
        rgb = frame[..., :3].astype(np.int16)
        visible = frame[..., 3] > 8
        cyan = (
            visible
            & (rgb[..., 1] > 65)
            & (rgb[..., 2] > 75)
            & (rgb[..., 1] - rgb[..., 0] > 22)
            & (rgb[..., 2] - rgb[..., 0] > 32)
        )
        count = int(cyan.sum())
        if not count:
            continue
        valid = visible & ~cyan
        if not valid.any():
            raise SystemExit(f"{sheet_path.name} frame {index}: no valid fur after cyan mask")
        _, nearest = ndimage.distance_transform_edt(~valid, return_indices=True)
        ys, xs = np.where(cyan)
        frame[ys, xs, :3] = frame[nearest[0, ys, xs], nearest[1, ys, xs], :3]
        replaced += count
    Image.fromarray(image, "RGBA").save(sheet_path, optimize=True)
    return replaced


def restore_source_vertical_motion(sheet_path: Path, spec: dict, measurements: dict) -> list[int]:
    cell = spec["cell"]
    cols = spec["key_cols"]
    image = np.asarray(Image.open(sheet_path).convert("RGBA")).copy()
    boxes = measurements["pounce"]["selectedBboxes"]
    reference_bottom = boxes[str(spec["frames"][0])][3]
    shifts = []
    for index, source_index in enumerate(spec["frames"]):
        source_bottom = boxes[str(source_index)][3]
        dy = round((source_bottom - reference_bottom) * spec["scale"])
        row, col = divmod(index, cols)
        y0, x0 = row * cell, col * cell
        image[y0:y0 + cell, x0:x0 + cell] = shift_cell(
            image[y0:y0 + cell, x0:x0 + cell], dy
        )
        shifts.append(dy)
    Image.fromarray(image, "RGBA").save(sheet_path, optimize=True)
    return shifts


def main() -> None:
    if not RIFE_EXE.exists():
        raise SystemExit(f"RIFE missing: {RIFE_EXE}")
    measurements = json.loads(MEASUREMENTS.read_text(encoding="utf-8"))
    for directory in (KEY_DIR, FINAL_DIR, PREVIEW_DIR, REPORT_DIR):
        directory.mkdir(parents=True, exist_ok=True)

    requested = set(sys.argv[1:])
    unknown = requested.difference(SPECS)
    if unknown:
        raise SystemExit(f"Unknown actions: {sorted(unknown)}")
    report_path = TASK / "runtime-build-report.json"
    if report_path.exists():
        build_report = json.loads(report_path.read_text(encoding="utf-8"))
    else:
        build_report = {
            "targetEffectiveBodyHeight": 262,
            "normalCellFoot": {"cell": 512, "footY": 410},
            "actions": {},
        }
    for name, spec in SPECS.items():
        if requested and name not in requested:
            continue
        key_sheet = KEY_DIR / f"{name}-keyframes.png"
        final_sheet = FINAL_DIR / spec["runtime"]
        command = [
            sys.executable, str(REBUILD),
            "--video", str(TASK / "videos" / spec["video"]),
            "--out", str(key_sheet),
            "--frames", ",".join(map(str, spec["frames"])),
            "--cols", str(spec["key_cols"]),
            "--cell", str(spec["cell"]),
            "--center-x", str(spec["center"]),
            "--feet-y", str(spec["foot"]),
            "--target-h", "262",
            "--scale", str(spec["scale"]),
            "--hard-edge", "245",
            "--edge-dark", "18",
            "--zero-transparent-rgb",
            "--bg-color", "#00D9FF",
            "--bg-dist", "48",
        ]
        if spec["uniform"]:
            command.append("--uniform-h")
        if spec["keep_dx"]:
            command.append("--keep-dx")
        run(command)

        cyan_spill_replaced = clean_cyan_spill(key_sheet, spec)
        source_y_shifts = []
        if spec.get("restore_source_y"):
            source_y_shifts = restore_source_vertical_motion(key_sheet, spec, measurements)
        source_x_anchors = []
        source_x_shifts = []
        if spec.get("lock_ground_x"):
            source_x_anchors, source_x_shifts = lock_ground_horizontal(key_sheet, spec)

        report = REPORT_DIR / f"{name}-rife.json"
        run([
            sys.executable, str(RIFE_SHEET),
            "--sheet", str(key_sheet),
            "--out", str(final_sheet),
            "--name", f"red-wolf-{name}",
            "--frame-width", str(spec["cell"]),
            "--frame-height", str(spec["cell"]),
            "--cols", str(spec["key_cols"]),
            "--frame-count", str(len(spec["frames"])),
            "--frame-rate", str(spec["source_fps"]),
            "--mode", spec["mode"],
            "--out-cols", str(spec["out_cols"]),
            "--preview-dir", str(PREVIEW_DIR),
            "--report", str(report),
            "--rife", str(RIFE_EXE),
            "--repair-red-outliers",
        ])
        rife_report = json.loads(report.read_text(encoding="utf-8"))
        build_report["actions"][name] = {
            "sourceVideo": f"videos/{spec['video']}",
            "sourceFrames": spec["frames"],
            "sourceKeySheet": str(key_sheet.relative_to(TASK)).replace("\\", "/"),
            "runtimeSheet": str(final_sheet.relative_to(TASK)).replace("\\", "/"),
            "frameSize": [spec["cell"], spec["cell"]],
            "frameCount": rife_report["outputFrameCount"],
            "grid": [spec["out_cols"], rife_report["rows"]],
            "mode": spec["mode"],
            "cyanSpillPixelsReplaced": cyan_spill_replaced,
            "sourceYShifts": source_y_shifts,
            "sourceXGroundAnchors": source_x_anchors,
            "sourceXShifts": source_x_shifts,
            "sourceXGroundTarget": spec.get("ground_x_target"),
            "sourceXGroundAnchorsAfterShift": [
                anchor + dx for anchor, dx in zip(source_x_anchors, source_x_shifts)
            ],
            "validation": rife_report["validation"],
        }

    report_path.write_text(
        json.dumps(build_report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(f"[red-wolf-build] complete: {report_path}")


if __name__ == "__main__":
    main()
