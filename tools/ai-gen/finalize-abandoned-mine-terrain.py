"""Install the abandoned-mine prop renders and create static review evidence."""

from __future__ import annotations

import json
import random
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


REPO = Path(__file__).resolve().parents[2]
SOURCE = REPO / "tools" / "ai-gen" / "_abandoned_mine_terrain_20260828"
PROP_SOURCE = SOURCE / "props"
RUNTIME = REPO / "assets" / "terrain" / "abandoned-mine-props"
FLOOR = REPO / "assets" / "terrain" / "floor_abandoned_mine_seamless.png"


def alpha_bbox(image: Image.Image):
    alpha = image.getchannel("A")
    bbox = alpha.getbbox()
    if bbox is None:
        return None
    return list(bbox)


def main():
    manifest_path = SOURCE / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    props = manifest["props"]
    if len(props) != 18:
        raise RuntimeError(f"Expected 18 props, got {len(props)}")
    RUNTIME.mkdir(parents=True, exist_ok=True)
    report = []
    for name in props:
        src = PROP_SOURCE / f"{name}.png"
        dst = RUNTIME / src.name
        shutil.copy2(src, dst)
        with Image.open(dst).convert("RGBA") as image:
            bbox = alpha_bbox(image)
            report.append({
                "key": name,
                "src": str(dst.relative_to(REPO)).replace("\\", "/"),
                "size": list(image.size),
                "alphaBBox": bbox,
                "opaquePixels": sum(1 for value in image.getchannel("A").getdata() if value > 8),
            })

    tile_w, tile_h = 256, 296
    sheet = Image.new("RGBA", (tile_w * 6, tile_h * 3 + 320), (20, 18, 16, 255))
    draw = ImageDraw.Draw(sheet)
    font = ImageFont.load_default()
    if FLOOR.exists():
        with Image.open(FLOOR).convert("RGB") as floor:
            floor = floor.resize((sheet.width, 320), Image.Resampling.LANCZOS)
            sheet.alpha_composite(floor.convert("RGBA"), (0, 0))
        draw.rectangle((0, 0, sheet.width, 34), fill=(0, 0, 0, 170))
        draw.text((14, 11), "ABANDONED MINE - SEAMLESS FLOOR (runtime applies Y scale 0.5774)",
                  fill=(238, 222, 190, 255), font=font)

    for index, name in enumerate(props):
        column = index % 6
        row = index // 6
        x = column * tile_w
        y = 320 + row * tile_h
        with Image.open(RUNTIME / f"{name}.png").convert("RGBA") as prop:
            checker = Image.new("RGBA", (tile_w, 256), (42, 39, 34, 255))
            cell = 16
            cdraw = ImageDraw.Draw(checker)
            for yy in range(0, 256, cell):
                for xx in range(0, 256, cell):
                    if ((xx // cell) + (yy // cell)) % 2:
                        cdraw.rectangle((xx, yy, xx + cell - 1, yy + cell - 1), fill=(52, 48, 42, 255))
            checker.alpha_composite(prop)
            sheet.alpha_composite(checker, (x, y))
        label = name.replace("abandoned_mine_prop_", "")
        draw.rectangle((x, y + 256, x + tile_w - 1, y + tile_h - 1), fill=(12, 11, 10, 255))
        draw.text((x + 8, y + 269), f"{index + 1:02d}  {label}", fill=(230, 214, 184, 255), font=font)

    preview = SOURCE / "abandoned-mine-terrain-preview.png"
    sheet.save(preview)

    # Runtime-style material/deco proof: world-phase texture repeated after the
    # required 0.5774 Y compression, with the same configured display heights.
    terrain_config = json.loads((REPO / "data" / "abandoned-mine-terrain.json").read_text(encoding="utf-8"))
    room_w, room_h = 1536, 864
    room = Image.new("RGBA", (room_w, room_h), (11, 10, 9, 255))
    with Image.open(FLOOR).convert("RGB") as floor:
        period = floor.resize((1024, round(1024 * 0.5774)), Image.Resampling.LANCZOS).convert("RGBA")
        for y in range(-period.height, room_h + period.height, period.height):
            for x in range(-period.width, room_w + period.width, period.width):
                room.alpha_composite(period, (x, y))
    rng = random.Random(82283)
    assets = terrain_config["deco"]["assets"]
    for _ in range(28):
        asset = rng.choices(assets, weights=[entry["weight"] for entry in assets], k=1)[0]
        with Image.open(REPO / asset["src"]).convert("RGBA") as prop:
            height = round(asset["size"] * rng.uniform(0.88, 1.12))
            width = max(1, round(prop.width * height / prop.height))
            prop = prop.resize((width, height), Image.Resampling.LANCZOS)
            if rng.random() < 0.5:
                prop = prop.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
            px = rng.randrange(80, room_w - 80)
            py = rng.randrange(100, room_h - 70)
            room.alpha_composite(prop, (px - width // 2, py - round(height * asset["originY"])))
    room_draw = ImageDraw.Draw(room)
    room_draw.rectangle((0, 0, room_w, 36), fill=(0, 0, 0, 176))
    room_draw.text((14, 12), "ABANDONED MINE - RUNTIME-SCALE FLOOR + VISUAL-ONLY PROP PROOF",
                   fill=(238, 222, 190, 255), font=font)
    room_preview = SOURCE / "abandoned-mine-terrain-room-preview.png"
    room.save(room_preview)
    report_path = SOURCE / "alpha-report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    manifest["runtimeProps"] = report
    manifest["preview"] = str(preview.relative_to(REPO)).replace("\\", "/")
    manifest["roomPreview"] = str(room_preview.relative_to(REPO)).replace("\\", "/")
    manifest["alphaReport"] = str(report_path.relative_to(REPO)).replace("\\", "/")
    manifest["floorSelection"] = {
        "runtime": "assets/terrain/floor_abandoned_mine_seamless.png",
        "runtimeSeam": "strict H/V edge equality from the accepted authored source",
        "candidateSeed": 122828,
        "candidateDecision": "rejected and removed; large periodic rock clusters repeat more visibly than the runtime floor",
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Installed {len(props)} props to {RUNTIME}")
    print(f"Preview: {preview}")
    print(f"Room preview: {room_preview}")


if __name__ == "__main__":
    main()
