#!/usr/bin/env python3
"""Finalize the defense-tower cold-steel icon family and optionally promote it."""

from __future__ import annotations

import argparse
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
RAW = ROOT / "raw"
CANDIDATES = ROOT / "candidates"
PREVIEWS = ROOT / "previews"
FORMAL = PROJECT / "assets" / "ui" / "tower" / "cold-steel"
RUNTIME = PROJECT / "assets" / "ui" / "runtime-icons" / "ui" / "tower" / "cold-steel"
SHARED_FINALIZER = (
    PROJECT
    / "tools"
    / "ai-gen"
    / "_field_hospital_icons_20260824"
    / "finalize_icons.py"
)

ICONS = (
    ("tower-chip-strength", "STRENGTH"),
    ("tower-chip-dexterity", "DEXTERITY"),
    ("tower-chip-constitution", "CONSTITUTION"),
    ("tower-chip-intelligence", "INTELLIGENCE"),
    ("tower-chip-spirit", "SPIRIT"),
    ("tower-chip-luck", "LUCK"),
    ("tower-module-damage", "DAMAGE"),
    ("tower-module-range", "RANGE"),
    ("tower-module-attspd", "RAPID FIRE"),
    ("tower-module-reload", "RELOAD"),
    ("tower-module-overheat", "OVERHEAT"),
    ("tower-module-cooling", "COOLING"),
)

MASTER_NAME = "tower-chip-strength"


def compose_on_master_frame(master: Image.Image, subject: Image.Image) -> Image.Image:
    """Keep one exact frame while replacing only the central circular artwork."""
    if subject.size != master.size:
        subject = subject.resize(master.size, Image.Resampling.LANCZOS)
    width, height = master.size
    inset = round(min(width, height) * 0.127)
    mask = Image.new("L", master.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((inset, inset, width - inset, height - inset), fill=255)
    mask = mask.filter(ImageFilter.GaussianBlur(round(min(width, height) * 0.008)))
    return Image.composite(subject.convert("RGB"), master.convert("RGB"), mask)


def load_shared_finalizer():
    spec = spec_from_file_location("field_hospital_icon_finalizer", SHARED_FINALIZER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load shared finalizer: {SHARED_FINALIZER}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def alpha_bbox(image: Image.Image) -> tuple[int, int, int, int]:
    alpha = np.asarray(image.getchannel("A"))
    ys, xs = np.where(alpha > 8)
    if not len(xs):
        raise RuntimeError("empty alpha mask")
    return int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1


def make_contact_sheet(finals: list[tuple[str, str, Image.Image]]) -> Image.Image:
    columns = 4
    cell_w = 244
    cell_h = 272
    pad = 22
    rows = (len(finals) + columns - 1) // columns
    sheet = Image.new(
        "RGBA",
        (pad * 2 + columns * cell_w, pad * 2 + rows * cell_h),
        (9, 12, 15, 255),
    )
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default(size=16)
    for index, (name, label, icon) in enumerate(finals):
        col = index % columns
        row = index // columns
        left = pad + col * cell_w
        top = pad + row * cell_h
        draw.rounded_rectangle(
            (left + 6, top + 6, left + cell_w - 6, top + cell_h - 6),
            radius=12,
            fill=(16, 20, 25, 255),
            outline=(52, 65, 75, 255),
            width=2,
        )
        preview = icon.resize((209, 209), Image.Resampling.LANCZOS)
        sheet.alpha_composite(preview, (left + (cell_w - 209) // 2, top + 16))
        text_box = draw.textbbox((0, 0), label, font=font)
        text_w = text_box[2] - text_box[0]
        draw.text(
            (left + (cell_w - text_w) // 2, top + 236),
            label,
            font=font,
            fill=(217, 224, 229, 255),
        )
    return sheet


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--promote",
        action="store_true",
        help="replace formal tower icons and their 128px runtime mirrors",
    )
    args = parser.parse_args()

    shared = load_shared_finalizer()
    CANDIDATES.mkdir(parents=True, exist_ok=True)
    PREVIEWS.mkdir(parents=True, exist_ok=True)

    master = Image.open(RAW / f"{MASTER_NAME}-raw.png").convert("RGB")
    finals: list[tuple[str, str, Image.Image]] = []
    for name, label in ICONS:
        generated = Image.open(RAW / f"{name}-raw.png").convert("RGB")
        source = master if name == MASTER_NAME else compose_on_master_frame(master, generated)
        final = shared.normalize(shared.cut_canvas(source, "black"), 209, 199)
        candidate = CANDIDATES / f"{name}.png"
        final.save(candidate, optimize=True)
        finals.append((name, label, final))
        bbox = alpha_bbox(final)
        print(f"{name}: size={final.size} bbox={bbox}")

        if args.promote:
            FORMAL.mkdir(parents=True, exist_ok=True)
            RUNTIME.mkdir(parents=True, exist_ok=True)
            final.save(FORMAL / f"{name}.png", optimize=True)
            runtime = final.resize((128, 128), Image.Resampling.LANCZOS)
            runtime.save(RUNTIME / f"{name}.png", optimize=True)

    contact = make_contact_sheet(finals)
    contact_path = PREVIEWS / "defense-tower-cold-steel-icons-contact.png"
    contact.save(contact_path, optimize=True)
    print(contact_path)


if __name__ == "__main__":
    main()
