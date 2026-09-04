"""Build paged checkerboard contacts containing every final sprite frame."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
KINDS = ("idle", "run", "attack", "die")


def checker(cell: Image.Image) -> Image.Image:
    yy, xx = np.indices((cell.height, cell.width))
    shade = np.where((xx // 12 + yy // 12) % 2, 62, 43).astype(np.uint8)
    background = Image.fromarray(np.repeat(shade[..., None], 3, axis=2), "RGB")
    background.paste(cell, (0, 0), cell)
    return background


def main() -> None:
    manifest = json.loads((ROOT / "spritesheet-manifest.json").read_text(encoding="utf-8-sig"))
    output_dir = ROOT / "previews/full-frame-review"
    output_dir.mkdir(parents=True, exist_ok=True)
    report = {"sourceManifest": "spritesheet-manifest.json", "allActiveFramesIncluded": True, "actions": {}}
    for kind in KINDS:
        action = manifest["actions"][kind]
        width, height = action["frameWidth"], action["frameHeight"]
        sheet = Image.open(ROOT / action["sheet"]).convert("RGBA")
        cells = [
            sheet.crop((index % action["cols"] * width, index // action["cols"] * height,
                        index % action["cols"] * width + width, index // action["cols"] * height + height))
            for index in range(action["frameCount"])
        ]
        scale = min(0.62, 210 / width)
        tile_width, tile_height = round(width * scale), round(height * scale)
        per_page, cols = 30, 6
        pages = []
        for page_index, start in enumerate(range(0, len(cells), per_page), 1):
            batch = cells[start : start + per_page]
            rows = math.ceil(len(batch) / cols)
            page = Image.new("RGB", (tile_width * cols, (tile_height + 20) * rows), "#20242a")
            draw = ImageDraw.Draw(page)
            for slot, cell in enumerate(batch):
                frame_index = start + slot
                x, y = slot % cols * tile_width, slot // cols * (tile_height + 20)
                preview = checker(cell).resize((tile_width, tile_height), Image.Resampling.LANCZOS)
                page.paste(preview, (x, y + 20))
                source_type = "key" if frame_index % 2 == 0 else "RIFE"
                draw.text((x + 4, y + 3), f"{kind} f{frame_index:03d} {source_type}", fill="white")
            relative = f"previews/full-frame-review/{kind}-page-{page_index:02d}.png"
            page.save(ROOT / relative)
            pages.append({"path": relative, "firstFrame": start, "lastFrame": start + len(batch) - 1})
        report["actions"][kind] = {"frameCount": len(cells), "pages": pages}
    (ROOT / "full-frame-review.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"Built {sum(len(action['pages']) for action in report['actions'].values())} full-frame review pages.")


if __name__ == "__main__":
    main()
