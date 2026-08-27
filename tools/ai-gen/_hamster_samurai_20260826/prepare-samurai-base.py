from __future__ import annotations

import argparse
import json
import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image


CELL = 512
COLS = 8
TARGET_FOOT_Y = 456
ACTION_SPECS = {
    "idle": {"source": "idle.png", "frameCount": 13, "anchor": "median"},
    "running": {"source": "running.png", "frameCount": 21, "anchor": "median"},
    "attacking": {"source": "attacking.png", "frameCount": 22, "anchor": "first"},
    "dying": {"source": "dying.png", "frameCount": 13, "anchor": "first"},
}


def extract_frames(sheet: Image.Image, frame_count: int) -> list[Image.Image]:
    frames = []
    for index in range(frame_count):
        x = (index % COLS) * CELL
        y = (index // COLS) * CELL
        frames.append(sheet.crop((x, y, x + CELL, y + CELL)).convert("RGBA"))
    return frames


def alpha_bbox(frame: Image.Image) -> tuple[int, int, int, int]:
    bbox = frame.getchannel("A").getbbox()
    if bbox is None:
        raise ValueError("blank source frame")
    return bbox


def compose(frames: list[Image.Image]) -> Image.Image:
    rows = math.ceil(len(frames) / COLS)
    sheet = Image.new("RGBA", (COLS * CELL, rows * CELL), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        sheet.alpha_composite(frame, ((index % COLS) * CELL, (index // COLS) * CELL))
    return sheet


def shift_action(frames: list[Image.Image], anchor_mode: str) -> tuple[list[Image.Image], int, list[tuple[int, int, int, int]]]:
    source_boxes = [alpha_bbox(frame) for frame in frames]
    bottoms = [bbox[3] - 1 for bbox in source_boxes]
    anchor_bottom = bottoms[0] if anchor_mode == "first" else int(round(float(np.median(bottoms))))
    shift_y = TARGET_FOOT_Y - anchor_bottom
    shifted = []
    for frame in frames:
        output = Image.new("RGBA", (CELL, CELL), (0, 0, 0, 0))
        output.alpha_composite(frame, (0, shift_y))
        shifted.append(output)
    return shifted, shift_y, source_boxes


def build_icon(frame: Image.Image, output: Path) -> None:
    bbox = alpha_bbox(frame)
    body = frame.crop(bbox)
    body.thumbnail((116, 116), Image.Resampling.LANCZOS)
    icon = Image.new("RGBA", (128, 128), (0, 0, 0, 0))
    icon.alpha_composite(body, ((128 - body.width) // 2, 128 - body.height - 6))
    output.parent.mkdir(parents=True, exist_ok=True)
    icon.save(output, optimize=True, compress_level=9)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source-dir", type=Path, required=True)
    parser.add_argument("--task-dir", type=Path, required=True)
    parser.add_argument("--icon", type=Path, required=True)
    args = parser.parse_args()

    original_dir = args.task_dir / "source-originals"
    base_dir = args.task_dir / "base"
    original_dir.mkdir(parents=True, exist_ok=True)
    base_dir.mkdir(parents=True, exist_ok=True)

    report = {
        "sourceDirectory": str(args.source_dir),
        "cell": [CELL, CELL],
        "cols": COLS,
        "targetFootY": TARGET_FOOT_Y,
        "actions": {},
    }
    normalized_idle = None
    for action, spec in ACTION_SPECS.items():
        source = args.source_dir / spec["source"]
        archived = original_dir / spec["source"]
        shutil.copy2(source, archived)
        sheet = Image.open(source).convert("RGBA")
        if sheet.size != (4096, 2048):
            raise ValueError(f"{source}: expected 4096x2048, got {sheet.size}")
        frames = extract_frames(sheet, spec["frameCount"])
        normalized, shift_y, source_boxes = shift_action(frames, spec["anchor"])
        output = base_dir / f"{action}.png"
        compose(normalized).save(output, optimize=True, compress_level=9)
        normalized_boxes = [alpha_bbox(frame) for frame in normalized]
        if any(bbox[0] == 0 or bbox[1] == 0 or bbox[2] == CELL or bbox[3] == CELL for bbox in normalized_boxes):
            raise ValueError(f"{action}: normalized content touches a cell edge")
        report["actions"][action] = {
            "source": str(source),
            "archivedSource": str(archived),
            "baseSheet": str(output),
            "frameCount": len(normalized),
            "anchorMode": spec["anchor"],
            "constantShiftY": shift_y,
            "sourceBottomRange": [min(b[3] - 1 for b in source_boxes), max(b[3] - 1 for b in source_boxes)],
            "normalizedBottomRange": [min(b[3] - 1 for b in normalized_boxes), max(b[3] - 1 for b in normalized_boxes)],
            "edgeTouchFrames": [],
        }
        if action == "idle":
            normalized_idle = normalized[0]

    if normalized_idle is None:
        raise RuntimeError("idle frame was not prepared")
    build_icon(normalized_idle, args.icon)
    report["icon"] = str(args.icon)
    (args.task_dir / "prepare-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
