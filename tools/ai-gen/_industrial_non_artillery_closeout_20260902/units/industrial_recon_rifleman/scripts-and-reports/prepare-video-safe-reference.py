"""Place the approved mother unchanged on a roomier 16:9 white canvas."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent.parent / "mother" / "industrial_recon_rifleman-mother-v02-soviet-mosin.png"
OUTPUT = ROOT / "references" / "industrial-recon-rifleman-video-safe-16x9-v01.png"
CANVAS = (1920, 1080)
CONTENT = (1152, 768)


image = Image.open(SOURCE).convert("RGB")
image.thumbnail(CONTENT, Image.Resampling.LANCZOS)
canvas = Image.new("RGB", CANVAS, "white")
canvas.paste(image, ((CANVAS[0] - image.width) // 2, (CANVAS[1] - image.height) // 2))
OUTPUT.parent.mkdir(parents=True, exist_ok=True)
canvas.save(OUTPUT)
print(f"source={SOURCE} sourceSize={Image.open(SOURCE).size} placed={image.size} canvas={CANVAS} -> {OUTPUT}")
