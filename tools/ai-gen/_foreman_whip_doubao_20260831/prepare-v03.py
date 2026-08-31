from pathlib import Path
from PIL import Image
import json

root = Path(__file__).resolve().parent
index = 22
source = Image.open(root / "before/attacking.png").convert("RGBA")
x, y = index % 8 * 512, index // 8 * 512
image = source.crop((x, y, x + 512, y + 512))
image.save(root / "references/foreman-whip-open-frame22.png")
bbox = image.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
body = image.crop(bbox)
scale = 320 / body.height
body = body.resize((round(body.width * scale), 320), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (1280, 960), "white")
canvas.alpha_composite(body, (486 - round((256 - bbox[0]) * scale), 630 - body.height))
canvas.convert("RGB").save(root / "references/foreman-whip-wide-v03.png")
print(json.dumps({"frame": index, "bbox": bbox, "scale": scale, "canvas": [1280, 960]}))
