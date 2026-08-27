#!/usr/bin/env python3
"""Build direct GIF and contact-sheet evidence for hamster-assault source videos."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
PREVIEW_DIR = ROOT / "previews" / "videos"


def decode(path: Path) -> tuple[list[Image.Image], float]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    fps = float(stream.average_rate or 24)
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    container.close()
    if not frames:
        raise RuntimeError(f"no frames decoded from {path}")
    return frames, fps


def build(name: str, source: Path) -> dict[str, object]:
    frames, fps = decode(source)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)

    gif_frames = [frame.resize((512, 288), Image.Resampling.LANCZOS) for frame in frames[::2]]
    gif_path = PREVIEW_DIR / f"{name}-preview.gif"
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=round(2000 / fps),
        loop=0,
        disposal=2,
    )

    indices = np.linspace(0, len(frames) - 1, 12, dtype=int)
    cell_w, cell_h = 320, 180
    sheet = Image.new("RGB", (cell_w * 4, cell_h * 3), (245, 245, 245))
    draw = ImageDraw.Draw(sheet)
    for slot, index in enumerate(indices):
        frame = frames[int(index)].resize((cell_w, cell_h), Image.Resampling.LANCZOS)
        x = (slot % 4) * cell_w
        y = (slot // 4) * cell_h
        sheet.paste(frame, (x, y))
        draw.rectangle((x + 4, y + 4, x + 70, y + 24), fill=(0, 0, 0))
        draw.text((x + 8, y + 7), f"f{int(index):03d}", fill=(255, 255, 255))
    contact_path = PREVIEW_DIR / f"{name}-contact.png"
    sheet.save(contact_path)

    return {
        "source": str(source.relative_to(ROOT)).replace("\\", "/"),
        "frameCount": len(frames),
        "fps": fps,
        "size": list(frames[0].size),
        "gif": str(gif_path.relative_to(ROOT)).replace("\\", "/"),
        "contact": str(contact_path.relative_to(ROOT)).replace("\\", "/"),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--only", choices=["idle", "running", "attacking", "dying"])
    args = parser.parse_args()
    report_path = PREVIEW_DIR / "preview-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    names = [args.only] if args.only else ["idle", "running", "attacking", "dying"]
    for name in names:
        source = VIDEO_DIR / f"{name}-doubao-v01.mp4"
        if source.exists():
            report[name] = build(name, source)
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
