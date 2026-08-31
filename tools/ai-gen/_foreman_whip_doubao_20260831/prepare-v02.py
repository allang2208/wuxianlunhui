from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
image = Image.open(root / "references/foreman-idle-master.png").convert("RGBA")
body = image.crop(image.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox())
body = body.resize((round(body.width * 225 / body.height), 225), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (1680, 720), "white")
canvas.alpha_composite(body, (620 - body.width // 2, 455 - body.height))
canvas.convert("RGB").save(root / "references/foreman-whip-wide-v02.png")
