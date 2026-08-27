from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
SRC = ROOT / "zombie-dog-idle-generated-v3-realistic-alpha-candidate.png"
MASK = ROOT / "zombie-dog-idle-generated-v3-realistic-alpha.png"
CUTOUT = ROOT / "zombie-dog-idle-mother-v3-realistic.png"
VIDEO_DIR = ROOT / "video"
H3_FRAME = VIDEO_DIR / "zombie-dog-h3-white.png"


def main():
    rgb = Image.open(SRC).convert("RGB")
    alpha = Image.open(MASK).convert("L")
    if alpha.size != rgb.size:
        alpha = alpha.resize(rgb.size, Image.Resampling.LANCZOS)

    rgba = rgb.convert("RGBA")
    rgba.putalpha(alpha)
    rgba.save(CUTOUT)

    a = np.asarray(alpha)
    ys, xs = np.where(a > 10)
    if len(xs) == 0:
        raise RuntimeError("BiRefNet mask is empty")
    bbox = (int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1)
    subject = rgba.crop(bbox)

    canvas_w, canvas_h = 1344, 768
    target_h = 560
    foot_y = 710
    scale = target_h / subject.height
    target_w = round(subject.width * scale)
    if target_w > 1160:
        scale = 1160 / subject.width
        target_w = 1160
        target_h = round(subject.height * scale)
    subject = subject.resize((target_w, target_h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", (canvas_w, canvas_h), "white")
    x = (canvas_w - target_w) // 2
    y = foot_y - target_h
    canvas.paste(subject.convert("RGB"), (x, y), subject.getchannel("A"))
    VIDEO_DIR.mkdir(parents=True, exist_ok=True)
    canvas.save(H3_FRAME)

    print({
        "source_size": rgb.size,
        "alpha_bbox": bbox,
        "alpha_pixels": int((a > 10).sum()),
        "h3_subject_size": (target_w, target_h),
        "h3_origin": (x, y),
        "h3_foot_y": foot_y,
    })


if __name__ == "__main__":
    main()
