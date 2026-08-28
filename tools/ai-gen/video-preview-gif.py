#!/usr/bin/env python3
"""Create a compact GIF preview from a source video without changing timing."""

from __future__ import annotations

import argparse
from pathlib import Path

import av
from PIL import Image


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--video", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--fps", type=float, default=10.0)
    ap.add_argument("--size", default="512x288")
    args = ap.parse_args()

    width, height = (int(value) for value in args.size.lower().split("x", 1))
    container = av.open(str(args.video))
    stream = container.streams.video[0]
    source_fps = float(stream.average_rate or 24.0)
    stride = max(1, round(source_fps / args.fps))
    playback_fps = source_fps / stride
    frames: list[Image.Image] = []
    for index, frame in enumerate(container.decode(stream)):
        if index % stride:
            continue
        image = frame.to_image().convert("RGB")
        image.thumbnail((width, height), Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", (width, height), "black")
        canvas.paste(image, ((width - image.width) // 2, (height - image.height) // 2))
        frames.append(canvas)
    container.close()
    if not frames:
        raise SystemExit("video contains no decoded frames")

    args.out.parent.mkdir(parents=True, exist_ok=True)
    duration_ms = round(1000.0 / playback_fps)
    frames[0].save(
        args.out, save_all=True, append_images=frames[1:],
        duration=duration_ms, loop=0, disposal=2,
    )
    print(
        f"source_fps={source_fps:.3f} stride={stride} frames={len(frames)} "
        f"duration_ms={duration_ms} -> {args.out}"
    )


if __name__ == "__main__":
    main()
