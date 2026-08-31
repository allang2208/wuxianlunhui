"""Install the three requested city-hall eras from existing raws; no new generation."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
REQUEST = "使用LV1默认，随着科技推进逐步升级LV2、LV3"
TIERS = {
    1: {"tex": "city_hall_lv1",
        "raw": "candidates_dev_s12_v1/city_hall_lv1/city_hall_lv1_structure_v02_raw.png",
        "corners": ((78, 696), (944, 697), (511, 914)),
        "selection": "Assistant selected B/v02 under the user's explicit three-era integration instruction; no new generation."},
    2: {"tex": "city_hall",
        "raw": "lv2-balcony/refine-r01/candidates/city_hall_lv2/city_hall_lv2_refine_v02_raw.png",
        "corners": ((77, 699), (944, 690), (511, 914)),
        "selection": "Previously accepted LV2 balcony refinement R01/v02, unchanged."},
    3: {"tex": "city_hall_lv3",
        "raw": "candidates_dev_s12_v1/city_hall_lv3/city_hall_lv3_structure_v02_raw.png",
        "corners": ((80, 698), (943, 699), (510, 915)),
        "selection": "User-selected LV3/v02; existing roof and plants retained, no new generation."},
}


def run(tool, *args):
    subprocess.run([sys.executable, str(ROOT / "tools/ai-gen" / tool), *map(str, args)],
                   cwd=ROOT, check=True)


def install(level):
    spec = TIERS[level]
    tex = spec["tex"]
    raw = HERE.parent / spec["raw"]
    body = HERE / f"{tex}_body.png"
    runtime = ROOT / f"assets/terrain/{tex}.png"
    meta = HERE / f"{tex}_runtime_metadata.json"
    run("key-world122-building-body.py", raw, body, "--threshold", 100,
        "--remove-enclosed-key", "--nearest-opaque-edge-rgb")
    # The new raw-derived tiers have a thin keyed rim. Replace only inner-edge RGB;
    # alpha, plants and the approved LV2 image remain intact.
    fringe_args = ("--defringe-inner-pixels", 3) if level != 2 else ()
    run("finalize-building-runtime.py", body, runtime, "--display-width", 512,
        "--preserve-alpha-exact", "--nearest-opaque-edge-rgb", "--metadata", meta,
        *fringe_args)
    metadata = json.loads(meta.read_text(encoding="utf-8"))
    x0, y0, _, _ = metadata["cropBox"]
    width, height = metadata["fileSize"]
    # Each raw has its own outer lower plinth corners; never reuse another era's fit.
    left, right, front = spec["corners"]
    ground_w = right[0] - left[0]
    cx, cy = (left[0] + right[0]) / 2, (left[1] + right[1]) / 2
    ground_d = 2 * (front[1] - cy)
    sx, sy = 512 / ground_w, 256 / ground_d
    visual = {
        "tex": tex, "assetPath": runtime.relative_to(ROOT).as_posix(),
        "displayW": round(width * sx, 6), "displayH": round(height * sy, 6),
        "footOffsetY": round((front[1] - y0 - height / 2) * sy, 6),
        "visualFootprint": {
            "centerXRatio": round((cx - x0) / width, 9),
            "centerYRatio": round((cy - y0) / height, 9),
            "widthRatio": round(ground_w / width, 9),
            "depthRatio": round(ground_d / height, 9), "scaleMode": "strict"
        },
        "assetCutoutHash": hashlib.sha256(runtime.read_bytes()).hexdigest().upper()
    }
    metadata.update({"acceptedRaw": raw.relative_to(ROOT).as_posix(),
                     "source": body.relative_to(ROOT).as_posix(),
                     "output": runtime.relative_to(ROOT).as_posix(), "visual": visual,
                     "groundLandmarks": {"left": left, "right": right, "front": front},
                     "alphaMaskDepth": None, "logicalFootprint": [4, 4],
                     "userRequest": REQUEST, "level": level,
                     "selectionBasis": spec["selection"], "runtimeTested": False})
    metadata.update({key: visual[key] for key in ("displayW", "displayH", "footOffsetY")})
    metadata.update({"scaleX": sx, "scaleY": sy})
    meta.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    picture = Image.open(runtime).convert("RGBA")
    shown = picture.resize((round(visual["displayW"]), round(visual["displayH"])), Image.Resampling.LANCZOS)
    preview = Image.new("RGBA", shown.size, "#dad7d0")
    preview.alpha_composite(shown)
    preview.convert("RGB").save(HERE / f"{tex}_preview.png")
    fit = preview.copy()
    draw = ImageDraw.Draw(fit)
    fcx, fcy = (cx - x0) * sx, (cy - y0) * sy
    draw.line([(fcx - 256, fcy), (fcx, fcy - 128), (fcx + 256, fcy),
               (fcx, fcy + 128), (fcx - 256, fcy)], fill="#d1325d", width=2)
    fit.convert("RGB").save(HERE / f"{tex}_footprint.png")
    print(json.dumps({"level": level, **visual}, ensure_ascii=False, indent=2))


def compose_eras():
    canvas = Image.new("RGB", (1680, 500), "#dad7d0")
    draw = ImageDraw.Draw(canvas)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 20)
    titles = ["LV1 · 默认 · 古典议事厅", "LV2 · 住房优化 · 自治市政厅", "LV3 · 现代住宅体系 · 现代市政中心"]
    for column, spec in enumerate(TIERS.values()):
        path = HERE / f"{spec['tex']}_preview.png"
        if not path.exists():
            continue
        with Image.open(path) as picture:
            x = column * 560 + (560 - picture.width) // 2
            canvas.paste(picture, (x, 472 - picture.height))
        draw.text((column * 560 + 22, 16), titles[column], font=font, fill="#27303a")
    canvas.save(HERE / "city_hall_three_eras.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--tiers", type=int, choices=TIERS, nargs="+", default=list(TIERS))
    args = parser.parse_args()
    for level in args.tiers:
        install(level)
    compose_eras()
