"""Publish the user-accepted three-tier building art; keep alpha provenance."""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = ROOT / "runtime"
index = json.loads((ROOT / "local-repair-index.json").read_text(encoding="utf-8"))
names = ["工程师营地", "工程工坊", "载具工厂"]

def run(script, args, log):
    result = subprocess.run([sys.executable, str(REPO / "tools/ai-gen" / script), *map(str, args)],
                            capture_output=True, text=True, encoding="utf-8",
                            env={**os.environ, "PYTHONIOENCODING": "utf-8"})
    if result.returncode:
        raise SystemExit(result.stderr or result.stdout)
    log.write_text(result.stdout, encoding="utf-8")

entries = []
for entry in index["entries"]:
    asset_id = entry["assetId"]
    keyed = OUT / f"{asset_id}_keyed.png"
    body = OUT / f"{asset_id}_body.png"
    rgba = np.asarray(Image.open(keyed).convert("RGBA"))
    rgb = rgba[..., :3].astype(np.int16)
    edge = distance_transform_edt(rgba[..., 3] >= 16)
    # Only a <=3 source-pixel rim is eligible. No alpha edits or global recolor.
    spill = ((rgb[..., 1] >= 50) & (rgb[..., 1] >= rgb[..., 0] + 20)
             & (rgb[..., 1] >= rgb[..., 2] + 20) & (rgba[..., 3] >= 16) & (edge <= 3))
    if np.any(spill):
        run("repair-local-green-spill.py", [keyed, body, "--rect", "0,0,1024,1024",
            "--min-green", 50, "--green-margin", 20, "--max-edge-distance", 3],
            OUT / f"{asset_id}_edge-rgb.log")
    else:
        Image.fromarray(rgba).save(body)
    destination = REPO / "assets/terrain" / f"{asset_id}.png"
    metadata_path = OUT / f"{asset_id}_runtime.json"
    run("finalize-building-runtime.py", [body, destination, "--display-width", 512,
        "--preserve-alpha-exact", "--nearest-opaque-edge-rgb", "--metadata", metadata_path],
        OUT / f"{asset_id}_finalize.log")
    meta = json.loads(metadata_path.read_text(encoding="utf-8"))
    # All three plinths reach the outermost x of the image. Use their visible
    # left/right corner elevations and front tip, independently for each tier.
    alpha = np.asarray(Image.open(destination))[..., 3]
    ys, xs = np.where(alpha >= 128)
    left, right = int(xs.min()), int(xs.max())
    side_rows = []
    for x in (left + 2, right - 2):
        occupied = np.where(alpha[:, x] >= 128)[0]
        side_rows.append(float(occupied.max()))
    center_y = sum(side_rows) / 2
    front_y = int(ys.max()) + 1
    h, w = alpha.shape
    visual = {
        "tex": asset_id, "assetPath": f"assets/terrain/{asset_id}.png",
        "displayW": meta["displayW"], "displayH": meta["displayH"],
        "footOffsetY": meta["footOffsetY"],
        "visualFootprint": {
            "centerXRatio": round((left + right + 1) / 2 / w, 6),
            "centerYRatio": round(center_y / h, 6),
            "widthRatio": round((right - left + 1) / w, 6),
            "depthRatio": round(2 * (front_y - center_y) / h, 6),
            "scaleMode": "strict",
        },
    }
    entries.append({"assetId": asset_id, "level": entry["level"],
        "name": names[entry["level"] - 1], "visual": visual,
        "sourceRaw": entry["correctedRaw"], "source48": entry["source48"],
        "sourceMetadata": entry["localMetadata"],
        "keyThreshold": {"engineer_camp":60,"engineering_workshop":110,"vehicle_factory":90}[asset_id],
        "depthUsedForAlpha": False, "rgbEdgeRepairPixels": int(spill.sum()),
        "calibration": {"sideRows": side_rows, "frontY": front_y,
                        "leftX": left, "rightX": right, "fileSize": [w,h],
                        "logicalFootprintCells": 4, "targetFootprint": [512,256]},
        "assetCutoutHash": hashlib.sha256(destination.read_bytes()).hexdigest().upper(),
        "runtimeMetadata": str(metadata_path.relative_to(ROOT)).replace("\\", "/")})
    print(asset_id, json.dumps(visual, ensure_ascii=False))

manifest = {"status": "runtime_assets_installed", "acceptedOn": "2026-08-30",
    "authorization": "用户在询问是否导入游戏后明确要求继续接入当前三档已修正建筑。",
    "sourceIndex": "local-repair-index.json", "entries": entries,
    "runtimeValidation": "Not run; user will test under project agreement."}
(OUT / "runtime-index.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+"\n", encoding="utf-8")

# A viewable offline asset lineup; not a screenshot or a runtime validation.
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 27)
small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 19)
preview = Image.new("RGBA", (1800, 620), "#eeeae0")
draw = ImageDraw.Draw(preview)
for i, entry in enumerate(entries):
    draw.text((600*i+25, 17), f"LV{i+1}  {entry['name']}", font=font, fill="#293b3c")
    for y in range(75, 550, 20):
        for x in range(i*600+20, i*600+580, 20):
            color = "#ddd9d1" if ((x-i*600-20)//20+(y-75)//20)%2 else "#f9f6ef"
            draw.rectangle((x,y,x+19,min(y+19,549)), fill=color)
    im = Image.open(REPO / entry["visual"]["assetPath"]).convert("RGBA")
    im.thumbnail((535, 455), Image.Resampling.LANCZOS)
    preview.alpha_composite(im, (i*600+(600-im.width)//2, 540-im.height))
    draw.text((i*600+25, 565), "正式透明素材 · 4×4占格 · 工程制造支线", font=small, fill="#766043")
preview.convert("RGB").save(OUT / "engineer-branch-runtime-lineup.png")
