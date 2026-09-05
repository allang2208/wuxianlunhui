"""Derive purple mineral pixels from the five accepted runtime piles, preserving stone and alpha."""

import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = ROOT / "high_energy"


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    records = []
    board = Image.new("RGB", (1440, 416), "#222831")
    draw = ImageDraw.Draw(board)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 23)
    draw.text((18, 12), "矿洞位面 · 紫色高能矿脉（新生成储量 ×2） / 共用枯竭态", font=font, fill="white")
    for index in range(1, 6):
        source = REPO / f"assets/terrain/energy_node_rubble_{index}.png"
        target = REPO / f"assets/terrain/energy_node_high_energy_{index}.png"
        depleted = REPO / f"assets/terrain/energy_node_rubble_depleted_{index}.png"
        rgba = np.asarray(Image.open(source).convert("RGBA")).copy()
        rgb = rgba[..., :3].astype(np.float32)
        red, green, blue = rgb[..., 0], rgb[..., 1], rgb[..., 2]
        # Saturated blue/cyan mineral only; exclude the gray rock's cool shadows.
        weight = np.clip((blue - red - 45) / 35, 0, 1) * np.clip((green - red - 12) / 18, 0, 1)
        weight *= rgba[..., 3] > 0
        purple = np.stack((blue * .72 + green * .18, red * .4 + green * .4, blue), axis=-1)
        rgba[..., :3] = np.rint(np.clip(rgb + (purple - rgb) * weight[..., None], 0, 255)).astype(np.uint8)
        Image.fromarray(rgba).save(target, optimize=True)
        records.append({
            "variant": index,
            "source": source.relative_to(REPO).as_posix(),
            "output": target.relative_to(REPO).as_posix(),
            "depleted": depleted.relative_to(REPO).as_posix(),
            "size": [rgba.shape[1], rgba.shape[0]],
            "operation": "mineral-blue-to-purple-v1; RGB-only, no recrop, rescale, alpha edit or whole-rock tint",
        })
        x = (index - 1) * 288 + 16
        draw.text((x, 48), f"{index}号", font=font, fill="white")
        for row, path in enumerate((target, depleted)):
            image = Image.open(path).convert("RGBA")
            tile = Image.new("RGB", (256, 148), "#64646a")
            td = ImageDraw.Draw(tile)
            for y in range(0, 148, 16):
                for xx in range(0, 256, 16):
                    if (y // 16 + xx // 16) % 2:
                        td.rectangle((xx, y, xx + 15, y + 15), fill="#b6b6b8")
            tile.paste(image, (0, 148 - image.height), image)
            board.paste(tile, (x, 78 + row * 164))
    board.save(OUT / "high-energy-preview.png")
    manifest = {
        "sceneId": "scene12", "name": "高能矿脉", "storageMultiplier": 2,
        "storageConfig": "src/config/energy-config.js#highEnergy",
        "sourcePipeline": "Approved Dev rubble variants, deterministic local mineral palette derivative",
        "script": "export-high-energy.py", "alphaPreserved": True,
        "sharedDepletedState": True, "runtimeInstalled": True, "variants": records,
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(str(OUT / "high-energy-preview.png"))


if __name__ == "__main__":
    main()
