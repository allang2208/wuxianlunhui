#!/usr/bin/env python3
"""Apply the fixed cavalry-school crystal rank badge to every recruitment icon."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
RUNTIME = PROJECT / "assets" / "ui" / "technology-icons"
THATCH_FINALIZER = ROOT.parent / "_thatch_hut_tier_icons_20260826" / "finalize_icons.py"
REFERENCE = RUNTIME / "cavalry_school_level_3.png"

FAMILIES = (
    "thatch_hut",
    "hamster_barracks",
    "shooting_range",
    "cavalry_school",
    "church",
)


def load_thatch_finalizer():
    spec = spec_from_file_location("world122_recruitment_icon_finalizer", THATCH_FINALIZER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load crystal template: {THATCH_FINALIZER}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def marker_already_present(icon: Image.Image, marker: Image.Image, position: tuple[int, int]) -> bool:
    x, y = position
    target = np.asarray(icon.crop((x, y, x + marker.width, y + marker.height)).convert("RGBA"))
    source = np.asarray(marker.convert("RGBA"))
    # Compare only fully opaque pixels.  Feathered edge pixels are intentionally
    # alpha-composited with each icon's own background and therefore differ.
    opaque = source[:, :, 3] == 255
    if not np.any(opaque):
        return False
    return bool(np.max(np.abs(
        target[:, :, :3][opaque].astype(np.int16)
        - source[:, :, :3][opaque].astype(np.int16)
    )) <= 1)


def main() -> None:
    template = load_thatch_finalizer()
    crystal_parts = template.extract_crystals(Image.open(REFERENCE).convert("RGBA"))

    for family in FAMILIES:
        for tier in (1, 2, 3):
            path = RUNTIME / f"{family}_level_{tier}.png"
            icon = Image.open(path).convert("RGBA")
            changed = False
            for marker_name in template.TIER_MARKERS[tier]:
                marker, position = crystal_parts[marker_name]
                if marker_already_present(icon, marker, position):
                    continue
                icon.alpha_composite(marker, position)
                changed = True
            if changed:
                icon.save(path, optimize=True)
                print(f"updated {path.name}")
            else:
                print(f"kept {path.name}")


if __name__ == "__main__":
    main()
