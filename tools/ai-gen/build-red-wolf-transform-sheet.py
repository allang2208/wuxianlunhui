#!/usr/bin/env python3
"""Build the RedWolfKing wolf-to-werewolf transform spritesheet from H3 video.

The H3 clip spends its latter half holding the final pose. This builder finds the
first frame already matching the true endpoint, samples the active transform, and
then forces the real final video frame into the last sprite cell. Every sampled
subject uses one fixed scale, a shared horizontal center, and a shared foot line.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
import sys

import av
import numpy as np
from PIL import Image
from scipy import ndimage


TOOLS_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(TOOLS_DIR))
from transparent_cutout import build_alpha, decontaminate, detect_bg_color  # noqa: E402


def decode_video(path: Path) -> list[np.ndarray]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    stream.thread_type = "AUTO"
    return [frame.to_ndarray(format="rgb24") for frame in container.decode(stream)]


def find_endpoint_start(frames: list[np.ndarray], threshold: float = 1.0) -> int:
    endpoint = frames[-1].astype(np.int16)
    for index, frame in enumerate(frames):
        mae = float(np.abs(frame.astype(np.int16) - endpoint).mean())
        if mae <= threshold:
            return index
    return len(frames) - 1


def sample_indexes(frame_count: int, endpoint_start: int, wanted: int) -> list[int]:
    if wanted < 2:
        raise ValueError("frame count must be at least 2")
    active = np.linspace(0, endpoint_start, wanted, endpoint=True)
    indexes = [int(round(value)) for value in active]
    indexes[-1] = frame_count - 1
    if len(set(indexes)) != len(indexes):
        raise ValueError(f"sampling produced duplicate indexes: {indexes}")
    return indexes


def cutout(rgb: np.ndarray, tolerance: int) -> Image.Image:
    bg = detect_bg_color(rgb)
    alpha = build_alpha(rgb, bg, tol=tolerance, soft=45, feather=0.8, keep_largest=True)
    foreground = decontaminate(rgb, alpha, bg)
    alpha_u8 = np.clip(alpha * 255.0, 0, 255).astype(np.uint8)
    foreground[alpha_u8 == 0] = 0
    return Image.fromarray(np.dstack([foreground, alpha_u8]), "RGBA")


def remove_cyan_spill(image: Image.Image) -> Image.Image:
    """Replace H3 cyan-screen spill with the nearest real red/black body color.

    The character palette contains no cyan, so this is safe for this asset and
    removes both soft antialias spill and high-alpha H.264 chroma-block residue.
    """
    arr = np.asarray(image).copy()
    rgb = arr[:, :, :3].astype(np.int16)
    alpha = arr[:, :, 3]
    cyan = ((alpha > 4)
            & (rgb[:, :, 1] > rgb[:, :, 0] + 20)
            & (rgb[:, :, 2] > rgb[:, :, 0] + 20))
    valid = (alpha > 8) & ~cyan
    if cyan.any() and valid.any():
        _, nearest = ndimage.distance_transform_edt(~valid, return_indices=True)
        arr[cyan, :3] = arr[nearest[0][cyan], nearest[1][cyan], :3]
        faint = cyan & (alpha < 24)
        arr[faint] = 0
    arr[arr[:, :, 3] == 0, :3] = 0
    return Image.fromarray(arr, "RGBA")


def place_frame(subject: Image.Image, cell: int, scale: float, foot_y: int) -> tuple[Image.Image, dict]:
    alpha = np.asarray(subject.getchannel("A"))
    ys, xs = np.where(alpha > 12)
    if not len(xs):
        raise ValueError("sampled frame contains no foreground")
    box = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    cropped = subject.crop(box)
    width = max(1, round(cropped.width * scale))
    height = max(1, round(cropped.height * scale))
    if width > cell - 32 or height > foot_y - 16:
        raise ValueError(f"foreground does not fit cell at fixed scale: {width}x{height}")
    resized = cropped.resize((width, height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", (cell, cell), (0, 0, 0, 0))
    x = round((cell - width) / 2)
    y = foot_y - height
    canvas.alpha_composite(resized, (x, y))
    arr = np.asarray(canvas).copy()
    arr[arr[:, :, 3] == 0, :3] = 0
    canvas = remove_cyan_spill(Image.fromarray(arr, "RGBA"))
    return canvas, {"sourceBox": list(box), "placedBox": [x, y, x + width, y + height]}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--video", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--report", type=Path)
    parser.add_argument("--frames", type=int, default=20)
    parser.add_argument("--cols", type=int, default=5)
    parser.add_argument("--cell", type=int, default=640)
    parser.add_argument("--scale", type=float, default=0.75)
    parser.add_argument("--foot-y", type=int, default=590)
    parser.add_argument("--tolerance", type=int, default=55)
    parser.add_argument("--endpoint-mae", type=float, default=1.0)
    args = parser.parse_args()

    frames = decode_video(args.video)
    if not frames:
        raise RuntimeError("video contains no decoded frames")
    endpoint_start = find_endpoint_start(frames, args.endpoint_mae)
    indexes = sample_indexes(len(frames), endpoint_start, args.frames)
    rows = (args.frames + args.cols - 1) // args.cols
    sheet = Image.new("RGBA", (args.cols * args.cell, rows * args.cell), (0, 0, 0, 0))
    placements = []
    for cell_index, source_index in enumerate(indexes):
        transparent = cutout(frames[source_index], args.tolerance)
        placed, stats = place_frame(transparent, args.cell, args.scale, args.foot_y)
        column = cell_index % args.cols
        row = cell_index // args.cols
        sheet.alpha_composite(placed, (column * args.cell, row * args.cell))
        placements.append({"cell": cell_index, "sourceFrame": source_index, **stats})

    args.out.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(args.out)
    report_path = args.report or args.out.with_suffix(".json")
    report = {
        "source": str(args.video),
        "output": str(args.out),
        "sourceFrameCount": len(frames),
        "endpointStart": endpoint_start,
        "sampleIndexes": indexes,
        "layout": {"cols": args.cols, "rows": rows, "frames": args.frames,
                   "cell": args.cell, "footY": args.foot_y, "fixedScale": args.scale},
        "placements": placements,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
