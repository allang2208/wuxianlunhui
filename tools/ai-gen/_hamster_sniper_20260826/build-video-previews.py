from pathlib import Path

import av
from PIL import Image


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
PREVIEW_DIR = ROOT / "previews" / "videos"
TARGET_FPS = 10.0
TARGET_SIZE = (512, 288)


def build_preview(name: str, source_name: str | None = None) -> None:
    source = VIDEO_DIR / (source_name or f"{name}-doubao.mp4")
    output = PREVIEW_DIR / f"{name}-preview.gif"
    container = av.open(str(source))
    stream = container.streams.video[0]
    source_fps = float(stream.average_rate or 24)
    stride = max(1, round(source_fps / TARGET_FPS))
    playback_fps = source_fps / stride
    frames: list[Image.Image] = []

    for index, frame in enumerate(container.decode(stream)):
        if index % stride != 0:
            continue
        image = frame.to_image().convert("RGB")
        image.thumbnail(TARGET_SIZE, Image.Resampling.LANCZOS)
        canvas = Image.new("RGB", TARGET_SIZE, "white")
        canvas.paste(
            image,
            ((TARGET_SIZE[0] - image.width) // 2, (TARGET_SIZE[1] - image.height) // 2),
        )
        frames.append(canvas)
    container.close()

    if not frames:
        raise RuntimeError(f"no frames decoded from {source}")

    PREVIEW_DIR.mkdir(parents=True, exist_ok=True)
    duration_ms = round(1000 / playback_fps)
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=duration_ms,
        loop=0,
        disposal=2,
    )
    print(
        f"{name}: source_fps={source_fps:.3f} stride={stride} "
        f"preview_frames={len(frames)} duration_ms={duration_ms} -> {output}"
    )


def main() -> None:
    for state in ("idle", "running", "attacking", "dying"):
        build_preview(state)
    build_preview("running-v02", "running-doubao-v02.mp4")
    build_preview("dying-v02", "dying-doubao-v02.mp4")
    build_preview("dying-v03", "dying-doubao-v03.mp4")
    build_preview("dying-v04", "dying-doubao-v04.mp4")
    build_preview("dying-v05", "dying-doubao-v05.mp4")
    build_preview("dying-v06", "dying-doubao-v06.mp4")
    build_preview("dying-v07", "dying-doubao-v07.mp4")


if __name__ == "__main__":
    main()
