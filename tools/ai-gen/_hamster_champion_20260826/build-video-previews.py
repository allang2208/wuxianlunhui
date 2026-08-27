from pathlib import Path

import av
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
PREVIEW_DIR = ROOT / "previews" / "videos"


def build_preview(name: str, source_name: str | None = None) -> None:
    source = VIDEO_DIR / (source_name or f"{name}-doubao.mp4")
    container = av.open(str(source))
    stream = container.streams.video[0]
    source_fps = float(stream.average_rate or 24)
    stride = max(1, round(source_fps / 10.0))
    frames = []
    contact_frames = []
    for index, frame in enumerate(container.decode(stream)):
        image = frame.to_image().convert("RGB")
        if index % stride == 0:
            frames.append(image.resize((512, 288), Image.Resampling.LANCZOS))
        if index % 12 == 0:
            thumb = image.resize((320, 180), Image.Resampling.LANCZOS)
            contact_frames.append((index, thumb))
    container.close()
    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    duration_ms = round(1000 / (source_fps / stride))
    frames[0].save(PREVIEW_DIR / f"{name}-preview.gif", save_all=True, append_images=frames[1:], duration=duration_ms, loop=0, disposal=2)
    rows = (len(contact_frames) + 3) // 4
    contact = Image.new("RGB", (1280, rows * 206), "#20242a")
    draw = ImageDraw.Draw(contact)
    for pos, (index, thumb) in enumerate(contact_frames):
        x = (pos % 4) * 320
        y = (pos // 4) * 206
        contact.paste(thumb, (x, y))
        draw.text((x + 6, y + 184), f"source f{index}", fill="white")
    contact.save(PREVIEW_DIR / f"{name}-contact.png")
    print(f"{name}: source_fps={source_fps:.3f} preview_frames={len(frames)}")


def main() -> None:
    for state in ("idle", "running", "attacking", "dying"):
        build_preview(state)
    if (VIDEO_DIR / "running-doubao-v02.mp4").exists():
        build_preview("running-v02", "running-doubao-v02.mp4")
    if (VIDEO_DIR / "attacking-doubao-v02.mp4").exists():
        build_preview("attacking-v02", "attacking-doubao-v02.mp4")
    if (VIDEO_DIR / "attacking-doubao-v03.mp4").exists():
        build_preview("attacking-v03", "attacking-doubao-v03.mp4")


if __name__ == "__main__":
    main()
