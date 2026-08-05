from PIL import Image
import os

base = os.path.dirname(os.path.abspath(__file__))
root = os.path.dirname(base)  # game-dev
workspace = os.path.dirname(root)  # 2026-7-13-1
src = os.path.join(workspace, "tools", "verify-shots")
out = os.path.join(src, "crops")
os.makedirs(out, exist_ok=True)

boxes = [
    ("defense-meteor-lava.png", (640, 760, 1280, 1060)),
    ("defense-blizzard.png", (640, 760, 1280, 1060)),
    ("defense-icewall.png", (640, 760, 1280, 1060)),
    ("defense-towers-firing.png", (640, 760, 1280, 1060)),
    ("defense-scene8.png", (640, 760, 1280, 1060)),
]
for name, box in boxes:
    p = os.path.join(src, name)
    if not os.path.exists(p):
        print("missing", name)
        continue
    im = Image.open(p).convert("RGB")
    im.crop(box).save(os.path.join(out, "crop_" + name))
    print("ok", name, im.size)
