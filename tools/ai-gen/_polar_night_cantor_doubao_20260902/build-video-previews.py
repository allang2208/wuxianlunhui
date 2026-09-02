"""Create whole-source GIF/contact previews without modifying Doubao videos."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
ACTIONS = ("idle", "running", "attacking", "dying")


def build(action: str, video: Path) -> dict:
    stem = video.stem
    with av.open(str(video)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 24)
        frames, times = [], []
        for index, frame in enumerate(container.decode(stream)):
            frames.append(frame.to_image().convert("RGB"))
            times.append(float(frame.time) if frame.time is not None else index / fps)
        stream_duration = float(stream.duration * stream.time_base) if stream.duration else None
    if not frames:
        raise RuntimeError(f"No decodable frames: {video}")
    origin = times[0]
    times = [value - origin for value in times]
    total = max(stream_duration or 0, times[-1] + 1 / fps)
    bounds = [round(value * 100) for value in times] + [round(total * 100)]
    durations = [max(1, bounds[i + 1] - bounds[i]) * 10 for i in range(len(frames))]
    previews = ROOT / "previews"
    previews.mkdir(exist_ok=True)
    source_w, source_h = frames[0].size
    width = 640
    height = round(width * source_h / source_w)
    gif_frames = [frame.resize((width, height), Image.Resampling.LANCZOS) for frame in frames]
    gif = previews / f"{stem}.gif"
    options = dict(save_all=True, append_images=gif_frames[1:], duration=durations, disposal=2, optimize=False)
    if action in ("idle", "running"):
        options["loop"] = 0
    gif_frames[0].save(gif, **options)
    cols, rows = 6, 4
    cell_w, cell_h, label_h = 320, round(320 * source_h / source_w), 22
    contact = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h)), (238, 238, 238))
    draw = ImageDraw.Draw(contact)
    indices = np.linspace(0, len(frames) - 1, cols * rows, dtype=int)
    for slot, index in enumerate(indices):
        x = slot % cols * cell_w
        y = slot // cols * (cell_h + label_h)
        contact.paste(frames[index].resize((cell_w, cell_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 6, y + cell_h + 4), f"f{index:03d}  {times[index]:.3f}s", fill=(20, 20, 20))
    contact_path = previews / f"{stem}-contact.png"
    contact.save(contact_path)
    return {
        "video": video.relative_to(ROOT).as_posix(),
        "gif": gif.relative_to(ROOT).as_posix(),
        "contact": contact_path.relative_to(ROOT).as_posix(),
        "sourceSize": [source_w, source_h],
        "sourceFrameCount": len(frames),
        "sourceFps": fps,
        "sourceDurationSeconds": total,
        "previewRange": "entire source, no trimming, no retiming",
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=ACTIONS)
    args = parser.parse_args()
    report_path = ROOT / "previews/preview-report.json"
    report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    video = ROOT / manifest["actions"][args.action]["video"]
    report[args.action] = build(args.action, video)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({args.action: report[args.action]}, ensure_ascii=False))


if __name__ == "__main__":
    main()
