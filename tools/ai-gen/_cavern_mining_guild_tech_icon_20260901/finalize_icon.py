"""Finalize the cavern mining guild technology icon with the shared hex-badge rules."""

import json
import runpy
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
RAW = ROOT / "raw/cavern_mining_guild_raw.png"
RUNTIME = PROJECT / "assets/ui/technology-icons/cavern_mining_guild.png"
PREVIEW = ROOT / "cavern-mining-guild-tech-preview.png"


def main() -> None:
    shared = runpy.run_path(
        str(ROOT.parent / "_technology_tree_gap_icons_20260826/finalize_icons.py")
    )
    source = Image.open(RAW)
    bounds = shared["find_badge_bounds"](source, "black")
    icon = shared["normalize"](
        shared["cut_hex_badge"](source, "black"),
        size=1024,
        visible_size=1000,
    )

    pixels = np.asarray(icon).copy()
    pixels[pixels[..., 3] == 0, :3] = 0
    icon = Image.fromarray(pixels, "RGBA")
    RUNTIME.parent.mkdir(parents=True, exist_ok=True)
    icon.save(RUNTIME, optimize=True)

    preview = Image.new("RGBA", (1440, 760), "#e9e5dc")
    draw = ImageDraw.Draw(preview)
    draw.rectangle((20, 20, 740, 740), fill="#26323b")
    preview.alpha_composite(icon.resize((700, 700), Image.Resampling.LANCZOS), (30, 30))
    for index, size in enumerate((256, 128, 64, 48)):
        x = 790 + (index % 2) * 300
        y = 80 + (index // 2) * 330
        draw.rectangle((x - 18, y - 18, x + size + 18, y + size + 18), fill="#26323b")
        preview.alpha_composite(icon.resize((size, size), Image.Resampling.LANCZOS), (x, y))
        draw.text((x, y + size + 28), f"{size}px", fill="#332d29")
    preview.convert("RGB").save(PREVIEW, optimize=True)

    manifest = {
        "generator": "Codex built-in image_gen",
        "date": "2026-09-01",
        "scope": "Independent technology-tree icon for cavern_mining_guild only",
        "generatedFile": "exec-5dc7cac0-5a67-4b8b-a992-95c220b94566.png",
        "raw": "raw/cavern_mining_guild_raw.png",
        "rawMode": source.mode,
        "rawSize": list(source.size),
        "sourceHexBounds": list(bounds),
        "backgroundMode": "black",
        "alphaMethod": "shared deterministic point-up hex mask, 0.65px feather",
        "visibleLongEdge": 1000,
        "styleReference": "assets/ui/technology-icons/thatch_hut_level_1.png",
        "subjectReference": "assets/terrain/mining_guild.png",
        "promptSet": "prompt.md",
        "runtimePath": str(RUNTIME.relative_to(PROJECT)).replace("\\", "/"),
        "runtimeMode": icon.mode,
        "runtimeSize": list(icon.size),
        "alphaRange": list(icon.getchannel("A").getextrema()),
        "alphaBBox": list(icon.getchannel("A").getbbox()),
        "preview": PREVIEW.name,
        "runtimeValidation": "Not run; user tests under project agreement",
    }
    (ROOT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest, ensure_ascii=False))


if __name__ == "__main__":
    main()
