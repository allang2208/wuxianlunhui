#!/usr/bin/env python3
"""Build direct-review GIFs and contact sheets for Red Wolf King source videos."""

from __future__ import annotations

import json
import math
from pathlib import Path

import av
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
PREVIEW_DIR = ROOT / "previews" / "videos"
SOURCES = {
    "transform-v02": "transform-h3-v02.mp4",
    "werewolf-run-v02": "werewolf-run-h3-v02.mp4",
    "werewolf-attack-v02": "werewolf-attack-h3-v02.mp4",
    "werewolf-howl-v01": "werewolf-howl-h3-v01.mp4",
    "werewolf-dying-v01": "werewolf-dying-h3-v01.mp4",
    "werewolf-pounce-v01": "werewolf-pounce-h3-v01.mp4",
}


def decode(path: Path) -> tuple[list[Image.Image], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    return frames, fps


def build(name: str, source_name: str) -> dict[str, object]:
    frames, fps = decode(VIDEO_DIR / source_name)
    if not frames:
        raise RuntimeError(f"no frames decoded from {source_name}")
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    preview_frames = [frame.resize((512, 288), Image.Resampling.LANCZOS) for frame in frames[::2]]
    preview_frames[0].save(
        PREVIEW_DIR / f"{name}-preview.gif",
        save_all=True,
        append_images=preview_frames[1:],
        duration=round(2000 / fps),
        loop=0,
        disposal=2,
    )

    sample_step = 6 if name in {
        "transform-v02", "werewolf-attack-v02", "werewolf-howl-v01",
        "werewolf-dying-v01", "werewolf-pounce-v01",
    } else 10
    indices = list(range(0, len(frames), sample_step))
    if indices[-1] != len(frames) - 1:
        indices.append(len(frames) - 1)
    cols = 4
    rows = math.ceil(len(indices) / cols)
    contact = Image.new("RGB", (1280, rows * 204), "#20242a")
    draw = ImageDraw.Draw(contact)
    for position, index in enumerate(indices):
        tile = frames[index].resize((320, 180), Image.Resampling.LANCZOS)
        x = position % cols * 320
        y = position // cols * 204
        contact.paste(tile, (x, y))
        draw.text((x + 5, y + 184), f"source f{index} / {index / fps:.2f}s", fill="white")
    contact.save(PREVIEW_DIR / f"{name}-contact.png")
    return {
        "source": f"videos/{source_name}",
        "sourceFrames": len(frames),
        "sourceFps": fps,
        "previewGif": f"previews/videos/{name}-preview.gif",
        "contact": f"previews/videos/{name}-contact.png",
    }


def main() -> None:
    report = {
        name: build(name, source)
        for name, source in SOURCES.items()
        if (VIDEO_DIR / source).exists()
    }
    (PREVIEW_DIR / "preview-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
