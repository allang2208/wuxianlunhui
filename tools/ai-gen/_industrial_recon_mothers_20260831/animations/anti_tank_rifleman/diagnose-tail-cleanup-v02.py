#!/usr/bin/env python3
"""Preview a conservative hamster-tail cleanup without touching approved source cutouts.

The v01 diagnostic used a broad lower-left wedge and damaged boots/gear.  This
revision grows only from exposed tail-colored pixels at the far-left edge of the
thick-body silhouette.  It intentionally leaves an occluded tail base in place
rather than carving into the approved body motion.
"""

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
SPEC = importlib.util.spec_from_file_location("anti_tank_tail_v02_base", BASE_PATH)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BASE_PATH}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)


def conservative_tail_candidate(
    rgba: np.ndarray, *, include_disconnected_segments: bool = False
) -> np.ndarray:
    """Return only the exposed, thin tail extension outside the thick body.

    The geometric gate is the safety contract.  Color is used only to avoid
    removing an exposed boot or dark equipment that also protrudes past bx0.
    """
    bx0, by0, bx1, by1 = BASE.opened_body_bbox(rgba)
    body_h = by1 - by0 + 1
    alpha = rgba[..., 3]
    rgb = rgba[..., :3]
    hsv = cv2.cvtColor(rgb, cv2.COLOR_RGB2HSV)
    yy, xx = np.indices(alpha.shape)

    exposed_extension = (
        (alpha > 12)
        & (xx < bx0)
        & (yy > by0 + round(body_h * 0.78))
        & (yy <= by1 + round(body_h * 0.04))
    )
    # Warm, light brown/pink tail fur.  The value floor rejects the dark boots.
    tail_color = (
        (hsv[..., 0] <= 14)
        & (hsv[..., 1] >= 110)
        & (hsv[..., 2] >= 90)
        & (rgb[..., 0] >= rgb[..., 1] + 28)
        & (rgb[..., 0] >= rgb[..., 2] + 45)
    )
    seed = exposed_extension & tail_color
    if not seed.any():
        return np.zeros_like(seed)

    # Let the tail-colored component grow back toward its base.  The corridor
    # is deliberately low and left of the body's center; connectivity to the
    # exposed tip prevents similarly colored trouser cloth from being selected.
    body_w = bx1 - bx0 + 1
    corridor = (
        (alpha > 12)
        & (xx < bx0 + round(body_w * 0.32))
        & (yy > by0 + round(body_h * 0.70))
        & (yy <= by1 + round(body_h * 0.04))
    )
    pool = (corridor & tail_color).astype(np.uint8)
    pool = cv2.morphologyEx(pool, cv2.MORPH_CLOSE, np.ones((3, 5), np.uint8))
    count, labels, stats, _ = cv2.connectedComponentsWithStats(pool, 8)
    keep = np.zeros_like(pool)
    for label in range(1, count):
        component = labels == label
        w = int(stats[label, cv2.CC_STAT_WIDTH])
        h = int(stats[label, cv2.CC_STAT_HEIGHT])
        area = int(stats[label, cv2.CC_STAT_AREA])
        touches_exposed_tip = bool(np.any(component & seed))
        thin_tail_segment = w >= max(14, round(h * 1.15)) and area >= 30
        if touches_exposed_tip or (include_disconnected_segments and thin_tail_segment):
            keep[component] = 1

    # Recover the soft antialias fringe around the selected tail component,
    # still constrained to the low, left corridor.
    keep = cv2.dilate(keep, np.ones((5, 5), np.uint8)) > 0

    # Hard protection for the approved thick silhouette.  Tail fur can share
    # its palette with trousers and boot highlights; an opened body core is a
    # safer discriminator than color alone.  Dilating the core also preserves
    # the clothing edge and shoelaces.
    solid = (alpha > 32).astype(np.uint8)
    opened = cv2.morphologyEx(
        solid,
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (41, 41)),
    )
    core_count, core_labels, core_stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    protected = np.zeros_like(solid, dtype=bool)
    if core_count > 1:
        core_label = 1 + int(np.argmax(core_stats[1:, cv2.CC_STAT_AREA]))
        protected = cv2.dilate(
            (core_labels == core_label).astype(np.uint8), np.ones((7, 7), np.uint8)
        ) > 0
    seed_after_protection = keep & corridor & ~protected
    if not seed_after_protection.any():
        return seed_after_protection

    # Once a color-safe seed is known, recover the rest of that thin alpha
    # appendage regardless of shading.  The protected core blocks propagation
    # into trousers/boots, while the low-left corridor blocks other equipment.
    thin_pool = corridor & (alpha > 3) & ~protected
    thin_count, thin_labels, _, _ = cv2.connectedComponentsWithStats(
        thin_pool.astype(np.uint8), 8
    )
    grown = np.zeros_like(thin_pool)
    for label in range(1, thin_count):
        component = thin_labels == label
        if np.any(component & seed_after_protection):
            grown |= component
    return grown


def main() -> None:
    out = ROOT / "postprocess" / "tail-diagnostics-v02"
    out.mkdir(parents=True, exist_ok=True)
    model = BASE.BASE.get_model()
    samples = {
        "idle-f52": ("idle-doubao-v02-no-fire.mp4", 52),
        "idle-f60": ("idle-doubao-v02-no-fire.mp4", 60),
        "running-f39": ("running-doubao-v01.mp4", 39),
        "running-f51": ("running-doubao-v01.mp4", 51),
        "attack-f8": ("attacking-doubao-v01.mp4", 8),
        "attack-f35": ("attacking-doubao-v01.mp4", 35),
        "attack-f60": ("attacking-doubao-v01.mp4", 60),
        "grenade-f70": ("grenade-throw-doubao-v01.mp4", 70),
        "grenade-f74": ("grenade-throw-doubao-v01.mp4", 74),
        "grenade-f76": ("grenade-throw-doubao-v01.mp4", 76),
        "grenade-f77": ("grenade-throw-doubao-v01.mp4", 77),
        "dying-f62": ("dying-doubao-v01.mp4", 62),
        "dying-f78": ("dying-doubao-v01.mp4", 78),
    }
    decoded: dict[str, tuple[list[np.ndarray], float]] = {}
    report: dict[str, object] = {}
    for name, (video_name, index) in samples.items():
        if video_name not in decoded:
            decoded[video_name] = BASE.BASE.decode_video(ROOT / "videos" / video_name)
        rgba = BASE.BASE.cutout_rgba(decoded[video_name][0][index], model)
        candidate = conservative_tail_candidate(
            rgba, include_disconnected_segments=name.startswith("attack-")
        )
        overlay = rgba.copy()
        overlay[candidate, :3] = (255, 0, 255)
        overlay[candidate, 3] = 255
        cleaned = rgba.copy()
        cleaned[candidate] = 0
        Image.fromarray(rgba, "RGBA").save(out / f"{name}-cutout.png")
        Image.fromarray(overlay, "RGBA").save(out / f"{name}-candidate-overlay.png")
        Image.fromarray(cleaned, "RGBA").save(out / f"{name}-cleaned.png")
        report[name] = {
            "alphaBBox": BASE.BASE.alpha_bbox(rgba),
            "openedBodyBBox": BASE.opened_body_bbox(rgba),
            "candidatePixels": int(candidate.sum()),
            "candidateBBox": BASE.BASE.alpha_bbox(np.dstack([np.zeros_like(rgba[..., :3]), candidate.astype(np.uint8) * 255])) if candidate.any() else None,
        }
        print(f"[tail-diagnostic-v02] {name}", flush=True)
    (out / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
