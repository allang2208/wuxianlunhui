#!/usr/bin/env python3
"""Extract named full-resolution review frames from one task video."""

from __future__ import annotations

import argparse
from pathlib import Path

import av
from PIL import Image


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("video", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("frames", nargs="+", type=int)
    args = parser.parse_args()
    selected = set(args.frames)
    args.output.mkdir(parents=True, exist_ok=True)
    with av.open(str(args.video)) as container:
        stream = container.streams.video[0]
        for index, frame in enumerate(container.decode(stream)):
            if index in selected:
                Image.fromarray(frame.to_ndarray(format="rgb24"), "RGB").save(
                    args.output / f"{args.video.stem}-f{index:03d}.png"
                )
    print(f"saved {len(list(args.output.glob(args.video.stem + '-f*.png')))} frames")


if __name__ == "__main__":
    main()
