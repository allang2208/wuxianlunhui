#!/usr/bin/env python3
"""Prepare immutable MiniMax H3 identity, work-state, and motion references."""

from __future__ import annotations

from fractions import Fraction
from pathlib import Path

import av
from PIL import Image


PROJECT_ROOT = Path(__file__).resolve().parents[3]
TASK_ROOT = Path(__file__).resolve().parent
REFERENCE_ROOT = TASK_ROOT / "references"
FARMER_ROOT = PROJECT_ROOT / "assets" / "companions" / "hamster_farmer"
CELL = 512
COLS = 8
CANVAS = (1024, 576)
TARGET_HEIGHT = 420
FEET_Y = 500
SMALL_TARGET_HEIGHT = 320
SMALL_FEET_Y = 450


def frame_from_sheet(path: Path, index: int) -> Image.Image:
    sheet = Image.open(path).convert("RGBA")
    x = (index % COLS) * CELL
    y = (index // COLS) * CELL
    return sheet.crop((x, y, x + CELL, y + CELL))


def normalized_rgba(frame: Image.Image, target_height: int = TARGET_HEIGHT,
                    feet_y: int = FEET_Y) -> Image.Image:
    bbox = frame.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("source frame has no visible subject")
    subject = frame.crop(bbox)
    scale = target_height / subject.height
    width = max(1, round(subject.width * scale))
    subject = subject.resize((width, target_height), Image.Resampling.LANCZOS)
    out = Image.new("RGBA", CANVAS, (0, 0, 0, 0))
    x = (CANVAS[0] - width) // 2
    y = feet_y - target_height
    out.alpha_composite(subject, (x, y))
    return out


def on_white(frame: Image.Image) -> Image.Image:
    white = Image.new("RGB", CANVAS, "white")
    white.paste(frame.convert("RGB"), (0, 0), frame.getchannel("A"))
    return white


def write_reference(path: Path, frame: Image.Image, target_height: int = TARGET_HEIGHT,
                    feet_y: int = FEET_Y) -> None:
    on_white(normalized_rgba(frame, target_height, feet_y)).save(path, optimize=True)


def write_motion_reference(path: Path, target_height: int = TARGET_HEIGHT,
                           feet_y: int = FEET_Y) -> None:
    frames = [normalized_rgba(frame_from_sheet(FARMER_ROOT / "running.png", index),
                              target_height, feet_y)
              for index in range(14)]
    path.parent.mkdir(parents=True, exist_ok=True)
    with av.open(str(path), mode="w") as container:
        stream = container.add_stream("libx264", rate=14)
        stream.width, stream.height = CANVAS
        stream.pix_fmt = "yuv420p"
        stream.options = {"crf": "15", "preset": "slow"}
        for _ in range(5):
            for image in frames:
                video_frame = av.VideoFrame.from_image(on_white(image))
                video_frame.time_base = Fraction(1, 14)
                for packet in stream.encode(video_frame):
                    container.mux(packet)
        for packet in stream.encode():
            container.mux(packet)


def main() -> None:
    REFERENCE_ROOT.mkdir(parents=True, exist_ok=True)
    write_reference(REFERENCE_ROOT / "farmer-master.png",
                    frame_from_sheet(FARMER_ROOT / "idle.png", 0))
    write_reference(REFERENCE_ROOT / "farmer-working.png",
                    frame_from_sheet(FARMER_ROOT / "harvesting.png", 9))
    write_motion_reference(REFERENCE_ROOT / "farmer-running-motion.mp4")
    write_reference(REFERENCE_ROOT / "farmer-master-small.png",
                    frame_from_sheet(FARMER_ROOT / "idle.png", 0),
                    SMALL_TARGET_HEIGHT, SMALL_FEET_Y)
    write_motion_reference(REFERENCE_ROOT / "farmer-running-motion-small.mp4",
                           SMALL_TARGET_HEIGHT, SMALL_FEET_Y)
    print(f"references prepared under {REFERENCE_ROOT}")


if __name__ == "__main__":
    main()
