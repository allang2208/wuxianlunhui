#!/usr/bin/env python3
"""Create compact review sheets from World-122 building approval previews."""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--pattern", default="*_preview.png")
    args = parser.parse_args()
    out = args.out or args.root / "contact_sheets"
    out.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default()
    entries = []
    for building in sorted(p for p in args.root.iterdir() if p.is_dir()):
        for preview in sorted(building.glob(args.pattern)):
            entries.append((building.name, preview))
    tile_w, tile_h, label_h = 512, 548, 36
    per_page = 8
    for page_start in range(0, len(entries), per_page):
        page_entries = entries[page_start:page_start + per_page]
        page = Image.new("RGB", (tile_w * 2, tile_h * 4), (20, 20, 20))
        draw = ImageDraw.Draw(page)
        for idx, (building, path) in enumerate(page_entries):
            x = (idx % 2) * tile_w
            y = (idx // 2) * tile_h
            image = Image.open(path).convert("RGBA")
            image.thumbnail((tile_w - 20, tile_h - label_h - 14), Image.Resampling.LANCZOS)
            px = x + (tile_w - image.width) // 2
            py = y + label_h + (tile_h - label_h - image.height) // 2
            page.paste(Image.new("RGB", image.size, (0, 0, 0)), (px, py))
            page.paste(image, (px, py), image)
            draw.text((x + 12, y + 10), f"{building} / {path.stem}", fill=(240, 240, 240), font=font)
        target = out / f"page_{page_start // per_page + 1:02d}.png"
        page.save(target)
        print(target)


if __name__ == "__main__":
    main()
