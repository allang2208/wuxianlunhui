#!/usr/bin/env python3
"""Find a natural idle cycle window without geometrically rewriting motion."""

from __future__ import annotations

import importlib.util
import math
from pathlib import Path

import cv2
import numpy as np


ROOT = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("source_builder", ROOT / "build-source-sheets.py")
builder = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(builder)


def delta(first: np.ndarray, second: np.ndarray) -> float:
    union = (first[..., 3] > 8) | (second[..., 3] > 8)
    if not union.any():
        return 0.0
    a = first.astype(np.float32) / 255.0
    b = second.astype(np.float32) / 255.0
    return float(np.abs(a[union] - b[union]).mean())


def main() -> None:
    decoded = builder.decode(ROOT / "videos" / "idle-doubao-v01.mp4")
    recovered = [builder.recover_rgba(frame) for frame in decoded]
    core_x, _, core_w = builder.core_geometry(recovered[0])
    first_bbox = builder.alpha_bbox(recovered[0])
    scale = builder.TARGET_CORE_W / core_w
    matrix = np.array(
        [
            [scale, 0.0, builder.TARGET_CORE_X - scale * core_x],
            [0.0, scale, builder.TARGET_FOOT_Y - scale * first_bbox[3]],
        ],
        dtype=np.float32,
    )
    placed = []
    for rgba in recovered:
        rgb = cv2.warpAffine(
            rgba[..., :3], matrix, (builder.CELL_W, builder.CELL_H),
            flags=cv2.INTER_LANCZOS4,
        )
        alpha = cv2.warpAffine(
            rgba[..., 3], matrix, (builder.CELL_W, builder.CELL_H),
            flags=cv2.INTER_LANCZOS4,
        )
        alpha[alpha < 3] = 0
        rgb[alpha == 0] = 0
        placed.append(builder.despill_placed_rgba(np.dstack([rgb, alpha])))

    candidates = []
    for step in (4, 6, 8):
        for start in range(0, 65, 2):
            for end in range(start + step * 6, len(placed), step):
                indices = list(range(start, end, step))
                if len(indices) < 6:
                    continue
                adjacent = [
                    delta(placed[indices[i]], placed[indices[i + 1]])
                    for i in range(len(indices) - 1)
                ]
                median = float(np.median([value for value in adjacent if value > 0]))
                if median <= 0:
                    continue
                seam = delta(placed[indices[-1]], placed[indices[0]])
                seam_ratio = seam / median
                endpoint = delta(placed[start], placed[end]) / median
                if not 0.5 <= seam_ratio <= 1.5:
                    continue
                score = abs(math.log(seam_ratio)) + endpoint * 0.4
                candidates.append(
                    (score, step, start, end, len(indices), seam_ratio, endpoint)
                )
    for item in sorted(candidates)[:20]:
        score, step, start, end, count, seam_ratio, endpoint = item
        print(
            f"step={step} start={start} end={end} count={count} "
            f"seamRatio={seam_ratio:.4f} endpointRatio={endpoint:.4f} score={score:.4f}"
        )


if __name__ == "__main__":
    main()
