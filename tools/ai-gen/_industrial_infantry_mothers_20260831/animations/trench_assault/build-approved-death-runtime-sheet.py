#!/usr/bin/env python3
"""Pack the approved death RIFE sheet into a formal runtime asset."""

from __future__ import annotations

from hashlib import sha256
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[5]
TASK_ROOT = Path(__file__).resolve().parent
SOURCE_PATH = TASK_ROOT / "postprocess" / "sheets-rife" / "dying.png"
RIFE_REPORT = TASK_ROOT / "postprocess" / "rife-reports" / "dying.json"
OUTPUT_PATH = ROOT / "assets" / "companions" / "trench_assault" / "dying.png"
REPORT_PATH = TASK_ROOT / "runtime-death-sheet-report.json"
SOURCE_CELL = 512
CROP = (88, 208, 424, 368)
FRAME_WIDTH = CROP[2] - CROP[0]
FRAME_HEIGHT = CROP[3] - CROP[1]
OUTPUT_COLS = 7


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def main() -> None:
    rife = json.loads(RIFE_REPORT.read_text(encoding="utf-8"))
    frame_count = int(rife["outputFrameCount"])
    if frame_count != 49:
        raise RuntimeError(f"One-shot 25-frame source must produce 49 frames, got {frame_count}")
    source_cols = int(rife.get("outputCols", rife["cols"]))
    source = Image.open(SOURCE_PATH).convert("RGBA")
    frames: list[Image.Image] = []
    touching: list[int] = []
    alpha_bottoms: list[int] = []
    for index in range(frame_count):
        col = index % source_cols
        row = index // source_cols
        cell = source.crop(
            (
                col * SOURCE_CELL,
                row * SOURCE_CELL,
                (col + 1) * SOURCE_CELL,
                (row + 1) * SOURCE_CELL,
            )
        )
        frame = cell.crop(CROP)
        arr = np.asarray(frame)
        alpha = arr[..., 3]
        if not np.any(alpha):
            raise RuntimeError(f"Death frame {index} became empty")
        if np.any(alpha[0]) or np.any(alpha[-1]) or np.any(alpha[:, 0]) or np.any(alpha[:, -1]):
            touching.append(index)
        alpha_bottoms.append(int(np.where(alpha > 0)[0].max()))
        frames.append(frame)
    if touching:
        raise RuntimeError(f"Runtime crop touches cell edges in frames {touching}")

    rows = math.ceil(frame_count / OUTPUT_COLS)
    output = Image.new(
        "RGBA", (OUTPUT_COLS * FRAME_WIDTH, rows * FRAME_HEIGHT), (0, 0, 0, 0)
    )
    for index, frame in enumerate(frames):
        output.paste(
            frame,
            ((index % OUTPUT_COLS) * FRAME_WIDTH, (index // OUTPUT_COLS) * FRAME_HEIGHT),
        )
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    output.save(OUTPUT_PATH, optimize=True, compress_level=9)

    reopened = Image.open(OUTPUT_PATH).convert("RGBA")
    transparent_rgb = 0
    for index, expected in enumerate(frames):
        actual = reopened.crop(
            (
                (index % OUTPUT_COLS) * FRAME_WIDTH,
                (index // OUTPUT_COLS) * FRAME_HEIGHT,
                (index % OUTPUT_COLS + 1) * FRAME_WIDTH,
                (index // OUTPUT_COLS + 1) * FRAME_HEIGHT,
            )
        )
        if not np.array_equal(np.asarray(expected), np.asarray(actual)):
            raise RuntimeError(f"Death frame {index} changed during packing")
        arr = np.asarray(actual)
        transparent_rgb += int(np.count_nonzero(arr[..., :3][arr[..., 3] == 0]))
    if transparent_rgb:
        raise RuntimeError(f"Found {transparent_rgb} RGB values in fully transparent pixels")

    decoded_bytes = OUTPUT_COLS * rows * FRAME_WIDTH * FRAME_HEIGHT * 4
    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "trench_assault",
        "action": "dying",
        "status": "user_approved_formal_asset_runtime_integrated",
        "operation": (
            "shared transparent-only crop and tighter sheet packing; no resampling, "
            "redraw or per-frame recentering"
        ),
        "source": SOURCE_PATH.relative_to(ROOT).as_posix(),
        "output": OUTPUT_PATH.relative_to(ROOT).as_posix(),
        "sourceCell": [SOURCE_CELL, SOURCE_CELL],
        "cropBox": list(CROP),
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "frameCount": frame_count,
        "endFrame": frame_count - 1,
        "cols": OUTPUT_COLS,
        "rows": rows,
        "frameRate": float(rife["outputFrameRate"]),
        "repeat": 0,
        "footYRange": [min(alpha_bottoms), max(alpha_bottoms)],
        "touchingFrames": touching,
        "transparentRgbNonzeroValues": transparent_rgb,
        "pixelExactSourceCrop": True,
        "pngBytes": OUTPUT_PATH.stat().st_size,
        "sha256": digest(OUTPUT_PATH),
        "decodedBytes": decoded_bytes,
        "decodedMiB": round(decoded_bytes / 1024 / 1024, 3),
        "runtimeIntegrationActive": True,
        "testsRun": False,
    }
    REPORT_PATH.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
