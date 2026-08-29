#!/usr/bin/env python3
"""Build exact-900-ms GIF/contact previews for the accepted snake attack."""

from __future__ import annotations

import json
import math
from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SHEET = ROOT / "generated" / "final" / "attacking-v02.png"
RIFE_REPORT = ROOT / "reports" / "rife" / "attacking-v02.json"
TOTAL_MS = 900
COLS = 8


def distributed_gif_durations(frame_count: int, total_ms: int) -> list[int]:
    total_ticks = total_ms // 10
    low = total_ticks // frame_count
    extra = total_ticks % frame_count
    durations: list[int] = []
    accumulator = 0
    for _ in range(frame_count):
        accumulator += extra
        ticks = low
        if accumulator >= frame_count:
            ticks += 1
            accumulator -= frame_count
        durations.append(ticks * 10)
    if sum(durations) != total_ms:
        raise ValueError("GIF timing must preserve the exact runtime duration")
    return durations


def checker(frame: Image.Image, width: int, height: int) -> Image.Image:
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
    report = json.loads(RIFE_REPORT.read_text(encoding="utf-8"))
    frame_width = int(report["frameWidth"])
    frame_height = int(report["frameHeight"])
    frame_count = int(report["outputFrameCount"])
    sheet = Image.open(SHEET).convert("RGBA")
    expected = (COLS * frame_width, math.ceil(frame_count / COLS) * frame_height)
    if sheet.size != expected:
        raise ValueError(f"unexpected sheet size {sheet.size}, expected {expected}")

    frames = []
    for index in range(frame_count):
        row, col = divmod(index, COLS)
        crop = sheet.crop((
            col * frame_width,
            row * frame_height,
            (col + 1) * frame_width,
            (row + 1) * frame_height,
        ))
        frames.append(checker(crop, frame_width, frame_height))

    out_dir = ROOT / "previews" / "final"
    out_dir.mkdir(parents=True, exist_ok=True)
    durations = distributed_gif_durations(frame_count, TOTAL_MS)
    gif = out_dir / "attacking-v02-runtime.gif"
    frames[0].save(
        gif,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=False,
    )

    thumb_w, thumb_h = frames[0].size
    contact_cols = 8
    contact_rows = math.ceil(frame_count / contact_cols)
    contact = Image.new("RGB", (contact_cols * thumb_w, contact_rows * thumb_h), (30, 30, 30))
    draw = ImageDraw.Draw(contact)
    for index, frame in enumerate(frames):
        row, col = divmod(index, contact_cols)
        x, y = col * thumb_w, row * thumb_h
        contact.paste(frame, (x, y))
        draw.text((x + 8, y + 8), f"runtime {index:02d}", fill="white")
    contact_path = out_dir / "attacking-v02-runtime-contact.png"
    contact.save(contact_path, optimize=True)
    print(json.dumps({
        "gif": str(gif.relative_to(ROOT)).replace("\\", "/"),
        "contact": str(contact_path.relative_to(ROOT)).replace("\\", "/"),
        "frameCount": frame_count,
        "totalMs": sum(durations),
        "durationsMs": durations,
    }, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
