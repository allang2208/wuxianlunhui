#!/usr/bin/env python3
"""Build whole-source GIF and 24-point contact previews without altering videos."""

import argparse
import json
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
ACTIONS = ("idle", "running", "attacking", "dying")


def build(action: str, video: Path) -> dict:
    with av.open(str(video)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 24)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
        duration = float(stream.duration * stream.time_base) if stream.duration else len(frames) / fps
    if not frames:
        raise RuntimeError(f"No decodable frames: {video}")
    previews = ROOT / "previews"
    previews.mkdir(exist_ok=True)
    source_w, source_h = frames[0].size
    gif_size = (640, round(640 * source_h / source_w))
    gif_frames = [frame.resize(gif_size, Image.Resampling.LANCZOS) for frame in frames]
    gif_path = previews / f"{video.stem}.gif"
    gif_frames[0].save(
        gif_path,
        save_all=True,
        append_images=gif_frames[1:],
        duration=max(1, round(1000 / fps)),
        loop=0 if action in ("idle", "running") else 1,
        disposal=2,
        optimize=False,
    )
    cols, rows = 6, 4
    cell_w, cell_h, label_h = 320, round(320 * source_h / source_w), 22
    contact = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h)), (238, 238, 238))
    draw = ImageDraw.Draw(contact)
    indices = np.linspace(0, len(frames) - 1, cols * rows, dtype=int)
    for slot, index in enumerate(indices):
        x = slot % cols * cell_w
        y = slot // cols * (cell_h + label_h)
        contact.paste(frames[index].resize((cell_w, cell_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 6, y + cell_h + 4), f"f{index:03d}  {index / fps:.3f}s", fill=(20, 20, 20))
    contact_path = previews / f"{video.stem}-contact.png"
    contact.save(contact_path)
    return {
        "video": video.relative_to(ROOT).as_posix(),
        "gif": gif_path.relative_to(ROOT).as_posix(),
        "contact": contact_path.relative_to(ROOT).as_posix(),
        "sourceSize": [source_w, source_h],
        "sourceFrameCount": len(frames),
        "sourceFps": fps,
        "sourceDurationSeconds": duration,
        "previewRange": "entire source, no trimming or retiming",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=ACTIONS)
    args = parser.parse_args()
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    video = ROOT / manifest["actions"][args.action]["video"]
    report_path = ROOT / "previews/preview-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    report[args.action] = build(args.action, video)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({args.action: report[args.action]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
