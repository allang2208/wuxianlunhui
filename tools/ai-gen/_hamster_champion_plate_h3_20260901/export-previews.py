#!/usr/bin/env python3
"""Export full H3 source-video GIF previews without dropping or retiming frames."""

import argparse
import json
from pathlib import Path

import av
from PIL import Image


def export(video: Path, output_dir: Path) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    with av.open(str(video)) as container:
        stream = container.streams.video[0]
        rate = float(stream.average_rate)
        decoded = list(container.decode(stream))
        starts = [float(frame.pts * stream.time_base) for frame in decoded]
        origin = starts[0]
        starts = [value - origin for value in starts]
        end = starts[-1] + 1.0 / rate
        frames = [
            frame.to_image().convert("RGB").resize((512, 288), Image.Resampling.LANCZOS)
            for frame in decoded
        ]

    ticks = [round(value * 100) for value in starts] + [round(end * 100)]
    durations = [max(1, ticks[index + 1] - ticks[index]) * 10 for index in range(len(frames))]
    gif = output_dir / f"{video.stem}.gif"
    frames[0].save(
        gif,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=False,
    )
    report = {
        "sourceVideo": str(video.resolve()),
        "preview": str(gif.resolve()),
        "sourceFrameCount": len(decoded),
        "sourceFps": rate,
        "sourceFrameSize": [decoded[0].width, decoded[0].height],
        "sourceDurationSeconds": end,
        "previewSize": [512, 288],
        "previewDurationMs": sum(durations),
        "previewFrameDurationsMs": durations,
        "timeQuantizationErrorMs": round(sum(durations) - end * 1000, 4),
        "kind": "Full source-video preview; not a runtime spritesheet or runtime playback proof",
        "motionEdited": False,
        "sourceFramesDropped": False,
        "backgroundRemoved": False,
        "rifeApplied": False,
    }
    (output_dir / f"{video.stem}-preview.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"{gif}: {len(frames)} source frames, {sum(durations)} ms")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("videos", type=Path, nargs="+")
    parser.add_argument("--output-dir", type=Path, required=True)
    args = parser.parse_args()
    for video in args.videos:
        export(video, args.output_dir)


if __name__ == "__main__":
    main()
