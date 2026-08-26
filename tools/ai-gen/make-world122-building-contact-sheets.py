#!/usr/bin/env python3
"""Create compact review sheets from World-122 building approval previews."""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


def checkerboard(size, cell=24):
    """Neutral review matte that keeps both pale walls and dark iron visible."""
    image = Image.new("RGB", size, (112, 118, 124))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], cell):
        for x in range(0, size[0], cell):
            if (x // cell + y // cell) % 2:
                draw.rectangle((x, y, min(x + cell - 1, size[0] - 1),
                                min(y + cell - 1, size[1] - 1)),
                               fill=(142, 148, 154))
    return image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--pattern", default="*_preview.png")
    parser.add_argument("--flat", action="store_true",
                        help="collect matching previews directly from root instead of its child directories")
    parser.add_argument("--remove-all-green", action="store_true",
                        help="remove HSV-green interpolation residue from the rendered sheet")
    parser.add_argument("--checkerboard", action="store_true",
                        help="composite transparent previews over a neutral checkerboard instead of black")
    args = parser.parse_args()
    out = args.out or args.root / "contact_sheets"
    out.mkdir(parents=True, exist_ok=True)
    font = ImageFont.load_default()
    entries = []
    if args.flat:
        entries.extend((args.root.name, preview) for preview in sorted(args.root.glob(args.pattern)))
    else:
        for building in sorted(p for p in args.root.iterdir() if p.is_dir()):
            for preview in sorted(building.glob(args.pattern)):
                entries.append((building.name, preview))
    tile_w, tile_h, label_h = 512, 548, 36
    per_page = 8
    for page_start in range(0, len(entries), per_page):
        page_entries = entries[page_start:page_start + per_page]
        page_rows = max(1, (len(page_entries) + 1) // 2)
        page = Image.new("RGB", (tile_w * 2, tile_h * page_rows), (20, 20, 20))
        draw = ImageDraw.Draw(page)
        for idx, (building, path) in enumerate(page_entries):
            x = (idx % 2) * tile_w
            y = (idx // 2) * tile_h
            image = Image.open(path).convert("RGBA")
            image.thumbnail((tile_w - 20, tile_h - label_h - 14), Image.Resampling.LANCZOS)
            px = x + (tile_w - image.width) // 2
            py = y + label_h + (tile_h - label_h - image.height) // 2
            matte = checkerboard(image.size) if args.checkerboard else Image.new("RGB", image.size, (0, 0, 0))
            page.paste(matte, (px, py))
            page.paste(image, (px, py), image)
            draw.text((x + 12, y + 10), f"{building} / {path.stem}", fill=(240, 240, 240), font=font)
        if args.remove_all_green:
            rgb = np.asarray(page).copy()
            hsv = np.asarray(page.convert("HSV"))
            hue = hsv[..., 0].astype(np.float32) * (179.0 / 255.0)
            green = ((hue >= 35.0) & (hue <= 90.0)
                     & (hsv[..., 1] >= 24) & (hsv[..., 2] >= 24))
            rgb[green] = (20, 20, 20)
            page = Image.fromarray(rgb, "RGB")
        target = out / f"page_{page_start // per_page + 1:02d}.png"
        page.save(target)
        print(target)


if __name__ == "__main__":
    main()
