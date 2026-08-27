#!/usr/bin/env python3
"""Finalize the generated warehouse-level icon with the shared cold-steel icon pipeline."""

from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
SHARED_FINALIZER = PROJECT / "tools" / "ai-gen" / "_field_hospital_icons_20260824" / "finalize_icons.py"
RAW = ROOT / "warehouse-level-expansion-raw.png"
OUTPUT = PROJECT / "assets" / "ui" / "building-upgrades" / "warehouse-level-expansion.png"


def load_shared_finalizer():
    spec = spec_from_file_location("field_hospital_icon_finalizer", SHARED_FINALIZER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load shared finalizer: {SHARED_FINALIZER}")
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main() -> None:
    shared = load_shared_finalizer()
    source = Image.open(RAW)
    final = shared.normalize(shared.cut_canvas(source, "black"), 256, 244)
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    final.save(OUTPUT, optimize=True)
    print(OUTPUT)


if __name__ == "__main__":
    main()
