#!/usr/bin/env python3
"""Build the Desert Priest sprite sheets from the two approved local videos.

Source contract (24 fps, 720x720):
  1.mp4 idle:    f0..f35 (f36 is the near-duplicate loop endpoint)
  1.mp4 running: f46..f57 (f58 starts the next repeated gait cycle)
  1.mp4 dying:   f160..f180, resampled to 17 gameplay frames
  1.mp4 spell:   deliberately ignored
  2.mp4 spelling: one complete staff-raising cast, resampled to 17 frames

BiRefNet supplies alpha. All actions share one scale derived from motion f0,
and every output includes GIF/contact previews plus a JSON validation report.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

SCRIPT_DIR = Path(__file__).resolve().parent
BASE_SCRIPT = SCRIPT_DIR / "jungle-wizard-video-rebuild.py"
MODULE_SPEC = importlib.util.spec_from_file_location("sprite_rebuild_base", BASE_SCRIPT)
if MODULE_SPEC is None or MODULE_SPEC.loader is None:
    raise RuntimeError(f"Cannot import sprite helper: {BASE_SCRIPT}")
BASE = importlib.util.module_from_spec(MODULE_SPEC)
sys.modules[MODULE_SPEC.name] = BASE
MODULE_SPEC.loader.exec_module(BASE)


@dataclass(frozen=True)
class ActionSpec:
    key: str
    output_stem: str
    source: str
    indices: tuple[int, ...]
    playback_fps: float
    repeat: int
    anchor: str


def cutout_black_matte(rgb: np.ndarray, model) -> np.ndarray:
    alpha = np.asarray(BASE.predict_alpha(model, Image.fromarray(rgb, "RGB")))
    alpha = np.squeeze(alpha)
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]), interpolation=cv2.INTER_LINEAR)
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255.0
    alpha = BASE.keep_subject_component(np.clip(alpha, 0, 255).astype(np.uint8))

    # Reverse the source video's black matte on semi-transparent edge pixels.
    clean_rgb = rgb.astype(np.float32).copy()
    a = alpha.astype(np.float32) / 255.0
    semi = (a > 0.02) & (a < 0.98)
    if semi.any():
        clean_rgb[semi] = np.clip(clean_rgb[semi] / a[semi, None], 0, 255)
    clean_rgb[a <= 0.02] = 0
    return np.dstack([clean_rgb.astype(np.uint8), alpha])


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--motion-video", type=Path, required=True)
    parser.add_argument("--spell-video", type=Path, required=True)
    parser.add_argument("--out-dir", type=Path, required=True)
    parser.add_argument("--target-reference-height", type=int, default=224)
    args = parser.parse_args()

    args.out_dir.mkdir(parents=True, exist_ok=True)
    motion_frames, motion_fps = BASE.decode_video(args.motion_video)
    spell_frames, spell_fps = BASE.decode_video(args.spell_video)
    if len(motion_frames) != 241 or abs(motion_fps - 24.0) > 0.01:
        raise RuntimeError(
            f"Unexpected 1.mp4 contract: {len(motion_frames)} frames at {motion_fps:.4f} fps"
        )
    if len(spell_frames) != 97 or abs(spell_fps - 24.0) > 0.01:
        raise RuntimeError(
            f"Unexpected 2.mp4 contract: {len(spell_frames)} frames at {spell_fps:.4f} fps"
        )

    specs = (
        ActionSpec("idle", "idle", "motion", tuple(range(0, 36)), 24.0, -1, "torso"),
        ActionSpec("walk", "running", "motion", tuple(range(46, 58)), 24.0, -1, "torso"),
        ActionSpec(
            "spell",
            "spelling",
            "spell",
            (0, 4, 8, 12, 16, 20, 24, 28, 34, 40, 48, 56, 64, 72, 80, 88, 96),
            12.0,
            0,
            "feet",
        ),
        ActionSpec(
            "dying",
            "dying",
            "motion",
            (160, 161, 162, 163, 164, 165, 166, 167, 168, 169, 170, 171, 172, 173, 174, 176, 180),
            12.0,
            0,
            "bbox",
        ),
    )

    model = BASE.get_model()
    source_frames = {"motion": motion_frames, "spell": spell_frames}
    cache: dict[tuple[str, int], np.ndarray] = {}

    def get_cutout(source: str, index: int) -> np.ndarray:
        cache_key = (source, index)
        if cache_key not in cache:
            cache[cache_key] = cutout_black_matte(source_frames[source][index], model)
            print(f"[desert-priest] cutout {source} f{index}", flush=True)
        return cache[cache_key]

    reference = get_cutout("motion", 0)
    _, y0, _, y1 = BASE.alpha_bbox(reference)
    scale = args.target_reference_height / (y1 - y0 + 1)
    report: dict[str, object] = {
        "motionSource": str(args.motion_video),
        "spellSource": str(args.spell_video),
        "motionSourceFrameCount": len(motion_frames),
        "spellSourceFrameCount": len(spell_frames),
        "sourceFrameRate": motion_fps,
        "ignoredMotionSpellRange": [102, 162],
        "targetReferenceHeight": args.target_reference_height,
        "sourceScale": scale,
        "actions": {},
    }

    for action in specs:
        rgba_frames = [get_cutout(action.source, index) for index in action.indices]
        anchors = [BASE.horizontal_anchor(frame, action.anchor) for frame in rgba_frames]
        cell_w, cell_h = BASE.choose_cell(rgba_frames, anchors, scale)
        cells = [
            BASE.place_cell(frame, anchor, scale, cell_w, cell_h)
            for frame, anchor in zip(rgba_frames, anchors)
        ]
        sheet = BASE.compose_sheet(cells, 8)
        output_name = f"{action.output_stem}.png"
        Image.fromarray(sheet, "RGBA").save(
            args.out_dir / output_name, optimize=True, compress_level=9
        )
        BASE.save_previews(
            action.output_stem, cells, action.indices, action.playback_fps, args.out_dir
        )
        validation = BASE.validate_cells(cells, action.repeat)
        report["actions"][action.key] = {
            "output": output_name,
            "source": action.source,
            "sourceIndices": list(action.indices),
            "frameCount": len(action.indices),
            "frameWidth": cell_w,
            "frameHeight": cell_h,
            "cols": 8,
            "rows": math.ceil(len(cells) / 8),
            "frameRate": action.playback_fps,
            "repeat": action.repeat,
            "anchor": action.anchor,
            "validation": validation,
        }
        print(
            f"[desert-priest] {action.key}: {len(cells)} frames, "
            f"cell {cell_w}x{cell_h}, validation={validation}",
            flush=True,
        )

    with (args.out_dir / "report.json").open("w", encoding="utf-8") as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)


if __name__ == "__main__":
    main()
