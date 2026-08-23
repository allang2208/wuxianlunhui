#!/usr/bin/env python3
"""Build the hamster baker's three transparent animation sheets from 1.mp4.

Source contract (24 fps, 720x720, 145 frames):
  idle:           f2..f7 then ping-pong back to f3
  empty_running:  f42..f61 (f62 is the matching gait endpoint)
  loaded_running: f114..f133 (f134 is the matching gait endpoint)

The original video contains transitions and later frames where the carried bread
touches the camera edge. Those frames are deliberately excluded. BiRefNet supplies
alpha; all actions share the approved hamster-farmer visible height, a stable torso
anchor, and one fixed ground line.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "jungle-wizard-video-rebuild.py"
MODULE_SPEC = importlib.util.spec_from_file_location("baker_sprite_base", BASE_SCRIPT)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {BASE_SCRIPT}")
BASE = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = BASE
MODULE_SPEC.loader.exec_module(BASE)


@dataclass(frozen=True)
class ActionSpec:
    key: str
    indices: tuple[int, ...]
    playback_fps: float = 12.0
    repeat: int = -1
    anchor: str = "torso"


def reference_alpha_height(path: Path, frame_width: int = 512, frame_height: int = 512) -> int:
    image = Image.open(path).convert("RGBA").crop((0, 0, frame_width, frame_height))
    alpha = np.asarray(image.getchannel("A"))
    ys, _ = np.where(alpha > 16)
    if not len(ys):
        raise RuntimeError(f"Reference frame has no alpha content: {path}")
    return int(ys.max() - ys.min() + 1)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument(
        "--size-reference",
        type=Path,
        default=Path("assets/companions/hamster_farmer/idle.png"),
    )
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    frames, source_fps = BASE.decode_video(args.video)
    if len(frames) != 145 or abs(source_fps - 24.0) > 0.01:
        raise RuntimeError(
            f"Unexpected baker source: {len(frames)} frames at {source_fps:.4f} fps; "
            "expected 145 frames at 24 fps"
        )

    specs = (
        # The source idle has no matching endpoint. A short forward/backward arc
        # preserves its subtle face motion and makes both joins one ordinary step.
        ActionSpec("idle", (2, 3, 4, 5, 6, 7, 6, 5, 4, 3)),
        # Leg-phase scan finds a complete left/right gait between the endpoint
        # pairs f42/f62 and f114/f134. Drop the repeated endpoints from the sheets.
        ActionSpec("empty_running", tuple(range(42, 62)), playback_fps=16.0),
        ActionSpec("loaded_running", tuple(range(114, 134)), playback_fps=16.0),
    )

    model = BASE.get_model()
    cache: dict[int, np.ndarray] = {}

    def get_cutout(index: int) -> np.ndarray:
        if index not in cache:
            cache[index] = BASE.cutout_rgba(frames[index], model)
            print(f"[bakery-baker] cutout f{index}", flush=True)
        return cache[index]

    target_height = reference_alpha_height(args.size_reference)
    reference = get_cutout(specs[0].indices[0])
    _, y0, _, y1 = BASE.alpha_bbox(reference)
    scale = target_height / (y1 - y0 + 1)
    report: dict[str, object] = {
        "source": str(args.video),
        "sourceFrameCount": len(frames),
        "sourceFrameRate": source_fps,
        "sizeReference": str(args.size_reference),
        "targetReferenceHeight": target_height,
        "sourceScale": scale,
        "sourceActionRanges": {
            "idle": [[0, 20], [70, 89], [139, 144]],
            "empty_running": [26, 67],
            "loaded_running": [90, 138],
        },
        "actions": {},
    }

    for spec in specs:
        rgba_frames = [get_cutout(index) for index in spec.indices]
        anchors = [BASE.horizontal_anchor(frame, spec.anchor) for frame in rgba_frames]
        cell_w, cell_h = BASE.choose_cell(rgba_frames, anchors, scale)
        cells = [
            BASE.place_cell(frame, anchor, scale, cell_w, cell_h)
            for frame, anchor in zip(rgba_frames, anchors)
        ]
        sheet = BASE.compose_sheet(cells, 8)
        output_name = f"{spec.key}.png"
        Image.fromarray(sheet, "RGBA").save(
            args.out_dir / output_name, optimize=True, compress_level=9
        )
        BASE.save_previews(spec.key, cells, spec.indices, spec.playback_fps, args.out_dir)
        validation = BASE.validate_cells(cells, spec.repeat)
        report["actions"][spec.key] = {
            "output": output_name,
            "sourceIndices": list(spec.indices),
            "frameCount": len(spec.indices),
            "frameWidth": cell_w,
            "frameHeight": cell_h,
            "cols": 8,
            "rows": math.ceil(len(cells) / 8),
            "frameRate": spec.playback_fps,
            "repeat": spec.repeat,
            "anchor": spec.anchor,
            "footRatio": round((cell_h * 0.9375 - 1) / cell_h, 6),
            "validation": validation,
        }
        print(
            f"[bakery-baker] {spec.key}: {len(cells)} frames, "
            f"cell {cell_w}x{cell_h}, validation={validation}",
            flush=True,
        )

    with (args.out_dir / "report.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
