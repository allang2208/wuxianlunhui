"""Create whole-source GIF and contact previews without modifying the source video."""
from __future__ import annotations

import json
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos/black-wolf-dying-doubao-v01.mp4"


def main() -> None:
    with av.open(str(VIDEO)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 24)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    if not frames:
        raise RuntimeError(f"No decodable frames: {VIDEO}")
    previews = ROOT / "previews"
    previews.mkdir(parents=True, exist_ok=True)
    source_w, source_h = frames[0].size
    gif_size = (640, round(640 * source_h / source_w))
    gif_frames = [frame.resize(gif_size, Image.Resampling.LANCZOS) for frame in frames]
    gif_path = previews / "black-wolf-dying-doubao-v01.gif"
    gif_frames[0].save(gif_path, save_all=True, append_images=gif_frames[1:],
                       duration=round(1000 / fps), disposal=2, optimize=False)
    cols, rows, cell_w = 6, 4, 320
    cell_h, label_h = round(cell_w * source_h / source_w), 22
    contact = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h)), (238, 238, 238))
    draw = ImageDraw.Draw(contact)
    indices = np.linspace(0, len(frames) - 1, cols * rows, dtype=int)
    for slot, index in enumerate(indices):
        x = slot % cols * cell_w
        y = slot // cols * (cell_h + label_h)
        contact.paste(frames[index].resize((cell_w, cell_h), Image.Resampling.LANCZOS), (x, y))
        draw.text((x + 6, y + cell_h + 4), f"f{index:03d}  {index / fps:.3f}s", fill=(20, 20, 20))
    contact_path = previews / "black-wolf-dying-doubao-v01-contact.png"
    contact.save(contact_path)
    report = {
        "video": VIDEO.relative_to(ROOT).as_posix(),
        "gif": gif_path.relative_to(ROOT).as_posix(),
        "contact": contact_path.relative_to(ROOT).as_posix(),
        "sourceSize": [source_w, source_h],
        "sourceFrameCount": len(frames),
        "sourceFps": fps,
        "sourceDurationSeconds": len(frames) / fps,
        "previewRange": "entire source, no trimming, no retiming",
    }
    (previews / "preview-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
