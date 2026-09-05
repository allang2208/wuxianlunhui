#!/usr/bin/env python3
"""Build review GIFs, contact sheets, and raw scale metrics for the sealed-shaft lord."""

from __future__ import annotations

import json
import math
import statistics
from pathlib import Path

import av
from PIL import Image, ImageChops, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
PREVIEW_DIR = ROOT / "previews" / "videos"
SOURCES = {
    "idle-minimax-h3-v01": "idle-minimax-h3-v01.mp4",
    "walking-minimax-h3-v01": "walking-minimax-h3-v01.mp4",
    "crystal-arm-smash-minimax-h3-v01": "crystal-arm-smash-minimax-h3-v01.mp4",
    "borequake-minimax-h3-v01": "borequake-minimax-h3-v01.mp4",
    "drill-rush-minimax-h3-v01": "drill-rush-minimax-h3-v01.mp4",
    "dying-minimax-h3-v01": "dying-minimax-h3-v01.mp4",
}


def decode(path: Path) -> tuple[list[Image.Image], float, int, int]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        width = stream.codec_context.width
        height = stream.codec_context.height
        frames = [
            Image.fromarray(frame.to_ndarray(format="rgb24"), "RGB")
            for frame in container.decode(stream)
        ]
    return frames, fps, width, height


def foreground_mask(frame: Image.Image) -> Image.Image:
    white = Image.new("RGB", frame.size, "white")
    difference = ImageChops.difference(frame, white).convert("L")
    return difference.point(lambda value: 255 if value > 18 else 0)


def scale_metrics(frame: Image.Image) -> dict[str, int] | None:
    mask = foreground_mask(frame)
    bbox = mask.getbbox()
    if bbox is None:
        return None
    x0, y0, x1, y1 = bbox
    pixels = mask.load()
    spans: list[tuple[int, int]] = []
    for y in range(y0, y1):
        occupied = [x for x in range(x0, x1) if pixels[x, y] != 0]
        if occupied:
            spans.append((y, occupied[-1] - occupied[0] + 1))
    max_span = max(span for _, span in spans)
    # The upward drill is tall and narrow. Exclude its thin rows from the body-height
    # anchor so rotation of the weapon cannot make the whole unit appear smaller.
    body_span_threshold = max(12, round(max_span * 0.22))
    body_rows = [y for y, span in spans if span >= body_span_threshold]
    body_top = min(body_rows) if body_rows else y0
    foot_y = y1 - 1
    return {
        "bboxX": x0,
        "bboxY": y0,
        "bboxWidth": x1 - x0,
        "bboxHeight": y1 - y0,
        "effectiveBodyTop": body_top,
        "effectiveBodyHeight": foot_y - body_top + 1,
        "footY": foot_y,
    }


def build(name: str, source_name: str) -> dict[str, object]:
    frames, fps, width, height = decode(VIDEO_DIR / source_name)
    if not frames:
        raise RuntimeError(f"No frames decoded from {source_name}")
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    preview_step = 2
    preview_frames = [
        frame.resize((512, 288), Image.Resampling.LANCZOS)
        for frame in frames[::preview_step]
    ]
    preview_frames[0].save(
        PREVIEW_DIR / f"{name}-preview.gif",
        save_all=True,
        append_images=preview_frames[1:],
        duration=round(1000 * preview_step / fps),
        loop=0,
        disposal=2,
    )

    sample_step = 8
    indices = list(range(0, len(frames), sample_step))
    if indices[-1] != len(frames) - 1:
        indices.append(len(frames) - 1)
    cols = 4
    tile_w, tile_h, label_h = 320, 180, 24
    rows = math.ceil(len(indices) / cols)
    contact = Image.new("RGB", (cols * tile_w, rows * (tile_h + label_h)), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, index in enumerate(indices):
        tile = frames[index].resize((tile_w, tile_h), Image.Resampling.LANCZOS)
        x = position % cols * tile_w
        y = position // cols * (tile_h + label_h)
        contact.paste(tile, (x, y))
        draw.text((x + 6, y + tile_h + 4), f"source f{index} / {index / fps:.2f}s", fill="white")
    contact.save(PREVIEW_DIR / f"{name}-contact.png")

    measured = [metric for frame in frames if (metric := scale_metrics(frame)) is not None]
    body_heights = [metric["effectiveBodyHeight"] for metric in measured]
    foot_lines = [metric["footY"] for metric in measured]
    return {
        "source": f"videos/{source_name}",
        "sourceFrames": len(frames),
        "sourceFps": fps,
        "sourceSize": [width, height],
        "durationSeconds": len(frames) / fps,
        "previewFps": fps / preview_step,
        "previewGif": f"previews/videos/{name}-preview.gif",
        "contact": f"previews/videos/{name}-contact.png",
        "contactIndices": indices,
        "rawScale": {
            "effectiveBodyHeightMin": min(body_heights),
            "effectiveBodyHeightMedian": round(statistics.median(body_heights), 2),
            "effectiveBodyHeightMax": max(body_heights),
            "footYMin": min(foot_lines),
            "footYMedian": round(statistics.median(foot_lines), 2),
            "footYMax": max(foot_lines),
            "requiresNormalization": max(body_heights) - min(body_heights) > 24,
            "anchorRule": "effective body height and foot line; narrow upward drill excluded",
        },
    }


def main() -> None:
    report = {
        name: build(name, source)
        for name, source in SOURCES.items()
        if (VIDEO_DIR / source).is_file()
    }
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    (PREVIEW_DIR / "preview-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
