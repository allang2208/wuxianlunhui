"""Create review artifacts from the exact downloaded Doubao candidate."""
from pathlib import Path
import argparse
import json
import av
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageOps

HERE = Path(__file__).resolve().parent
parser = argparse.ArgumentParser()
parser.add_argument("--video", type=Path, required=True)
parser.add_argument("--label", default="whip-v01")
args = parser.parse_args()
with av.open(str(args.video)) as container:
    stream = container.streams.video[0]
    fps = float(stream.average_rate)
    frames = [frame.to_ndarray(format="rgb24") for frame in container.decode(video=0)]
selected = np.rint(np.linspace(0, len(frames) - 1, 28)).astype(int)
contact = Image.new("RGB", (4 * 384, 7 * 240), "#242a32")
draw = ImageDraw.Draw(contact)
for i, index in enumerate(selected):
    x, y = i % 4 * 384, i // 4 * 240
    thumb = ImageOps.contain(Image.fromarray(frames[index]), (384, 216))
    contact.paste(thumb, (x, y + (216 - thumb.height) // 2))
    draw.text((x + 5, y + 220), f"f{index:03d} / {index / fps:.3f}s", fill="white")
contact.save(HERE / f"previews/{args.label}-source-contact.png")
images = [ImageOps.contain(Image.fromarray(frame), (768, 432), Image.Resampling.LANCZOS) for frame in frames]
durations = [10 * (round((i + 1) * 100 / fps) - round(i * 100 / fps)) for i in range(len(images))]
images[0].save(HERE / f"previews/{args.label}-source.gif", save_all=True, append_images=images[1:], duration=durations, loop=0, disposal=2)
rows = []
for i, rgb in enumerate(frames):
    # The model may draw a neutral gray studio background despite the white
    # prompt. Chroma separates brown/olive actor pixels from that background;
    # it is still only a review aid, not the final alpha or a completeness test.
    signed = rgb.astype(np.int16)
    mask = ((signed.max(axis=2) - signed.min(axis=2) > 12) & (signed.min(axis=2) < 190)).astype(np.uint8)
    count, labels, stats, centers = cv2.connectedComponentsWithStats(mask, 8)
    main = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    x, y, w, h, area = [int(value) for value in stats[main]]
    rows.append({"frame": i, "bodyAndConnectedWhipProxyBBox": [x, y, x + w, y + h], "area": area})
record = {"video": str(args.video), "fps": fps, "frameCount": len(frames), "size": [frames[0].shape[1], frames[0].shape[0]], "note": "RGB component bounds are a review aid only; inspect thin whip and original video visually before cutout.", "frames": rows}
(HERE / f"previews/{args.label}-source-metadata.json").write_text(json.dumps(record, indent=2), encoding="utf-8")
print(json.dumps({key: record[key] for key in ("fps", "frameCount", "size")}))
