#!/usr/bin/env python3
"""Build runtime sheets via one shared transparent crop and tighter packing."""

from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parents[5]
TASK_ROOT = Path(__file__).resolve().parent
SOURCE_ROOT = TASK_ROOT / "postprocess/sheets-rife"
OUTPUT_ROOT = ROOT / "assets/companions/hamster_anti_tank_rifleman"
REPORT_PATH = TASK_ROOT / "runtime-sheet-report.json"

SOURCE_CELL = 512
# One crop for every action preserves the approved alignment and scale. The
# union alpha bounds are (166, 213)-(383, 353); this adds transparent guard.
CROP = (152, 200, 408, 376)
FRAME_WIDTH = CROP[2] - CROP[0]
FRAME_HEIGHT = CROP[3] - CROP[1]

SPECS = {
    "idle": {"sourceCols": 8, "frameCount": 38, "cols": 8, "rows": 5, "frameRate": 24, "repeat": -1},
    "running": {"sourceCols": 8, "frameCount": 48, "cols": 8, "rows": 6, "frameRate": 48, "repeat": -1},
    "attacking": {"sourceCols": 8, "frameCount": 71, "cols": 8, "rows": 9, "frameRate": 24, "repeat": 0},
    "grenade_throw": {"sourceCols": 8, "frameCount": 79, "cols": 8, "rows": 10, "frameRate": 24, "repeat": 0},
    "dying": {"sourceCols": 8, "frameCount": 47, "cols": 8, "rows": 6, "frameRate": 24, "repeat": 0},
}


def digest(path: Path) -> str:
    return sha256(path.read_bytes()).hexdigest()


def build_action(name: str, spec: dict[str, int]) -> dict[str, object]:
    source_path = SOURCE_ROOT / f"{name}.png"
    output_path = OUTPUT_ROOT / f"{name}.png"
    source = Image.open(source_path).convert("RGBA")
    frames: list[Image.Image] = []
    for index in range(spec["frameCount"]):
        col = index % spec["sourceCols"]
        row = index // spec["sourceCols"]
        frame = source.crop((
            col * SOURCE_CELL,
            row * SOURCE_CELL,
            (col + 1) * SOURCE_CELL,
            (row + 1) * SOURCE_CELL,
        )).crop(CROP)
        frames.append(frame)

    output = Image.new(
        "RGBA",
        (spec["cols"] * FRAME_WIDTH, spec["rows"] * FRAME_HEIGHT),
        (0, 0, 0, 0),
    )
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
        output.paste(frame, (
            (index % spec["cols"]) * FRAME_WIDTH,
            (index // spec["cols"]) * FRAME_HEIGHT,
        ))

    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    output.save(output_path, format="PNG", optimize=True, compress_level=9)

    reopened = Image.open(output_path).convert("RGBA")
    nonzero_transparent_rgb = 0
    for index, source_frame in enumerate(frames):
        saved = reopened.crop((
            (index % spec["cols"]) * FRAME_WIDTH,
            (index // spec["cols"]) * FRAME_HEIGHT,
            (index % spec["cols"] + 1) * FRAME_WIDTH,
            (index // spec["cols"] + 1) * FRAME_HEIGHT,
        ))
        if not np.array_equal(np.asarray(source_frame), np.asarray(saved)):
            raise RuntimeError(f"{name} frame {index} changed during runtime packing")
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
        "date": "2026-09-02",
        "unitKey": "anti_tank_rifleman",
        "operation": "shared transparent-only crop and tighter packing; no resampling, redraw or per-frame recentering",
        "sourceCell": [SOURCE_CELL, SOURCE_CELL],
        "cropBox": list(CROP),
        "runtimeCell": [FRAME_WIDTH, FRAME_HEIGHT],
        "commonFootY": 152,
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
