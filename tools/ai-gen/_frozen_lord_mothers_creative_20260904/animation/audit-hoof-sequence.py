#!/usr/bin/env python3
"""Measure four fixed screen-space hoof bands in the raw sequence candidate."""

from __future__ import annotations

import argparse
import json
import runpy
from pathlib import Path

import numpy as np


ROOT = Path(__file__).resolve().parent
COMMON = runpy.run_path(str(ROOT / "audit-antler-camera.py"))
decode = COMMON["decode"]
frame_metrics = COMMON["frame_metrics"]


def episodes(values: list[int], threshold: int = 6) -> list[dict]:
    result = []
    start = None
    for index, value in enumerate(values + [0]):
        if value >= threshold and start is None:
            start = index
        elif value < threshold and start is not None:
            stop = index - 1
            peak = max(range(start, stop + 1), key=lambda frame: values[frame])
            result.append({
                "startFrame": start,
                "peakFrame": peak,
                "endFrame": stop,
                "peakLiftPixels": values[peak],
            })
            start = None
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--out", type=Path)
    args = parser.parse_args()
    video = args.video.resolve()
    output = args.out.resolve() if args.out else video.with_name(f"{video.stem}-hoof-audit.json")
    frames = decode(video)
    first = frame_metrics(frames[0])
    contacts = [round(value) for value in first["footXs"]]
    if len(contacts) != 4:
        raise RuntimeError(f"expected four opening hoof contacts, got {contacts}")
    baseline_bottom = first["bbox"][3]
    first_mask = first["mask"]
    opening_foot_ys = []
    for center_x in contacts:
        x0, x1 = max(0, center_x - 24), min(first_mask.shape[1], center_x + 25)
        ys, _xs = np.where(first_mask[320:530, x0:x1] > 0)
        opening_foot_ys.append(int(ys.max() + 320) if len(ys) else baseline_bottom)
    per_hoof_lift = [[] for _ in contacts]
    frame_rows = []
    for frame_index, frame in enumerate(frames):
        mask = frame_metrics(frame)["mask"]
        row = {"frame": frame_index, "liftPixels": []}
        for hoof_index, center_x in enumerate(contacts):
            x0, x1 = max(0, center_x - 24), min(mask.shape[1], center_x + 25)
            ys, _xs = np.where(mask[320:530, x0:x1] > 0)
            max_y = int(ys.max() + 320) if len(ys) else 320
            lift = max(0, opening_foot_ys[hoof_index] - max_y)
            per_hoof_lift[hoof_index].append(lift)
            row["liftPixels"].append(lift)
        frame_rows.append(row)
    report = {
        "method": "raw-video fixed x bands around the four opening hoof contacts; no frame transformed",
        "video": str(video.relative_to(ROOT)).replace("\\", "/"),
        "decodedFrames": len(frames),
        "openingHoofXs": contacts,
        "openingBottomY": baseline_bottom,
        "openingHoofYs": opening_foot_ys,
        "liftThresholdPixels": 6,
        "hoofEpisodesScreenLeftToRight": [episodes(values) for values in per_hoof_lift],
        "samples": [frame_rows[index] for index in range(0, min(72, len(frames)), 2)],
    }
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
