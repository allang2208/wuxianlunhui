#!/usr/bin/env python3
"""Rank same-pose loop windows in the accepted raw bell-hart stride clip."""

from __future__ import annotations

import json
from pathlib import Path

import av
import numpy as np


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "03-white-silence-bell-hart-stride-h3-v01.mp4"
OUTPUT = ROOT / "videos" / "03-white-silence-bell-hart-stride-h3-v01-loop-audit.json"


def main() -> None:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    arrays = [frame[70:530, 240:760].astype(np.int16) for frame in frames]
    masks = [np.linalg.norm(255.0 - frame.astype(np.float32), axis=2) > 24.0 for frame in arrays]
    ranked = []
    for start in range(0, 41):
        for end in range(start + 40, min(len(frames), start + 81)):
            union = masks[start] | masks[end]
            delta = np.abs(arrays[start] - arrays[end]).mean(axis=2)
            ranked.append({
                "startFrame": start,
                "duplicateEndpoint": end,
                "periodFrames": end - start,
                "periodMs": round((end - start) * 1000 / fps),
                "meanAbsRgbOnUnion": round(float(delta[union].mean()), 4),
                "changedUnionRatioOver12": round(float((delta[union] > 12).mean()), 6),
                "foregroundAreaRatio": round(float(masks[end].sum() / max(1, masks[start].sum())), 6),
            })
    ranked.sort(key=lambda item: (item["meanAbsRgbOnUnion"], item["changedUnionRatioOver12"]))
    report = {
        "method": "raw fixed-crop RGB and foreground-union comparison; no frame transformed",
        "video": str(VIDEO.relative_to(ROOT)).replace("\\", "/"),
        "decodedFrames": len(frames),
        "fps": fps,
        "search": {"startFrames": [0, 40], "periodFrames": [40, 80]},
        "topCandidates": ranked[:40],
        "namedPairs": [
            next(item for item in ranked if item["startFrame"] == start and item["duplicateEndpoint"] == end)
            for start, end in [(0, 64), (0, 60), (0, 59), (5, 64), (27, 91), (32, 96)]
        ],
    }
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(OUTPUT)


if __name__ == "__main__":
    main()
