"""Export only the six mushroom-farm badges using the existing geometric badge pipeline."""
import json
import runpy
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
shared = runpy.run_path(str(ROOT.parent / "_royal_mint_icons_20260824/finalize_icons.py"))
specs = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))["icons"]
names = ["食用菌栽培", "菌业标准化", "优选菌种", "恒湿培育", "分层菌床", "轻便采收筐"]
preview = Image.new("RGB", (840, 636), (29, 34, 39))
draw = ImageDraw.Draw(preview)
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 20)
records = []

for index, spec in enumerate(specs):
    source = Image.open(ROOT / spec["raw"])
    technology = spec["kind"] == "technology"
    size, visible_size = (1024, 1000) if technology else (256, 244)
    # Geometry keeps charcoal recesses opaque even if the source has a baked checkerboard.
    cutout = shared["cut_badge"](source, spec["background"], "hex" if technology else "square")
    final = shared["normalize"](cutout, size, visible_size)
    destination = PROJECT / spec["runtime"]
    destination.parent.mkdir(parents=True, exist_ok=True)
    final.save(destination, optimize=True)
    x, y = (index % 3) * 280 + 12, (index // 3) * 318 + 8
    thumb = final.resize((256, 256), Image.Resampling.LANCZOS)
    preview.paste(thumb, (x, y), thumb)
    draw.text((x + 128, y + 266), names[index], anchor="mt", font=font, fill=(225, 231, 235))
    records.append({"id": spec["id"], "sourceMode": source.mode,
                    "sourceSize": list(source.size), "output": spec["runtime"],
                    "outputSize": list(final.size), "alphaBBox": final.getchannel("A").getbbox(),
                    "shape": "hex" if technology else "cut-corner-square"})

preview.save(ROOT / "icons-preview.png", optimize=True)
(ROOT / "runtime-metadata.json").write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")
print(json.dumps(records, ensure_ascii=False, indent=2))
