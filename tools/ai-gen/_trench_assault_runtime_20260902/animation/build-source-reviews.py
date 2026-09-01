#!/usr/bin/env python3
"""Build deterministic contact sheets and GIFs for trench-assault source videos."""

from __future__ import annotations

import argparse
import json
import math
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw, ImageOps


TASK = Path(__file__).resolve().parent
VIDEOS = TASK / "videos"
PREVIEWS = TASK / "previews"


def decode(path: Path) -> tuple[list[Image.Image], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 24.0)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    if not frames:
        raise RuntimeError(f"no frames decoded: {path}")
    return frames, fps


def make_sheet(frames: list[Image.Image], fps: float, indices: list[int], output: Path) -> None:
    thumb = (320, 180)
    label_h = 24
    cols = 4
    rows = math.ceil(len(indices) / cols)
    sheet = Image.new("RGB", (cols * thumb[0], rows * (thumb[1] + label_h)), "#171717")
    draw = ImageDraw.Draw(sheet)
    for cell, index in enumerate(indices):
        image = ImageOps.contain(frames[index], thumb, Image.Resampling.LANCZOS)
        x = cell % cols * thumb[0]
        y = cell // cols * (thumb[1] + label_h)
        sheet.paste(image, (x + (thumb[0] - image.width) // 2, y + (thumb[1] - image.height) // 2))
        draw.text((x + 6, y + thumb[1] + 4), f"f{index} / {index / fps:.3f}s", fill="white")
    output.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(output)


def save_gif(frames: list[Image.Image], fps: float, output: Path) -> None:
    step = 2 if fps >= 20 else 1
    sampled = [frame.resize((480, 270), Image.Resampling.LANCZOS) for frame in frames[::step]]
    duration = max(20, round(1000 * step / fps))
    sampled[0].save(
        output,
        save_all=True,
        append_images=sampled[1:],
        duration=duration,
        loop=0,
        optimize=False,
        disposal=2,
    )


def subject_bbox(frame: Image.Image) -> list[int] | None:
    rgb = np.asarray(frame, dtype=np.int16)
    distance = np.max(np.abs(rgb - 255), axis=2)
    ys, xs = np.where(distance > 30)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def warm_flash_score(frame: Image.Image) -> int:
    rgb = np.asarray(frame, dtype=np.int16)
    region = rgb[:, int(rgb.shape[1] * 0.5) :, :]
    r, g, b = region[..., 0], region[..., 1], region[..., 2]
    warm = (r > 185) & (g > 65) & (g < 215) & (b < 135) & (r > g + 28) & (g > b + 12)
    return int(warm.sum())


def review(path: Path) -> dict[str, object]:
    frames, fps = decode(path)
    count = len(frames)
    stem = path.stem
    contact_indices = sorted(set(round(i * (count - 1) / 31) for i in range(32)))
    make_sheet(frames, fps, contact_indices, PREVIEWS / f"{stem}-contact-32.png")
    save_gif(frames, fps, PREVIEWS / f"{stem}-source.gif")
    bboxes = [bbox for frame in frames if (bbox := subject_bbox(frame)) is not None]
    scores = [warm_flash_score(frame) for frame in frames]
    peak = max(range(count), key=scores.__getitem__)
    width, height = frames[0].size
    return {
        "video": f"videos/{path.name}",
        "frameCount": count,
        "fps": fps,
        "size": [width, height],
        "durationSeconds": count / fps,
        "warmFlashPeakFrame": peak,
        "warmFlashPeakScore": scores[peak],
        "warmFlashFramesAboveHalfPeak": [
            index for index, score in enumerate(scores) if score >= scores[peak] * 0.5 and score > 0
        ],
        "subjectBBoxUnion": [
            min(bbox[0] for bbox in bboxes),
            min(bbox[1] for bbox in bboxes),
            max(bbox[2] for bbox in bboxes),
            max(bbox[3] for bbox in bboxes),
        ],
        "edgeMarginPixels": {
            "left": min(bbox[0] for bbox in bboxes),
            "top": min(bbox[1] for bbox in bboxes),
            "right": min(width - 1 - bbox[2] for bbox in bboxes),
            "bottom": min(height - 1 - bbox[3] for bbox in bboxes),
        },
        "artifacts": {
            "contact32": f"previews/{stem}-contact-32.png",
            "gif": f"previews/{stem}-source.gif",
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--video", action="append")
    args = parser.parse_args()
    paths = (
        [VIDEOS / name for name in args.video]
        if args.video
        else sorted(VIDEOS.glob("*.mp4"))
    )
    if not paths:
        raise RuntimeError("no source videos found")
    missing = [str(path) for path in paths if not path.exists()]
    if missing:
        raise FileNotFoundError(f"missing source videos: {missing}")
    report = {
        "schemaVersion": 1,
        "date": "2026-09-01",
        "unitKey": "trench_assault",
        "takes": [review(path) for path in paths],
    }
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    output = PREVIEWS / "source-review-report.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
