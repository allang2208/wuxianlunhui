#!/usr/bin/env python3
"""Build the user-facing charge preview on the exact 2400 ms gameplay clock."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
FRAME_COUNT = 31
CELL_W = 768
CELL_H = 640
COLS = 5
TOTAL_MS = 2400


def checker(frame: Image.Image) -> Image.Image:
    base = Image.new("RGB", frame.size, (58, 62, 68))
    draw = ImageDraw.Draw(base)
    tile = 24
    for y in range(0, CELL_H, tile):
        for x in range(0, CELL_W, tile):
            if ((x // tile) + (y // tile)) & 1:
                draw.rectangle((x, y, x + tile - 1, y + tile - 1), fill=(92, 97, 104))
    base.paste(frame, mask=frame.getchannel("A"))
    return base.resize((CELL_W // 2, CELL_H // 2), Image.Resampling.LANCZOS)


def distributed_gif_durations(frame_count: int, total_ms: int) -> list[int]:
    """Distribute GIF's 10 ms quanta while preserving the exact total duration."""
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
    assert sum(durations) == total_ms
    return durations


def main() -> None:
    sheet_path = ROOT / "spritesheets" / "runtime" / "charge.png"
    sheet = Image.open(sheet_path).convert("RGBA")
    frames = []
    for index in range(FRAME_COUNT):
        row, col = divmod(index, COLS)
        crop = sheet.crop((col * CELL_W, row * CELL_H, (col + 1) * CELL_W, (row + 1) * CELL_H))
        frames.append(checker(crop))

    out_dir = ROOT / "previews"
    out_dir.mkdir(parents=True, exist_ok=True)
    durations = distributed_gif_durations(FRAME_COUNT, TOTAL_MS)
    frames[0].save(
        out_dir / "charge-runtime-v4.gif",
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
    )

    thumb_w, thumb_h = frames[0].size
    rows = (FRAME_COUNT + COLS - 1) // COLS
    contact = Image.new("RGB", (COLS * thumb_w, rows * thumb_h), (30, 30, 30))
    draw = ImageDraw.Draw(contact)
    for index, frame in enumerate(frames):
        row, col = divmod(index, COLS)
        x, y = col * thumb_w, row * thumb_h
        contact.paste(frame, (x, y))
        draw.text((x + 8, y + 8), f"runtime {index:02d}", fill="white")
    contact.save(out_dir / "charge-runtime-v4-contact.png", optimize=True)

    print({"frames": FRAME_COUNT, "totalMs": sum(durations), "durationsMs": durations})


if __name__ == "__main__":
    main()
