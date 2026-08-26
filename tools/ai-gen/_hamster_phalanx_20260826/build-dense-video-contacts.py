from __future__ import annotations

import math
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
OUTPUT_DIR = ROOT / "previews" / "window-analysis"
VIDEOS = {
    "idle": "hamster_phalanx_idle_h3.mp4",
    "walking-v02": "hamster_phalanx_walking_h3_v02.mp4",
    "attacking": "hamster_phalanx_attacking_h3.mp4",
    "dying": "hamster_phalanx_dying_h3.mp4",
}
COUNT = 32
COLS = 8
THUMB = (256, 144)
LABEL_H = 22


def decode(path: Path) -> list[Image.Image]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    container.close()
    if not frames:
        raise RuntimeError(f"no video frames: {path}")
    return frames


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    for name, filename in VIDEOS.items():
        frames = decode(VIDEO_DIR / filename)
        indices = np.linspace(0, len(frames) - 1, min(COUNT, len(frames))).round().astype(int)
        rows = math.ceil(len(indices) / COLS)
        sheet = Image.new(
            "RGB",
            (COLS * THUMB[0], rows * (THUMB[1] + LABEL_H)),
            "#20242a",
        )
        draw = ImageDraw.Draw(sheet)
        for position, index in enumerate(indices.tolist()):
            x = (position % COLS) * THUMB[0]
            y = (position // COLS) * (THUMB[1] + LABEL_H)
            sheet.paste(frames[index].resize(THUMB, Image.Resampling.LANCZOS), (x, y))
            draw.text((x + 5, y + THUMB[1] + 3), f"frame {index}", fill="white")
        sheet.save(OUTPUT_DIR / f"{name}-dense-contact.png")
        print(f"{name}: decoded={len(frames)} sampled={len(indices)}")


if __name__ == "__main__":
    main()
