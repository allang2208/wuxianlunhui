"""Build exact-frame review sheets for bolt cycling and death framing."""

from pathlib import Path

import av
from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parent


def decode(path: Path) -> tuple[list[Image.Image], float]:
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate or 24.0)
        frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]
    return frames, fps


def sheet(video: Path, output: Path, indices: list[int], thumb: tuple[int, int], cols: int) -> None:
    frames, fps = decode(video)
    label_h = 24
    rows = (len(indices) + cols - 1) // cols
    result = Image.new("RGB", (cols * thumb[0], rows * (thumb[1] + label_h)), "#171717")
    draw = ImageDraw.Draw(result)
    for cell, index in enumerate(indices):
        image = ImageOps.contain(frames[index], thumb, Image.Resampling.LANCZOS)
        x = cell % cols * thumb[0]
        y = cell // cols * (thumb[1] + label_h)
        result.paste(image, (x + (thumb[0] - image.width) // 2, y + (thumb[1] - image.height) // 2))
        draw.text((x + 6, y + thumb[1] + 4), f"f{index} / {index / fps:.3f}s", fill="white")
    output.parent.mkdir(parents=True, exist_ok=True)
    result.save(output)


sheet(
    ROOT / "videos" / "attacking-doubao-v01.mp4",
    ROOT / "previews" / "attacking-doubao-v01-release-f22-f40.png",
    list(range(22, 41)),
    (320, 180),
    5,
)
sheet(
    ROOT / "videos" / "attacking-doubao-v01.mp4",
    ROOT / "previews" / "attacking-doubao-v01-bolt-f54-f101.png",
    [54, 58, 62, 66, 70, 74, 77, 81, 85, 89, 93, 97, 101],
    (320, 180),
    4,
)
sheet(
    ROOT / "videos" / "dying-doubao-v01.mp4",
    ROOT / "previews" / "dying-doubao-v01-framing-f00-f120.png",
    [0, 19, 27, 31, 39, 58, 70, 77, 89, 120],
    (320, 240),
    5,
)
print("detail review sheets written")
