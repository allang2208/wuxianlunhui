from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent
image = Image.open(root / "references/foreman-whip-open-frame22.png").convert("RGBA")
bbox = image.getchannel("A").point(lambda a: 255 if a > 16 else 0).getbbox()
body = image.crop(bbox)
scale = 320 / body.height
body = body.resize((round(body.width * scale), 320), Image.Resampling.LANCZOS)
canvas = Image.new("RGBA", (2240, 960), "white")
canvas.alpha_composite(body, (760 - round((256 - bbox[0]) * scale), 630 - body.height))
canvas.convert("RGB").save(root / "references/foreman-whip-wide-v04.png")
text = (root / "prompts/whip-v03.txt").read_text(encoding="utf-8")
text = text.replace("5秒，4:3", "5秒，21:9超宽画幅")
text = text.replace("人物高度不超过画面高度40%", "人物高度不超过画面高度35%")
text = text.replace("画面宽度约38%", "画面宽度约34%")
text = "本次必须保留参考图的超宽左右留白，尤其画面右方至少60%的宽度是空白。这些空白用于容纳甩鞭峰值，不能裁掉空白或放大人物。\n\n" + text
(root / "prompts/whip-v04.txt").write_text(text, encoding="utf-8")
