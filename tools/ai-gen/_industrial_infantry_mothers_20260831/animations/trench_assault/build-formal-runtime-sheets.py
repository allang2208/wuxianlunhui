#!/usr/bin/env python3
"""Crop shared transparent padding and pack formal trench-assault sheets."""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


REPO = Path(__file__).resolve().parents[5]
TASK_ROOT = Path(__file__).resolve().parent
SOURCE_ROOT = TASK_ROOT / "postprocess" / "sheets-rife"
REPORT_ROOT = TASK_ROOT / "postprocess" / "rife-reports"
OUTPUT_ROOT = REPO / "assets" / "companions" / "trench_assault"
REPORT_PATH = TASK_ROOT / "runtime-sheet-report.json"
SOURCE_CELL = 512
CROPS = {
    "idle": (88, 208, 424, 368),
    "running": (88, 208, 424, 368),
    "attacking": (88, 208, 424, 368),
    "dying": (88, 208, 424, 368),
}
OUTPUT_COLS = {"idle": 7, "running": 7, "attacking": 7, "dying": 7}
REPEATS = {"idle": -1, "running": -1, "attacking": 0, "dying": 0}


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def split_source(sheet: Image.Image, cols: int, count: int, crop: tuple[int, ...]) -> list[Image.Image]:
    frames: list[Image.Image] = []
    for index in range(count):
        col = index % cols
        row = index // cols
        cell = sheet.crop((
            col * SOURCE_CELL, row * SOURCE_CELL,
            (col + 1) * SOURCE_CELL, (row + 1) * SOURCE_CELL,
        ))
        frames.append(cell.crop(crop))
    return frames


def build_action(name: str) -> dict[str, object]:
    source_path = SOURCE_ROOT / f"{name}.png"
    rife_path = REPORT_ROOT / f"{name}.json"
    if not source_path.exists() or not rife_path.exists():
        raise FileNotFoundError(f"Missing formal RIFE inputs for {name}")
    rife = json.loads(rife_path.read_text(encoding="utf-8"))
    frame_count = int(rife["outputFrameCount"])
    source_cols = int(rife.get("outputCols", rife["cols"]))
    crop = CROPS[name]
    frame_width = crop[2] - crop[0]
    frame_height = crop[3] - crop[1]
    output_cols = OUTPUT_COLS[name]
    output_rows = math.ceil(frame_count / output_cols)
    source = Image.open(source_path).convert("RGBA")
    frames = split_source(source, source_cols, frame_count, crop)

    touching: list[int] = []
    alpha_bottoms: list[int] = []
    for index, frame in enumerate(frames):
        arr = np.asarray(frame)
        alpha = arr[..., 3]
        if not np.any(alpha):
            raise RuntimeError(f"{name} frame {index} became empty")
        if np.any(alpha[0]) or np.any(alpha[-1]) or np.any(alpha[:, 0]) or np.any(alpha[:, -1]):
            touching.append(index)
        alpha_bottoms.append(int(np.where(alpha > 0)[0].max()))
    if touching:
        raise RuntimeError(f"{name} runtime crop touches cell edges in frames {touching}")

    output = Image.new(
        "RGBA", (output_cols * frame_width, output_rows * frame_height), (0, 0, 0, 0)
    )
    for index, frame in enumerate(frames):
        output.paste(frame, (
            (index % output_cols) * frame_width,
            (index // output_cols) * frame_height,
        ))
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    output_path = OUTPUT_ROOT / f"{name}.png"
    output.save(output_path, optimize=True, compress_level=9)

    reopened = Image.open(output_path).convert("RGBA")
    transparent_rgb = 0
    for index, expected in enumerate(frames):
        col = index % output_cols
        row = index // output_cols
        actual = reopened.crop((
            col * frame_width, row * frame_height,
            (col + 1) * frame_width, (row + 1) * frame_height,
        ))
        if not np.array_equal(np.asarray(expected), np.asarray(actual)):
            raise RuntimeError(f"{name} frame {index} changed during packing")
        arr = np.asarray(actual)
        transparent_rgb += int(np.count_nonzero(arr[..., :3][arr[..., 3] == 0]))
    if transparent_rgb:
        raise RuntimeError(f"{name} has {transparent_rgb} RGB values in transparent pixels")

    decoded_bytes = output_cols * output_rows * frame_width * frame_height * 4
    return {
        "source": source_path.relative_to(REPO).as_posix(),
        "output": output_path.relative_to(REPO).as_posix(),
        "sourceCell": [SOURCE_CELL, SOURCE_CELL],
        "cropBox": list(crop),
        "frameWidth": frame_width,
        "frameHeight": frame_height,
        "frameCount": frame_count,
        "endFrame": frame_count - 1,
        "cols": output_cols,
        "rows": output_rows,
        "frameRate": float(rife["outputFrameRate"]),
        "repeat": REPEATS[name],
        "footYRange": [min(alpha_bottoms), max(alpha_bottoms)],
        "touchingFrames": touching,
        "transparentRgbNonzeroValues": transparent_rgb,
        "pixelExactSourceCrop": True,
        "pngBytes": output_path.stat().st_size,
        "sha256": digest(output_path),
        "decodedBytes": decoded_bytes,
        "decodedMiB": round(decoded_bytes / 1024 / 1024, 3),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--action", action="append", choices=tuple(CROPS))
    args = parser.parse_args()
    requested = args.action or [
        name for name in CROPS
        if (SOURCE_ROOT / f"{name}.png").exists() and (REPORT_ROOT / f"{name}.json").exists()
    ]
    existing: dict[str, object] = {}
    if REPORT_PATH.exists():
        existing = json.loads(REPORT_PATH.read_text(encoding="utf-8")).get("actions", {})
    for name in requested:
        existing[name] = build_action(name)
    total_decoded = sum(int(action["decodedBytes"]) for action in existing.values())
    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "trench_assault",
        "operation": "shared transparent-only crop and tighter packing; no resampling, redraw or per-frame recentering",
        "actions": existing,
        "budget": {
            "profile": "crowd",
            "targetMiB": 32,
            "admissionMiB": 64,
            "decodedBytes": total_decoded,
            "decodedMiB": round(total_decoded / 1024 / 1024, 3),
            "targetPassed": total_decoded <= 32 * 1024 * 1024,
            "admissionPassed": total_decoded <= 64 * 1024 * 1024,
            "maximumTextureDimension": max(
                max(int(action["cols"]) * int(action["frameWidth"]), int(action["rows"]) * int(action["frameHeight"]))
                for action in existing.values()
            ),
        },
        "runtimeIntegrationActive": True,
        "testsRun": False,
    }
    REPORT_PATH.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
