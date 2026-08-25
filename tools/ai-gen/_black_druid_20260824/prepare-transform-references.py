#!/usr/bin/env python3
"""Prepare matched H3 endpoint frames for black-bear/druid transformations.

The two endpoint subjects share one native H3 1344x768 camera, centre line and foot
line. Their relative heights reproduce the current runtime visual scale so the
transform sheet can bridge the two existing animation sets without a size pop.
"""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
BEAR_SOURCE = ROOT.parent / "_black_bear_20260824" / "mother" / "black-bear-mother-512.png"
DRUID_SOURCE = ROOT / "mother" / "black-druid-mother-angle-v2.png"
OUT_DIR = ROOT / "transform" / "references"

CANVAS_WIDTH = 1344
CANVAS_HEIGHT = 768
FOOT_Y = 700
CENTRE_X = 672
BEAR_HEIGHT = 341
# Runtime-equivalent ratio: (430 * 167.3 / 512) / (262 * 180 / 512).
DRUID_HEIGHT = 520


def alpha_crop(path: Path) -> Image.Image:
    image = Image.open(path).convert("RGBA")
    bbox = image.getchannel("A").getbbox()
    if not bbox:
        raise ValueError(f"empty alpha in {path}")
    return image.crop(bbox)


def endpoint(source: Path, target_height: int) -> tuple[Image.Image, dict]:
    subject = alpha_crop(source)
    scale = target_height / subject.height
    target_width = max(1, round(subject.width * scale))
    subject = subject.resize((target_width, target_height), Image.Resampling.LANCZOS)
    canvas = Image.new("RGB", (CANVAS_WIDTH, CANVAS_HEIGHT), (255, 255, 255))
    x = round(CENTRE_X - target_width / 2)
    y = FOOT_Y - target_height
    canvas.paste(subject.convert("RGB"), (x, y), subject.getchannel("A"))
    return canvas, {
        "source": str(source.relative_to(ROOT.parent.parent)),
        "canvas": [CANVAS_WIDTH, CANVAS_HEIGHT],
        "placedBox": [x, y, x + target_width, y + target_height],
        "centreX": CENTRE_X,
        "footY": FOOT_Y,
    }


def main() -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    outputs = {
        "black-bear-transform-endpoint.png": endpoint(BEAR_SOURCE, BEAR_HEIGHT),
        "black-druid-transform-endpoint.png": endpoint(DRUID_SOURCE, DRUID_HEIGHT),
    }
    for name, (image, stats) in outputs.items():
        image.save(OUT_DIR / name)
        print(name, stats)


if __name__ == "__main__":
    main()
