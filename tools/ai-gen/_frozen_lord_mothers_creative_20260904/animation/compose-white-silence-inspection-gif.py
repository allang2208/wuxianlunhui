#!/usr/bin/env python3
"""Compose the six formal White Silence Bell Hart GIFs into one review grid."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw, ImageSequence


ROOT = Path(__file__).resolve().parent
FAMILY = ROOT / "formal" / "white-silence-bell-hart"
SOURCES = [
    ("stride", FAMILY / "stride" / "previews" / "white-silence-bell-hart-stride.gif"),
    ("antler", FAMILY / "antler-body" / "previews" / "white-silence-bell-hart-antler_body.gif"),
    ("double_toll", FAMILY / "previews" / "white-silence-bell-hart-double_toll_body.gif"),
    ("hoof_sequence", FAMILY / "hoof-sequence-body" / "previews" / "white-silence-bell-hart-hoof_sequence_body.gif"),
    ("long_tone", FAMILY / "long-tone-body" / "previews" / "white-silence-bell-hart-long_tone_body.gif"),
    ("rhythm_shift", FAMILY / "rhythm-shift-body" / "previews" / "white-silence-bell-hart-rhythm_shift_body.gif"),
]
OUTPUT = FAMILY / "previews" / "white-silence-bell-hart-all-formal-actions.gif"
STEP_MS = 50
PREVIEW_MS = 6000
THUMB = 192
LABEL_H = 24
PAD = 8


def load_timeline(path: Path) -> tuple[list[Image.Image], list[int], int]:
    with Image.open(path) as gif:
        frames = []
        durations = []
        for frame in ImageSequence.Iterator(gif):
            frames.append(frame.convert("RGB").resize((THUMB, THUMB), Image.Resampling.LANCZOS))
            durations.append(int(frame.info.get("duration", gif.info.get("duration", STEP_MS))))
    total = sum(durations)
    return frames, durations, total


def frame_at(timeline: tuple[list[Image.Image], list[int], int], time_ms: int) -> Image.Image:
    frames, durations, total = timeline
    cursor = time_ms % total
    elapsed = 0
    for frame, duration in zip(frames, durations):
        elapsed += duration
        if cursor < elapsed:
            return frame
    return frames[-1]


def main() -> None:
    timelines = [(label, load_timeline(path)) for label, path in SOURCES]
    cell_w = THUMB + PAD * 2
    cell_h = THUMB + LABEL_H + PAD * 2
    output_frames = []
    for time_ms in range(0, PREVIEW_MS, STEP_MS):
        canvas = Image.new("RGB", (cell_w * 3, cell_h * 2), "#202328")
        draw = ImageDraw.Draw(canvas)
        for index, (label, timeline) in enumerate(timelines):
            x = (index % 3) * cell_w + PAD
            y = (index // 3) * cell_h + PAD
            canvas.paste(frame_at(timeline, time_ms), (x, y))
            draw.text((x, y + THUMB + 5), label, fill="#f2f5f7")
        output_frames.append(canvas)

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    output_frames[0].save(
        OUTPUT,
        save_all=True,
        append_images=output_frames[1:],
        duration=STEP_MS,
        loop=0,
        disposal=2,
        optimize=False,
    )
    print(OUTPUT)


if __name__ == "__main__":
    main()
