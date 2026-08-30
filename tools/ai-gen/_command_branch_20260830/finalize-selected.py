"""Produce only the three accepted command-building assets, without AI regeneration.

The selected raw is canonical. RGB keying and edge-limited despill use the shared
building tools; the incompatible modeled Depth is never used as an alpha mask.
Ground landmarks are per-image visual calibration, not gameplay geometry.
"""
import hashlib
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
OUT = HERE / "accepted"
OUT.mkdir(exist_ok=True)
selection = json.loads((HERE / "final-selection.json").read_text(encoding="utf-8"))
refinements = json.loads((HERE / "refinement-manifest.json").read_text(encoding="utf-8"))


def relative(path):
    return path.relative_to(ROOT).as_posix()


def run(tool, *args):
    result = subprocess.run([sys.executable, str(ROOT / "tools/ai-gen" / tool),
                             *map(str, args)], cwd=ROOT, check=True,
                            stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    return result.stdout.decode("utf-8", errors="replace")


def backdrop(size, color):
    if color != "checker":
        return Image.new("RGBA", size, color)
    yy, xx = np.indices((size[1], size[0]))
    values = np.where(((xx // 24 + yy // 24) % 2)[..., None],
                      np.array([225, 211, 231]), np.array([38, 29, 46]))
    return Image.fromarray(values.astype(np.uint8), "RGB").convert("RGBA")


font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 23)
small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
overview = Image.new("RGB", (1740, 660), "#e9e5dd")
draw = ImageDraw.Draw(overview)
draw.text((24, 16), "指挥建筑定稿：指挥所 A / 司令部 B / 国防部 A", font=font, fill="#263b42")
draw.text((24, 52), "同一4×4占地 · 等级科技更换名称与外观 · 离线素材预览，非游戏截图", font=small, fill="#65625d")
records = []
for chosen in selection["assets"]:
    asset_id = chosen["id"]
    stem = f"{asset_id}_refine_v{chosen['variant']:02d}"
    raw = ROOT / refinements["outputRoot"] / asset_id / (stem + "_raw.png")
    keyed = OUT / f"{asset_id}_keyed.png"
    body = OUT / f"{asset_id}_body.png"
    runtime = ROOT / "assets/terrain" / (asset_id + ".png")
    metadata_path = OUT / f"{asset_id}_runtime_metadata.json"
    logs = [run("key-world122-building-body.py", raw, keyed,
                "--threshold", chosen["keyThreshold"])]

    pixels = np.asarray(Image.open(keyed).convert("RGBA"))
    rgb = pixels[..., :3].astype(np.int16)
    near_edge = distance_transform_edt(pixels[..., 3] >= 16) <= chosen["edgeRepairPixels"]
    residue = ((rgb[..., 1] >= 90) & (rgb[..., 1] >= rgb[..., 0] + 35)
               & (rgb[..., 1] >= rgb[..., 2] + 35) & (pixels[..., 3] >= 16) & near_edge)
    if np.any(residue):
        logs.append(run("repair-local-green-spill.py", keyed, body, "--rect", "0,0,1024,1024",
                        "--max-edge-distance", chosen["edgeRepairPixels"]))
    else:
        Image.fromarray(pixels, "RGBA").save(body)
    logs.append(run("finalize-building-runtime.py", body, runtime, "--display-width", 512,
                    "--preserve-alpha-exact", "--nearest-opaque-edge-rgb", "--metadata", metadata_path))
    (OUT / (asset_id + "_finalize.log")).write_text("\n".join(logs), encoding="utf-8")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    x0, y0, _, _ = metadata["cropBox"]
    width, height = metadata["fileSize"]
    left, right = chosen["groundLeft"], chosen["groundRight"]
    ground_width = right[0] - left[0]
    center_x = (left[0] + right[0]) / 2
    center_y = (left[1] + right[1]) / 2
    ground_depth = 2 * (chosen["groundFrontY"] - center_y)
    sx, sy = 512 / ground_width, 256 / ground_depth
    visual = {
        "tex": asset_id, "assetPath": relative(runtime),
        "thumbnailPath": f"assets/ui/building-thumbnails/{asset_id}.png",
        "displayW": round(width * sx, 6), "displayH": round(height * sy, 6),
        "footOffsetY": round((chosen["groundFrontY"] - y0 - height / 2) * sy, 6),
        "visualFootprint": {
            "centerXRatio": round((center_x - x0) / width, 9),
            "centerYRatio": round((center_y - y0) / height, 9),
            "widthRatio": round(ground_width / width, 9),
            "depthRatio": round(ground_depth / height, 9), "scaleMode": "strict",
        },
        "assetCutoutHash": hashlib.sha256(runtime.read_bytes()).hexdigest().upper(),
    }
    metadata["beforeGroundCalibration"] = {key: metadata[key] for key in ("displayW", "displayH", "footOffsetY", "scaleX", "scaleY")}
    metadata.update({key: visual[key] for key in ("displayW", "displayH", "footOffsetY")})
    metadata.update({"scaleX": sx, "scaleY": sy, "acceptedRaw": relative(raw), "source": relative(body),
                     "output": relative(runtime), "visual": visual,
                     "groundLandmarksSource": chosen, "sourceScaleX": sx, "sourceScaleY": sy,
                     "calibrationMethod": "Accepted raw foundation outer lower corners; hidden rear corner inferred symmetrically.",
                     "alphaMaskDepth": None, "edgeRepairPixels": chosen["edgeRepairPixels"]})
    metadata_path.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    picture = Image.open(runtime).convert("RGBA")
    thumbnail = picture.convert("RGBa")
    thumbnail.thumbnail((122, 58), Image.Resampling.LANCZOS)
    thumb_canvas = Image.new("RGBA", (128, 64), (0, 0, 0, 0))
    thumb_canvas.paste(thumbnail.convert("RGBA"), ((128 - thumbnail.width) // 2, (64 - thumbnail.height) // 2))
    thumb_path = ROOT / visual["thumbnailPath"]
    thumb_path.parent.mkdir(parents=True, exist_ok=True)
    thumb_canvas.save(thumb_path)
    review = Image.new("RGB", (width * 4, height + 38), "#dedbd4")
    review_draw = ImageDraw.Draw(review)
    for index, color in enumerate(("#080808", "#777777", "#ffffff", "checker")):
        tile = backdrop(picture.size, color)
        tile.alpha_composite(picture)
        review.paste(tile.convert("RGB"), (index * width, 38))
        review_draw.text((index * width + 8, 5), asset_id + " / " + color, font=small, fill="#263b42")
    review_path = OUT / (asset_id + "_alpha_review.png")
    review.save(review_path)
    # Purely offline picture made with the same per-axis transform as the config.
    shown = picture.resize((round(visual["displayW"]), round(visual["displayH"])), Image.Resampling.LANCZOS)
    column = chosen["level"] - 1
    origin = (column * 580 + 290, 603)
    px = round(origin[0] - (center_x - x0) * sx)
    py = round(origin[1] - (chosen["groundFrontY"] - y0) * sy)
    overview.paste(shown, (px, py), shown)
    draw.text((column * 580 + 25, 98), f"LV{chosen['level']} · {chosen['name']} · {chosen['choice']}", font=font, fill="#263b42")
    # Footprint wire overlay is a separate visual calibration artifact.
    fit_preview = backdrop(shown.size, "#d4d3cc")
    fit_preview.alpha_composite(shown)
    fit_draw = ImageDraw.Draw(fit_preview)
    cx, cy = (center_x - x0) * sx, (center_y - y0) * sy
    fit_draw.line([(cx - 256, cy), (cx, cy - 128), (cx + 256, cy),
                   (cx, cy + 128), (cx - 256, cy)], fill="#e9476a", width=2)
    fit_preview.save(OUT / (asset_id + "_footprint.png"))
    records.append({**chosen, "acceptedRaw": relative(raw), "body": relative(body),
                    "generationMetadata": relative(raw.with_name(stem + "_generation.json")),
                    "runtimeMetadata": relative(metadata_path), "visual": visual,
                    "alphaReview": relative(review_path)})

overview.save(OUT / "command_buildings_accepted.png")
(OUT / "runtime-assets.json").write_text(json.dumps({
    "status": "accepted_assets_prepared", "buildingId": selection["buildingId"],
    "selection": relative(HERE / "final-selection.json"), "assets": records,
    "runtimeTested": False,
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Prepared the three selected runtime textures and offline previews; no gameplay tests run.")
