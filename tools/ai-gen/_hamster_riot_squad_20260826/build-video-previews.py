from pathlib import Path

import av
import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
PREVIEW_DIR = ROOT / "previews" / "videos"
TARGET_FPS = 10.0
TARGET_SIZE = (512, 288)
CONTACT_SAMPLES = 24
CONTACT_COLS = 6
CONTACT_THUMB = (320, 180)
SOURCES = {
    "idle": "hamster_riot_squad_idle_doubao.mp4",
    "idle-h3-v02": "hamster_riot_squad_idle_h3_v02.mp4",
    "moving": "hamster_riot_squad_moving_doubao.mp4",
    "moving-h3-v03": "hamster_riot_squad_moving_h3_v03.mp4",
    "moving-h3-v04": "hamster_riot_squad_moving_h3_v04.mp4",
    "attacking": "hamster_riot_squad_attacking_doubao.mp4",
    "attacking-h3-v01": "hamster_riot_squad_attacking_h3_v01.mp4",
    "attacking-h3-v02": "hamster_riot_squad_attacking_h3_v02.mp4",
    "dying": "hamster_riot_squad_dying_doubao.mp4",
    "dying-h3-v01": "hamster_riot_squad_dying_h3_v01.mp4",
}


def build_gif(action: str, frames: list[Image.Image], source_fps: float) -> Path:
    stride = max(1, round(source_fps / TARGET_FPS))
    playback_fps = source_fps / stride
    preview_frames: list[Image.Image] = []
    for frame in frames[::stride]:
        image = frame.copy()
        image.thumbnail(TARGET_SIZE, Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", TARGET_SIZE, "white")
        canvas.paste(
            image,
            ((TARGET_SIZE[0] - image.width) // 2, (TARGET_SIZE[1] - image.height) // 2),
        )
        preview_frames.append(canvas)
    if not preview_frames:
        raise RuntimeError(f"no preview frames for {action}")

    output = PREVIEW_DIR / f"{action}-source-preview.gif"
    preview_frames[0].save(
        output,
        save_all=True,
        append_images=preview_frames[1:],
        duration=round(1000 / playback_fps),
        loop=0,
        disposal=2,
        optimize=False,
    )
    return output


def build_contact(action: str, frames: list[Image.Image]) -> Path:
    wanted = min(CONTACT_SAMPLES, len(frames))
    indexes = np.linspace(0, len(frames) - 1, wanted).round().astype(int).tolist()
    label_h = 24
    rows = (wanted + CONTACT_COLS - 1) // CONTACT_COLS
    sheet = Image.new(
        "RGB",
        (CONTACT_COLS * CONTACT_THUMB[0], rows * (CONTACT_THUMB[1] + label_h)),
        (22, 22, 22),
    )
    draw = ImageDraw.Draw(sheet)
    for cell, index in enumerate(indexes):
        thumb = frames[index].resize(CONTACT_THUMB, Image.Resampling.LANCZOS)
        x = (cell % CONTACT_COLS) * CONTACT_THUMB[0]
        y = (cell // CONTACT_COLS) * (CONTACT_THUMB[1] + label_h)
        sheet.paste(thumb, (x, y))
        draw.text((x + 8, y + CONTACT_THUMB[1] + 4), f"frame {index}", fill="white")

    output = PREVIEW_DIR / f"{action}-source-contact-24.jpg"
    sheet.save(output, quality=92)
    return output


def build_previews(action: str, source: Path) -> None:
    container = av.open(str(source))
    stream = container.streams.video[0]
    source_fps = float(stream.average_rate or 24)
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    container.close()
    if not frames:
        raise RuntimeError(f"no frames decoded from {source}")

    gif = build_gif(action, frames, source_fps)
    contact = build_contact(action, frames)
    print(
        f"{action}: frames={len(frames)} fps={source_fps:.3f} "
        f"gif={gif.relative_to(ROOT)} contact={contact.relative_to(ROOT)}"
    )


def main() -> None:
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    for action, filename in SOURCES.items():
        source = VIDEO_DIR / filename
        if not source.exists():
            print(f"{action}: pending ({source.relative_to(ROOT)} missing)")
            continue
        build_previews(action, source)


if __name__ == "__main__":
    main()
