#!/usr/bin/env python3
"""Select natural authored cycles without interpolation or trajectory edits."""

from __future__ import annotations

import json
from pathlib import Path

import av


ROOT = Path(__file__).resolve().parent
JOBS = [
    {
        "name": "idle",
        "source": ROOT / "videos" / "idle-doubao-v02.mp4",
        "output": ROOT / "videos" / "idle-doubao-v02-loop.mp4",
        "start": 34,
        "endInclusive": 93,
        "closureFrame": 94,
        "thumbnailGrayMae": 0.35694444,
    },
    {
        "name": "moving",
        "source": ROOT / "videos" / "moving-doubao-v01-restricted-fix.mp4",
        "output": ROOT / "videos" / "moving-doubao-v01-loop.mp4",
        "start": 35,
        "endInclusive": 87,
        "closureFrame": 88,
        "thumbnailGrayMae": 2.3684723,
    },
]


def trim(job: dict[str, object]) -> dict[str, object]:
    source = Path(job["source"])
    output = Path(job["output"])
    start = int(job["start"])
    end = int(job["endInclusive"])
    with av.open(str(source)) as input_container:
        input_stream = input_container.streams.video[0]
        fps = input_stream.average_rate
        with av.open(str(output), "w") as output_container:
            output_stream = output_container.add_stream("libx264", rate=fps)
            output_stream.width = input_stream.width
            output_stream.height = input_stream.height
            output_stream.pix_fmt = "yuv420p"
            output_stream.options = {"crf": "17", "preset": "medium"}
            written = 0
            for index, frame in enumerate(input_container.decode(input_stream)):
                if index < start:
                    continue
                if index > end:
                    break
                clean = av.VideoFrame.from_ndarray(frame.to_ndarray(format="rgb24"), format="rgb24")
                for packet in output_stream.encode(clean):
                    output_container.mux(packet)
                written += 1
            for packet in output_stream.encode():
                output_container.mux(packet)
    return {
        "name": job["name"],
        "source": str(source.relative_to(ROOT)),
        "output": str(output.relative_to(ROOT)),
        "sourceFrameRange": [start, end],
        "nextNaturalClosureFrame": int(job["closureFrame"]),
        "frames": written,
        "fps": float(fps),
        "durationSeconds": written / float(fps),
        "closureThumbnailGrayMae": float(job["thumbnailGrayMae"]),
        "interpolation": False,
        "trajectoryEdited": False,
    }


def main() -> None:
    report = {"naturalCycles": [trim(job) for job in JOBS]}
    path = ROOT / "natural-cycle-report.json"
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(path.read_text(encoding="utf-8"))


if __name__ == "__main__":
    main()
