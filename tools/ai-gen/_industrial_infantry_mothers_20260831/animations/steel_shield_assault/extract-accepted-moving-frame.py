#!/usr/bin/env python3
"""Extract one accepted moving frame as an identity reference for later actions."""

from pathlib import Path

import av


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "moving-doubao-v02-coat-covered.mp4"
OUTPUT = ROOT / "references" / "moving-v02-frame31-accepted-tail.png"
TARGET_FRAME = 31


def main() -> None:
    container = av.open(str(VIDEO))
    try:
        for index, frame in enumerate(container.decode(video=0)):
            if index == TARGET_FRAME:
                OUTPUT.parent.mkdir(parents=True, exist_ok=True)
                frame.to_image().save(OUTPUT)
                return
    finally:
        container.close()
    raise RuntimeError(f"frame {TARGET_FRAME} not found in {VIDEO}")


if __name__ == "__main__":
    main()
