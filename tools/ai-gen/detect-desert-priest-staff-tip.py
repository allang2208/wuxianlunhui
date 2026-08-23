"""Locate the gold staff head in each valid Desert Priest spell frame.

This is a small asset-pipeline helper, not runtime code.  It detects saturated
gold pixels in the upper half of each 512px cell, groups them into connected
components, and follows the staff-head component across the 17-frame motion.
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np


def _gold_mask(frame: np.ndarray) -> np.ndarray:
    blue, green, red, alpha = cv2.split(frame)
    # The staff head is the only compact, strongly saturated gold object above
    # the character.  A light morphology pass joins its engraved highlights.
    mask = (
        (alpha > 90)
        & (red > 95)
        & (green > 55)
        & (red.astype(np.int16) - blue.astype(np.int16) > 38)
        & (green.astype(np.int16) - blue.astype(np.int16) > 12)
    ).astype(np.uint8)
    mask[300:, :] = 0
    return cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((3, 3), np.uint8))


def _components(frame: np.ndarray) -> list[dict[str, float]]:
    mask = _gold_mask(frame)
    count, _, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
    result: list[dict[str, float]] = []
    for label in range(1, count):
        x, y, width, height, area = stats[label]
        if area < 7:
            continue
        cx, cy = centroids[label]
        result.append(
            {
                "x": float(x),
                "y": float(y),
                "w": float(width),
                "h": float(height),
                "area": float(area),
                "cx": float(cx),
                "cy": float(cy),
            }
        )
    return result


def detect(sheet_path: Path, frame_count: int = 17) -> list[tuple[int, int]]:
    sheet = cv2.imread(str(sheet_path), cv2.IMREAD_UNCHANGED)
    if sheet is None or sheet.shape[2] != 4:
        raise RuntimeError(f"Expected an RGBA sheet: {sheet_path}")

    anchors: list[tuple[int, int]] = []
    for index in range(frame_count):
        col, row = index % 8, index // 8
        frame = sheet[row * 512 : (row + 1) * 512, col * 512 : (col + 1) * 512]
        candidates = _components(frame)
        if not candidates:
            raise RuntimeError(f"No gold candidates found in frame {index}")

        def score(component: dict[str, float]) -> float:
            # The staff is a tall component on the right in its low pose.  Once
            # raised, its head is simply the highest gold component; in the four
            # overhead frames it touches the character and becomes one large
            # component, which the low top edge still identifies correctly.
            top_score = component["y"] * 1.8
            right_score = max(0.0, 285.0 - (component["x"] + component["w"] / 2)) * 4.0
            short_penalty = max(0.0, 24.0 - component["h"]) * 8.0
            return top_score + right_score + short_penalty

        best = min(candidates, key=score)
        mask = _gold_mask(frame)
        x0, y0 = round(best["x"]), round(best["y"])
        x1 = x0 + round(best["w"])
        # Only average the gold pixels in the component's top cap.  Using the
        # entire component would pull the anchor down the staff shaft.
        head_band = max(12, min(36, round(best["w"]) + 4))
        ys, xs = np.nonzero(mask[y0 : y0 + head_band, x0:x1])
        anchor = (round(float(xs.mean()) + x0), round(float(ys.mean()) + y0))
        anchors.append(anchor)
        print(f"{index:02d}: {anchor} component={best}")
    return anchors


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("sheet", type=Path)
    args = parser.parse_args()
    anchors = detect(args.sheet)
    print("staffTipFrames:", [[x, y] for x, y in anchors])


if __name__ == "__main__":
    main()
