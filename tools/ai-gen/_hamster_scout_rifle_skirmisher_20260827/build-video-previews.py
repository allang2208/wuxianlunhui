#!/usr/bin/env python3
"""Build direct GIF/contact evidence for the scout-rifle skirmisher source videos."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_NAME = {
    "idle": "idle-user-1.mp4",
    "moving": "moving-attacking-h3-v02.mp4",
    "moving_attacking": "moving-attacking-h3-v02.mp4",
    "standing_attacking": "standing-attacking-h3-v03.mp4",
    "dying": "dying-h3-v01.mp4",
}


def decode(path: Path) -> tuple[list[Image.Image], float]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    fps = float(stream.average_rate or 24)
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    container.close()
    if not frames:
        raise RuntimeError(f"no frames decoded from {path}")
    return frames, fps


def build(motion: str) -> dict[str, object]:
    source = ROOT / "videos" / VIDEO_NAME[motion]
    frames, fps = decode(source)
    preview_dir = ROOT / "previews" / "videos"
    preview_dir.mkdir(parents=True, exist_ok=True)

    gif_frames = [frame.resize((512, 288), Image.Resampling.LANCZOS) for frame in frames[::2]]
    gif_path = preview_dir / f"{motion}-source-preview.gif"
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=max(20, round(2000 / fps)),
        loop=0,
        disposal=2,
    )

    indices = np.linspace(0, len(frames) - 1, 24, dtype=int)
    cell_w, cell_h = 256, 144
    contact = Image.new("RGB", (cell_w * 6, cell_h * 4), (245, 245, 245))
    draw = ImageDraw.Draw(contact)
    for slot, index in enumerate(indices):
        frame = frames[int(index)].resize((cell_w, cell_h), Image.Resampling.LANCZOS)
        x = (slot % 6) * cell_w
        y = (slot // 6) * cell_h
        contact.paste(frame, (x, y))
        draw.rectangle((x + 3, y + 3, x + 58, y + 20), fill=(0, 0, 0))
        draw.text((x + 6, y + 5), f"f{int(index):03d}", fill=(255, 255, 255))
    contact_path = preview_dir / f"{motion}-source-contact-24.png"
    contact.save(contact_path)

    dense_contact_path = None
    dense_range = {
        "standing_attacking": (24, 80),
        "dying": (24, 72),
    }.get(motion)
    if dense_range:
        dense_indices = list(range(dense_range[0], dense_range[1] + 1, 2))
        dense_cell_w, dense_cell_h = 320, 180
        dense_cols = 5
        dense_rows = int(np.ceil(len(dense_indices) / dense_cols))
        dense = Image.new(
            "RGB",
            (dense_cell_w * dense_cols, dense_cell_h * dense_rows),
            (245, 245, 245),
        )
        dense_draw = ImageDraw.Draw(dense)
        for slot, index in enumerate(dense_indices):
            frame = frames[index].resize((dense_cell_w, dense_cell_h), Image.Resampling.LANCZOS)
            x = (slot % dense_cols) * dense_cell_w
            y = (slot // dense_cols) * dense_cell_h
            dense.paste(frame, (x, y))
            dense_draw.rectangle((x + 3, y + 3, x + 61, y + 22), fill=(0, 0, 0))
            dense_draw.text((x + 7, y + 6), f"f{index:03d}", fill=(255, 255, 255))
        dense_contact_path = preview_dir / (
            f"{motion}-source-contact-f{dense_range[0]:03d}-f{dense_range[1]:03d}-step2.png"
        )
        dense.save(dense_contact_path)

    return {
        "source": f"videos/{VIDEO_NAME[motion]}",
        "frameCount": len(frames),
        "fps": fps,
        "size": list(frames[0].size),
        "gif": str(gif_path.relative_to(ROOT)).replace("\\", "/"),
        "contact": str(contact_path.relative_to(ROOT)).replace("\\", "/"),
        "denseContact": (
            str(dense_contact_path.relative_to(ROOT)).replace("\\", "/")
            if dense_contact_path else None
        ),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=tuple(VIDEO_NAME))
    args = parser.parse_args()
    motions = [args.only] if args.only else list(VIDEO_NAME)
    report_path = ROOT / "previews" / "videos" / "preview-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    for motion in motions:
        report[motion] = build(motion)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
