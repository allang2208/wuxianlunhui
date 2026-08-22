#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build modular World-122 settlement buildings from one reusable component kit."""

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
    if len(argv) != 5:
        raise SystemExit("usage: blender --background --python settlement-building-pack-blender.py -- manifest.json id out.blend preview.png depth.png")
    manifest, building_id, blend, preview, depth = argv
    return os.path.abspath(manifest), building_id, os.path.abspath(blend), os.path.abspath(preview), os.path.abspath(depth)


def hipped_roof(collection, root, name, length, width, height, location, mat):
    half_l, half_w = length / 2, width / 2
    top_l, top_w = length * 0.42, width * 0.08
    z = height
    vertices = [
        (-half_l, -half_w, 0), (half_l, -half_w, 0),
        (half_l, half_w, 0), (-half_l, half_w, 0),
        (-top_l, -top_w, z), (top_l, -top_w, z),
        (top_l, top_w, z), (-top_l, top_w, z),
    ]
    faces = [(0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7), (4, 5, 6, 7)]
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    obj.location = location
    kit.bevel(obj, 1.8, 2)
    return obj


def cone(collection, root, name, radius, height, location, mat, vertices=32):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=0, depth=height)
    obj = bpy.context.object
    obj.name = name
    obj.parent = root
    obj.location = location
    obj.data.materials.append(mat)
    kit.bevel(obj, 0.8, 2)
    kit.move_to_collection(obj, collection)
    return obj


def common_context(building_id, spec):
    palette = {key: kit.rgba(value) for key, value in spec["palette"].items()}
    collection = bpy.data.collections.new(building_id.upper() + "_EDITABLE_COMPONENTS")
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new(building_id.upper() + "_ROOT_ROT_Z_44_8", None)
    collection.objects.link(root)
    root.rotation_euler.z = math.radians(float(spec["camera"]["buildingRotationZ"]))
    mats = {
        "foundation": kit.material("MAT_Fieldstone_Foundation", palette["foundation"], noise={"scale": 4.5, "detail": 4, "bump": 0.24}),
        "stone": kit.material("MAT_Weathered_Stone", palette["stone"], noise={"scale": 5, "detail": 4, "bump": 0.23}),
        "plaster": kit.material("MAT_Muted_Plaster", palette["plaster"], noise={"scale": 7, "detail": 2, "bump": 0.08}),
        "timber": kit.material("MAT_Dark_Oak", palette["timber"], noise={"scale": 3, "detail": 5, "bump": 0.2}),
        "roof": kit.material("MAT_Aged_Roof", palette["roof"], noise={"scale": 10, "detail": 4, "bump": 0.24}),
        "thatch": kit.material("MAT_Thatch", palette["thatch"], roughness=0.96, noise={"scale": 15, "detail": 5, "bump": 0.35}),
        "iron": kit.material("MAT_Blackened_Iron", palette["iron"], roughness=0.48, metallic=0.72, noise={"scale": 7, "detail": 3, "bump": 0.12}),
        "brass": kit.material("MAT_Aged_Brass", palette["brass"], roughness=0.42, metallic=0.66),
        "glass": kit.material("MAT_Warm_Glass", palette["glass"], roughness=0.25, emission=(palette["glass"], 0.38)),
        "glow": kit.material("MAT_Warm_Glow", palette["glow"], roughness=0.3, emission=(palette["glow"], 2.0)),
        "straw": kit.material("MAT_Straw", palette["straw"], roughness=0.9, noise={"scale": 12, "detail": 4, "bump": 0.25}),
    }
    return collection, root, mats


