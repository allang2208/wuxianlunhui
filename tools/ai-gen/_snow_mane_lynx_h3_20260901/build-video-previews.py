#!/usr/bin/env python3
"""Build local source-video contact sheets and exact-duration GIF previews."""

from __future__ import annotations

import argparse
import math
from pathlib import Path

import av
from PIL import Image, ImageDraw


def distributed_durations(frame_count: int, total_ms: int) -> list[int]:
    ticks = [round(index * total_ms / frame_count / 10) for index in range(frame_count + 1)]
    values = [(ticks[index + 1] - ticks[index]) * 10 for index in range(frame_count)]
    if min(values) <= 0 or sum(values) != total_ms:
        raise RuntimeError(f"invalid GIF timing: count={frame_count} total={sum(values)}")
    return values


def decode(path: Path) -> tuple[list[Image.Image], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [Image.fromarray(frame.to_ndarray(format="rgb24"), "RGB")
                  for frame in container.decode(stream)]
    if not frames:
        raise RuntimeError(f"no frames decoded from {path}")
    return frames, fps


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", type=Path, required=True)
    parser.add_argument("--total-ms", type=int, default=5170)
    parser.add_argument("--samples", type=int, default=24)
    parser.add_argument("--start", type=int)
    parser.add_argument("--end", type=int)
    parser.add_argument("--step", type=int, default=1)
    parser.add_argument("--cols", type=int, default=6)
    parser.add_argument("--suffix", default="")
    args = parser.parse_args()

    frames, fps = decode(args.video)
    if args.start is not None or args.end is not None:
        start = max(0, args.start or 0)
        end = min(len(frames) - 1, args.end if args.end is not None else len(frames) - 1)
        indices = list(range(start, end + 1, max(1, args.step)))
    else:
        indices = [round(index * (len(frames) - 1) / max(1, args.samples - 1))
                   for index in range(args.samples)]
    thumb_w, thumb_h, label_h, cols = 256, 144, 22, max(1, args.cols)
    rows = math.ceil(len(indices) / cols)
    contact = Image.new("RGB", (cols * thumb_w, rows * (thumb_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for slot, source_index in enumerate(indices):
        preview = frames[source_index].resize((thumb_w, thumb_h), Image.Resampling.LANCZOS)
        x = (slot % cols) * thumb_w
        y = (slot // cols) * (thumb_h + label_h)
        contact.paste(preview, (x, y))
        draw.text((x + 5, y + thumb_h + 3), f"f{source_index}", fill="white")
    suffix = f"_{args.suffix}" if args.suffix else ""
    contact_path = args.video.with_name(f"{args.video.stem}_contact{suffix}.png")
    contact.save(contact_path)

    gif_frames = [frame.resize((512, 288), Image.Resampling.LANCZOS).quantize(colors=256)
                  for frame in frames]
    durations = distributed_durations(len(gif_frames), args.total_ms)
    gif_path = args.video.with_name(f"{args.video.stem}_preview.gif")
    gif_frames[0].save(gif_path, save_all=True, append_images=gif_frames[1:],
                       duration=durations, loop=0, disposal=2, optimize=False)
    print(f"[lynx-video-preview] frames={len(frames)} fps={fps:.4f} "
          f"contact={contact_path} gif={gif_path} duration={sum(durations)}ms")


if __name__ == "__main__":
    main()
