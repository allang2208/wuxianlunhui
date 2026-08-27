#!/usr/bin/env python3
"""Finalize thatch-hut recruitment tier icons with deterministic crystal markers."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
RAW = ROOT / "raw"
RUNTIME = PROJECT / "assets" / "ui" / "technology-icons"
REFERENCE = RUNTIME / "cavalry_school_level_3.png"
SHARED_FINALIZER = ROOT.parent / "_technology_tree_gap_icons_20260826" / "finalize_icons.py"

TIERS = (1, 2, 3)

# Exact silhouettes and positions from cavalry_school_level_3.png.  Level I uses
# the lower center crystal, level II the two shoulder crystals, and level III
# the complete three-crystal arrangement.  Keeping this as code makes the
# recruitment-building tier marker independent from image-generation variance.
CRYSTALS = {
    "left": {
        "box": (332, 736, 436, 875),
        "polygon": ((52, 1), (102, 48), (98, 94), (52, 138), (1, 94), (1, 48)),
        "position": (332, 736),
    },
    "center": {
        "box": (457, 799, 567, 943),
        "polygon": ((55, 1), (109, 50), (105, 98), (55, 143), (1, 98), (1, 50)),
        "position": (457, 799),
    },
    "right": {
        "box": (588, 736, 692, 875),
        "polygon": ((52, 1), (103, 48), (103, 94), (52, 138), (1, 94), (1, 48)),
        "position": (588, 736),
    },
}

TIER_MARKERS = {
    1: ("center",),
    2: ("left", "right"),
    3: ("left", "center", "right"),
}


def load_shared_finalizer():
    spec = spec_from_file_location("world122_technology_icon_finalizer", SHARED_FINALIZER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load shared finalizer: {SHARED_FINALIZER}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def extract_crystals(reference: Image.Image) -> dict[str, tuple[Image.Image, tuple[int, int]]]:
    crystals = {}
    for name, config in CRYSTALS.items():
        crop = reference.crop(config["box"]).convert("RGBA")
        mask = Image.new("L", crop.size, 0)
        ImageDraw.Draw(mask).polygon(config["polygon"], fill=255)
        crop.putalpha(mask.filter(ImageFilter.GaussianBlur(0.65)))
        crystals[name] = (crop, config["position"])
    return crystals


def main() -> None:
    finalizer = load_shared_finalizer()
    crystals = extract_crystals(Image.open(REFERENCE).convert("RGBA"))
    RUNTIME.mkdir(parents=True, exist_ok=True)

    for tier in TIERS:
        name = f"thatch_hut_level_{tier}"
        source = Image.open(RAW / f"{name}_raw.png")
        icon = finalizer.normalize(finalizer.cut_hex_badge(source, "checker"))
        for marker_name in TIER_MARKERS[tier]:
            marker, position = crystals[marker_name]
            icon.alpha_composite(marker, position)
        icon.save(RUNTIME / f"{name}.png", optimize=True)


if __name__ == "__main__":
    main()
