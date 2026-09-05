#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build v11 runtime layers with the modeled floor explicitly omitted."""

from __future__ import annotations

import json
import os
import shutil

import numpy as np
from PIL import Image, ImageDraw


ROOT = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.join(ROOT, "runtime_delivery_v10")
OUTPUT_DIR = os.path.join(ROOT, "runtime_delivery_v11_components_only")
BEAUTY_PATH = os.path.join(SOURCE_DIR, "main_hub_v10_runtime_beauty.png")
ID_PATH = os.path.join(SOURCE_DIR, "main_hub_v10_runtime_semantic_id.png")
BLENDER_MANIFEST_PATH = os.path.join(SOURCE_DIR, "main-hub-v10-blender-render.json")
RUNTIME_MANIFEST_PATH = os.path.join(OUTPUT_DIR, "main-hub-v11-runtime-manifest.json")
PREVIEW_PATH = os.path.join(OUTPUT_DIR, "main_hub_v11_components_only_preview.png")
BOARD_PATH = os.path.join(OUTPUT_DIR, "main_hub_v11_components_only_layers.png")
ASSET_DIR = os.path.normpath(os.path.join(ROOT, "..", "..", "..", "..", "..", "assets", "terrain"))
BACKDROP_PATH = os.path.normpath(os.path.join(ROOT, "..", "..", "..", "..", "..", "assets", "scenes", "main_hub_summit_backdrop_v01.png"))
HUB_TILE_PATH = os.path.normpath(os.path.join(ROOT, "..", "..", "..", "..", "..", "assets", "terrain", "hub_brick.png"))
WIDTH = 2048
HEIGHT = 1152
GAME_ORIGIN = (6144.0, 4096.0)
BACKDROP_BASELINE_WORLD_Y = 3650.0

GROUP_COLORS = {
    "ground": (255, 0, 0),
    "rear_architecture": (0, 255, 0),
    "terraces_and_stair": (0, 0, 255),
    "fixtures": (255, 255, 0),
    "service_plinths": (255, 0, 255),
}

RUNTIME_LAYERS = {
    "component_bases": ("terraces_and_stair", "service_plinths"),
    "rear_architecture": ("rear_architecture",),
    "fixtures": ("fixtures",),
}


