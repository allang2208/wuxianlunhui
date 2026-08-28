#!/usr/bin/env python3
"""Refresh Falcon Edict runtime texture and the Falcon panels in existing previews."""

from __future__ import annotations

from pathlib import Path

from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parents[5]
HELD = ROOT / "assets/weapons/falcon-edict-equip.png"
ICON = ROOT / "assets/icons/firearms/falcon-edict.png"
RUNTIME = ROOT / "assets/weapons/runtime/weapons/falcon-edict-equip.png"
PREVIEW_DIR = ROOT / "tools/ai-gen/weapon-gen/mythic-pistols-20260828"


def paste_canvas(
    preview: Image.Image,
    source: Image.Image,
    clear_box: tuple[int, int, int, int],
    canvas_size: int,
) -> None:
    x0, y0, x1, y1 = clear_box
    background = preview.getpixel((x0 + 4, y0 + 4))
    ImageDraw.Draw(preview).rectangle(clear_box, fill=background)
    rendered = source.resize((canvas_size, canvas_size), Image.Resampling.LANCZOS)
    x = x0 + ((x1 - x0) - canvas_size) // 2
    y = y0 + ((y1 - y0) - canvas_size) // 2
    preview.alpha_composite(rendered, (x, y))


def main() -> None:
    held = Image.open(HELD).convert("RGBA")
    icon = Image.open(ICON).convert("RGBA")

    RUNTIME.parent.mkdir(parents=True, exist_ok=True)
    held.resize((512, 512), Image.Resampling.LANCZOS).save(RUNTIME, optimize=True)

    overview_path = PREVIEW_DIR / "mythic-pistols-preview.png"
    overview = Image.open(overview_path).convert("RGBA")
    paste_canvas(overview, held, (920, 100, 1759, 419), 400)
    paste_canvas(overview, icon, (430, 550, 779, 809), 300)
    overview.save(overview_path, optimize=True)

    angle_path = PREVIEW_DIR / "angle-correction-preview.png"
    angle = Image.open(angle_path).convert("RGBA")
    paste_canvas(angle, icon, (800, 460, 1339, 804), 360)
    angle.save(angle_path, optimize=True)

    print(f"runtime -> {RUNTIME} {Image.open(RUNTIME).size}")
    print(f"preview -> {overview_path}")
    print(f"preview -> {angle_path}")


if __name__ == "__main__":
    main()
