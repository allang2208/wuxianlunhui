#!/usr/bin/env python3
"""Export representative BiRefNet cutouts and tail-mask diagnostics."""

from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
BASE_PATH = REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" / "build-sniper-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("anti_tank_tail_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BASE_PATH}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)


def tail_candidate(rgba: np.ndarray) -> np.ndarray:
    bx0, by0, bx1, by1 = BASE.opened_body_bbox(rgba)
    body_w = bx1 - bx0 + 1
    body_h = by1 - by0 + 1
    yy, xx = np.indices(rgba.shape[:2])
    roi = (
        (xx < bx0 + round(body_w * 0.22))
        & (yy > by0 + round(body_h * 0.63))
        & (yy < by1 + round(body_h * 0.12))
    )
    foreground = rgba[..., 3] > 12
    return roi & foreground


def main() -> None:
    out = ROOT / "postprocess" / "tail-diagnostics"
    out.mkdir(parents=True, exist_ok=True)
    model = BASE.BASE.get_model()
    samples = {
        "idle-f52": ("idle-doubao-v02-no-fire.mp4", 52),
        "running-f39": ("running-doubao-v01.mp4", 39),
        "attack-f8": ("attacking-doubao-v01.mp4", 8),
        "grenade-f70": ("grenade-throw-doubao-v01.mp4", 70),
        "dying-f62": ("dying-doubao-v01.mp4", 62),
    }
    report = {}
    for name, (video_name, index) in samples.items():
        frames, _ = BASE.BASE.decode_video(ROOT / "videos" / video_name)
        rgba = BASE.BASE.cutout_rgba(frames[index], model)
        candidate = tail_candidate(rgba)
        overlay = rgba.copy()
        overlay[candidate, :3] = (255, 0, 255)
        overlay[candidate, 3] = 255
        Image.fromarray(rgba, "RGBA").save(out / f"{name}-cutout.png")
        Image.fromarray(overlay, "RGBA").save(out / f"{name}-candidate-overlay.png")
        report[name] = {
            "alphaBBox": BASE.BASE.alpha_bbox(rgba),
            "openedBodyBBox": BASE.opened_body_bbox(rgba),
            "candidatePixels": int(candidate.sum()),
        }
        print(f"[tail-diagnostic] {name}", flush=True)
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
