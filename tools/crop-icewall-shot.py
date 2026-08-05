from PIL import Image
import os

base = os.path.dirname(os.path.abspath(__file__))
gd = os.path.dirname(base)
src = os.path.join(gd, "tools", "verify-shots", "layer-audit")
out = os.path.join(src, "crops")
os.makedirs(out, exist_ok=True)

for name in ["defense-icewall-on-gate.png", "defense-overview.png"]:
    p = os.path.join(src, name)
    if not os.path.exists(p):
        print("missing", name)
        continue
    im = Image.open(p).convert("RGB")
    w, h = im.size
    # 下半部分（沙袋墙与门口区域）
    im.crop((0, int(h * 0.62), w, h)).save(os.path.join(out, "crop_" + name))
    print("ok", name, im.size)
