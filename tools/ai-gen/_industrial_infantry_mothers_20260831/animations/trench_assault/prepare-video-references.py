#!/usr/bin/env python3
"""Pad approved trench-assault identity/action references to a safe 16:9 canvas."""

from pathlib import Path

from PIL import Image


TASK = Path(__file__).resolve().parent
INPUTS = {
    "trench-assault-mother-video-safe-16x9.png": TASK.parent.parent / "mother/trench_assault-mother-v03-a10.png",
    "trench-assault-running-keyframe-video-safe-16x9.png": TASK / "keyframes/running-keyframe-v01.png",
    "trench-assault-attacking-keyframe-video-safe-16x9.png": TASK / "keyframes/attacking-keyframe-v01.png",
    "trench-assault-dying-start-v02-right-video-safe-16x9.png": TASK / "keyframes/dying-start-keyframe-v02-right.png",
    "trench-assault-dying-end-v03-right-side-video-safe-16x9.png": TASK / "keyframes/dying-end-keyframe-v03-right-side.png",
}
OUTPUT = TASK / "references"
CANVAS = (1280, 720)


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    for name, source in INPUTS.items():
        image = Image.open(source).convert("RGB")
        scale = min(CANVAS[0] / image.width, CANVAS[1] / image.height)
        size = (round(image.width * scale), round(image.height * scale))
        resized = image.resize(size, Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", CANVAS, (255, 255, 255))
        xy = ((CANVAS[0] - size[0]) // 2, (CANVAS[1] - size[1]) // 2)
        canvas.paste(resized, xy)
        destination = OUTPUT / name
        canvas.save(destination)
        print(f"wrote {destination} from {source} at {size} offset {xy}")


if __name__ == "__main__":
    main()
