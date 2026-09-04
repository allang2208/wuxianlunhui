"""Normalize accepted potion renders into centered 1536px runtime icons."""

import json
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
CANVAS_SIZE = 1536
CONTENT_SIZE = round(CANVAS_SIZE * 0.90)


def normalize(source: Image.Image) -> tuple[Image.Image, tuple[int, int, int, int]]:
    rgba = source.convert("RGBA")
    alpha = rgba.getchannel("A")
    threshold = alpha.point(lambda value: 255 if value > 8 else 0)
    bbox = threshold.getbbox()
    if not bbox:
        raise RuntimeError("Potion icon has no visible alpha content")

    crop = rgba.crop(bbox)
    scale = CONTENT_SIZE / max(crop.size)
    resized = crop.resize(
        (max(1, round(crop.width * scale)), max(1, round(crop.height * scale))),
        Image.Resampling.LANCZOS,
    )
    canvas = Image.new("RGBA", (CANVAS_SIZE, CANVAS_SIZE), (0, 0, 0, 0))
    left = (CANVAS_SIZE - resized.width) // 2
    top = (CANVAS_SIZE - resized.height) // 2
    canvas.alpha_composite(resized, (left, top))
    return canvas, bbox


def main() -> None:
    manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
    records = []
    for spec in manifest["icons"]:
        source_path = ROOT / spec["raw"]
        output_path = PROJECT / spec["runtime"]
        source = Image.open(source_path)
        final, source_bbox = normalize(source)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        final.save(output_path, optimize=True)
        records.append({
            "id": spec["id"],
            "raw": spec["raw"],
            "runtime": spec["runtime"],
            "sourceMode": source.mode,
            "sourceSize": list(source.size),
            "sourceAlphaBBox": list(source_bbox),
            "outputSize": list(final.size),
            "outputAlphaBBox": list(final.getchannel("A").getbbox()),
        })

    (ROOT / "runtime-metadata.json").write_text(
        json.dumps(records, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps(records, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
