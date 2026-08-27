#!/usr/bin/env python3
"""Build true-alpha v2 boiler-worker mothers and normalized white references."""

from pathlib import Path
import sys

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parent
sys.path.insert(0, str(TOOLS))

from rmbg_cutout import get_model, predict_alpha  # noqa: E402


MOTHERS = ROOT / "mothers"
REFERENCES = ROOT / "references"
PREVIEWS = ROOT / "previews"

CANVAS = 1024
BODY_HEIGHT = 760
FEET_Y = 890

SOURCES = {
    "empty": MOTHERS / "hamster-boiler-worker-v2-white-raw.png",
    "food": MOTHERS / "hamster-boiler-worker-v2-food-white-raw.png",
    "energy": MOTHERS / "hamster-boiler-worker-v2-energy-white-raw.png",
}


def decontaminate_white(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    """Reverse white-matte compositing at soft subject edges."""
    image = rgb.astype(np.float32)
    a = (alpha.astype(np.float32) / 255.0)[..., None]
    foreground = (image - (1.0 - a) * 255.0) / np.maximum(a, 1.0 / 255.0)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    foreground[alpha == 0] = 0
    return foreground


def transparent_path(name: str) -> Path:
    suffix = "" if name == "empty" else f"-{name}"
    return MOTHERS / f"hamster-boiler-worker-v2{suffix}-transparent.png"


def normalized_reference(image: Image.Image) -> Image.Image:
    bbox = image.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("BiRefNet produced an empty subject")
    subject = image.crop(bbox)
    scale = min(760 / subject.width, BODY_HEIGHT / subject.height)
    subject = subject.resize(
        (max(1, round(subject.width * scale)), max(1, round(subject.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (CANVAS, CANVAS), (255, 255, 255, 255))
    canvas.alpha_composite(subject, ((CANVAS - subject.width) // 2, FEET_Y - subject.height))
    return canvas.convert("RGB")


def main() -> None:
    REFERENCES.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(parents=True, exist_ok=True)
    model = get_model()
    references: dict[str, Image.Image] = {}

    for name, source in SOURCES.items():
        rgb_image = Image.open(source).convert("RGB")
        rgb = np.asarray(rgb_image)
        alpha = predict_alpha(model, rgb_image)
        rgba = np.dstack((decontaminate_white(rgb, alpha), alpha)).astype(np.uint8)
        transparent = Image.fromarray(rgba, "RGBA")
        output = transparent_path(name)
        transparent.save(output)
        references[name] = normalized_reference(transparent)
        bbox = transparent.getchannel("A").getbbox()
        print(
            f"[boiler-worker-v2] {name}: mode={transparent.mode} "
            f"alpha={transparent.getchannel('A').getextrema()} bbox={bbox} -> {output}",
            flush=True,
        )

    for name, reference in references.items():
        reference.save(REFERENCES / f"hamster-boiler-worker-v2-{name}-white.png")

    contact = Image.new("RGB", (CANVAS * 3, CANVAS + 64), "#20242a")
    draw = ImageDraw.Draw(contact)
    for index, name in enumerate(("empty", "food", "energy")):
        contact.paste(references[name], (index * CANVAS, 0))
        draw.text((index * CANVAS + 24, CANVAS + 20), name, fill="white")
    contact.save(PREVIEWS / "hamster-boiler-worker-v2-reference-contact.jpg", quality=94)


if __name__ == "__main__":
    main()
