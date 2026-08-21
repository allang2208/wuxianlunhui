#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the editable modular World-122 economic workshop reference model."""

import importlib.util
import json
import math
import os
import sys

import bpy


def load_kit():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "building-component-kit.py")
    spec = importlib.util.spec_from_file_location("world122_building_components", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kit = load_kit()


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 4:
        raise SystemExit("usage: blender --background --python workshop-blender-template.py -- spec.json out.blend preview.png depth.png")
    return tuple(os.path.abspath(path) for path in argv)


def build(spec):
    palette = {key: kit.rgba(value) for key, value in spec["palette"].items()}
    dims = spec["dimensions"]
    collection = bpy.data.collections.new("WORKSHOP_MODEL_EDITABLE")
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new("WORKSHOP_ROOT_ROT_Z_44_8", None)
    collection.objects.link(root)
    root.rotation_euler.z = math.radians(float(spec["camera"]["buildingRotationZ"]))

    mats = {
        "foundation": kit.material("MAT_Fieldstone", palette["foundation"], noise={"scale": 4.2, "detail": 4, "bump": 0.24}),
        "plaster": kit.material("MAT_Warm_Plaster", palette["plaster"], noise={"scale": 7, "detail": 2, "bump": 0.08}),
        "timber": kit.material("MAT_Dark_Oak", palette["timber"], noise={"scale": 3, "detail": 5, "bump": 0.2}),
        "roof": kit.material("MAT_Aged_Red_Tile", palette["roof"], noise={"scale": 11, "detail": 4, "bump": 0.24}),
        "iron": kit.material("MAT_Blackened_Iron", palette["iron"], roughness=0.46, metallic=0.72, noise={"scale": 7, "detail": 3, "bump": 0.12}),
        "brass": kit.material("MAT_Aged_Brass", palette["brass"], roughness=0.42, metallic=0.68, noise={"scale": 6, "detail": 3, "bump": 0.08}),
        "glass": kit.material("MAT_Warm_Glass", palette["glass"], roughness=0.24, emission=(palette["glass"], 0.45)),
        "glow": kit.material("MAT_Forge_Glow", palette["glow"], roughness=0.3, emission=(palette["glow"], 2.4)),
        "stone": kit.material("MAT_Chimney_Stone", palette["stone"], noise={"scale": 5, "detail": 4, "bump": 0.23}),
    }

    foundation = dims["foundation"]
    body = dims["body"]
    second_floor = dims.get("secondFloor")
    roof = dims["roof"]
    fh = foundation[2]
    body_base = fh
    first_floor_top = fh + body[2]
    second_floor_base = first_floor_top
    roof_base = (second_floor_base + second_floor[2] - 3
                 if second_floor else first_floor_top - 3)
    front_y = -body[1] / 2 - 3
    side_x = -body[0] / 2 - 3

    kit.box(collection, root, "Foundation_Stone", foundation, (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    kit.box(collection, root, "Workshop_Plaster_Body", body, (0, 0, fh + body[2] / 2), mats["plaster"], bevel_width=5)
    kit.box(collection, root, "Stone_Lower_Wall", (body[0] + 8, body[1] + 8, 45),
            (0, 0, fh + 22), mats["foundation"], bevel_width=4)
    if second_floor:
        upper_w, upper_d, upper_h = second_floor
        kit.box(collection, root, "SecondFloor_Plaster_Body", second_floor,
                (0, 0, second_floor_base + upper_h / 2), mats["plaster"], bevel_width=4)
        # A visible floor beam and short corbels make the extra storey read as a
        # structural addition while leaving every ground-floor object untouched.
        kit.box(collection, root, "SecondFloor_Front_Sill", (upper_w + 18, 12, 13),
                (0, -upper_d / 2 - 5, second_floor_base + 4), mats["timber"], bevel_width=1.5)
        kit.box(collection, root, "SecondFloor_Left_Sill", (12, upper_d + 18, 13),
                (-upper_w / 2 - 5, 0, second_floor_base + 4), mats["timber"], bevel_width=1.5)
        for x in (-upper_w / 2 + 20, -upper_w / 4, 0, upper_w / 4, upper_w / 2 - 20):
            kit.box(collection, root, f"SecondFloor_Front_Corbel_{int(x)}", (9, 26, 24),
                    (x, -upper_d / 2 - 10, second_floor_base - 5), mats["timber"],
                    rotation=(25, 0, 0), bevel_width=1)
        for y in (-upper_d / 2 + 20, 0, upper_d / 2 - 20):
            kit.box(collection, root, f"SecondFloor_Left_Corbel_{int(y)}", (26, 9, 24),
                    (-upper_w / 2 - 10, y, second_floor_base - 5), mats["timber"],
                    rotation=(0, -25, 0), bevel_width=1)
    kit.gabled_prism(collection, root, "Main_Gabled_Roof", roof[0], roof[1], roof[2],
                     (0, 0, roof_base), mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "RoofTile", roof[0], roof[1], roof[2], roof_base, mats["roof"], rows=12)
    kit.box(collection, root, "Roof_Ridge_Cap", (roof[0] + 16, 9, 9),
            (0, 0, roof_base + roof[2] + 3), mats["brass"], bevel_width=1.2)

    kit.half_timber_facade(collection, root, "Front_Timber", body[0], body[2], front_y,
                           fh, mats["timber"], bays=4)
    kit.half_timber_side(collection, root, "Left_Timber", body[1], body[2], side_x,
                         fh, mats["timber"], bays=3)
    if second_floor:
        upper_w, upper_d, upper_h = second_floor
        upper_front_y = -upper_d / 2 - 3
        upper_side_x = -upper_w / 2 - 3
        kit.half_timber_facade(collection, root, "SecondFloor_Front_Timber", upper_w,
                               upper_h, upper_front_y, second_floor_base,
                               mats["timber"], bays=3)
        kit.half_timber_side(collection, root, "SecondFloor_Left_Timber", upper_d,
                             upper_h, upper_side_x, second_floor_base,
                             mats["timber"], bays=2)

    # Recessed open entrance with reusable double leaves and an interior work zone.
    door_w, door_h = dims["door"]
    kit.box(collection, root, "Entrance_Recess", (door_w + 22, 14, door_h + 14),
            (0, front_y - 2, fh + door_h / 2), mats["timber"], bevel_width=3)
    kit.box(collection, root, "Entrance_Warm_Interior", (door_w - 4, 8, door_h - 5),
            (0, front_y - 10, fh + door_h / 2), mats["glow"], bevel_width=2)
    kit.double_doors(collection, root, "Workshop_DoubleDoor", (0, front_y - 13, fh),
                     door_w, door_h, mats["timber"], mats["iron"], open_angle=22)
    kit.workbench(collection, root, "Interior_Workbench", (0, front_y - 24, fh + 3), mats["timber"], mats["iron"])
    kit.anvil(collection, root, "Front_Anvil", (58, front_y - 27, fh + 3), mats["iron"])

    # Windows and lighting are separate donor-ready component clusters.
    kit.shutter_window(collection, root, "Front_Window_Left", (-112, front_y - 3, fh + 92),
                       mats["glass"], mats["timber"], mats["iron"], scale=0.86)
    kit.shutter_window(collection, root, "Front_Window_Right", (112, front_y - 3, fh + 92),
                       mats["glass"], mats["timber"], mats["iron"], scale=0.86)
    kit.shutter_window(collection, root, "Side_Window_Front", (side_x - 2, -67, fh + 92),
                       mats["glass"], mats["timber"], mats["iron"], orientation="side", scale=0.9)
    kit.shutter_window(collection, root, "Side_Window_Back", (side_x - 2, 67, fh + 92),
                       mats["glass"], mats["timber"], mats["iron"], orientation="side", scale=0.9)
    kit.lantern(collection, root, "Lantern_Left", (-73, front_y - 15, fh + 88), mats["iron"], mats["glow"])
    kit.lantern(collection, root, "Lantern_Right", (73, front_y - 15, fh + 88), mats["iron"], mats["glow"])
    if second_floor:
        upper_w, upper_d, upper_h = second_floor
        upper_front_y = -upper_d / 2 - 3
        upper_side_x = -upper_w / 2 - 3
        upper_window_z = second_floor_base + upper_h * 0.54
        kit.shutter_window(collection, root, "SecondFloor_Window_Left",
                           (-upper_w * 0.27, upper_front_y - 3, upper_window_z),
                           mats["glass"], mats["timber"], mats["iron"], scale=0.78)
        kit.shutter_window(collection, root, "SecondFloor_Window_Right",
                           (upper_w * 0.27, upper_front_y - 3, upper_window_z),
                           mats["glass"], mats["timber"], mats["iron"], scale=0.78)
        kit.shutter_window(collection, root, "SecondFloor_Side_Window_Front",
                           (upper_side_x - 2, -upper_d * 0.24, upper_window_z),
                           mats["glass"], mats["timber"], mats["iron"],
                           orientation="side", scale=0.76)
        kit.shutter_window(collection, root, "SecondFloor_Side_Window_Back",
                           (upper_side_x - 2, upper_d * 0.24, upper_window_z),
                           mats["glass"], mats["timber"], mats["iron"],
                           orientation="side", scale=0.76)

    # Mechanical identity: large gable crest plus smaller wall gear train.
    crest_z = roof_base + roof[2] * 0.43
    crest_y = -roof[1] / 2 - 5
    kit.gear(collection, root, "Gable_Gear_Crest", 35, (0, crest_y, crest_z), mats["iron"], teeth=14)
    kit.box(collection, root, "Gable_Hammer_Handle", (8, 8, 64), (0, crest_y - 11, crest_z),
            mats["brass"], rotation=(0, 34, 0), bevel_width=1)
    kit.box(collection, root, "Gable_Hammer_Head", (34, 9, 12), (-17, crest_y - 11, crest_z + 25),
            mats["brass"], rotation=(0, 34, 0), bevel_width=2)
    kit.gear(collection, root, "Side_Gear_Large", 25, (side_x - 9, 62, fh + 83), mats["brass"], axis="X", teeth=12)
    kit.gear(collection, root, "Side_Gear_Small", 16, (side_x - 10, 102, fh + 114), mats["iron"], axis="X", teeth=10)

    chimney_x, chimney_y = dims["chimneyPosition"]
    kit.chimney(collection, root, "Forge_Chimney", (chimney_x, chimney_y, roof_base + 37),
                mats["stone"], mats["iron"], height=dims["chimneyHeight"])
    return root


def main():
    spec_path, blend_path, preview_path, depth_path = parse_args()
    with open(spec_path, "r", encoding="utf-8-sig") as handle:
        spec = json.load(handle)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    root = build(spec)
    kit.setup_scene(spec, preview_path)
    camera = kit.setup_camera(spec, root)
    bpy.context.scene.camera = camera
    os.makedirs(os.path.dirname(blend_path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.render.render(write_still=True)
    kit.render_depth(bpy.context.scene, root, camera, depth_path, "Workshop")
    print("workshop model ->", blend_path)
    print("workshop preview ->", preview_path)
    print("workshop depth ->", depth_path)


if __name__ == "__main__":
    main()
