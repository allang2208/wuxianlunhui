#!/usr/bin/env python3
"""Build source-video review GIFs and 24-frame contact sheets, without altering motion."""
from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import av
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent


def build(video: Path) -> dict:
    with av.open(str(video)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    if not frames:
        raise RuntimeError(f"No video frames: {video}")

    output = video.parent.parent / "previews"
    output.mkdir(parents=True, exist_ok=True)
    width, height = frames[0].size
    preview_width = 640
    preview_height = round(height * preview_width / width)
    # Sample at approximately 12 fps, preserving the complete source timeline.
    step = max(1, round(fps / 12))
    indices = list(range(0, len(frames), step))
    gif_frames = [frames[i].resize((preview_width, preview_height), Image.Resampling.LANCZOS) for i in indices]
    boundaries = [round(i / fps * 100) for i in indices] + [round(len(frames) / fps * 100)]
    durations = [max(1, boundaries[i + 1] - boundaries[i]) * 10 for i in range(len(indices))]
    gif_path = output / f"{video.stem}-source.gif"
    gif_frames[0].save(gif_path, save_all=True, append_images=gif_frames[1:],
                       duration=durations, loop=0, disposal=2, optimize=False)

    sample_count = min(24, len(frames))
    contact_indices = sorted({round(i * (len(frames) - 1) / max(1, sample_count - 1)) for i in range(sample_count)})
    tile_w = 320
    tile_h = round(height * tile_w / width)
    label_h = 22
    columns = 4
    rows = math.ceil(len(contact_indices) / columns)
    sheet = Image.new("RGB", (columns * tile_w, rows * (tile_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(sheet)
    for position, index in enumerate(contact_indices):
        x = position % columns * tile_w
        y = position // columns * (tile_h + label_h)
        sheet.paste(frames[index].resize((tile_w, tile_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 5, y + tile_h + 3), f"f{index}  {index / fps:.3f}s", fill="white")
    contact_path = output / f"{video.stem}-contact.png"
    sheet.save(contact_path)
    report = {
        "video": video.relative_to(ROOT).as_posix(),
        "sourceSize": [width, height],
        "sourceFrames": len(frames),
        "sourceFps": fps,
        "sourceDurationSeconds": len(frames) / fps,
        "gif": gif_path.relative_to(ROOT).as_posix(),
        "gifFrameIndices": indices,
        "gifDurationMs": sum(durations),
        "contact": contact_path.relative_to(ROOT).as_posix(),
        "contactFrameIndices": contact_indices,
        "previewNote": "Full source candidate, approximately 12fps preview. GIF replay is for review; attack and death remain one-shot actions. No cutout, motion normalization, or runtime integration.",
    }
    (output / f"{video.stem}-preview.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))
    return report


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, action="append")
    args = parser.parse_args()
    videos = args.video or sorted((ROOT / "videos").glob("*.mp4"))
    for video in videos:
        build(video.resolve())
