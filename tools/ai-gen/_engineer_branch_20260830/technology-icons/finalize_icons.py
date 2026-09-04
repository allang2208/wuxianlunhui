"""Finish only the three engineer technology icons with the shared badge rules."""
import json
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[3]
AI = PROJECT / "tools/ai-gen"
RUNTIME = PROJECT / "assets/ui/technology-icons"
REFERENCE = RUNTIME / "cavalry_school_level_3.png"
NAMES = ("工程师营地", "工程工坊", "载具工厂")
GENERATED = (
    "exec-02501dca-bd28-45ad-bfde-55fe3d26990b.png",
    "exec-3d161107-c22e-4221-810b-229664ce2eb1.png",
    "exec-e25d8d76-fa42-445b-a58a-193f8812d9a9.png",
)


def load(path, name):
    spec = spec_from_file_location(name, path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    shared = load(AI / "_technology_tree_gap_icons_20260826/finalize_icons.py", "engineer_hex")
    ranks = load(AI / "_thatch_hut_tier_icons_20260826/finalize_icons.py", "engineer_rank")
    crystals = ranks.extract_crystals(Image.open(REFERENCE).convert("RGBA"))
    RUNTIME.mkdir(parents=True, exist_ok=True)
    outputs = []
    entries = []
    for level in (1, 2, 3):
        icon_id = f"engineer_camp_level_{level}"
        source_path = ROOT / "raw" / f"{icon_id}_raw.png"
        source = Image.open(source_path)
        bounds = shared.find_badge_bounds(source, "checker")
        icon = shared.normalize(shared.cut_hex_badge(source, "checker"))
        for marker in ranks.TIER_MARKERS[level]:
            part, position = crystals[marker]
            icon.alpha_composite(part, position)
        pixels = np.asarray(icon).copy()
        pixels[pixels[..., 3] == 0, :3] = 0
        icon = Image.fromarray(pixels, "RGBA")
        output_path = RUNTIME / f"{icon_id}.png"
        icon.save(output_path, optimize=True)
        outputs.append(icon)
        entries.append({
            "id": icon_id, "name": NAMES[level-1], "level": level,
            "generatedFile": GENERATED[level-1],
            "sourceRaw": str(source_path.relative_to(ROOT)).replace("\\", "/"),
            "sourceMode": source.mode, "sourceSize": list(source.size),
            "sourceHexBounds": list(bounds),
            "runtimePath": str(output_path.relative_to(PROJECT)).replace("\\", "/"),
            "runtimeSize": list(icon.size), "alphaBBox": list(icon.getbbox()),
            "crystalMarkers": list(ranks.TIER_MARKERS[level]),
        })
        print(icon_id, "source", source.mode, source.size, "hex", bounds,
              "final", icon.size, "alpha", icon.getbbox(), "crystals", level)

    manifest = {
        "generator": "Codex built-in image_gen", "date": "2026-08-30",
        "scope": "Only engineer_camp_level_1/2/3 technology icon art and iconPath",
        "styleReference": "assets/ui/technology-icons/thatch_hut_level_1.png",
        "crystalReference": "assets/ui/technology-icons/cavalry_school_level_3.png",
        "subjectReferences": ["assets/terrain/engineer_camp.png", "assets/terrain/engineering_workshop.png", "assets/terrain/vehicle_factory.png"],
        "promptSet": "prompts.md", "entries": entries,
        "runtimeValidation": "Not run; user tests under project agreement",
    }
    (ROOT / "generation-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")

    # Delivery contact sheet with dark/light backgrounds and UI-size specimens.
    preview = Image.new("RGBA", (1500, 730), "#eeebe3")
    draw = ImageDraw.Draw(preview)
    title = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 29)
    label = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 19)
    for i, icon in enumerate(outputs):
        x = i * 500
        draw.text((x+22, 17), f"LV{i+1}  {NAMES[i]}", font=title, fill="#243239")
        draw.rectangle((x+15,65,x+484,564),fill="#28343e")
        preview.alpha_composite(icon.resize((465,465), Image.Resampling.LANCZOS), (x+17,80))
        draw.text((x+24,580), f"1024×1024 RGBA · 固定{i+1}颗蓝水晶", font=label, fill="#665948")
        for j, size in enumerate((88,64,48)):
            xx=x+30+j*140
            preview.alpha_composite(icon.resize((size,size), Image.Resampling.LANCZOS), (xx,625))
            draw.text((xx+size+3,642), str(size), font=label, fill="#665948")
    preview.convert("RGB").save(ROOT / "engineer-technology-icons-preview.png")


if __name__ == "__main__":
    main()
