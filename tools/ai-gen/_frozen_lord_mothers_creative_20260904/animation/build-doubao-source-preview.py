#!/usr/bin/env python3
"""Build full-timeline GIF and 32-point direction contact for one Doubao source clip."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import av
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent


def distributed_durations(frame_count: int, total_ms: int) -> list[int]:
    preview_ms = round(total_ms / 10) * 10
    ticks = [round(index * preview_ms / frame_count / 10) for index in range(frame_count + 1)]
    values = [(ticks[index + 1] - ticks[index]) * 10 for index in range(frame_count)]
    if min(values) <= 0 or sum(values) != preview_ms:
        raise RuntimeError(f"invalid GIF timing: {values}")
    return values


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument(
        "--direction-gate",
        default="fixed approved camera, facing, root and identity topology",
        help="asset-specific direction/topology contract written to the preview report",
    )
    parser.add_argument(
        "--stage",
        default="raw-doubao-source-awaiting-offline-direction-topology-review",
    )
    args = parser.parse_args()
    video = args.video.resolve()

    with av.open(str(video)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
        container_duration_ms = round(container.duration / 1000) if container.duration else None
    if not frames:
        raise RuntimeError(f"no frames decoded from {video}")

    width, height = frames[0].size
    duration_ms = container_duration_ms or round(len(frames) * 1000 / fps)
    contact_indices = sorted({
        round(index * (len(frames) - 1) / 31) for index in range(32)
    })
    thumb_w, thumb_h, label_h, cols = 256, 144, 22, 6
    rows = math.ceil(len(contact_indices) / cols)
    contact = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for slot, source_index in enumerate(contact_indices):
        preview = frames[source_index].resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = slot % cols * thumb_w
        y = slot // cols * (thumb_h + label_h)
        contact.paste(preview, (x, y))
        draw.text((x + 5, y + thumb_h + 3), f"f{source_index}  {source_index / fps:.3f}s", fill="white")
    contact_path = video.with_name(f"{video.stem}_contact.png")
    contact.save(contact_path)

    gif_indices = list(range(0, len(frames), max(1, round(fps / 12))))
    if gif_indices[-1] != len(frames) - 1:
        gif_indices.append(len(frames) - 1)
    gif_frames = [
        frames[index].resize((640, 360), Image.Resampling.LANCZOS).quantize(colors=256)
        for index in gif_indices
    ]
    durations = distributed_durations(len(gif_frames), duration_ms)
    gif_path = video.with_name(f"{video.stem}_preview.gif")
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=False,
    )

    report = {
        "video": video.relative_to(ROOT).as_posix(),
        "sourceSize": [width, height],
        "sourceFrames": len(frames),
        "sourceFps": fps,
        "containerDurationMs": duration_ms,
        "contact": contact_path.relative_to(ROOT).as_posix(),
        "contactFrameIndices": contact_indices,
        "previewGif": gif_path.relative_to(ROOT).as_posix(),
        "previewFrameIndices": gif_indices,
        "previewDurationMs": sum(durations),
        "directionGate": args.direction_gate,
        "stage": args.stage,
    }
    report_path = video.with_name(f"{video.stem}_preview.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
