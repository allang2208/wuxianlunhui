"""Finalize desert cookhouse upgrade and technology badges into runtime RGBA assets."""
import json
import runpy
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
shared = runpy.run_path(str(ROOT.parent / "_royal_mint_icons_20260824/finalize_icons.py"))
manifest = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
records = {"upgrades": [], "technology": None}


def clear_transparent_rgb(image: Image.Image) -> Image.Image:
    pixels = np.asarray(image.convert("RGBA")).copy()
    pixels[pixels[:, :, 3] == 0, :3] = 0
    return Image.fromarray(pixels, "RGBA")


for spec in manifest["upgrades"]:
    source = Image.open(ROOT / spec["raw"])
    left, top, right, bottom = shared["find_badge_bounds"](source, "black")
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
    final = clear_transparent_rgb(shared["normalize"](cutout, 256, 244))
    destination = PROJECT / spec["runtime"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    final.save(destination, optimize=True)

    runtime_icon = PROJECT / "assets/ui/runtime-icons" / Path(spec["runtime"]).relative_to("assets")
    runtime_icon.parent.mkdir(parents=True, exist_ok=True)
    mirror = clear_transparent_rgb(final.resize((128, 128), Image.Resampling.LANCZOS))
    mirror.save(runtime_icon, optimize=True)

    alpha = np.asarray(final.getchannel("A"))
    records["upgrades"].append({
        "id": spec["id"],
        "raw": spec["raw"],
        "runtime": spec["runtime"],
        "runtimeMirror": runtime_icon.relative_to(PROJECT).as_posix(),
        "sourceMode": source.mode,
        "sourceSize": list(source.size),
        "runtimeSize": list(final.size),
        "alphaExtrema": [int(alpha.min()), int(alpha.max())],
        "alphaBBox": list(final.getchannel("A").getbbox()),
    })

tech = manifest["technology"]
source = Image.open(ROOT / tech["raw"])
cutout = shared["cut_badge"](source, "black", "hex")
final = clear_transparent_rgb(shared["normalize"](cutout, 1024, 1000))
destination = PROJECT / tech["runtime"]
destination.parent.mkdir(parents=True, exist_ok=True)
final.save(destination, optimize=True)
alpha = np.asarray(final.getchannel("A"))
rgba = np.asarray(final)
records["technology"] = {
    "id": tech["id"],
    "raw": tech["raw"],
    "runtime": tech["runtime"],
    "sourceMode": source.mode,
    "sourceSize": list(source.size),
    "runtimeSize": list(final.size),
    "alphaExtrema": [int(alpha.min()), int(alpha.max())],
    "alphaBBox": list(final.getchannel("A").getbbox()),
    "cornerAlpha": [int(alpha[0, 0]), int(alpha[0, -1]), int(alpha[-1, 0]), int(alpha[-1, -1])],
    "transparentPixelsWithRgb": int(np.count_nonzero((alpha == 0) & np.any(rgba[:, :, :3] != 0, axis=2))),
}

(ROOT / "runtime-metadata.json").write_text(
    json.dumps(records, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print(json.dumps(records, ensure_ascii=False, indent=2))
