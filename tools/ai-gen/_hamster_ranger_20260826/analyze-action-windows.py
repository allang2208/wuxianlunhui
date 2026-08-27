#!/usr/bin/env python3
"""Create dense contacts and motion summaries for accepted ranger videos."""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
OUT_DIR = ROOT / "previews" / "window-analysis"
SOURCES = {
    "idle": "idle-h3.mp4",
    "running": "running-h3-v02.mp4",
    "dying": "dying-h3.mp4",
}
STEP = 4
THUMB_W = 320
THUMB_H = 180
LABEL_H = 24
COLS = 4


def decode(path: Path) -> tuple[list[np.ndarray], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]
    return frames, fps


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    report: dict[str, object] = {}
    for action, filename in SOURCES.items():
        frames, fps = decode(VIDEO_DIR / filename)
        indices = list(range(0, len(frames), STEP))
        if indices[-1] != len(frames) - 1:
            indices.append(len(frames) - 1)
        rows = math.ceil(len(indices) / COLS)
        contact = Image.new(
            "RGB", (COLS * THUMB_W, rows * (THUMB_H + LABEL_H)), "#20242a"
        )
        draw = ImageDraw.Draw(contact)
        for position, index in enumerate(indices):
            frame = Image.fromarray(frames[index], "RGB").resize(
                (THUMB_W, THUMB_H), Image.Resampling.LANCZOS
            )
            x = (position % COLS) * THUMB_W
            y = (position // COLS) * (THUMB_H + LABEL_H)
            contact.paste(frame, (x, y))
            draw.text(
                (x + 5, y + THUMB_H + 4),
                f"f{index} / {index / fps:.2f}s",
                fill="white",
            )
        contact.save(OUT_DIR / f"{action}-dense-contact.jpg", quality=92)

        small = [
            cv2.resize(
                cv2.cvtColor(frame, cv2.COLOR_RGB2GRAY),
                (180, 100),
                interpolation=cv2.INTER_AREA,
            )
            for frame in frames
        ]
        deltas = []
        for left, right in zip(small, small[1:]):
            mask = np.minimum(left, right) < 245
            deltas.append(
                float(np.abs(left.astype(np.float32) - right)[mask].mean())
                if mask.any()
                else 0.0
            )
        report[action] = {
            "source": f"videos/{filename}",
            "sourceFrames": len(frames),
            "fps": fps,
            "sampledFrames": indices,
            "adjacentDelta": deltas,
        }
    (OUT_DIR / "motion-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )


if __name__ == "__main__":
    main()
