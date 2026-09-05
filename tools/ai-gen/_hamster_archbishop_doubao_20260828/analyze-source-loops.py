#!/usr/bin/env python3
"""Rank natural loop windows on the normalized transparent source sheets."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent


def cells(action: str, spec: dict[str, object]) -> list[np.ndarray]:
    image = np.asarray(Image.open(ROOT / "source-sheets-pre-interpolation" / f"{action}.png").convert("RGBA"))
    width = int(spec["frameWidth"])
    height = int(spec["frameHeight"])
    cols = int(spec["cols"])
    out = []
    for index in range(int(spec["frameCount"])):
        row, col = divmod(index, cols)
        out.append(image[row * height:(row + 1) * height, col * width:(col + 1) * width].copy())
    return out


def delta(left: np.ndarray, right: np.ndarray) -> float:
    left_alpha = left[..., 3] > 16
    right_alpha = right[..., 3] > 16
    union = left_alpha | right_alpha
    if not union.any():
        return 0.0
    left_rgb = left[..., :3].astype(np.float32)
    right_rgb = right[..., :3].astype(np.float32)
    rgb = np.abs(left_rgb - right_rgb).mean(axis=2)
    alpha = np.abs(left[..., 3].astype(np.float32) - right[..., 3])
    return float((rgb[union].mean() * 0.75) + (alpha[union].mean() * 0.25))


def alpha_iou(left: np.ndarray, right: np.ndarray) -> float:
    a = left[..., 3] > 32
    b = right[..., 3] > 32
    union = np.logical_or(a, b).sum()
    return float(np.logical_and(a, b).sum() / union) if union else 1.0


def rank(action: str, frames: list[np.ndarray], source_indices: list[int]) -> list[dict[str, object]]:
    ranked = []
    min_keys = 6 if action == "moving" else 8
    for start in range(len(frames)):
        for endpoint in range(start + min_keys, len(frames)):
            window = frames[start:endpoint]
            adjacent = [delta(a, b) for a, b in zip(window, window[1:])]
            if not adjacent:
                continue
            closure_delta = delta(frames[start], frames[endpoint])
            seam_delta = delta(frames[endpoint - 1], frames[start])
            adjacent_mean = float(np.mean(adjacent))
            seam_ratio = seam_delta / max(0.001, adjacent_mean)
            closure_iou = alpha_iou(frames[start], frames[endpoint])
            score = closure_delta + abs(seam_ratio - 1.0) * 12.0 + (1.0 - closure_iou) * 30.0
            ranked.append({
                "score": score,
                "startSheetFrame": start,
                "endpointSheetFrame": endpoint,
                "sourceStart": source_indices[start],
                "sourceEndInclusive": source_indices[endpoint - 1],
                "sourceClosureFrame": source_indices[endpoint],
                "keyFrameCount": endpoint - start,
                "durationSeconds": (source_indices[endpoint] - source_indices[start]) / 24.0,
                "closureDelta": closure_delta,
                "closureAlphaIou": closure_iou,
                "seamDelta": seam_delta,
                "adjacentMean": adjacent_mean,
                "seamRatio": seam_ratio,
            })
    return sorted(ranked, key=lambda item: float(item["score"]))


def main() -> None:
    report = json.loads((ROOT / "source-sheet-report.json").read_text(encoding="utf-8"))
    output = {}
    for action in ("idle", "moving"):
        spec = report["actions"][action]
        ranked = rank(action, cells(action, spec), list(spec["sourceIndices"]))
        output[action] = ranked[:20]
        print(f"[{action}]")
        for item in ranked[:12]:
            print(
                f"start={item['sourceStart']} end={item['sourceEndInclusive']} "
                f"closure={item['sourceClosureFrame']} keys={item['keyFrameCount']} "
                f"duration={item['durationSeconds']:.3f}s closureDelta={item['closureDelta']:.3f} "
                f"IoU={item['closureAlphaIou']:.4f} seamRatio={item['seamRatio']:.3f} "
                f"score={item['score']:.3f}"
            )
    (ROOT / "natural-cycle-candidates.json").write_text(
        json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
