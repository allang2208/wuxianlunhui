#!/usr/bin/env python3
"""Extract full-resolution running frames for restricted tail-mask design."""

from pathlib import Path

import av


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "videos" / "running-doubao-v01.mp4"
OUTPUT = ROOT / "references" / "running-tail-review"
INDICES = {28, 34, 40, 46}


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    container = av.open(str(SOURCE))
    stream = container.streams.video[0]
    for index, frame in enumerate(container.decode(stream)):
        if index in INDICES:
            frame.to_image().convert("RGB").save(OUTPUT / f"running-f{index:03d}.png")
    container.close()
    print(f"saved {sorted(INDICES)} to {OUTPUT}")


if __name__ == "__main__":
    main()
