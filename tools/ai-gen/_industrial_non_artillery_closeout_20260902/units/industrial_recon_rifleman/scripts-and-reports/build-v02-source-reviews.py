#!/usr/bin/env python3
"""Build deterministic source-video review artifacts for recon rifleman v02 takes."""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parent
PREVIEWS = ROOT / "previews"


def decode(path: Path) -> tuple[list[Image.Image], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 24.0)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    if not frames:
        raise RuntimeError(f"no frames decoded: {path}")
    return frames, fps


def make_sheet(
    frames: list[Image.Image],
    fps: float,
    indices: list[int],
    output: Path,
    *,
    thumb: tuple[int, int] = (320, 180),
    cols: int = 4,
) -> None:
    label_h = 24
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


def make_crop_sheet(
    frames: list[Image.Image],
    fps: float,
    indices: list[int],
    output: Path,
    crop: tuple[int, int, int, int],
    *,
    thumb: tuple[int, int] = (480, 330),
    cols: int = 4,
) -> None:
    cropped = [frame.crop(crop) for frame in frames]
    make_sheet(cropped, fps, indices, output, thumb=thumb, cols=cols)


def subject_bbox(frame: Image.Image) -> list[int] | None:
    rgb = np.asarray(frame, dtype=np.int16)
    distance = np.max(np.abs(rgb - 255), axis=2)
    ys, xs = np.where(distance > 30)
    if not len(xs):
        return None
    return [int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())]


def warm_flash_score(frame: Image.Image) -> int:
    rgb = np.asarray(frame, dtype=np.int16)
    h, w = rgb.shape[:2]
    region = rgb[:, int(w * 0.48) :, :]
    r, g, b = region[..., 0], region[..., 1], region[..., 2]
    warm = (r > 185) & (g > 65) & (g < 215) & (b < 135) & (r > g + 28) & (g > b + 12)
    return int(warm.sum())


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


def review(path: Path, stem: str) -> dict[str, object]:
    frames, fps = decode(path)
    count = len(frames)
    contact_indices = sorted(set(round(i * (count - 1) / 31) for i in range(32)))
    make_sheet(frames, fps, contact_indices, PREVIEWS / f"{stem}-contact-32.png")
    save_gif(frames, fps, PREVIEWS / f"{stem}-source.gif")

    all_indices = list(range(count))
    make_sheet(
        frames,
        fps,
        all_indices,
        PREVIEWS / f"{stem}-all-frames.png",
        thumb=(240, 135),
        cols=12,
    )

    scores = [warm_flash_score(frame) for frame in frames]
    peak = max(range(count), key=scores.__getitem__)
    if "attacking" in stem:
        start = max(0, peak - 8)
        end = min(count - 1, peak + 72)
        detail_indices = sorted(set([peak] + list(range(start, end + 1, 4))))
        make_sheet(
            frames,
            fps,
            detail_indices,
            PREVIEWS / f"{stem}-fire-and-bolt-detail.png",
            thumb=(480, 270),
            cols=5,
        )
        make_crop_sheet(
            frames,
            fps,
            list(range(48, min(count, 78), 2)),
            PREVIEWS / f"{stem}-receiver-hand-detail-a.png",
            (340, 120, 900, 505),
            thumb=(400, 275),
            cols=4,
        )
        make_crop_sheet(
            frames,
            fps,
            list(range(78, min(count, 104), 2)),
            PREVIEWS / f"{stem}-receiver-hand-detail-b.png",
            (340, 120, 900, 505),
            thumb=(400, 275),
            cols=4,
        )

    bboxes = [subject_bbox(frame) for frame in frames]
    valid = [bbox for bbox in bboxes if bbox is not None]
    width, height = frames[0].size
    return {
        "video": str(path.relative_to(ROOT)),
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
            min(bbox[0] for bbox in valid),
            min(bbox[1] for bbox in valid),
            max(bbox[2] for bbox in valid),
            max(bbox[3] for bbox in valid),
        ],
        "edgeMarginPixels": {
            "left": min(bbox[0] for bbox in valid),
            "top": min(bbox[1] for bbox in valid),
            "right": min(width - 1 - bbox[2] for bbox in valid),
            "bottom": min(height - 1 - bbox[3] for bbox in valid),
        },
        "artifacts": {
            "contact32": f"previews/{stem}-contact-32.png",
            "allFrames": f"previews/{stem}-all-frames.png",
            "gif": f"previews/{stem}-source.gif",
            "fireAndBoltDetail": (
                f"previews/{stem}-fire-and-bolt-detail.png" if "attacking" in stem else None
            ),
            "receiverHandDetail": ([
                f"previews/{stem}-receiver-hand-detail-a.png",
                f"previews/{stem}-receiver-hand-detail-b.png",
            ] if "attacking" in stem else None),
        },
    }


def main() -> None:
    jobs = [
        ("attacking-doubao-v02-single-shot-bolt.mp4", "attacking-doubao-v02-single-shot-bolt"),
        ("dying-doubao-v02-safe-framing.mp4", "dying-doubao-v02-safe-framing"),
        ("attacking-doubao-v03-receiver-visible.mp4", "attacking-doubao-v03-receiver-visible"),
        ("dying-doubao-v03-sling-retained.mp4", "dying-doubao-v03-sling-retained"),
    ]
    results = []
    for filename, stem in jobs:
        path = ROOT / "videos" / filename
        if path.exists():
            results.append(review(path, stem))
    if not results:
        raise RuntimeError("no v02 source videos found")
    report = {"schemaVersion": 1, "date": "2026-09-01", "takes": results}
    output = PREVIEWS / "v02-source-review-report.json"
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
