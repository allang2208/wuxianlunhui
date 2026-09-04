#!/usr/bin/env python3
"""Composite the accepted no-text grand mall body over the generation key color."""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[4]
SOURCE = (
    ROOT
    / "tools/ai-gen/_settlement_building_pack_20260821/grand_mall"
    / "grand_mall_refine_v02_notext_body.png"
)
OUTPUT = Path(__file__).resolve().parent / "grand_mall_notext_init.png"


def main() -> None:
    body = Image.open(SOURCE).convert("RGBA")
    canvas = Image.new("RGBA", body.size, (0, 255, 0, 255))
    canvas.alpha_composite(body)
    canvas.convert("RGB").save(OUTPUT, optimize=True)
    print(f"prepared {OUTPUT} from {SOURCE}")


if __name__ == "__main__":
    main()
