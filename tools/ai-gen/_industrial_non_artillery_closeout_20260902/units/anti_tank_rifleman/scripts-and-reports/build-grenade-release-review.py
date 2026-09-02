"""Build exact consecutive-frame evidence around the grenade release."""

from pathlib import Path

import av
from PIL import Image, ImageDraw, ImageOps


ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "grenade-throw-doubao-v01.mp4"
OUTPUT = ROOT / "previews" / "grenade-throw-doubao-v01-release-f68-f80.png"
INDICES = list(range(68, 81))
THUMB = (320, 180)
COLS = 4
LABEL_HEIGHT = 24


with av.open(str(VIDEO)) as container:
    stream = container.streams.video[0]
    fps = float(stream.average_rate or 24.0)
    frames = [frame.to_image().convert("RGB") for frame in container.decode(stream)]

rows = (len(INDICES) + COLS - 1) // COLS
sheet = Image.new("RGB", (COLS * THUMB[0], rows * (THUMB[1] + LABEL_HEIGHT)), "#181818")
draw = ImageDraw.Draw(sheet)
for cell, index in enumerate(INDICES):
    image = ImageOps.contain(frames[index], THUMB, Image.Resampling.LANCZOS)
    x = cell % COLS * THUMB[0]
    y = cell // COLS * (THUMB[1] + LABEL_HEIGHT)
    sheet.paste(image, (x + (THUMB[0] - image.width) // 2, y + (THUMB[1] - image.height) // 2))
    draw.text((x + 6, y + THUMB[1] + 4), f"frame {index} / {index / fps:.3f}s", fill="white")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
sheet.save(OUTPUT)
print(f"decoded={len(frames)} fps={fps:.3f} indices={INDICES} -> {OUTPUT}")
