"""Derive accepted engineer-building cutouts with the standard building tools.

This is asset production only: no game launch, tests, or general asset rebuild.
Original Depth differs at the props and plinth; it must not clip accepted art.
"""
import json
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = ROOT / "runtime"
OUT.mkdir(exist_ok=True)
INDEX = json.loads((ROOT / "local-repair-index.json").read_text(encoding="utf-8"))
# Distances sampled from each accepted raw; camp thatch requires the lowest key.
THRESHOLDS = {"engineer_camp": 60, "engineering_workshop": 110, "vehicle_factory": 90}

for entry in INDEX["entries"]:
    asset_id = entry["assetId"]
    raw = ROOT / entry["correctedRaw"]
    keyed = OUT / f"{asset_id}_keyed.png"
    command = [sys.executable, str(REPO / "tools/ai-gen/key-world122-building-body.py"),
               str(raw), str(keyed), "--threshold", str(THRESHOLDS[asset_id]),
               "--remove-enclosed-key", "--preview", str(OUT / f"{asset_id}_checker.png")]
    result = subprocess.run(command, capture_output=True, text=True, encoding="utf-8",
                            env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    if result.returncode:
        raise SystemExit(result.stderr)
    (OUT / f"{asset_id}_keying.log").write_text(result.stdout, encoding="utf-8")
    print(asset_id, result.stdout.strip())

font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 26)
preview = Image.new("RGB", (1800, 710), "#eeeae0")
draw = ImageDraw.Draw(preview)
names = ["工程师营地", "工程工坊", "载具工厂"]
for i, entry in enumerate(INDEX["entries"]):
    draw.text((i * 600 + 16, 16), f"LV{i + 1}  {names[i]}", font=font, fill="#293b3c")
    tile = Image.open(OUT / f"{entry['assetId']}_checker.png").convert("RGB")
    tile.thumbnail((580, 640), Image.Resampling.LANCZOS)
    preview.paste(tile, (i * 600 + 10, 65))
preview.save(OUT / "engineer-branch-cutout-preview.png")
