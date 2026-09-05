#!/usr/bin/env python3
"""Composite only the generated pseudo-lettering panel into the current mall body."""

from pathlib import Path

import cv2
import numpy as np
from PIL import Image, ImageFilter


ROOT = Path(__file__).resolve().parents[3]
SOURCE = Path(__file__).resolve().parent / "grand_mall_sign_candidate_v02.png"
TARGET = ROOT / "assets/terrain/grand_mall.png"
OUTPUT = Path(__file__).resolve().parent / "grand_mall_sign_only_candidate_v02.png"

# Current runtime body is the accepted 1041x1059 source cropped by (212, 133).
# Keep its rigid plaque and gold frame; replace only the inset red face.
TARGET_INNER_QUAD = np.float32([
    [377, 521],
    [500, 489],
    [510, 536],
    [376, 579],
])


def ordered_quad(points: np.ndarray) -> np.ndarray:
    points = np.asarray(points, dtype=np.float32).reshape(-1, 2)
    sums = points.sum(axis=1)
    diffs = np.diff(points, axis=1).reshape(-1)
    return np.float32([
        points[np.argmin(sums)],
        points[np.argmin(diffs)],
        points[np.argmax(sums)],
        points[np.argmax(diffs)],
    ])


def find_generated_red_face(source: np.ndarray) -> np.ndarray:
    rgb = source[..., :3]
    alpha = source[..., 3]
    red = rgb[..., 0].astype(np.int16)
    green = rgb[..., 1].astype(np.int16)
    blue = rgb[..., 2].astype(np.int16)
    height, width = alpha.shape
    roi = np.zeros_like(alpha, dtype=bool)
    roi[int(height * 0.52):int(height * 0.78), int(width * 0.54):int(width * 0.96)] = True
    mask = np.where(
        roi
        & (alpha > 32)
        & (red > 115)
        & (red > green * 1.55)
        & (red > blue * 1.45)
        & (green < 105),
        255,
        0,
    ).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((9, 9), np.uint8))
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        raise RuntimeError("No red sign face found in generated candidate")
    contour = max(contours, key=cv2.contourArea)
    hull = cv2.convexHull(contour)
    perimeter = cv2.arcLength(hull, True)
    approx = cv2.approxPolyDP(hull, perimeter * 0.025, True)
    quad = approx.reshape(-1, 2) if len(approx) == 4 else cv2.boxPoints(cv2.minAreaRect(hull))
    return ordered_quad(quad)


def main() -> None:
    source = np.asarray(Image.open(SOURCE).convert("RGBA"))
    target = np.asarray(Image.open(TARGET).convert("RGBA")).copy()
    source_quad = find_generated_red_face(source)
    matrix = cv2.getPerspectiveTransform(source_quad, TARGET_INNER_QUAD)
    warped = cv2.warpPerspective(
        source,
        matrix,
        (target.shape[1], target.shape[0]),
        flags=cv2.INTER_LANCZOS4,
        borderMode=cv2.BORDER_CONSTANT,
        borderValue=(0, 0, 0, 0),
    )
    mask = np.zeros(target.shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(mask, TARGET_INNER_QUAD.astype(np.int32), 255)
    mask = np.asarray(Image.fromarray(mask).filter(ImageFilter.GaussianBlur(0.45)))
    blend = (mask.astype(np.float32) / 255.0)[..., None]
    composed = np.clip(
        warped.astype(np.float32) * blend + target.astype(np.float32) * (1.0 - blend),
        0,
        255,
    ).astype(np.uint8)
    # The sign-only edit must not alter the accepted building alpha.
    composed[..., 3] = target[..., 3]
    Image.fromarray(composed, "RGBA").save(OUTPUT, optimize=True)
    print(f"source sign quad: {source_quad.tolist()}")
    print(f"wrote {OUTPUT}")


if __name__ == "__main__":
    main()
