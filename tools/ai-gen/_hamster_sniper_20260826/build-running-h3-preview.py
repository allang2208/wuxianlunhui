import argparse
from pathlib import Path

import av
from PIL import Image


ROOT = Path(__file__).resolve().parent
TARGET_FPS = 12.0
TARGET_SIZE = (512, 288)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--name", default="running-h3-v01")
    args = parser.parse_args()
    source = ROOT / "videos" / f"{args.name}.mp4"
    output = ROOT / "previews" / "videos" / f"{args.name}-preview.gif"
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
        canvas.paste(image, ((TARGET_SIZE[0] - image.width) // 2,
                             (TARGET_SIZE[1] - image.height) // 2))
        frames.append(canvas)
    container.close()
    if not frames:
        raise RuntimeError(f"no frames decoded from {source}")
    output.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        output,
        save_all=True,
        append_images=frames[1:],
        duration=round(1000 / playback_fps),
        loop=0,
        disposal=2,
    )
    print(f"frames={len(frames)} fps={playback_fps:.3f} -> {output}")


if __name__ == "__main__":
    main()
