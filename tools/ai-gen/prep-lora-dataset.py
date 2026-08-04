#!/usr/bin/env python3
"""Prepare the Klein 4B style-LoRA training set from the in-repo skill icons.

- Selects the hexagonal-badge skill icon series (fireball / meteor / flame armor /
  blizzard + ice wall / lightning / holy light candidates).
- Composites the transparent RGBA icons onto a plain pure white background
  (matches the established "isolated on a plain pure white background" prompt
  style so training and inference prompts stay isomorphic).
- Writes caption .txt per image following prompts/skill-icon.md structure, each
  starting with the trigger token "wuxianlunhui magic skill icon".

Output layout (AI-Toolkit / kohya compatible):
    <out>/dataset/00001.png + 00001.txt ...
"""

import os
import shutil

from PIL import Image

SKILLS_DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\game-dev\assets\skills"
OUT_ROOT = r"Y:\工作\无尽轮回\scratch\klein-lora-skillicon"
TRIGGER = "wuxianlunhui magic skill icon"

STYLE_BASE = (
    "game skill icon emblem, purple hexagonal badge with gold trim and embossed "
    "translucent crystal block base at the bottom, the center shows "
)
STYLE_TAIL = (
    ", centered, game asset art, high detail, crisp, "
    "isolated on a plain pure white background"
)

# (filename, theme description)
TRAIN_SET = [
    ("fireball_icon.png",
     "a blazing fireball with swirling orange and yellow flames, a floating fire orb"),
    ("陨星坠落.png",
     "a massive dark volcanic meteor rock falling diagonally, charred black stone with "
     "glowing orange lava cracks, long fiery tail and ember sparks trailing behind"),
    ("灼锋焰甲.png",
     "a flaming sword wrapped in roaring fire, ember sparks around the blade"),
    ("blizzard_icon.png",
     "swirling blizzard snowstorm, spiral vortex of white snowflakes and icy blue wind, "
     "frost mist and small ice shards, glowing icy blue highlights"),
    ("冰墙.png",
     "a thick translucent ice wall with sharp crystal edges, frost patterns and icy blue glow"),
    ("闪电.png",
     "a jagged lightning bolt striking down, electric blue-white glow and spark arcs"),
    ("圣光.png",
     "a radiant beam of holy light from above, golden-white rays and a soft glowing halo"),
]


def main():
    dataset_dir = os.path.join(OUT_ROOT, "dataset")
    os.makedirs(dataset_dir, exist_ok=True)

    for idx, (fname, theme) in enumerate(TRAIN_SET, start=1):
        src = os.path.join(SKILLS_DIR, fname)
        if not os.path.exists(src):
            print(f"SKIP missing: {fname}")
            continue

        im = Image.open(src).convert("RGBA")
        canvas = Image.new("RGB", im.size, (255, 255, 255))
        canvas.paste(im, mask=im.split()[3])

        stem = f"{idx:05d}"
        img_out = os.path.join(dataset_dir, f"{stem}.png")
        txt_out = os.path.join(dataset_dir, f"{stem}.txt")

        canvas.save(img_out, "PNG")
        caption = f"{TRIGGER}, {STYLE_BASE}{theme}{STYLE_TAIL}"
        with open(txt_out, "w", encoding="utf-8") as fh:
            fh.write(caption + "\n")
        print(f"{stem}  {fname:<20} {im.size[0]}x{im.size[1]}  {caption[:70]}...")

    print(f"\ndone -> {dataset_dir}")
    print(f"images: {len([f for f in os.listdir(dataset_dir) if f.endswith('.png')])}")


if __name__ == "__main__":
    main()
