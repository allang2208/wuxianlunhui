#!/usr/bin/env python3
"""Measure raw cutout proportions without modifying any animation assets."""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent / "frames" / "birefnet-source"
MOTHER = Path(__file__).resolve().parents[1] / "mothers" / "sealed-shaft-rock-wraith-mother-v04.png"
ITEMS = (
    "idle-f024",
    "crystalArmSmash-f000",
    "crystalArmSmash-f096",
    "borequake-f000",
    "borequake-f096",
    "drillRush-f000",
    "drillRush-f040",
    "drillRush-f056",
    "drillRush-f064",
    "drillRush-f080",
    "drillRush-f096",
)


def bbox(mask: np.ndarray) -> tuple[int, int, int, int]:
    ys, xs = np.where(mask)
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def measure(name: str) -> None:
    alpha = np.asarray(Image.open(ROOT / f"{name}.png").convert("RGBA"))[..., 3]
    full = bbox(alpha > 32)
    opened = cv2.morphologyEx(
        (alpha > 32).astype(np.uint8),
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (31, 31)),
    )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    if count <= 1:
        raise RuntimeError(f"Morphology removed body for {name}")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    body = bbox(labels == largest)
    full_w, full_h = full[2] - full[0] + 1, full[3] - full[1] + 1
    body_w, body_h = body[2] - body[0] + 1, body[3] - body[1] + 1
    print(
        f"{name}: full={full_w}x{full_h} ratio={full_w / full_h:.3f}; "
        f"thickBody={body_w}x{body_h} ratio={body_w / body_h:.3f}"
    )


def measure_mother() -> None:
    rgb = np.asarray(Image.open(MOTHER).convert("RGB"))
    foreground = np.min(rgb, axis=2) < 242
    full = bbox(foreground)
    opened = cv2.morphologyEx(
        foreground.astype(np.uint8),
        cv2.MORPH_OPEN,
        cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (45, 45)),
    )
    count, labels, stats, _ = cv2.connectedComponentsWithStats(opened, 8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    body = bbox(labels == largest)
    full_w, full_h = full[2] - full[0] + 1, full[3] - full[1] + 1
    body_w, body_h = body[2] - body[0] + 1, body[3] - body[1] + 1
    print(
        f"mother-v04: full={full_w}x{full_h} ratio={full_w / full_h:.3f}; "
        f"thickBody={body_w}x{body_h} ratio={body_w / body_h:.3f}"
    )


if __name__ == "__main__":
    measure_mother()
    for item in ITEMS:
        measure(item)
