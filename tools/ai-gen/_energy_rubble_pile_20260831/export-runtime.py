"""Export the five accepted mineral layouts through the shared key/finalize/depletion tools."""

import json
from pathlib import Path
import subprocess
import sys

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
EXPORT = ROOT / "runtime"
LAYOUTS = ["01_left", "02_right", "03_center", "04_front", "05_diagonal"]
LABELS = ["左侧集中", "右侧集中", "中部串联", "前沿散点", "对角分布"]


def call(name, *args):
    subprocess.run([sys.executable, str(REPO / "tools/ai-gen" / name), *map(str, args)],
                   cwd=REPO, check=True, stdout=subprocess.DEVNULL)


def main():
    EXPORT.mkdir(parents=True, exist_ok=True)
    records = []
    board = Image.new("RGB", (1440, 426), "#222831")
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 22)
    draw.text((20, 12), "五款能源矿堆 · 透明运行时贴图 / 枯竭态", font=font, fill="white")
    for index, (layout, label) in enumerate(zip(LAYOUTS, LABELS), 1):
        source = ROOT / "vein_variations_v3" / layout / "mineral_distribution_local_raw.png"
        keyed = EXPORT / f"rubble_{index}_keyed.png"
        body = EXPORT / f"rubble_{index}_body.png"
        metadata = EXPORT / f"rubble_{index}_crop.json"
        normal = REPO / f"assets/terrain/energy_node_rubble_{index}.png"
        depleted = REPO / f"assets/terrain/energy_node_rubble_depleted_{index}.png"
        # These approved rock-only sources contain no intentional green material.
        # Their original Blender Depth differs from the accepted rock silhouette,
        # so it must not clip their alpha during export.
        call("key-world122-building-body.py", source, keyed,
             "--threshold", 100, "--remove-all-green")
        call("finalize-building-runtime.py", keyed, body, "--display-width", 128,
             "--padding", 0, "--preserve-alpha-exact", "--nearest-opaque-edge-rgb",
             "--defringe-inner-pixels", 2, "--metadata", metadata)
        image = Image.open(body).convert("RGBA")
        size = (256, round(image.height * 256 / image.width))
        image = image.resize(size, Image.Resampling.LANCZOS)
        image.save(normal, optimize=True)
        call("make-energy-vein-depleted.py", normal, depleted,
             "--metadata", EXPORT / f"rubble_{index}_depleted.json")
        records.append({
            "variant": index, "label": label,
            "source": source.relative_to(REPO).as_posix(),
            "normal": normal.relative_to(REPO).as_posix(),
            "depleted": depleted.relative_to(REPO).as_posix(),
            "fileSize": list(size), "displayWidth": 128,
            "footOffsetY": size[1] / 4 - 32,
            "anchor": "cell center; bottom of sprite at cell center + 32px",
            "mirrored": False, "randomScale": False,
        })
        for row, path in enumerate((normal, depleted)):
            pic = Image.open(path).convert("RGBA")
            x, y = (index - 1) * 288 + 16, 80 + row * 170
            tile = Image.new("RGB", (256, 148), "#66666a")
            td = ImageDraw.Draw(tile)
            for ty in range(0, 148, 16):
                for tx in range(0, 256, 16):
                    if (tx // 16 + ty // 16) % 2:
                        td.rectangle((tx, ty, tx + 15, ty + 15), fill="#b6b6b8")
            tile.paste(pic, (0, 148 - pic.height), pic)
            board.paste(tile, (x, y))
            if row == 0:
                draw.text((x, 49), f"{index} · {label}", font=font, fill="white")
    board.save(EXPORT / "runtime-art-preview.png")
    manifest = {
        "status": "exported_for_runtime", "runtimeInstalled": True,
        "userAuthorization": "接入游戏，优化生成算法，每次生成尽量扎堆，不要线性排列",
        "keyThreshold": 100, "removeAllGreen": True,
        "depthUsedForAlpha": False, "runtimeWidthPixels": 256,
        "pipeline": ["key-world122-building-body.py", "finalize-building-runtime.py",
                     "aspect-preserving runtime downsample", "make-energy-vein-depleted.py"],
        "variants": records,
    }
    (EXPORT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"exported": len(records), "size": records[0]["fileSize"],
                      "preview": str(EXPORT / "runtime-art-preview.png")}, ensure_ascii=False))


if __name__ == "__main__":
    main()
