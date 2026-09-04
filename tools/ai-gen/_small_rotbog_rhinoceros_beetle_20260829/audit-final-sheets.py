#!/usr/bin/env python3
"""Asset-level audit for the four formal small-beetle sprite sheets."""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
CELL_W = 512
CELL_H = 512
COLS = 8
ACTIONS = {
    "idle": {"source": 9, "final": 18, "mode": "loop", "fps": 8.0},
    "walking": {"source": 20, "final": 40, "mode": "loop", "fps": 20.0},
    "attacking": {"source": 16, "final": 31, "mode": "one-shot", "fps": 16.0},
    "dying": {"source": 13, "final": 25, "mode": "one-shot", "fps": 13.0},
}


def cells(path: Path, count: int) -> list[np.ndarray]:
    image = np.asarray(Image.open(path).convert("RGBA")).copy()
    result = []
    for index in range(count):
        row, col = divmod(index, COLS)
        result.append(
            image[
                row * CELL_H:(row + 1) * CELL_H,
                col * CELL_W:(col + 1) * CELL_W,
            ].copy()
        )
    return result


def bbox(frame: np.ndarray) -> list[int] | None:
    ys, xs = np.where(frame[..., 3] > 8)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def motion_delta(first: np.ndarray, second: np.ndarray) -> float:
    union = (first[..., 3] > 8) | (second[..., 3] > 8)
    if not union.any():
        return 0.0
    a = first.astype(np.float32) / 255.0
    b = second.astype(np.float32) / 255.0
    return float(np.abs(a[union] - b[union]).mean())


def main() -> None:
    report: dict[str, object] = {
        "pipeline": "formal RGBA spritesheet static audit",
        "actions": {},
        "passed": True,
    }
    for action, cfg in ACTIONS.items():
        source = cells(ROOT / "spritesheets" / "key" / f"{action}.png", cfg["source"])
        final = cells(ROOT / "spritesheets" / "final" / f"{action}.png", cfg["final"])
        bboxes = [bbox(frame) for frame in final]
        empty = [index for index, item in enumerate(bboxes) if item is None]
        touching = [
            index
            for index, item in enumerate(bboxes)
            if item is not None
            and (item[0] <= 0 or item[1] <= 0 or item[2] >= 511 or item[3] >= 511)
        ]
        transparent_rgb = sum(
            int(np.count_nonzero(frame[..., :3][frame[..., 3] == 0]))
            for frame in final
        )
        blue_pixels = 0
        cyan_pixels = 0
        neon_green_pixels = 0
        neon_yellow_pixels = 0
        for frame in final:
            rgb = frame[..., :3].astype(np.int16)
            alpha = frame[..., 3]
            red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
            blue_pixels += int(
                ((alpha > 3) & (blue > np.maximum(red, green) + 18)).sum()
            )
            cyan_pixels += int(
                (
                    (alpha > 3)
                    & (green > red + 18)
                    & (blue > red + 18)
                ).sum()
            )
            neon_green_pixels += int(
                (
                    (alpha > 32)
                    & (green > 150)
                    & (green > red + 55)
                    & (green > blue + 55)
                ).sum()
            )
            neon_yellow_pixels += int(
                (
                    (alpha > 32)
                    & (red > 180)
                    & (green > 180)
                    & (blue < 70)
                ).sum()
            )
        even_preserved = all(
            np.array_equal(source[index], final[index * 2])
            for index in range(cfg["source"])
        )

        adjacent = [
            motion_delta(final[index], final[index + 1])
            for index in range(len(final) - 1)
        ]
        seam_ratio = None
        if cfg["mode"] == "loop":
            median_step = float(np.median([value for value in adjacent if value > 0]))
            seam_step = motion_delta(final[-1], final[0])
            seam_ratio = seam_step / median_step if median_step > 0 else math.inf

        rife_report = json.loads(
            (ROOT / "spritesheets" / "reports" / f"{action}-rife.json").read_text(
                encoding="utf-8"
            )
        )
        validation = rife_report["validation"]
        action_passed = (
            not empty
            and not touching
            and transparent_rgb == 0
            and blue_pixels == 0
            and cyan_pixels == 0
            and neon_green_pixels == 0
            and neon_yellow_pixels == 0
            and even_preserved
            and not validation.get("visibleDarkOutlierFrames")
            and not validation.get("visibleRedOutlierFrames")
            # A small seam delta means the loop closes gently. Only reject a
            # seam that jumps substantially more than the normal frame step.
            and (seam_ratio is None or seam_ratio <= 1.5)
        )
        report["actions"][action] = {
            "sheet": f"spritesheets/final/{action}.png",
            "frameCount": cfg["final"],
            "frameRate": cfg["fps"],
            "mode": cfg["mode"],
            "emptyFrames": empty,
            "touchingFrames": touching,
            "nonzeroRgbInTransparentPixels": transparent_rgb,
            "visibleBluePixels": blue_pixels,
            "visibleCyanPixels": cyan_pixels,
            "visibleNeonGreenPixels": neon_green_pixels,
            "visibleNeonYellowPixels": neon_yellow_pixels,
            "originalKeyFramesPreservedAtEvenIndices": even_preserved,
            "loopSeamMotionRatio": seam_ratio,
            "visibleDarkOutlierFrames": validation.get("visibleDarkOutlierFrames", {}),
            "visibleRedOutlierFrames": validation.get("visibleRedOutlierFrames", {}),
            "passed": action_passed,
        }
        report["passed"] = bool(report["passed"] and action_passed)

    out = ROOT / "spritesheets" / "reports" / "final-audit.json"
    out.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if not report["passed"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
