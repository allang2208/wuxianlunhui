"""Render the reported fence region on a contrasting checkerboard (preview only)."""

import sys
from PIL import Image, ImageDraw


source = Image.open(sys.argv[1]).convert("RGBA")
box = tuple(map(int, sys.argv[3].split(","))) if len(sys.argv) > 3 else (210, 120, 325, 225)
crop = source.crop(box)
crop = crop.resize((crop.width * 4, crop.height * 4), Image.Resampling.NEAREST)
preview = Image.new("RGBA", crop.size, (67, 39, 76, 255))
draw = ImageDraw.Draw(preview)
for y in range(0, crop.height, 24):
    for x in range(0, crop.width, 24):
        if (x // 24 + y // 24) % 2:
            draw.rectangle((x, y, x + 23, y + 23), fill=(164, 129, 173, 255))
preview.alpha_composite(crop)
preview.convert("RGB").save(sys.argv[2])
print(sys.argv[2])
