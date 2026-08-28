#!/usr/bin/env python3
"""Build direct GIF previews for the selected and reviewable source videos."""

from pathlib import Path

import av
from PIL import Image


ROOT = Path(__file__).resolve().parent
VIDEOS = {
    "idle-h3-v02": "idle-h3-v02.mp4",
    "running-h3-v01": "running-h3-v01.mp4",
    "attacking-h3-v01": "attacking-h3-v01.mp4",
    "charge-attacking-doubao-v01": "charge-attacking-doubao-v01.mp4",
    "lance-attacking-doubao-v01": "lance-attacking-doubao-v01.mp4",
    "dying-doubao-v01": "dying-doubao-v01.mp4",
}


def main() -> None:
    preview_dir = ROOT / "previews" / "videos"
    preview_dir.mkdir(parents=True, exist_ok=True)
    for preview_name, filename in VIDEOS.items():
        container = av.open(str(ROOT / "videos" / filename))
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 24)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
        container.close()
        if not frames:
            raise RuntimeError(f"no frames decoded from {filename}")
        preview_frames = [
            frame.resize((512, 288), Image.Resampling.LANCZOS)
            for frame in frames[::2]
        ]
        output = preview_dir / f"{preview_name}-preview.gif"
        preview_frames[0].save(
            output,
            save_all=True,
            append_images=preview_frames[1:],
            duration=max(20, round(2000 / fps)),
            loop=0,
            disposal=2,
            optimize=False,
        )
        print(f"saved {output} frames={len(preview_frames)} source_fps={fps:g}")


if __name__ == "__main__":
    main()
