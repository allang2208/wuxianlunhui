from pathlib import Path

import av
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "videos" / "dying-doubao-v04.mp4"
OUTPUT = ROOT / "previews" / "window-analysis" / "dying-v04-keyframes-original.jpg"
INDICES = (0, 12, 16, 20, 24, 28, 32, 48, 72, 96)


with av.open(str(SOURCE)) as container:
    stream = container.streams.video[0]
    fps = float(stream.average_rate)
    wanted = set(INDICES)
    frames = {
        index: frame.to_image().convert("RGB")
        for index, frame in enumerate(container.decode(stream))
        if index in wanted
    }

cell_w, cell_h, label_h, cols = 520, 360, 28, 2
rows = (len(INDICES) + cols - 1) // cols
sheet = Image.new("RGB", (cols * cell_w, rows * (cell_h + label_h)), "#20242a")
draw = ImageDraw.Draw(sheet)
for position, index in enumerate(INDICES):
    image = frames[index]
    crop = image.crop((0, 0, min(1050, image.width), image.height))
    crop.thumbnail((cell_w, cell_h), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (cell_w, cell_h), "white")
    canvas.paste(crop, ((cell_w - crop.width) // 2, (cell_h - crop.height) // 2))
    x = (position % cols) * cell_w
    y = (position // cols) * (cell_h + label_h)
    sheet.paste(canvas, (x, y))
    draw.text((x + 6, y + cell_h + 5), f"f{index} / {index / fps:.2f}s", fill="white")

OUTPUT.parent.mkdir(parents=True, exist_ok=True)
sheet.save(OUTPUT, quality=96)
print(OUTPUT)
