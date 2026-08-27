from __future__ import annotations

import math
from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
PREVIEW_DIR = ROOT / "previews" / "videos"
TARGET_FPS = 10.0
TARGET_SIZE = (512, 288)
CONTACT_COUNT = 16
CONTACT_COLS = 4

VIDEOS = {
    "idle": "hamster_anti_vehicle_idle_h3.mp4",
    "running": "hamster_anti_vehicle_running_h3.mp4",
    "smg_attacking": "hamster_anti_vehicle_smg_attacking_h3.mp4",
    "rocket_attacking": "hamster_anti_vehicle_rocket_attacking_h3.mp4",
    "rocket_attacking_v02": "hamster_anti_vehicle_rocket_attacking_h3_v02.mp4",
    "dying": "hamster_anti_vehicle_dying_h3.mp4",
}


def load_frames(source: Path) -> tuple[list[Image.Image], float]:
    container = av.open(str(source))
    stream = container.streams.video[0]
    stream.thread_type = "AUTO"
    source_fps = float(stream.average_rate or 24)
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    container.close()
    if not frames:
        raise RuntimeError(f"no frames decoded from {source}")
    return frames, source_fps


def build_gif(name: str, frames: list[Image.Image], source_fps: float) -> None:
    stride = max(1, round(source_fps / TARGET_FPS))
    playback_fps = source_fps / stride
    output_frames: list[Image.Image] = []
    for frame in frames[::stride]:
        image = frame.copy()
        image.thumbnail(TARGET_SIZE, Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", TARGET_SIZE, "white")
        canvas.paste(
            image,
            ((TARGET_SIZE[0] - image.width) // 2, (TARGET_SIZE[1] - image.height) // 2),
        )
        output_frames.append(canvas)
    output_frames[0].save(
        PREVIEW_DIR / f"{name}-h3-preview.gif",
        save_all=True,
        append_images=output_frames[1:],
        duration=round(1000 / playback_fps),
        loop=0,
        disposal=2,
    )


def build_contact_sheet(name: str, frames: list[Image.Image]) -> None:
    wanted = min(CONTACT_COUNT, len(frames))
    indexes = np.linspace(0, len(frames) - 1, wanted).round().astype(int).tolist()
    thumb_w, thumb_h = TARGET_SIZE
    label_h = 24
    rows = math.ceil(wanted / CONTACT_COLS)
    sheet = Image.new(
        "RGB",
        (CONTACT_COLS * thumb_w, rows * (thumb_h + label_h)),
        (22, 22, 22),
    )
    draw = ImageDraw.Draw(sheet)
    for cell, index in enumerate(indexes):
        thumb = frames[index].resize(TARGET_SIZE, Image.Resampling.LANCZOS)
        x = (cell % CONTACT_COLS) * thumb_w
        y = (cell // CONTACT_COLS) * (thumb_h + label_h)
        sheet.paste(thumb, (x, y))
        draw.text((x + 8, y + thumb_h + 4), f"frame {index}", fill=(255, 255, 255))
    sheet.save(PREVIEW_DIR / f"{name}-h3-contact.png")


def main() -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for name, filename in VIDEOS.items():
        frames, source_fps = load_frames(VIDEO_DIR / filename)
        build_gif(name, frames, source_fps)
        build_contact_sheet(name, frames)
        print(f"{name}: frames={len(frames)} source_fps={source_fps:.3f}")


if __name__ == "__main__":
    main()
