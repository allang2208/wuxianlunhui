#!/usr/bin/env python3
"""Extract the accepted running identity pose and prepare an H3 first frame."""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
HELPER_PATH = REPO / "tools" / "ai-gen" / "jungle-wizard-video-rebuild.py"
SPEC = importlib.util.spec_from_file_location("scout_running_ref_helper", HELPER_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"cannot import video helper: {HELPER_PATH}")
HELPER = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = HELPER
SPEC.loader.exec_module(HELPER)

VIDEO = ROOT / "videos" / "attacking-doubao-v01.mp4"
FRAME = 36
OUTPUT = ROOT / "references" / "moving-attacking-doubao-f036-safe-white-1024x576.png"
OUTPUT_ALPHA = ROOT / "references" / "moving-attacking-doubao-f036-cutout.png"


def main() -> None:
    frames, _ = HELPER.decode_video(VIDEO)
    rgba = HELPER.cutout_rgba(frames[FRAME], HELPER.get_model())
    x0, y0, x1, y1 = HELPER.alpha_bbox(rgba)
    subject = Image.fromarray(rgba[y0:y1 + 1, x0:x1 + 1], "RGBA")
    target_h = 405
    scale = target_h / subject.height
    target_w = round(subject.width * scale)
    if target_w > 820:
        scale = 820 / subject.width
        target_w = round(subject.width * scale)
        target_h = round(subject.height * scale)
    subject = subject.resize((target_w, target_h), Image.Resampling.LANCZOS)

    x = 115
    y = 515 - target_h
    if x + target_w > 955:
        raise RuntimeError(f"unsafe right margin: x={x} width={target_w}")
    alpha_canvas = Image.new("RGBA", (1024, 576), (0, 0, 0, 0))
    alpha_canvas.alpha_composite(subject, (x, y))
    alpha_canvas.save(OUTPUT_ALPHA)
    white = Image.new("RGB", (1024, 576), "white")
    white.paste(alpha_canvas.convert("RGB"), (0, 0), alpha_canvas.getchannel("A"))
    white.save(OUTPUT)
    print(
        f"[running-reference] source=f{FRAME} bbox={(x0, y0, x1, y1)} "
        f"content={target_w}x{target_h} at {(x, y)} -> {OUTPUT}"
    )


if __name__ == "__main__":
    main()
