#!/usr/bin/env python3
"""Crop a modeled contact overlay and compare it under the accepted sprite."""

import argparse
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


SCENE_SIZE = 512
CONTACT_CENTER = (SCENE_SIZE // 2, 360)


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("building_id")
    parser.add_argument("overlay_1024", type=Path)
    parser.add_argument("runtime_metadata", type=Path)
    parser.add_argument("output_dir", type=Path)
    parser.add_argument("--config", type=Path,
                        default=Path("data/producer-buildings.json"))
    parser.add_argument("--paving", type=Path,
                        default=Path("assets/terrain/building_road_tiles.png"))
    parser.add_argument("--building", type=Path)
    return parser.parse_args()


def draw_road(scene, sheet, center):
    frame_w = sheet.width // 4
    frame_h = sheet.height
    cx, cy = center
    placements = (
        (0, cx, cy - 32),
        (1, cx + 64, cy),
        (2, cx - 64, cy),
        (3, cx, cy + 32),
    )
    for frame_index, tile_x, tile_y in placements:
        frame = sheet.crop((frame_index * frame_w, 0,
                            (frame_index + 1) * frame_w, frame_h))
        scene.alpha_composite(frame, (round(tile_x - frame_w / 2),
                                      round(tile_y - frame_h / 2)))


def scaled_asset(image, width, height):
    return image.resize((int(width), int(height)), Image.Resampling.LANCZOS)


def place_for_footprint(entry, center):
    footprint = entry["visualFootprint"]
    return (
        round(center[0] - float(footprint["centerXRatio"]) * entry["displayW"]),
        round(center[1] - float(footprint["centerYRatio"]) * entry["displayH"]),
    )


def make_scene(entry, building, overlay, road, include_overlay):
    scene = Image.new("RGBA", (SCENE_SIZE, SCENE_SIZE), (25, 30, 37, 255))
    draw_road(scene, road, CONTACT_CENTER)
    position = place_for_footprint(entry, CONTACT_CENTER)
    if include_overlay:
        scene.alpha_composite(
            scaled_asset(overlay, entry["displayW"], entry["displayH"]), position)
    scene.alpha_composite(
        scaled_asset(building, entry["displayW"], entry["displayH"]), position)
    return scene


def main():
    args = parse_args()
    with args.config.open("r", encoding="utf-8-sig") as handle:
        config = json.load(handle)
    entry = config[args.building_id]
    with args.runtime_metadata.open("r", encoding="utf-8-sig") as handle:
        runtime_metadata = json.load(handle)

    building_path = args.building or Path(
        entry.get("assetPath", f"assets/terrain/{entry['tex']}.png"))
    building = Image.open(building_path).convert("RGBA")
    overlay_1024 = Image.open(args.overlay_1024).convert("RGBA")
    crop_box = tuple(runtime_metadata["cropBox"])
    overlay = overlay_1024.crop(crop_box)
    if overlay.size != building.size:
        raise SystemExit(
            f"overlay crop {overlay.size} does not match building {building.size}; "
            "camera/crop contract drifted")

    road = Image.open(args.paving).convert("RGBA")
    before = make_scene(entry, building, overlay, road, False)
    after = make_scene(entry, building, overlay, road, True)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    overlay_path = args.output_dir / f"{args.building_id}_ground_contact_overlay_runtime_canvas.png"
    after_path = args.output_dir / f"{args.building_id}_ground_contact_after.png"
    review_path = args.output_dir / f"{args.building_id}_ground_contact_review.png"
    overlay.save(overlay_path)
    after.save(after_path)

    margin, gap, label_h = 24, 18, 42
    review = Image.new(
        "RGB", (margin * 2 + SCENE_SIZE * 2 + gap,
                margin * 2 + label_h + SCENE_SIZE), (16, 20, 26))
    review.paste(before.convert("RGB"), (margin, margin + label_h))
    review.paste(after.convert("RGB"),
                 (margin + SCENE_SIZE + gap, margin + label_h))
    draw = ImageDraw.Draw(review)
    font = ImageFont.load_default()
    draw.text((margin, margin + 12), "BEFORE  current formal sprite + road",
              fill=(205, 214, 224), font=font)
    draw.text((margin + SCENE_SIZE + gap, margin + 12),
              "AFTER  modeled contact overlay under sprite",
              fill=(117, 213, 240), font=font)
    review.save(review_path)

    print("overlay runtime canvas ->", overlay_path)
    print("after preview ->", after_path)
    print("comparison ->", review_path)


if __name__ == "__main__":
    main()