def cover(image, size):
    scale = max(size[0] / image.width, size[1] / image.height)
    resized = image.resize((round(image.width * scale), round(image.height * scale)), Image.Resampling.LANCZOS)
    left = (resized.width - size[0]) // 2
    top = (resized.height - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


def tight_crop(image, padding=2):
    bbox = image.getchannel("A").getbbox()
    if bbox is None:
        raise RuntimeError("semantic layer is empty")
    box = (
        max(0, bbox[0] - padding), max(0, bbox[1] - padding),
        min(image.width, bbox[2] + padding), min(image.height, bbox[3] + padding),
    )
    return image.crop(box), box


def placement_for(box, origin_pixel, world_per_pixel):
    left, top, right, bottom = box
    width = right - left
    height = bottom - top
    center_x = left + width * 0.5
    center_y = top + height * 0.5
    return {
        "screenCenterX": round(GAME_ORIGIN[0] + (center_x - origin_pixel[0]) * world_per_pixel, 6),
        "screenCenterY": round(GAME_ORIGIN[1] + (center_y - origin_pixel[1]) * world_per_pixel, 6),
        "displayW": round(width * world_per_pixel, 6),
        "displayH": round(height * world_per_pixel, 6),
        "sourceCrop": {"left": left, "top": top, "right": right, "bottom": bottom, "width": width, "height": height},
    }


def tiled_marble_preview():
    # This board is illustrative only. It uses the actual runtime hub tile as
    # the lower-floor source rather than sampling the removed Blender plane.
    tile = Image.open(HUB_TILE_PATH).convert("RGBA")
    diamond = tile.crop((0, 112, 512, 408))
    floor = Image.new("RGBA", (WIDTH, HEIGHT), (242, 241, 236, 255))
    display = diamond.resize((512, 296), Image.Resampling.LANCZOS)
    for row, y in enumerate(range(350, HEIGHT + 296, 148)):
        offset = -256 if row % 2 else 0
        for x in range(offset, WIDTH + 512, 512):
            floor.alpha_composite(display, (x, y))
    return floor


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(ASSET_DIR, exist_ok=True)
    blender_manifest = json.loads(open(BLENDER_MANIFEST_PATH, "r", encoding="utf-8").read())
    beauty_array = np.asarray(Image.open(BEAUTY_PATH).convert("RGBA")).copy()
    semantic_array = np.asarray(Image.open(ID_PATH).convert("RGBA"))
    active = beauty_array[:, :, 3] > 0
    beauty_array[~active] = 0
    semantic_rgb = semantic_array[:, :, :3].astype(np.int32)
    names = list(GROUP_COLORS)
    colors = np.asarray([GROUP_COLORS[name] for name in names], dtype=np.int32)
    owner = ((semantic_rgb[:, :, None, :] - colors[None, None, :, :]) ** 2).sum(axis=3).argmin(axis=2)
    masks = {name: active & (owner == index) for index, name in enumerate(names)}

    layer_records = {}
    full_layers = {}
    origin_pixel = blender_manifest["originPixel"]
    world_per_pixel = float(blender_manifest["camera"]["orthoScale"]) / WIDTH
    for layer_name, groups in RUNTIME_LAYERS.items():
        mask = np.zeros(active.shape, dtype=bool)
        for group in groups:
            mask |= masks[group]
        pixels = beauty_array.copy()
        pixels[~mask] = 0
        full = Image.fromarray(pixels, "RGBA")
        cropped, crop_box = tight_crop(full)
        filename = f"main_hub_v11_{layer_name}.png"
        cropped.save(os.path.join(OUTPUT_DIR, filename), optimize=True)
        shutil.copy2(os.path.join(OUTPUT_DIR, filename), os.path.join(ASSET_DIR, filename))
        layer_records[layer_name] = {
            "file": filename,
            "assetPath": f"assets/terrain/{filename}",
            "semanticGroups": list(groups),
            "pixelCount": int(mask.sum()),
            **placement_for(crop_box, origin_pixel, world_per_pixel),
        }
        full_layers[layer_name] = full

    shadow_name = "main_hub_v11_shadow_proxy.png"
    shadow = Image.new("RGBA", (2, 2), (0, 0, 0, 0))
    shadow.save(os.path.join(OUTPUT_DIR, shadow_name))
    shadow.save(os.path.join(ASSET_DIR, shadow_name))

    # Exact reconstruction target excludes the authored Blender ground group.
    expected = beauty_array.copy()
    expected[masks["ground"]] = 0
    reconstructed = np.zeros_like(beauty_array)
    for layer_name, groups in RUNTIME_LAYERS.items():
        mask = np.zeros(active.shape, dtype=bool)
        for group in groups:
            mask |= masks[group]
        reconstructed[mask] = beauty_array[mask]
    diff = np.abs(reconstructed.astype(np.int16) - expected.astype(np.int16))
    recomposition = {
        "maxChannelErrorAgainstComponentsOnlyTarget": int(diff.max()),
        "changedPixelsAgainstComponentsOnlyTarget": int(np.any(diff != 0, axis=2).sum()),
        "omittedModeledGroundPixels": int(masks["ground"].sum()),
    }
    if recomposition["maxChannelErrorAgainstComponentsOnlyTarget"] or recomposition["changedPixelsAgainstComponentsOnlyTarget"]:
        raise RuntimeError(f"components-only recomposition mismatch: {recomposition}")

    preview = tiled_marble_preview()
    backdrop = cover(Image.open(BACKDROP_PATH).convert("RGB"), (WIDTH, HEIGHT)).convert("RGBA")
    baseline_y = round(origin_pixel[1] + (BACKDROP_BASELINE_WORLD_Y - GAME_ORIGIN[1]) / world_per_pixel)
    baseline_y = max(0, min(HEIGHT, baseline_y))
    preview.paste(backdrop.crop((0, 0, WIDTH, baseline_y)), (0, 0))
    for name in ("component_bases", "rear_architecture", "fixtures"):
        preview.alpha_composite(full_layers[name])
    preview.save(PREVIEW_PATH, optimize=True)

    board = Image.new("RGB", (2048, 1360), (7, 22, 39))
    board.paste(preview.convert("RGB"), (0, 0))
    draw = ImageDraw.Draw(board)
    draw.rectangle((0, 1152, 2048, 1360), fill=(9, 27, 47))
    draw.text((48, 1188), "MAIN HUB V11 / COMPONENTS ONLY", fill=(224, 226, 221))
    draw.text((48, 1232), "original hub_brick floor retained | modeled Blender floor omitted | summit backdrop retained", fill=(156, 177, 191))
    draw.text((48, 1274), "columns + component bases + lamps only | locked camera | no baked cast shadow", fill=(156, 177, 191))
    board.save(BOARD_PATH, optimize=True)

    manifest = {
        "assetId": "main_hub_v11_components_only_runtime_delivery",
        "status": "formally_integrated_assets_ready",
        "sourceBlend": "../runtime_delivery_v10/main_hub_runtime_master_v10.blend",
        "geometrySourceOfTruth": "v10 fixed-column Blender model",
        "modeledGroundIncluded": False,
        "runtimeFloor": "assets/terrain/hub_brick.png via scenes.mainHub.floor",
        "runtimeBackdrop": "assets/scenes/main_hub_summit_backdrop_v01.png",
        "runtimeLayers": layer_records,
        "shadowProxy": {"file": shadow_name, "assetPath": f"assets/terrain/{shadow_name}"},
        "camera": blender_manifest["camera"],
        "originPixel": origin_pixel,
        "worldPerPixel": round(world_per_pixel, 9),
        "recomposition": recomposition,
        "lightingOrShadowParametersChanged": False,
        "bakedDirectionalCastShadow": False,
        "runtimeIntegrated": True,
    }
    with open(RUNTIME_MANIFEST_PATH, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print("V11_COMPONENTS_ONLY_MANIFEST", RUNTIME_MANIFEST_PATH)
    print("V11_COMPONENTS_ONLY_PREVIEW", BOARD_PATH)
    print("V11_COMPONENTS_ONLY_RECOMPOSITION", json.dumps(recomposition))


if __name__ == "__main__":
    main()
