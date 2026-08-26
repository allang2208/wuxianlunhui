"""Normalize generated craft-card images to the project's 209px icon size."""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[3]
RAW = Path(__file__).resolve().parent / "generated" / "craft"
OUT = ROOT / "assets/icons/craft-cold-steel"

NAMES = [
    "frontier_overdrive_bolt",
    "frontier_ceramic_handguard",
    "frontier_light_core_round",
    "frontier_countermass_stock",
    "vengeance_burst_regulator",
    "vengeance_heavy_core_round",
    "vengeance_resonance_stock",
    "vengeance_full_auto_core",
]

OUT.mkdir(parents=True, exist_ok=True)
for name in NAMES:
    source = RAW / f"{name}.png"
    image = Image.open(source).convert("RGBA")
    image = image.resize((209, 209), Image.Resampling.LANCZOS)
    target = OUT / f"{name}.png"
    image.save(target, optimize=True)
    print(target.relative_to(ROOT))
