#!/usr/bin/env python3
"""Compose one synchronized formal-action review GIF per qualified lord."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageSequence


TASK_ROOT = Path(__file__).resolve().parents[1]
FORMAL = TASK_ROOT / "animation" / "formal"
FAMILIES = ("snow-sepulcher-carrier", "aurora-fate-weaver", "white-silence-bell-hart")
STEP_MS = 50
PREVIEW_MS = 6000
THUMB = 192
LABEL_H = 24
PAD = 8


def resolve(raw: str) -> Path:
    return TASK_ROOT / raw


def load_timeline(path: Path) -> tuple[list[Image.Image], list[int], int]:
    with Image.open(path) as gif:
        frames: list[Image.Image] = []
        durations: list[int] = []
        for frame in ImageSequence.Iterator(gif):
            frames.append(frame.convert("RGB").resize((THUMB, THUMB), Image.Resampling.LANCZOS))
            durations.append(int(frame.info.get("duration", gif.info.get("duration", STEP_MS))))
    return frames, durations, sum(durations)


def frame_at(timeline: tuple[list[Image.Image], list[int], int], time_ms: int) -> Image.Image:
    frames, durations, total = timeline
    cursor = time_ms % total
    elapsed = 0
    for frame, duration in zip(frames, durations):
        elapsed += duration
        if cursor < elapsed:
            return frame
    return frames[-1]


def action_manifests(family: Path) -> dict[str, dict]:
    output: dict[str, dict] = {}
    for path in family.rglob("spritesheet-manifest.json"):
        data = json.loads(path.read_text(encoding="utf-8"))
        output[data["action"]] = data
    return output


def compose_family(slug: str) -> Path:
    family = FORMAL / slug
    budget = json.loads((family / "family-sprite-budget-manifest.json").read_text(encoding="utf-8"))
    manifests = action_manifests(family)
    timelines = [
        (entry["action"], load_timeline(resolve(manifests[entry["action"]]["previewGif"])))
        for entry in budget["sheets"]
    ]
    cols = 2 if len(timelines) <= 4 else 3
    rows = math.ceil(len(timelines) / cols)
    cell_w = THUMB + PAD * 2
    cell_h = THUMB + LABEL_H + PAD * 2
    output_frames: list[Image.Image] = []
    for time_ms in range(0, PREVIEW_MS, STEP_MS):
        canvas = Image.new("RGB", (cell_w * cols, cell_h * rows), "#202328")
        draw = ImageDraw.Draw(canvas)
        for index, (label, timeline) in enumerate(timelines):
            x = (index % cols) * cell_w + PAD
            y = (index // cols) * cell_h + PAD
            canvas.paste(frame_at(timeline, time_ms), (x, y))
            draw.text((x, y + THUMB + 5), label, fill="#f2f5f7")
        output_frames.append(canvas)
    output = family / "previews" / f"{slug}-all-formal-actions.gif"
    output.parent.mkdir(parents=True, exist_ok=True)
    output_frames[0].save(
        output,
        save_all=True,
        append_images=output_frames[1:],
        duration=STEP_MS,
        loop=0,
        disposal=2,
        optimize=False,
    )
    return output


def main() -> None:
    for family in FAMILIES:
        print(compose_family(family))


if __name__ == "__main__":
    main()
