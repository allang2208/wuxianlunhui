"""Finalize frost smokehouse upgrade badges into runtime RGBA assets."""
import json
import runpy
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
shared = runpy.run_path(str(ROOT.parent / "_royal_mint_icons_20260824/finalize_icons.py"))
specs = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["icons"]
records = []

for spec in specs:
    source = Image.open(ROOT / spec["raw"])
    left, top, right, bottom = shared["find_badge_bounds"](source, spec["background"])
    bevel = round(min(right - left, bottom - top) * 0.11)
    mask = Image.new("L", source.size, 0)
    ImageDraw.Draw(mask).polygon([
        (left + bevel, top), (right - bevel, top),
        (right, top + bevel), (right, bottom - bevel),
        (right - bevel, bottom), (left + bevel, bottom),
        (left, bottom - bevel), (left, top + bevel),
    ], fill=255)
    cutout = source.convert("RGBA")
    cutout.putalpha(mask.filter(ImageFilter.GaussianBlur(0.65)))
    final = shared["normalize"](cutout, 256, 244)
    pixels = np.asarray(final).copy()
    pixels[pixels[:, :, 3] == 0, :3] = 0
    final = Image.fromarray(pixels, "RGBA")

    destination = PROJECT / spec["runtime"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    final.save(destination, optimize=True)

    runtime_icon = PROJECT / "assets/ui/runtime-icons" / Path(spec["runtime"]).relative_to("assets")
    runtime_icon.parent.mkdir(parents=True, exist_ok=True)
    final.resize((128, 128), Image.Resampling.LANCZOS).save(runtime_icon, optimize=True)

    records.append({
        "id": spec["id"],
        "raw": spec["raw"],
        "runtime": spec["runtime"],
        "sourceMode": source.mode,
        "sourceSize": list(source.size),
        "outputSize": list(final.size),
        "alphaBBox": list(final.getchannel("A").getbbox()),
    })

(ROOT / "runtime-metadata.json").write_text(
    json.dumps(records, ensure_ascii=False, indent=2),
    encoding="utf-8",
)
print(json.dumps(records, ensure_ascii=False, indent=2))
