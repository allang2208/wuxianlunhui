#!/usr/bin/env python3
"""Build transparent representative-frame reviews for tail-removal feasibility."""

from __future__ import annotations

import argparse
import importlib.util
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
BASE_BUILDER = REPO / "tools" / "ai-gen" / "_hamster_sniper_20260826" / "build-sniper-source-sheets.py"
SPEC = importlib.util.spec_from_file_location("trench_tail_review_base", BASE_BUILDER)
if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Cannot import {BASE_BUILDER}")
BASE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = BASE
SPEC.loader.exec_module(BASE)

OUT = ROOT / "previews" / "tail-salvage"
SPECS = {
    "running-h3-v03-motion-transfer": (0, 20, 40, 60, 80, 100, 123),
    "running-doubao-v04-movement-only": (0, 20, 40, 60, 80, 100, 120),
    "attacking-h3-v03-motion-transfer": (0, 24, 44, 60, 83, 107, 123),
}


def checker_preview(rgba: np.ndarray) -> Image.Image:
    image = Image.fromarray(rgba, "RGBA")
    checker = Image.new("RGB", image.size, (218, 218, 218))
    draw = ImageDraw.Draw(checker)
    step = 32
    for y in range(0, image.height, step):
        for x in range(0, image.width, step):
            if ((x // step) + (y // step)) % 2:
                draw.rectangle((x, y, x + step - 1, y + step - 1), fill=(242, 242, 242))
    checker.paste(image.convert("RGB"), mask=image.getchannel("A"))
    return checker


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--stem", action="append", choices=tuple(SPECS))
    args = parser.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)
    model = BASE.BASE.get_model()
    selected = args.stem or list(SPECS)
    for stem in selected:
        indices = SPECS[stem]
        frames, _fps = BASE.BASE.decode_video(ROOT / "videos" / f"{stem}.mp4")
        previews: list[Image.Image] = []
        for index in indices:
            rgba = BASE.BASE.cutout_rgba(frames[index], model)
            rgba[rgba[..., 3] == 0, :3] = 0
            Image.fromarray(rgba, "RGBA").save(OUT / f"{stem}-f{index:03d}.png")
            preview = checker_preview(rgba)
            preview.thumbnail((448, 256), Image.Resampling.LANCZOS)
            previews.append(preview)
            print(f"[tail-salvage] {stem} f{index}", flush=True)
        width = 448 * len(previews)
        contact = Image.new("RGB", (width, 286), (24, 24, 24))
        draw = ImageDraw.Draw(contact)
        for column, (index, preview) in enumerate(zip(indices, previews)):
            x = column * 448 + (448 - preview.width) // 2
            contact.paste(preview, (x, 0))
            draw.text((column * 448 + 8, 264), f"frame {index}", fill=(255, 255, 255))
        contact.save(OUT / f"{stem}-transparent-contact.png", optimize=True)


if __name__ == "__main__":
    main()
