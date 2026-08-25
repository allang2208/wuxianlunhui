#!/usr/bin/env python3
"""Prepare true-alpha mothers and green-screen MiniMax H3 first frames."""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
TOOLS = REPO / "tools" / "ai-gen"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))

from rmbg_cutout import get_model, predict_alpha  # noqa: E402


CANVAS = (1024, 576)
GREEN = (0, 255, 0, 255)
SPECS = {
    "cowherd": {
        "source": ROOT / "mother" / "cowherd_mother_v01.png",
        "transparent": ROOT / "mother" / "cowherd_mother_v01_transparent.png",
        "reference": ROOT / "references" / "cowherd_h3_green.png",
        "maxWidth": 620,
        "maxHeight": 460,
        "feetY": 528,
    },
    "cowherd_carrying_cheese": {
        "source": ROOT / "mother" / "cowherd_carrying_cheese_mother_v01.png",
        "transparent": ROOT / "mother" / "cowherd_carrying_cheese_mother_v01_transparent.png",
        "reference": ROOT / "references" / "cowherd_carrying_cheese_h3_green.png",
        "maxWidth": 620,
        "maxHeight": 460,
        "feetY": 528,
        "whiteMatte": False,
    },
    "holstein_cow": {
        "source": ROOT / "mother" / "holstein_cow_mother_v01.png",
        "transparent": ROOT / "mother" / "holstein_cow_mother_v01_transparent.png",
        "reference": ROOT / "references" / "holstein_cow_h3_green.png",
        "maxWidth": 600,
        "maxHeight": 390,
        "feetY": 500,
    },
}


def decontaminate_white(rgb: np.ndarray, alpha: np.ndarray) -> np.ndarray:
    image = rgb.astype(np.float32)
    a = (alpha.astype(np.float32) / 255.0)[..., None]
    foreground = (image - (1.0 - a) * 255.0) / np.maximum(a, 1.0 / 255.0)
    foreground = np.clip(foreground, 0, 255).astype(np.uint8)
    foreground[alpha == 0] = 0
    return foreground


def prepare_subject(source: Path, model, white_matte: bool = True) -> Image.Image:
    rgb_image = Image.open(source).convert("RGB")
    rgb = np.asarray(rgb_image)
    alpha = np.squeeze(np.asarray(predict_alpha(model, rgb_image)))
    if alpha.shape != rgb.shape[:2]:
        alpha = np.asarray(
            Image.fromarray(alpha.astype(np.uint8), "L").resize(
                (rgb.shape[1], rgb.shape[0]), Image.Resampling.BILINEAR
            )
        )
    if alpha.max(initial=0) <= 1.5:
        alpha = alpha * 255.0
    alpha = np.clip(alpha, 0, 255).astype(np.uint8)
    alpha[alpha < 4] = 0
    foreground = decontaminate_white(rgb, alpha) if white_matte else rgb.copy()
    foreground[alpha == 0] = 0
    return Image.fromarray(np.dstack((foreground, alpha)), "RGBA")


def make_reference(subject: Image.Image, max_width: int, max_height: int, feet_y: int) -> Image.Image:
    bbox = subject.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError("BiRefNet produced an empty subject")
    crop = subject.crop(bbox)
    scale = min(max_width / crop.width, max_height / crop.height)
    crop = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    x = (CANVAS[0] - crop.width) // 2
    y = feet_y - crop.height
    if x < 0 or y < 0 or x + crop.width > CANVAS[0] or y + crop.height > CANVAS[1]:
        raise RuntimeError(f"Reference clips canvas: {crop.size} at {(x, y)}")
    canvas = Image.new("RGBA", CANVAS, GREEN)
    canvas.alpha_composite(crop, (x, y))
    return canvas.convert("RGB")


def main() -> None:
    model = get_model()
    contacts = []
    for name, spec in SPECS.items():
        subject = prepare_subject(spec["source"], model, spec.get("whiteMatte", True))
        spec["transparent"].parent.mkdir(parents=True, exist_ok=True)
        subject.save(spec["transparent"], optimize=True)
        reference = make_reference(subject, spec["maxWidth"], spec["maxHeight"], spec["feetY"])
        spec["reference"].parent.mkdir(parents=True, exist_ok=True)
        reference.save(spec["reference"], optimize=True)
        contacts.append((name, reference))
        print(
            f"[cheese-farm-h3] {name}: alphaBBox={subject.getchannel('A').getbbox()} "
            f"reference={spec['reference']}",
            flush=True,
        )

    contact = Image.new("RGB", (CANVAS[0], CANVAS[1] * len(contacts) + 36 * len(contacts)), "#20242a")
    draw = ImageDraw.Draw(contact)
    y = 0
    for name, reference in contacts:
        contact.paste(reference, (0, y))
        draw.text((12, y + CANVAS[1] + 10), name, fill="white")
        y += CANVAS[1] + 36
    preview = ROOT / "previews" / "h3-reference-contact.jpg"
    preview.parent.mkdir(parents=True, exist_ok=True)
    contact.save(preview, quality=94)


if __name__ == "__main__":
    main()
