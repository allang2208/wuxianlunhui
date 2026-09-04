#!/usr/bin/env python3
"""Build runtime sheets by cropping shared transparent padding without resampling pixels."""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path

from PIL import Image
import numpy as np


ROOT = Path(__file__).resolve().parents[5]
TASK_ROOT = Path(__file__).resolve().parent
SOURCE_ROOT = TASK_ROOT / "postprocess/sheets-rife"
OUTPUT_ROOT = ROOT / "assets/companions/industrial_recon_rifleman"
REPORT_PATH = TASK_ROOT / "runtime-sheet-report.json"

SOURCE_CELL = 512
CROP = (88, 208, 424, 368)
FRAME_WIDTH = CROP[2] - CROP[0]
FRAME_HEIGHT = CROP[3] - CROP[1]

SPECS = {
    "idle": {"sourceCols": 8, "frameCount": 40, "cols": 8, "rows": 5, "frameRate": 24, "repeat": -1},
    "running": {"sourceCols": 8, "frameCount": 34, "cols": 7, "rows": 5, "frameRate": 48, "repeat": -1},
    "attacking": {"sourceCols": 8, "frameCount": 77, "cols": 11, "rows": 7, "frameRate": 24, "repeat": 0},
    "dying": {"sourceCols": 8, "frameCount": 53, "cols": 9, "rows": 6, "frameRate": 24, "repeat": 0},
}


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def split_source(sheet: Image.Image, cols: int, count: int) -> list[Image.Image]:
    frames: list[Image.Image] = []
    for index in range(count):
        col = index % cols
        row = index // cols
        frame = sheet.crop((
            col * SOURCE_CELL,
            row * SOURCE_CELL,
            (col + 1) * SOURCE_CELL,
            (row + 1) * SOURCE_CELL,
        ))
        frames.append(frame.crop(CROP))
    return frames


def build_action(name: str, spec: dict[str, int]) -> dict[str, object]:
    source_path = SOURCE_ROOT / f"{name}.png"
    output_path = OUTPUT_ROOT / f"{name}.png"
    source = Image.open(source_path).convert("RGBA")
    frames = split_source(source, spec["sourceCols"], spec["frameCount"])

    output = Image.new("RGBA", (spec["cols"] * FRAME_WIDTH, spec["rows"] * FRAME_HEIGHT), (0, 0, 0, 0))
    touching: list[int] = []
    alpha_bottoms: list[int] = []
    for index, frame in enumerate(frames):
        arr = np.asarray(frame)
        alpha = arr[:, :, 3]
        if not np.any(alpha):
            raise RuntimeError(f"{name} frame {index} became empty")
        if np.any(alpha[0]) or np.any(alpha[-1]) or np.any(alpha[:, 0]) or np.any(alpha[:, -1]):
            touching.append(index)
        alpha_bottoms.append(int(np.where(alpha > 0)[0].max()))
        col = index % spec["cols"]
        row = index // spec["cols"]
        output.paste(frame, (col * FRAME_WIDTH, row * FRAME_HEIGHT))

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    output.save(output_path, format="PNG", optimize=True, compress_level=9)

    reopened = Image.open(output_path).convert("RGBA")
    nonzero_transparent_rgb = 0
    for index, source_frame in enumerate(frames):
        col = index % spec["cols"]
        row = index // spec["cols"]
        saved = reopened.crop((
            col * FRAME_WIDTH,
            row * FRAME_HEIGHT,
            (col + 1) * FRAME_WIDTH,
            (row + 1) * FRAME_HEIGHT,
        ))
        if not np.array_equal(np.asarray(source_frame), np.asarray(saved)):
            raise RuntimeError(f"{name} frame {index} changed during runtime-sheet packing")
        saved_arr = np.asarray(saved)
        transparent = saved_arr[:, :, 3] == 0
        nonzero_transparent_rgb += int(np.count_nonzero(saved_arr[:, :, :3][transparent]))

    return {
        "source": source_path.relative_to(ROOT).as_posix(),
        "output": output_path.relative_to(ROOT).as_posix(),
        "frameWidth": FRAME_WIDTH,
        "frameHeight": FRAME_HEIGHT,
        "frameCount": spec["frameCount"],
        "endFrame": spec["frameCount"] - 1,
        "cols": spec["cols"],
        "rows": spec["rows"],
        "frameRate": spec["frameRate"],
        "repeat": spec["repeat"],
        "footYRange": [min(alpha_bottoms), max(alpha_bottoms)],
        "touchingFrames": touching,
        "transparentRgbNonzeroValues": nonzero_transparent_rgb,
        "pixelExactSourceCrop": True,
        "pngBytes": output_path.stat().st_size,
        "sha256": digest(output_path),
        "decodedBytes": spec["cols"] * spec["rows"] * FRAME_WIDTH * FRAME_HEIGHT * 4,
    }


def main() -> None:
    actions = {name: build_action(name, spec) for name, spec in SPECS.items()}
    total_decoded = sum(int(action["decodedBytes"]) for action in actions.values())
    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "industrial_recon_rifleman",
        "operation": "shared transparent-only crop and tighter sheet packing; no resampling, redraw or per-frame recentering",
        "sourceCell": [SOURCE_CELL, SOURCE_CELL],
        "cropBox": list(CROP),
        "runtimeCell": [FRAME_WIDTH, FRAME_HEIGHT],
        "commonFootY": 143,
        "actions": actions,
        "budget": {
            "profile": "crowd",
            "targetMiB": 32,
            "admissionMiB": 64,
            "decodedBytes": total_decoded,
            "decodedMiB": round(total_decoded / 1024 / 1024, 3),
            "admissionPassed": total_decoded <= 64 * 1024 * 1024,
            "maximumTextureDimension": max(
                max(action["cols"] * FRAME_WIDTH, action["rows"] * FRAME_HEIGHT)
                for action in actions.values()
            ),
        },
        "runtimeIntegrationActive": True,
        "testsRun": False,
    }
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
