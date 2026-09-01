"""Normalize the six approved industrial-economy technology badges.

This exporter does not repaint subjects. It removes the generated checkerboard
with the shared hexagonal mask, normalizes the visible badge to 1024px and
installs the resulting RGBA files into the runtime technology-icon directory.
"""

import json
import sys
from importlib.util import module_from_spec, spec_from_file_location
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
RUNTIME = PROJECT / "assets/ui/technology-icons"

ENTRIES = (
    ("industrial_energy_engineering", "燃油动力", "exec-bc18b8c9-6d7d-4bee-965f-df265628f531.png"),
    ("oil_power_standardization", "燃油机组标准化", "exec-8788a527-5179-4ba9-bb6f-ba942eca31e8.png"),
    ("industrial_food_processing", "食品罐藏", "exec-fcee4053-9861-4f9e-a11b-de038f7ab65a.png"),
    ("cannery_standardization", "罐装生产标准化", "exec-618125ec-1c11-4ad6-94ce-07b08bea4e44.png"),
    ("industrial_commerce", "近代商贸", "exec-d3bffda8-4f85-4f4a-8a63-a844ae3ca931.png"),
    ("trading_standardization", "贸易标准化", "exec-3df07732-07c2-41da-8032-018823cea9dc.png"),
)


def load_shared():
    path = PROJECT / "tools/ai-gen/_technology_tree_gap_icons_20260826/finalize_icons.py"
    spec = spec_from_file_location("industrial_economy_hex", path)
    module = module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    shared = load_shared()
    RUNTIME.mkdir(parents=True, exist_ok=True)
    final_dir = ROOT / "final/technology"
    final_dir.mkdir(parents=True, exist_ok=True)
    outputs = []
    records = []
    for icon_id, name, generated_file in ENTRIES:
        source_path = ROOT / "raw" / f"{icon_id}_raw.png"
        source = Image.open(source_path)
        bounds = shared.find_badge_bounds(source, "checker")
        icon = shared.normalize(shared.cut_hex_badge(source, "checker"))
        pixels = np.asarray(icon).copy()
        pixels[pixels[..., 3] == 0, :3] = 0
        icon = Image.fromarray(pixels, "RGBA")
        final_path = final_dir / f"{icon_id}.png"
        runtime_path = RUNTIME / f"{icon_id}.png"
        icon.save(final_path, optimize=True)
        icon.save(runtime_path, optimize=True)
        outputs.append((name, icon))
        records.append({
            "id": icon_id,
            "name": name,
            "generatedFile": generated_file,
            "rawPath": str(source_path.relative_to(PROJECT)).replace("\\", "/"),
            "rawSize": list(source.size),
            "hexBounds": list(bounds),
            "runtimePath": str(runtime_path.relative_to(PROJECT)).replace("\\", "/"),
            "runtimeSize": list(icon.size),
            "runtimeMode": icon.mode,
            "alphaBounds": list(icon.getbbox()),
        })

    board = Image.new("RGBA", (1536, 1120), "#e8e5dd")
    draw = ImageDraw.Draw(board)
    title = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 30)
    label = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 21)
    draw.text((28, 18), "近代经济 · 六项独立科技徽章", font=title, fill="#26343d")
    for index, (name, icon) in enumerate(outputs):
        x = (index % 3) * 512
        y = 70 + (index // 3) * 520
        draw.rectangle((x + 12, y, x + 500, y + 430), fill="#25313b")
        preview = icon.resize((420, 420), Image.Resampling.LANCZOS)
        board.alpha_composite(preview, (x + 46, y + 5))
        draw.text((x + 26, y + 440), name, font=label, fill="#26343d")
        for offset, size in enumerate((64, 48)):
            small = icon.resize((size, size), Image.Resampling.LANCZOS)
            board.alpha_composite(small, (x + 250 + offset * 100, y + 435))
    board.convert("RGB").save(ROOT / "technology-icons-preview.jpg", quality=94)
    manifest = {
        "date": "2026-09-01",
        "generator": "Codex built-in image_gen",
        "promptSet": "tools/ai-gen/_industrial_economy_ui_icons_20260901/prompts.md",
        "styleReferences": [
            "assets/ui/technology-icons/steam_industry_standardization.png",
            "assets/ui/technology-icons/bakery_craft.png",
            "assets/ui/technology-icons/mall_standardization.png",
        ],
        "subjectReferences": [
            "assets/terrain/oil_power_plant.png",
            "assets/terrain/cannery.png",
            "assets/terrain/trading_company.png",
        ],
        "operation": "Shared geometric hex mask and 1024px normalization; no subject repaint",
        "runtimeTested": False,
        "entries": records,
    }
    (ROOT / "technology-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
