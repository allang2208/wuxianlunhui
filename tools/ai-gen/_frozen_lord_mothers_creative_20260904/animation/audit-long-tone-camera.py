#!/usr/bin/env python3
"""Measure raw long-tone camera/root stability without transforming frames."""

from __future__ import annotations

import argparse
import json
import runpy
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DEFAULT_VIDEO = ROOT / "videos" / "03-white-silence-bell-hart-long-tone-body-h3-v01.mp4"
DEFAULT_OUTPUT = ROOT / "videos" / "03-white-silence-bell-hart-long-tone-body-h3-v01-camera-audit.json"
COMMON = runpy.run_path(str(ROOT / "audit-antler-camera.py"))
decode = COMMON["decode"]
frame_metrics = COMMON["frame_metrics"]
SAMPLES = [0, 8, 16, 24, 32, 40, 48, 56, 64, 72, 84, 96, 108, 123]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, default=DEFAULT_VIDEO)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--active-start", type=int, default=0)
    parser.add_argument("--active-end", type=int, default=104)
    parser.add_argument("--baseline-frame", type=int, default=0)
    parser.add_argument("--samples", default=",".join(str(value) for value in SAMPLES))
    args = parser.parse_args()
    video = args.video.resolve()
    output = args.out.resolve()
    sample_indices = [int(value) for value in args.samples.split(",") if value.strip()]
    frames = decode(video)
    metrics = [frame_metrics(frame) for frame in frames]
    for item in metrics:
        item.pop("mask", None)
    baseline = metrics[args.baseline_frame]
    baseline_feet = baseline["footXs"]
    samples = []
    for frame_index in sample_indices:
        item = {**metrics[frame_index], "frame": frame_index}
        item["rootDeltaX"] = round(item["rootX"] - baseline["rootX"], 2)
        item["rearFootDeltaX"] = round(item["rearFootX"] - baseline["rearFootX"], 2)
        item["heightRatio"] = round(item["height"] / baseline["height"], 4)
        item["areaRatio"] = round(item["area"] / baseline["area"], 4)
        if len(item["footXs"]) == len(baseline_feet):
            item["footDeltaXs"] = [
                round(current - opening, 2)
                for current, opening in zip(item["footXs"], baseline_feet)
            ]
        samples.append(item)

    active = metrics[args.active_start:args.active_end + 1]
    root_deltas = [item["rootX"] - baseline["rootX"] for item in active]
    rear_deltas = [item["rearFootX"] - baseline["rearFootX"] for item in active]
    report = {
        "method": "raw-video non-white subject silhouette; outer registration band excluded from subject measurement; no frame transformed",
        "video": str(video.relative_to(ROOT)).replace("\\", "/"),
        "decodedFrames": len(frames),
        "baseline": baseline,
        f"activeWindow{args.active_start}To{args.active_end}": {
            "rootDeltaXRange": [round(min(root_deltas), 2), round(max(root_deltas), 2)],
            "rearFootDeltaXRange": [round(min(rear_deltas), 2), round(max(rear_deltas), 2)],
            "heightRatioRange": [
                round(min(item["height"] / baseline["height"] for item in active), 4),
                round(max(item["height"] / baseline["height"] for item in active), 4),
            ],
            "areaRatioRange": [
                round(min(item["area"] / baseline["area"] for item in active), 4),
                round(max(item["area"] / baseline["area"] for item in active), 4),
            ],
        },
        "samples": samples,
    }
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
