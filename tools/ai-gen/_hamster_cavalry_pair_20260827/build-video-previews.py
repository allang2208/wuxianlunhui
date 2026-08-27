#!/usr/bin/env python3
"""Build direct GIF and 24-point contact evidence for cavalry source videos."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent


def decode(path: Path) -> tuple[list[Image.Image], float]:
    container = av.open(str(path))
    stream = container.streams.video[0]
    fps = float(stream.average_rate or 24)
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    container.close()
    if not frames:
        raise RuntimeError(f"no frames decoded from {path}")
    return frames, fps


def build(unit: str, motion: str, source: Path) -> dict[str, object]:
    frames, fps = decode(source)
    preview_dir = ROOT / "previews" / "videos" / unit
    preview_dir.mkdir(parents=True, exist_ok=True)

    gif_frames = [frame.resize((512, 288), Image.Resampling.LANCZOS) for frame in frames[::2]]
    gif_path = preview_dir / f"{motion}-preview.gif"
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=round(2000 / fps),
        loop=0,
        disposal=2,
    )

    indices = np.linspace(0, len(frames) - 1, 24, dtype=int)
    cell_w, cell_h = 256, 144
    sheet = Image.new("RGB", (cell_w * 6, cell_h * 4), (245, 245, 245))
    draw = ImageDraw.Draw(sheet)
    for slot, index in enumerate(indices):
        frame = frames[int(index)].resize((cell_w, cell_h), Image.Resampling.LANCZOS)
        x = (slot % 6) * cell_w
        y = (slot // 6) * cell_h
        sheet.paste(frame, (x, y))
        draw.rectangle((x + 3, y + 3, x + 53, y + 20), fill=(0, 0, 0))
        draw.text((x + 6, y + 5), f"f{int(index):03d}", fill=(255, 255, 255))
    contact_path = preview_dir / f"{motion}-contact-24.png"
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
    parser.add_argument("--unit", choices=("cavalry", "winged_hussar"), required=True)
    parser.add_argument("--only", choices=("idle", "running", "attacking", "dying"))
    args = parser.parse_args()
    preview_dir = ROOT / "previews" / "videos" / args.unit
    report_path = preview_dir / "preview-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    motions = [args.only] if args.only else ["idle", "running", "attacking", "dying"]
    for motion in motions:
        source = ROOT / "videos" / args.unit / f"{motion}-doubao-v01.mp4"
        if source.exists():
            report[motion] = build(args.unit, motion, source)
    preview_dir.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