def standard_shell(collection, root, mats, dims, *, roof_kind="gable", thatch=False, bays=4):
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    kit.box(collection, root, "Foundation", (fw, fd, fh), (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    kit.box(collection, root, "Body_Plaster", (bw, bd, bh), (0, 0, fh + bh / 2), mats["plaster"], bevel_width=5)
    kit.box(collection, root, "Lower_Stone_Wall", (bw + 7, bd + 7, min(52, bh * 0.34)),
            (0, 0, fh + min(52, bh * 0.34) / 2), mats["stone"], bevel_width=4)
    roof_base = fh + bh - 3
    roof_mat = mats["thatch"] if thatch else mats["roof"]
    if roof_kind == "hipped":
        hipped_roof(collection, root, "Main_Hipped_Roof", rw, rd, rh, (0, 0, roof_base), roof_mat)
    else:
        kit.gabled_prism(collection, root, "Main_Gabled_Roof", rw, rd, rh,
                         (0, 0, roof_base), mats["timber"], roof_mat)
        kit.roof_rows(collection, root, "RoofCourse", rw, rd, rh, roof_base, roof_mat,
                      rows=9 if thatch else 11)
    front_y = -bd / 2 - 3
    side_x = -bw / 2 - 3
    kit.half_timber_facade(collection, root, "Front_Timber", bw, bh, front_y, fh, mats["timber"], bays=bays)
    kit.half_timber_side(collection, root, "Left_Timber", bd, bh, side_x, fh, mats["timber"], bays=max(2, bays - 1))
    return {"fh": fh, "bw": bw, "bd": bd, "bh": bh, "rw": rw, "rd": rd, "rh": rh,
            "roofBase": roof_base, "frontY": front_y, "sideX": side_x}


def add_windmill_sails(collection, root, mats, y, hub_z, blade_length=158, radius=92, blade_width=42):
    kit.cylinder(collection, root, "Windmill_Hub_Back", 29, 18, (0, y, hub_z), mats["iron"], rotation=(90, 0, 0), vertices=48)
    kit.cylinder(collection, root, "Windmill_Hub_Wood", 23, 28, (0, y - 10, hub_z), mats["timber"], rotation=(90, 0, 0), vertices=48)
    for blade_index, angle in enumerate((45, 135, 225, 315)):
        rad = math.radians(angle)
        center_distance = radius
        cx = math.cos(rad) * center_distance
        cz = hub_z + math.sin(rad) * center_distance
        rotation = (0, -angle, 0)
        kit.box(collection, root, f"Sail_{blade_index}_CenterSpine", (blade_length, 9, 10),
                (cx, y - 23, cz), mats["timber"], rotation=rotation, bevel_width=1)
        perpendicular = (-math.sin(rad), math.cos(rad))
        for rail_index, offset in enumerate((-blade_width / 2, blade_width / 2)):
            rx = cx + perpendicular[0] * offset
            rz = cz + perpendicular[1] * offset
            kit.box(collection, root, f"Sail_{blade_index}_Rail_{rail_index}", (blade_length - 4, 7, 7),
                    (rx, y - 24, rz), mats["timber"], rotation=rotation, bevel_width=0.8)
        for slat_index, longitudinal in enumerate((-0.38, -0.19, 0, 0.19, 0.38)):
            longitudinal *= blade_length
            sx = cx + math.cos(rad) * longitudinal
            sz = cz + math.sin(rad) * longitudinal
            kit.box(collection, root, f"Sail_{blade_index}_Slat_{slat_index}", (7, 7, blade_width),
                    (sx, y - 25, sz), mats["timber"], rotation=rotation, bevel_width=0.6)
    kit.cylinder(collection, root, "Windmill_Hub_Cap", 12, 34, (0, y - 26, hub_z), mats["brass"], rotation=(90, 0, 0), vertices=32)


def build_windmill(spec):
    collection, root, mats = common_context("wheat_windmill", spec)
    fw, fd, fh = spec["dimensions"]["foundation"]
    bw, bd, bh = spec["dimensions"]["body"]
    rw, rd, rh = spec["dimensions"]["roof"]
    lower_h = bh * 0.54
    upper_h = bh - lower_h
    kit.box(collection, root, "Mill_Foundation", (fw, fd, fh), (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    kit.box(collection, root, "Mill_Tall_Stone_Base", (bw + 8, bd + 8, lower_h),
            (0, 0, fh + lower_h / 2), mats["stone"], bevel_width=5)
    kit.box(collection, root, "Mill_Upper_Plaster", (bw, bd, upper_h),
            (0, 0, fh + lower_h + upper_h / 2), mats["plaster"], bevel_width=4)
    front_y = -bd / 2 - 4
    side_x = -bw / 2 - 4
    kit.half_timber_facade(collection, root, "Mill_Upper_Timber", bw, upper_h, front_y,
                           fh + lower_h, mats["timber"], bays=3)
    kit.half_timber_side(collection, root, "Mill_Upper_Side_Timber", bd, upper_h, side_x,
                         fh + lower_h, mats["timber"], bays=2)
    roof_base = fh + bh - 3
    kit.gabled_prism(collection, root, "Mill_Compact_Gabled_Roof", rw, rd, rh,
                     (0, 0, roof_base), mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "Mill_RoofCourse", rw, rd, rh, roof_base, mats["roof"], rows=10)
    kit.double_doors(collection, root, "Mill_Grain_Door", (0, front_y - 5, fh), 72, 106,
                     mats["timber"], mats["iron"], open_angle=0)
    kit.shutter_window(collection, root, "Mill_Upper_Window", (48, front_y - 3, fh + lower_h + 70),
                       mats["glass"], mats["timber"], mats["iron"], scale=0.62)
    kit.shutter_window(collection, root, "Mill_Side_Window", (side_x - 2, 36, fh + lower_h + 62),
                       mats["glass"], mats["timber"], mats["iron"], orientation="side", scale=0.66)
    add_windmill_sails(collection, root, mats, front_y - 18, fh + lower_h + upper_h * 0.60,
                       blade_length=254, radius=150, blade_width=48)
    return root


def build_warehouse(spec):
    collection, root, mats = common_context("warehouse", spec)
    g = standard_shell(collection, root, mats, spec["dimensions"], bays=4)
    kit.double_doors(collection, root, "Warehouse_DoubleDoor", (-72, g["frontY"] - 6, g["fh"]), 112, 126, mats["timber"], mats["iron"], open_angle=0)
    for floor_index, z in enumerate((g["fh"] + 116, g["fh"] + 222, g["fh"] + 328), start=2):
        kit.box(collection, root, f"Warehouse_FloorBand_{floor_index}", (g["bw"] + 10, 10, 12),
                (0, g["frontY"] - 1, z), mats["timber"], bevel_width=1)
        for x in (-122, 122):
            kit.shutter_window(collection, root, f"Warehouse_F{floor_index}_Window_{x}",
                               (x, g["frontY"] - 3, z + 47), mats["glass"], mats["timber"],
                               mats["iron"], scale=0.60)
    platform_z = g["fh"] + 132
    kit.box(collection, root, "Warehouse_SecondFloor_Platform", (244, 74, 13),
            (36, g["frontY"] - 38, platform_z), mats["timber"], bevel_width=2)
    kit.box(collection, root, "Warehouse_Loft_DarkOpening", (88, 7, 86),
            (38, g["frontY"] - 9, platform_z + 47), mats["iron"], bevel_width=2)
    kit.double_doors(collection, root, "Warehouse_Loft_Doors", (38, g["frontY"] - 14, platform_z + 5),
                     84, 82, mats["timber"], mats["iron"], open_angle=22)
    for x in (-82, -18, 46, 110, 158):
        kit.box(collection, root, f"Warehouse_Balcony_Post_{x}", (8, 8, 58),
                (x, g["frontY"] - 76, platform_z + 31), mats["timber"], bevel_width=1)
    for z in (platform_z + 17, platform_z + 48):
        kit.box(collection, root, f"Warehouse_Balcony_Rail_{int(z)}", (248, 8, 8),
                (36, g["frontY"] - 76, z), mats["timber"], bevel_width=1)
    for index, (x, y, size) in enumerate(((-56, g["frontY"] - 43, 30),
                                          (86, g["frontY"] - 48, 34),
                                          (128, g["frontY"] - 43, 25))):
        kit.box(collection, root, f"Warehouse_Platform_Crate_{index}", (size, size, size),
                (x, y, platform_z + 13 + size / 2), mats["timber"], bevel_width=2)
        for band in (-size * 0.28, size * 0.28):
            kit.box(collection, root, f"Warehouse_Platform_CrateBand_{index}_{int(band)}",
                    (4, size + 2, size - 5), (x + band, y - 1, platform_z + 13 + size / 2),
                    mats["iron"], bevel_width=0.4)
    for index, x in enumerate((0, 52)):
        kit.cylinder(collection, root, f"Warehouse_Platform_Barrel_{index}", 17, 38,
                     (x, g["frontY"] - 48, platform_z + 32), mats["timber"], vertices=24, bevel_width=2)
        for z in (platform_z + 18, platform_z + 45):
            kit.cylinder(collection, root, f"Warehouse_Platform_BarrelBand_{index}_{int(z)}", 18, 4,
                         (x, g["frontY"] - 48, z), mats["iron"], vertices=24, bevel_width=0.4)
    kit.box(collection, root, "Warehouse_Hoist_Beam", (72, 12, 13), (38, g["frontY"] - 24, g["fh"] + g["bh"] + 35), mats["timber"], bevel_width=1)
    kit.cylinder(collection, root, "Warehouse_Hoist_Pulley", 11, 7, (38, g["frontY"] - 31, g["fh"] + g["bh"] + 26), mats["iron"], rotation=(90, 0, 0), vertices=32)
    fourth_z = g["fh"] + 338
    side_x = g["sideX"] - 38
    kit.box(collection, root, "Warehouse_FourthFloor_SidePlatform", (76, 206, 13),
            (side_x, 24, fourth_z), mats["timber"], bevel_width=2)
    kit.box(collection, root, "Warehouse_FourthFloor_SideOpening", (8, 88, 88),
            (g["sideX"] - 7, 18, fourth_z + 48), mats["iron"], bevel_width=2)
    kit.box(collection, root, "Warehouse_FourthFloor_SideDoor_Open", (8, 48, 86),
            (side_x - 18, -32, fourth_z + 47), mats["timber"], rotation=(0, 0, 34), bevel_width=2)
    outer_x = g["sideX"] - 77
    for z in (fourth_z + 18, fourth_z + 50):
        kit.box(collection, root, f"Warehouse_FourthFloor_SideRail_{int(z)}", (8, 210, 8),
                (outer_x, 24, z), mats["timber"], bevel_width=1)
    for y in (-76, -26, 24, 74, 124):
        kit.box(collection, root, f"Warehouse_FourthFloor_SidePost_{y}", (9, 9, 61),
                (outer_x, y, fourth_z + 32), mats["timber"], bevel_width=1)
    for index, (y, size) in enumerate(((-52, 28), (18, 34), (86, 25))):
        kit.box(collection, root, f"Warehouse_FourthFloor_Crate_{index}", (size, size, size),
                (side_x, y, fourth_z + 13 + size / 2), mats["timber"], bevel_width=2)
    for index, y in enumerate((-12, 58)):
        kit.cylinder(collection, root, f"Warehouse_FourthFloor_Barrel_{index}", 16, 36,
                     (side_x - 2, y, fourth_z + 31), mats["timber"], vertices=24, bevel_width=2)
    kit.box(collection, root, "Warehouse_FourthFloor_BundledSacks", (42, 52, 24),
            (side_x + 5, 110, fourth_z + 25), mats["straw"], rotation=(0, 0, -8), bevel_width=8)
    kit.lantern(collection, root, "Warehouse_Lantern_Left", (-82, g["frontY"] - 15, g["fh"] + 94), mats["iron"], mats["glow"])
    kit.lantern(collection, root, "Warehouse_Lantern_Right", (82, g["frontY"] - 15, g["fh"] + 94), mats["iron"], mats["glow"])
    return root


def build_blacksmith(spec):
    collection, root, mats = common_context("blacksmith", spec)
    g = standard_shell(collection, root, mats, spec["dimensions"], bays=3)
    door_x = -82
    kit.box(collection, root, "Forge_Left_Door_Frame", (102, 17, 124),
            (door_x, g["frontY"] - 4, g["fh"] + 62), mats["stone"], bevel_width=4)
    kit.box(collection, root, "Forge_Left_Interior", (84, 8, 108),
            (door_x, g["frontY"] - 14, g["fh"] + 55), mats["iron"], bevel_width=2)
    open_door = kit.box(collection, root, "Forge_Left_Door_Open", (46, 9, 108),
                        (door_x - 48, g["frontY"] - 28, g["fh"] + 55), mats["timber"],
                        rotation=(0, 0, -38), bevel_width=2)
    for row in (-30, 0, 30):
        kit.box(collection, open_door, f"Forge_Left_Door_Band_{row}", (38, 4, 5),
                (0, -6, row), mats["iron"], bevel_width=0.4)
    kit.box(collection, root, "Forge_Interior_Shelf", (72, 22, 8),
            (door_x, g["frontY"] + 2, g["fh"] + 72), mats["timber"], bevel_width=1)
    for index, x in enumerate((-104, -82, -60)):
        kit.box(collection, root, f"Forge_Interior_Tool_{index}", (5, 7, 42 - index * 5),
                (x, g["frontY"] - 17, g["fh"] + 49), mats["iron"], rotation=(0, index * 8 - 8, 0), bevel_width=0.5)
    kit.box(collection, root, "Forge_Interior_Embers", (54, 14, 15),
            (door_x, g["frontY"] - 18, g["fh"] + 15), mats["glow"], bevel_width=3)
    kit.box(collection, root, "Forge_Opening_Frame", (106, 16, 104), (58, g["frontY"] - 4, g["fh"] + 52), mats["stone"], bevel_width=4)
    kit.box(collection, root, "Forge_Opening_Glow", (88, 9, 84), (58, g["frontY"] - 13, g["fh"] + 45), mats["glow"], bevel_width=2)
    kit.workbench(collection, root, "Forge_Workbench", (48, g["frontY"] - 29, g["fh"] + 3), mats["timber"], mats["iron"])
    kit.anvil(collection, root, "Forge_Anvil", (116, g["frontY"] - 32, g["fh"] + 3), mats["iron"])
    kit.chimney(collection, root, "Forge_Chimney", (102, 48, g["roofBase"] + 36), mats["stone"], mats["iron"], height=122)
    kit.gear(collection, root, "Anvil_Sign_Backplate", 24, (-72, g["frontY"] - 13, g["fh"] + 105), mats["iron"], teeth=10)
    kit.lantern(collection, root, "Forge_Lantern", (78, g["frontY"] - 15, g["fh"] + 92), mats["iron"], mats["glow"])
    return root


def build_shooting_range(spec):
    collection, root, mats = common_context("shooting_range", spec)
    fw, fd, fh = spec["dimensions"]["foundation"]
    bw, bd, bh = spec["dimensions"]["body"]
    rw, rd, rh = spec["dimensions"]["roof"]
    house_y = 52
    kit.box(collection, root, "Range_Courtyard_Foundation", (fw, fd, fh),
            (0, -30, fh / 2), mats["foundation"], bevel_width=4)
    kit.box(collection, root, "Range_House", (bw, bd, bh),
            (0, house_y, fh + bh / 2), mats["plaster"], bevel_width=4)
    kit.box(collection, root, "Range_House_StoneBase", (bw + 7, bd + 7, 52),
            (0, house_y, fh + 26), mats["stone"], bevel_width=3)
    roof_base = fh + bh - 3
    kit.gabled_prism(collection, root, "Range_House_Roof", rw, rd, rh,
                     (0, house_y, roof_base), mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "Range_House_RoofCourse", rw, rd, rh, roof_base, mats["roof"], rows=9)
    house_front = house_y - bd / 2 - 4
    kit.half_timber_facade(collection, root, "Range_House_Timber", bw, bh, house_front, fh, mats["timber"], bays=3)
    kit.double_doors(collection, root, "Range_House_Door", (72, house_front - 5, fh),
                     66, 100, mats["timber"], mats["iron"], open_angle=0)
    kit.shutter_window(collection, root, "Range_House_Window", (-60, house_front - 3, fh + 75),
                       mats["glass"], mats["timber"], mats["iron"], scale=0.72)
    yard_front = -245
    yard_back = house_front - 10
    yard_center = (yard_front + yard_back) / 2
    yard_depth = yard_back - yard_front
    for side in (-1, 1):
        x = side * (fw / 2 - 14)
        for z in (fh + 30, fh + 67):
            kit.box(collection, root, f"Range_Yard_SideRail_{side}_{int(z)}", (8, yard_depth, 8),
                    (x, yard_center, z), mats["timber"], bevel_width=1)
        for y in (yard_front, yard_center, yard_back):
            kit.box(collection, root, f"Range_Yard_SidePost_{side}_{int(y)}", (11, 11, 82),
                    (x, y, fh + 41), mats["timber"], bevel_width=1.5)
    for side in (-1, 1):
        segment_w = (fw - 92) / 2
        x = side * (46 + segment_w / 2)
        for z in (fh + 30, fh + 67):
            kit.box(collection, root, f"Range_Yard_FrontRail_{side}_{int(z)}", (segment_w, 8, 8),
                    (x, yard_front, z), mats["timber"], bevel_width=1)
    for x in (-fw / 2 + 14, -46, 46, fw / 2 - 14):
        kit.box(collection, root, f"Range_Yard_FrontPost_{int(x)}", (11, 11, 82),
                (x, yard_front, fh + 41), mats["timber"], bevel_width=1.5)
    for index, x in enumerate((-92, 0, 92)):
        # Targets belong to the perimeter firing line, not against the house.
        # Keep them just inside the front fence so the yard reads as a real
        # training cell with a clear safety gap before the armory wall.
        target_y = yard_front + 38
        kit.box(collection, root, f"Range_TargetPost_{index}", (10, 10, 86),
                (x, target_y + 8, fh + 43), mats["timber"], bevel_width=1)
        kit.box(collection, root, f"Range_TargetFoot_{index}", (58, 28, 8),
                (x, target_y + 10, fh + 4), mats["timber"], bevel_width=1.5)
        kit.cylinder(collection, root, f"Range_Target_{index}_Outer", 27, 9,
                     (x, target_y, fh + 73), mats["straw"], rotation=(90, 0, 0), vertices=48)
        kit.cylinder(collection, root, f"Range_Target_{index}_Center", 9, 11,
                     (x, target_y - 6, fh + 73), mats["iron"], rotation=(90, 0, 0), vertices=32)
    armory_y = house_front - 15
    # A solid wall rack keeps the weapon silhouettes below the eaves.  The
    # diffusion pass must read these as organized wall storage, never as roof
    # ornaments.
    kit.box(collection, root, "Range_Armory_Rack_Back", (176, 10, 104),
            (-50, armory_y + 3, fh + 66), mats["timber"], bevel_width=2)
    for z in (fh + 35, fh + 92):
        kit.box(collection, root, f"Range_Armory_Rack_Rail_{int(z)}", (184, 14, 8),
                (-50, armory_y - 3, z), mats["iron"], bevel_width=1)
    for index, x in enumerate((-112, -92)):
        kit.box(collection, root, f"Range_Visible_Bow_{index}_Upper", (5, 7, 50),
                (x, armory_y, fh + 80), mats["timber"], rotation=(0, -18 if index == 0 else 18, 0), bevel_width=1)
        kit.box(collection, root, f"Range_Visible_Bow_{index}_Lower", (5, 7, 50),
                (x + 10, armory_y - 1, fh + 41), mats["timber"], rotation=(0, 18 if index == 0 else -18, 0), bevel_width=1)
    for index, x in enumerate((-58, -34)):
        kit.box(collection, root, f"Range_Visible_GunStock_{index}", (14, 8, 34),
                (x, armory_y - 5, fh + 34), mats["timber"], rotation=(0, -8, 0), bevel_width=2)
        kit.box(collection, root, f"Range_Visible_GunBarrel_{index}", (6, 7, 58),
                (x - 4, armory_y - 6, fh + 75), mats["iron"], rotation=(0, -8, 0), bevel_width=1)
    kit.box(collection, root, "Range_Powder_Shelf", (92, 24, 8),
            (24, armory_y - 8, fh + 24), mats["timber"], bevel_width=1.5)
    for index, x in enumerate((-4, 18, 40)):
        kit.box(collection, root, f"Range_PowderBag_{index}", (20, 10, 25),
                (x, armory_y - 1, fh + 34 + (index % 2) * 8), mats["straw"], rotation=(0, 0, index * 7 - 7), bevel_width=7)
        kit.box(collection, root, f"Range_PowderBagTie_{index}", (5, 8, 8),
                (x, armory_y - 2, fh + 49 + (index % 2) * 8), mats["timber"], bevel_width=2)
    return root


def build_cavalry_school(spec):
    collection, root, mats = common_context("cavalry_school", spec)
    g = standard_shell(collection, root, mats, spec["dimensions"], bays=4)
    for index, x in enumerate((-76, 76)):
        kit.double_doors(collection, root, f"Stable_Door_{index}", (x, g["frontY"] - 6, g["fh"]), 86, 112, mats["timber"], mats["iron"], open_angle=10)
    kit.shutter_window(collection, root, "Stable_Loft_Window", (0, g["frontY"] - 3, g["fh"] + 123), mats["glass"], mats["timber"], mats["iron"], scale=0.72)
    tw, td, th = spec["dimensions"]["tower"]
    tx, ty = -176, -48
    kit.box(collection, root, "Cavalry_Training_Tower", (tw, td, th), (tx, ty, g["fh"] + th / 2), mats["stone"], bevel_width=4)
    kit.half_timber_facade(collection, root, "Cavalry_Tower_Timber", tw, th, ty - td / 2 - 3, g["fh"], mats["timber"], bays=2)
    cone(collection, root, "Cavalry_Tower_Roof", 52, 84, (tx, ty, g["fh"] + th + 42), mats["roof"], vertices=4)
    kit.box(collection, root, "Cavalry_Crest", (42, 7, 48), (0, g["frontY"] - 13, g["fh"] + 132), mats["brass"], bevel_width=4)
    kit.lantern(collection, root, "Stable_Lantern_Left", (-126, g["frontY"] - 15, g["fh"] + 84), mats["iron"], mats["glow"])
    kit.lantern(collection, root, "Stable_Lantern_Right", (126, g["frontY"] - 15, g["fh"] + 84), mats["iron"], mats["glow"])
    return root


def build_thatch_hut(spec):
    collection, root, mats = common_context("thatch_hut", spec)
    g = standard_shell(collection, root, mats, spec["dimensions"], thatch=True, bays=3)
    kit.double_doors(collection, root, "Cottage_Door", (-76, g["frontY"] - 5, g["fh"]), 58, 98, mats["timber"], mats["iron"], open_angle=0)
    kit.shutter_window(collection, root, "Cottage_Window_Front", (46, g["frontY"] - 3, g["fh"] + 72), mats["glass"], mats["timber"], mats["iron"], scale=0.78)
    kit.shutter_window(collection, root, "Cottage_Window_Side", (g["sideX"] - 2, 44, g["fh"] + 74), mats["glass"], mats["timber"], mats["iron"], orientation="side", scale=0.8)
    kit.chimney(collection, root, "Cottage_Chimney", (82, 42, g["roofBase"] + 46), mats["stone"], mats["iron"], height=86)
    kit.lantern(collection, root, "Cottage_Lantern", (-36, g["frontY"] - 15, g["fh"] + 70), mats["iron"], mats["glow"])
    return root


BUILDERS = {
    "wheat_windmill": build_windmill,
    "warehouse": build_warehouse,
    "blacksmith": build_blacksmith,
    "shooting_range": build_shooting_range,
    "cavalry_school": build_cavalry_school,
    "thatch_hut": build_thatch_hut,
}


def main():
    manifest_path, building_id, blend_path, preview_path, depth_path = parse_args()
    with open(manifest_path, "r", encoding="utf-8-sig") as handle:
        manifest = json.load(handle)
    if building_id not in BUILDERS:
        raise SystemExit(f"unknown building id: {building_id}")
    spec = manifest["buildings"][building_id]
    spec["camera"] = manifest["camera"]
    spec["palette"] = manifest["palette"]
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    root = BUILDERS[building_id](spec)
    kit.setup_scene(spec, preview_path)
    camera = kit.setup_camera(spec, root)
    bpy.context.scene.camera = camera
    os.makedirs(os.path.dirname(blend_path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.render.render(write_still=True)
    kit.render_depth(bpy.context.scene, root, camera, depth_path, building_id)
    print("building id ->", building_id)
    print("model ->", blend_path)
    print("preview ->", preview_path)
    print("depth ->", depth_path)


if __name__ == "__main__":
    main()
