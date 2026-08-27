#!/usr/bin/env python3
"""Prepare fixed-scale v03 RedWolfKing werewolf references for H3 video generation."""

from pathlib import Path

import numpy as np
from PIL import Image


HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / "_red_wolf_king_style_refresh_20260827" / "red-werewolf-mother-v03-druid-medusa-realistic.png"
MASK = HERE / "references" / "red-werewolf-v03-alpha.png"
CUTOUT = HERE / "references" / "red-werewolf-v03-cutout-rgba.png"
WHITE_WIDE = HERE / "references" / "red-werewolf-v03-white-1024x576.png"
CYAN_WIDE = HERE / "references" / "red-werewolf-v03-cyan-1024x576.png"
ATTACK_CYAN = HERE / "references" / "red-werewolf-v03-attack-cyan-1024x576.png"


def place_wide(source: Image.Image, output: Path, max_height: int, max_width: int,
               background: str, center_x: int = 512) -> None:
    bbox = source.getchannel("A").getbbox()
    if not bbox:
        raise RuntimeError(f"empty alpha source: {source}")
    subject = source.crop(bbox)
    scale = min(max_height / subject.height, max_width / subject.width)
    size = (round(subject.width * scale), round(subject.height * scale))
    subject = subject.resize(size, Image.Resampling.LANCZOS)
    x = round(center_x - subject.width / 2)
    y = (576 - subject.height) // 2
    canvas = Image.new("RGB", (1024, 576), background)
    canvas.paste(subject.convert("RGB"), (x, y), subject.getchannel("A"))
    canvas.save(output)
    print(f"saved {output} content={subject.width}x{subject.height} at ({x},{y})")


def main() -> None:
    source = Image.open(SOURCE).convert("RGB")
    alpha_image = Image.open(MASK).convert("L")
    if source.size != alpha_image.size:
        raise RuntimeError(f"source/mask size mismatch: {source.size} vs {alpha_image.size}")

    rgb = np.asarray(source, dtype=np.float32)
    alpha_u8 = np.asarray(alpha_image, dtype=np.uint8)
    alpha = alpha_u8.astype(np.float32) / 255.0
    clean = rgb.copy()
    semi = (alpha > 0.02) & (alpha < 0.98)
    if semi.any():
        af = alpha[semi, None]
        clean[semi] = np.clip((clean[semi] - (1.0 - af) * 255.0) / af, 0, 255)
    clean[alpha <= 0.02] = 0
    alpha_u8 = np.where(alpha <= 0.02, 0, alpha_u8).astype(np.uint8)
    rgba = Image.fromarray(np.dstack((clean.astype(np.uint8), alpha_u8)), "RGBA")
    rgba.save(CUTOUT)

    place_wide(rgba, WHITE_WIDE, max_height=316, max_width=560, background="white")
    place_wide(rgba, CYAN_WIDE, max_height=316, max_width=560, background="#00E5FF")
    place_wide(rgba, ATTACK_CYAN, max_height=270, max_width=430,
               background="#00E5FF", center_x=365)
    print(f"saved cutout={CUTOUT} bbox={rgba.getchannel('A').getbbox()}")


if __name__ == "__main__":
    main()
