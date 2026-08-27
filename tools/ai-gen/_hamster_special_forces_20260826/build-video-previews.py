from pathlib import Path

import av
from PIL import Image


ROOT = Path(__file__).resolve().parent
VIDEO_DIR = ROOT / "videos"
PREVIEW_DIR = ROOT / "previews" / "raw"
TARGET_FPS = 10.0
TARGET_SIZE = (512, 288)
ACTIONS = (
    "idle",
    "idle-v02",
    "running",
    "running-v02",
    "attacking",
    "attacking-v02",
    "dying",
)
VIDEO_NAMES = {
    "idle-v02": "hamster_special_forces_idle_doubao_v02.mp4",
    "running-v02": "hamster_special_forces_running_doubao_v02.mp4",
    "attacking-v02": "hamster_special_forces_attacking_doubao_v02.mp4",
}


def build_preview(action: str) -> None:
    source = VIDEO_DIR / VIDEO_NAMES.get(
        action, f"hamster_special_forces_{action}_doubao.mp4"
    )
    output = PREVIEW_DIR / f"hamster-special-forces-{action}-doubao.gif"
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
        f"{action}: source_fps={source_fps:.3f} stride={stride} "
        f"preview_frames={len(frames)} duration_ms={duration_ms} -> {output}"
    )


def main() -> None:
    for action in ACTIONS:
        build_preview(action)


if __name__ == "__main__":
    main()
