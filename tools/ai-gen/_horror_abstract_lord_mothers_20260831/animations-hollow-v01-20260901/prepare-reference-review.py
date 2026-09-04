#!/usr/bin/env python3
"""Build the Hollow Ovum H3 safe reference and actual-frame review plate."""

from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[4]
TASK = Path(__file__).resolve().parent
CELL = 512


def frame(sheet_path: str, index: int) -> Image.Image:
    sheet = Image.open(ROOT / sheet_path).convert("RGBA")
    columns = sheet.width // CELL
    left = (index % columns) * CELL
    top = (index // columns) * CELL
    return sheet.crop((left, top, left + CELL, top + CELL))


def fit_preview(image: Image.Image, size: int = 238) -> Image.Image:
    preview = Image.new("RGBA", (size, size), (34, 37, 42, 255))
    copy = image.copy()
    copy.thumbnail((size - 12, size - 12), Image.Resampling.LANCZOS)
    preview.alpha_composite(copy, ((size - copy.width) // 2, (size - copy.height) // 2))
    return preview


def main() -> None:
    references = TASK / "references"
    references.mkdir(parents=True, exist_ok=True)

    mother_path = ROOT / "tools/ai-gen/_horror_abstract_lord_mothers_20260831/mother/hollow-ovum-mother-v02-white.png"
    mother = Image.open(mother_path).convert("RGB")
    safe = Image.new("RGB", (1024, 576), (255, 255, 255))
    # Equal-scale square inset. This keeps the mother's camera geometry intact
    # and gives the hovering shell enough clearance for H3 plate expansion.
    inset = mother.resize((480, 480), Image.Resampling.LANCZOS)
    safe.paste(inset, (272, 48))
    safe_path = references / "hollow-ovum-h3-reference-1024x576.png"
    safe.save(safe_path)

    rows = [
        ("shounao walk", "assets/enemies/shounao/walking.png", [0, 5, 11]),
        ("shounao slam", "assets/enemies/shounao/attacking.png", [0, 14, 25]),
        ("flyhand walk", "assets/enemies/flyhand/walking.png", [0, 7, 15]),
        ("flyhand hammer", "assets/enemies/flyhand/attacking.png", [0, 3, 15]),
    ]
    tile = 238
    label_h = 44
    margin = 22
    width = margin * 2 + tile * 3 + 18 * 2
    height = margin * 2 + len(rows) * (tile + label_h) + 18 * (len(rows) - 1)
    plate = Image.new("RGB", (width, height), (18, 20, 24))
    draw = ImageDraw.Draw(plate)
    font = ImageFont.load_default()
    y = margin
    review = []
    for row_name, sheet_path, indices in rows:
        for column, index in enumerate(indices):
            x = margin + column * (tile + 18)
            rendered = fit_preview(frame(sheet_path, index), tile).convert("RGB")
            plate.paste(rendered, (x, y + label_h))
            draw.text((x, y + 8), f"{row_name} / frame {index}", fill=(232, 235, 240), font=font)
        review.append({"name": row_name, "sheet": sheet_path, "indices": indices, "cell": CELL})
        y += tile + label_h + 18
    plate_path = references / "accepted-horror-frame-review.png"
    plate.save(plate_path)

    record = {
        "mother": str(mother_path.relative_to(ROOT)).replace("\\", "/"),
        "safeReference": str(safe_path.relative_to(ROOT)).replace("\\", "/"),
        "safeReferenceTransform": {
            "sourceCanvas": list(mother.size),
            "targetCanvas": [1024, 576],
            "resize": [480, 480],
            "pasteXY": [272, 48],
            "scaleMode": "equal-scale",
            "background": "#FFFFFF",
        },
        "reviewPlate": str(plate_path.relative_to(ROOT)).replace("\\", "/"),
        "actualFrameReferences": review,
    }
    (references / "reference-review.json").write_text(
        json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(record, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
