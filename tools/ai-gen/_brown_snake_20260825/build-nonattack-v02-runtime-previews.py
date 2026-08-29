#!/usr/bin/env python3
"""Build runtime-clock GIFs and contact sheets for accepted non-attack actions."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
ACTIONS = {
    "idle": {
        "stem": "idle-v02",
        "sheet": "idle-v02.png",
        "report": "idle-v02.json",
        "cols": 6,
        "frameMs": 125,
    },
    "walking": {
        "stem": "walking-v06",
        "sheet": "walking-v06.png",
        "report": "walking-v06.json",
        "cols": 5,
        "frameMs": 1000 / 72,
    },
    "dying": {
        "stem": "dying-v02",
        "sheet": "dying-v02.png",
        "report": "dying-v02.json",
        "cols": 6,
        "totalMs": 1800,
    },
}


def distributed_durations(frame_count: int, *, frame_ms: float | None = None,
                          total_ms: int | None = None) -> list[int]:
    if total_ms is None:
        if frame_ms is None:
            raise ValueError("frame_ms or total_ms is required")
        total_ms = round(frame_count * frame_ms)
    total_ticks = round(total_ms / 10)
    low = total_ticks // frame_count
    extra = total_ticks % frame_count
    durations = []
    accumulator = 0
    for _ in range(frame_count):
        accumulator += extra
        ticks = low
        if accumulator >= frame_count:
            ticks += 1
            accumulator -= frame_count
        durations.append(ticks * 10)
    return durations


def checker(frame: Image.Image) -> Image.Image:
    width, height = frame.size
    base = Image.new("RGB", frame.size, (58, 62, 68))
    draw = ImageDraw.Draw(base)
    tile = 24
    for y in range(0, height, tile):
        for x in range(0, width, tile):
            if ((x // tile) + (y // tile)) & 1:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(92, 97, 104))
    base.paste(frame, mask=frame.getchannel("A"))
    preview_width = min(512, width)
    preview_height = round(height * preview_width / width)
    return base.resize((preview_width, preview_height), Image.Resampling.LANCZOS)


def main() -> None:
    output_dir = ROOT / "previews" / "final"
    output_dir.mkdir(parents=True, exist_ok=True)
    summary = {}
    for action, spec in ACTIONS.items():
        report = json.loads((ROOT / "reports" / "rife" / spec["report"]).read_text(encoding="utf-8"))
        frame_width = int(report["frameWidth"])
        frame_height = int(report["frameHeight"])
        frame_count = int(report["outputFrameCount"])
        sheet = Image.open(ROOT / "generated" / "final" / spec["sheet"]).convert("RGBA")
        expected = (spec["cols"] * frame_width, math.ceil(frame_count / spec["cols"]) * frame_height)
        if sheet.size != expected:
            raise ValueError(f"{action}: unexpected sheet size {sheet.size}, expected {expected}")
        frames = []
        for index in range(frame_count):
            row, col = divmod(index, spec["cols"])
            cell = sheet.crop((
                col * frame_width,
                row * frame_height,
                (col + 1) * frame_width,
                (row + 1) * frame_height,
            ))
            frames.append(checker(cell))
        durations = distributed_durations(
            frame_count,
            frame_ms=spec.get("frameMs"),
            total_ms=spec.get("totalMs"),
        )
        gif = output_dir / f"{spec['stem']}-runtime.gif"
        frames[0].save(
            gif,
            save_all=True,
            append_images=frames[1:],
            duration=durations,
            loop=0,
            disposal=2,
            optimize=False,
        )
        contact_cols = min(8, frame_count)
        contact_rows = math.ceil(frame_count / contact_cols)
        thumb_w, thumb_h = frames[0].size
        contact = Image.new("RGB", (contact_cols * thumb_w, contact_rows * thumb_h), (30, 30, 30))
        draw = ImageDraw.Draw(contact)
        for index, frame in enumerate(frames):
            row, col = divmod(index, contact_cols)
            x, y = col * thumb_w, row * thumb_h
            contact.paste(frame, (x, y))
            draw.text((x + 8, y + 8), f"runtime {index:02d}", fill="white")
        contact_path = output_dir / f"{spec['stem']}-runtime-contact.png"
        contact.save(contact_path, optimize=True)
        summary[action] = {
            "gif": str(gif.relative_to(ROOT)).replace("\\", "/"),
            "contact": str(contact_path.relative_to(ROOT)).replace("\\", "/"),
            "frameCount": frame_count,
            "totalMs": sum(durations),
            "durationsMs": durations,
        }
    output = output_dir / "nonattack-v02-runtime-preview.json"
    output.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2), flush=True)


if __name__ == "__main__":
    main()
