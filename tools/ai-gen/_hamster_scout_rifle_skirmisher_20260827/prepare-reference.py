from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
SOURCE = ROOT / "mother" / "hamster-scout-rifle-skirmisher-standing-v03-candidate.png"
OUTPUT = ROOT / "references" / "hamster-scout-rifle-skirmisher-standing-v03-safe-white-1024x576.png"


def main() -> None:
    image = Image.open(SOURCE).convert("RGB")
    rgb = np.asarray(image)
    subject_mask = np.min(rgb, axis=2) < 248
    ys, xs = np.nonzero(subject_mask)
    if not len(xs):
        raise RuntimeError("mother image has no visible subject")

    margin = 12
    left = max(0, int(xs.min()) - margin)
    top = max(0, int(ys.min()) - margin)
    right = min(image.width, int(xs.max()) + margin + 1)
    bottom = min(image.height, int(ys.max()) + margin + 1)
    subject = image.crop((left, top, right, bottom))

    target_h = 405
    scale = target_h / subject.height
    target_w = round(subject.width * scale)
    if target_w > 880:
        scale = 880 / subject.width
        target_w = round(subject.width * scale)
        target_h = round(subject.height * scale)
    subject = subject.resize((target_w, target_h), Image.Resampling.LANCZOS)

    canvas = Image.new("RGB", (1024, 576), "white")
    x = 170
    y = 515 - target_h
    if x + target_w > 950:
        raise RuntimeError(f"unsafe right margin: x={x} width={target_w}")
    canvas.paste(subject, (x, y))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    canvas.save(OUTPUT)
    print(f"source_bbox={(left, top, right, bottom)} content={target_w}x{target_h} at {(x, y)} -> {OUTPUT}")


if __name__ == "__main__":
    main()
