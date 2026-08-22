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
    if len(argv) not in (5, 6):
        raise SystemExit("usage: blender --background --python settlement-building-pack-blender.py -- manifest.json id out.blend preview.png depth.png [body-depth.png]")
    manifest, building_id, blend, preview, depth = argv[:5]
    body_depth = os.path.abspath(argv[5]) if len(argv) == 6 else None
    return (os.path.abspath(manifest), building_id, os.path.abspath(blend),
            os.path.abspath(preview), os.path.abspath(depth), body_depth)


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
    palette_values = dict(spec["palette"])
    palette_values.update(spec.get("paletteOverrides", {}))
    palette = {key: kit.rgba(value) for key, value in palette_values.items()}
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
    if "crystal" in palette:
        crystal_highlight = palette.get("crystalHighlight", palette["crystal"])
        mats["crystal"] = kit.material(
            "MAT_Energy_Crystal_Deep", palette["crystal"], roughness=0.22,
            metallic=0.08, emission=(palette["crystal"], 0.28))
        mats["crystalHighlight"] = kit.material(
            "MAT_Energy_Crystal_Highlight", crystal_highlight, roughness=0.14,
            metallic=0.04, emission=(crystal_highlight, 0.58))
    return collection, root, mats


def portal_arch_ring(collection, root, name, outer_radius, inner_radius, depth,
                     spring_z, y, mat, segments=32):
    """Extruded semicircular ring in the X/Z plane for a clean portal arch."""
    angles = [math.pi * index / segments for index in range(segments + 1)]
    outer = [(outer_radius * math.cos(angle), spring_z + outer_radius * math.sin(angle))
             for angle in angles]
    inner = [(inner_radius * math.cos(angle), spring_z + inner_radius * math.sin(angle))
             for angle in angles]
    count = len(angles)
    vertices = []
    for plane_y in (y - depth / 2, y + depth / 2):
        vertices.extend((x, plane_y, z) for x, z in outer)
        vertices.extend((x, plane_y, z) for x, z in inner)
    front_outer = 0
    front_inner = count
    back_outer = count * 2
    back_inner = count * 3
    faces = []
    for index in range(count - 1):
        nxt = index + 1
        faces.append((front_outer + index, front_outer + nxt,
                      front_inner + nxt, front_inner + index))
        faces.append((back_outer + nxt, back_outer + index,
                      back_inner + index, back_inner + nxt))
        faces.append((front_outer + index, back_outer + index,
                      back_outer + nxt, front_outer + nxt))
        faces.append((front_inner + nxt, back_inner + nxt,
                      back_inner + index, front_inner + index))
    faces.append((front_outer, front_inner, back_inner, back_outer))
    faces.append((front_outer + count - 1, back_outer + count - 1,
                  back_inner + count - 1, front_inner + count - 1))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    kit.bevel(obj, 2.0, 3)
    return obj


def portal_core(collection, root, name, radius, bottom_z, spring_z, depth, y, mat,
                segments=32):
    """Thin extruded arched portal surface that stays behind the marble frame."""
    outline = [(-radius, bottom_z), (radius, bottom_z), (radius, spring_z)]
    outline.extend((radius * math.cos(math.pi * index / segments),
                    spring_z + radius * math.sin(math.pi * index / segments))
                   for index in range(1, segments + 1))
    count = len(outline)
    vertices = [(x, y - depth / 2, z) for x, z in outline]
    vertices.extend((x, y + depth / 2, z) for x, z in outline)
    faces = [tuple(range(count)), tuple(reversed(range(count, count * 2)))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    return obj


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


def research_pyramid_roof(collection, parent, name, length, width, height, location, mat):
    """Four-sided tower roof with one apex, matching the current institute silhouette."""
    half_l, half_w = length / 2, width / 2
    vertices = [
        (-half_l, -half_w, 0), (half_l, -half_w, 0),
        (half_l, half_w, 0), (-half_l, half_w, 0),
        (0, 0, height),
    ]
    faces = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (0, 3, 2, 1)]
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    obj.location = location
    kit.bevel(obj, 1.8, 2)
    return obj


def add_research_tower(collection, root, mats, name, location, shaft_size,
                       shaft_height, chamber_size, chamber_height, roof_size,
                       roof_height):
    """Research-institute tower: stone shaft, half-timber library chamber and steep cap."""
    x, y, base_z = location
    shaft_w, shaft_d = shaft_size
    chamber_w, chamber_d = chamber_size
    shaft_top = base_z + shaft_height
    chamber_top = shaft_top + chamber_height

    kit.box(collection, root, name + "_StoneShaft", (shaft_w, shaft_d, shaft_height),
            (x, y, base_z + shaft_height / 2), mats["stone"], bevel_width=4)
    kit.box(collection, root, name + "_ShaftFoot", (shaft_w + 12, shaft_d + 12, 14),
            (x, y, base_z + 7), mats["foundation"], bevel_width=3)
    kit.box(collection, root, name + "_StoneCrown", (shaft_w + 16, shaft_d + 16, 16),
            (x, y, shaft_top - 3), mats["foundation"], bevel_width=3)
    kit.box(collection, root, name + "_LibraryChamber", (chamber_w, chamber_d, chamber_height),
            (x, y, shaft_top + chamber_height / 2), mats["plaster"], bevel_width=3)

    front_y = y - chamber_d / 2 - 4
    side_x = x - chamber_w / 2 - 4
    kit.box(collection, root, name + "_FrontBottomBand", (chamber_w + 8, 8, 10),
            (x, front_y, shaft_top + 5), mats["timber"], bevel_width=1)
    kit.box(collection, root, name + "_FrontTopBand", (chamber_w + 8, 8, 10),
            (x, front_y, chamber_top - 5), mats["timber"], bevel_width=1)
    for index, offset in enumerate((-0.42, 0.0, 0.42)):
        kit.box(collection, root, f"{name}_FrontPost_{index}", (8, 8, chamber_height),
                (x + chamber_w * offset, front_y, shaft_top + chamber_height / 2),
                mats["timber"], bevel_width=0.8)
    kit.box(collection, root, name + "_SideBottomBand", (8, chamber_d + 8, 10),
            (side_x, y, shaft_top + 5), mats["timber"], bevel_width=1)
    kit.box(collection, root, name + "_SideTopBand", (8, chamber_d + 8, 10),
            (side_x, y, chamber_top - 5), mats["timber"], bevel_width=1)
    for index, offset in enumerate((-0.42, 0.0, 0.42)):
        kit.box(collection, root, f"{name}_SidePost_{index}", (8, 8, chamber_height),
                (side_x, y + chamber_d * offset, shaft_top + chamber_height / 2),
                mats["timber"], bevel_width=0.8)

    # Tall, warm library windows mark each tower as research space without
    # changing the main silhouette that the later diffusion pass must retain.
    window_h = chamber_height * 0.56
    for index, offset in enumerate((-0.22, 0.22)):
        kit.box(collection, root, f"{name}_FrontLibraryWindow_{index}",
                (chamber_w * 0.28, 7, window_h),
                (x + chamber_w * offset, front_y - 3, shaft_top + chamber_height * 0.52),
                mats["glass"], bevel_width=2)
    kit.box(collection, root, name + "_SideLibraryWindow", (7, chamber_d * 0.42, window_h),
            (side_x - 3, y, shaft_top + chamber_height * 0.52), mats["glass"], bevel_width=2)

    roof_w, roof_d = roof_size
    research_pyramid_roof(collection, root, name + "_SteepSlateRoof", roof_w, roof_d,
                          roof_height, (x, y, chamber_top - 2), mats["roof"])

    # Two tall stone-window recesses keep the tower readable below the chamber.
    for level, ratio in enumerate((0.30, 0.62)):
        z = base_z + shaft_height * ratio
        kit.box(collection, root, f"{name}_FrontShaftWindow_{level}",
                (shaft_w * 0.23, 6, shaft_height * 0.17),
                (x, y - shaft_d / 2 - 4, z), mats["glass"], bevel_width=3)
    return chamber_top + roof_height


def build_research_institute(spec):
    collection, root, mats = common_context("research_institute", spec)
    fw, fd, fh = spec["dimensions"]["foundation"]
    bw, bd, bh = spec["dimensions"]["body"]
    rw, rd, rh = spec["dimensions"]["roof"]
    center = spec["dimensions"]["centerTower"]
    side = spec["dimensions"]["sideTower"]

    # One connected fortified library hall, matching the existing three-tower
    # texture while remaining fully seated inside the fixed 2x2 foundation.
    kit.box(collection, root, "Research_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    kit.box(collection, root, "Research_MainStoneHall", (bw, bd, bh * 0.62),
            (0, 0, fh + bh * 0.31), mats["stone"], bevel_width=5)
    upper_base = fh + bh * 0.62
    upper_h = bh * 0.38
    kit.box(collection, root, "Research_MainLibraryFloor", (bw - 10, bd - 10, upper_h),
            (0, 0, upper_base + upper_h / 2), mats["plaster"], bevel_width=4)
    front_y = -(bd - 10) / 2 - 4
    side_x = -(bw - 10) / 2 - 4
    kit.half_timber_facade(collection, root, "Research_MainFrontTimber", bw - 10, upper_h,
                           front_y, upper_base, mats["timber"], bays=6)
    kit.half_timber_side(collection, root, "Research_MainSideTimber", bd - 10, upper_h,
                         side_x, upper_base, mats["timber"], bays=4)
    kit.double_doors(collection, root, "Research_MainDoor", (-110, -bd / 2 - 8, fh),
                     76, 112, mats["timber"], mats["iron"], open_angle=0)
    for index, x in enumerate((-132, -58, 32)):
        kit.box(collection, root, f"Research_MainFrontStoneWindow_{index}",
                (34, 7, 72), (x, -bd / 2 - 6, fh + 72), mats["glass"], bevel_width=4)
        kit.box(collection, root, f"Research_MainFrontWindowSill_{index}",
                (46, 11, 8), (x, -bd / 2 - 8, fh + 34), mats["foundation"], bevel_width=2)
    for index, y in enumerate((-92, -18, 58, 112)):
        kit.box(collection, root, f"Research_MainSideStoneWindow_{index}",
                (7, 32, 70), (-bw / 2 - 6, y, fh + 72), mats["glass"], bevel_width=4)
        kit.box(collection, root, f"Research_MainSideWindowSill_{index}",
                (11, 44, 8), (-bw / 2 - 8, y, fh + 34), mats["foundation"], bevel_width=2)

    # Split roof volumes leave the dominant central tower exposed and reproduce
    # the left/right sloped wings from the accepted texture.
    wing_x = bw * 0.25
    roof_base = fh + bh - 3
    for side_index, x in enumerate((-wing_x, wing_x)):
        kit.gabled_prism(collection, root, f"Research_WingRoof_{side_index}",
                         rw * 0.52, rd, rh, (x, 0, roof_base), mats["timber"], mats["roof"])

    # Put the side towers on opposite model corners that project to equal
    # camera depth.  Their full stone shafts then remain visible at the two
    # screen edges instead of collapsing into roof turrets.
    add_research_tower(collection, root, mats, "Research_LeftTower",
                       (-156, 92, fh), tuple(side[0:2]), side[2],
                       tuple(side[3:5]), side[5], tuple(side[6:8]), side[8])
    add_research_tower(collection, root, mats, "Research_RightTower",
                       (92, -156, fh), tuple(side[0:2]), side[2],
                       tuple(side[3:5]), side[5], tuple(side[6:8]), side[8])
    # The central tower is pulled toward the camera so its stone shaft remains
    # visible in front of the split roofs.  Matching x/y offsets compensate the
    # 44.8-degree root rotation and keep it centered on screen.
    add_research_tower(collection, root, mats, "Research_CentralTower",
                       (-48, -48, fh), tuple(center[0:2]), center[2],
                       tuple(center[3:5]), center[5], tuple(center[6:8]), center[8])

    # Restrained observatory emblem on the front wall; later AI detail may turn
    # this into an astrolabe, but it remains attached to the building.
    kit.cylinder(collection, root, "Research_Astrolabe_Backplate", 24, 7,
                 (58, -bd / 2 - 10, upper_base + upper_h * 0.57), mats["brass"],
                 rotation=(90, 0, 0), vertices=40, bevel_width=1)
    kit.cylinder(collection, root, "Research_Astrolabe_Hub", 8, 10,
                 (58, -bd / 2 - 15, upper_base + upper_h * 0.57), mats["iron"],
                 rotation=(90, 0, 0), vertices=28, bevel_width=0.8)
    return root


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


def build_hamster_barracks(spec):
    collection, root, mats = common_context("hamster_barracks", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    tw, td, th = dims["tower"]
    tower_roof_radius, tower_roof_height = dims["towerRoof"]

    # One connected fortified barracks: a central drill hall framed by two complete watchtowers.
    kit.box(collection, root, "Barracks_Foundation", (fw, fd, fh), (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    kit.box(collection, root, "Barracks_MainHall_Stone", (bw, bd, bh), (0, 0, fh + bh / 2), mats["stone"], bevel_width=5)
    upper_h = 70
    kit.box(collection, root, "Barracks_MainHall_UpperPlaster", (bw + 3, bd + 3, upper_h),
            (0, 0, fh + bh - upper_h / 2), mats["plaster"], bevel_width=3)
    roof_base = fh + bh - 3
    kit.gabled_prism(collection, root, "Barracks_MainHall_GabledRoof", rw, rd, rh,
                     (0, 0, roof_base), mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "Barracks_MainHall_RoofCourse", rw, rd, rh,
                  roof_base, mats["roof"], rows=12)

    front_y = -bd / 2 - 4
    kit.half_timber_facade(collection, root, "Barracks_MainHall_Timber", bw, upper_h,
                           front_y, fh + bh - upper_h, mats["timber"], bays=4)
    kit.double_doors(collection, root, "Barracks_MainGate", (0, front_y - 7, fh),
                     92, 126, mats["timber"], mats["iron"], open_angle=13)
    kit.box(collection, root, "Barracks_MainGate_WarmInterior", (70, 5, 108),
            (0, front_y + 4, fh + 58), mats["glow"], bevel_width=3)
    kit.box(collection, root, "Barracks_MainGate_Lintel", (126, 18, 18),
            (0, front_y - 1, fh + 132), mats["stone"], bevel_width=4)
    for side in (-1, 1):
        kit.box(collection, root, f"Barracks_MainGate_Jamb_{side:+d}", (18, 18, 132),
                (side * 58, front_y - 1, fh + 66), mats["stone"], bevel_width=4)

    tower_x = bw / 2 + tw * 0.36
    tower_y = -20
    for side, label in ((-1, "Left"), (1, "Right")):
        x = side * tower_x
        prefix = f"Barracks_{label}Watchtower"
        kit.box(collection, root, prefix + "_Shaft", (tw, td, th),
                (x, tower_y, fh + th / 2), mats["stone"], bevel_width=5)
        for band_z in (fh + 78, fh + 178, fh + th - 24):
            kit.box(collection, root, prefix + f"_StoneBand_{int(band_z)}", (tw + 10, td + 10, 12),
                    (x, tower_y, band_z), mats["foundation"], bevel_width=2)
        kit.box(collection, root, prefix + "_FrontArrowSlit", (13, 7, 62),
                (x, tower_y - td / 2 - 4, fh + 154), mats["glass"], bevel_width=5)
        visible_side_x = x - side * (tw / 2 + 4)
        kit.box(collection, root, prefix + "_SideArrowSlit", (7, 13, 58),
                (visible_side_x, tower_y + 12, fh + 204), mats["glass"], bevel_width=5)
        cone(collection, root, prefix + "_PyramidalRoof", tower_roof_radius, tower_roof_height,
             (x, tower_y, fh + th + tower_roof_height / 2 - 2), mats["roof"], vertices=4)
        kit.box(collection, root, prefix + "_RoofFinial", (9, 9, 28),
                (x, tower_y, fh + th + tower_roof_height + 10), mats["iron"], bevel_width=2)

    # Restrained military identity stays attached to the building and remains independently editable.
    kit.box(collection, root, "Barracks_ShieldCrest", (44, 7, 52),
            (0, front_y - 14, fh + bh - 48), mats["brass"], bevel_width=10)
    for index, x in enumerate((-104, -84, 84, 104)):
        lean = -5 if x < 0 else 5
        kit.box(collection, root, f"Barracks_WeaponRack_Spear_{index}", (6, 7, 94),
                (x, front_y - 13, fh + 53), mats["timber"], rotation=(0, lean, 0), bevel_width=1)
        cone(collection, root, f"Barracks_WeaponRack_Spearhead_{index}", 7, 18,
             (x + (-4 if x < 0 else 4), front_y - 13, fh + 107), mats["iron"], vertices=4)
    kit.lantern(collection, root, "Barracks_GateLantern_Left", (-76, front_y - 18, fh + 98), mats["iron"], mats["glow"])
    kit.lantern(collection, root, "Barracks_GateLantern_Right", (76, front_y - 18, fh + 98), mats["iron"], mats["glow"])
    return root


def build_explorer_camp(spec):
    collection, root, mats = common_context("explorer_camp", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    tw, td, th = dims["tower"]
    tower_roof_radius, tower_roof_height = dims["towerRoof"]

    # A single connected dungeon forward base: command pavilion, attached
    # lookout tower and covered supply bay, all seated inside one 2x2 slab.
    kit.box(collection, root, "ExplorerCamp_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)

    hall_x, hall_y = 42, 24
    kit.box(collection, root, "ExplorerCamp_CommandHall_StonePlinth",
            (bw + 16, bd + 16, 42), (hall_x, hall_y, fh + 21),
            mats["stone"], bevel_width=5)
    kit.box(collection, root, "ExplorerCamp_CommandHall_CanvasBody",
            (bw, bd, bh - 38), (hall_x, hall_y, fh + 42 + (bh - 38) / 2),
            mats["plaster"], bevel_width=4)
    front_y = hall_y - bd / 2 - 4
    side_x = hall_x - bw / 2 - 4
    kit.half_timber_facade(collection, root, "ExplorerCamp_CommandHall_FrontFrame",
                           bw, bh - 32, front_y, fh + 34, mats["timber"], bays=5)
    kit.half_timber_side(collection, root, "ExplorerCamp_CommandHall_SideFrame",
                         bd, bh - 32, side_x, fh + 34, mats["timber"], bays=4)

    roof_base = fh + bh - 2
    kit.gabled_prism(collection, root, "ExplorerCamp_CommandCanvasRoof",
                     rw, rd, rh, (hall_x, hall_y, roof_base),
                     mats["timber"], mats["plaster"])
    # Raised canvas ridge and tie-down battens make the pavilion read as a
    # reinforced expedition tent rather than another residential cottage.
    kit.box(collection, root, "ExplorerCamp_RidgePole", (rw + 10, 12, 14),
            (hall_x, hall_y, roof_base + rh - 2), mats["timber"], bevel_width=3)
    for index, x in enumerate((-92, -28, 36, 100)):
        kit.box(collection, root, f"ExplorerCamp_FrontRoofTie_{index}",
                (9, 14, 76), (hall_x + x, front_y - 15, roof_base + 37),
                mats["timber"], rotation=(45, 0, 0), bevel_width=1)

    kit.double_doors(collection, root, "ExplorerCamp_CommandEntrance",
                     (hall_x - 62, front_y - 6, fh + 34), 76, 116,
                     mats["timber"], mats["iron"], open_angle=16)
    kit.box(collection, root, "ExplorerCamp_CommandWarmInterior", (58, 6, 96),
            (hall_x - 62, front_y + 2, fh + 90), mats["glow"], bevel_width=3)
    kit.shutter_window(collection, root, "ExplorerCamp_CommandWindow",
                       (hall_x + 78, front_y - 4, fh + 100),
                       mats["glass"], mats["timber"], mats["iron"], scale=0.78)
    kit.lantern(collection, root, "ExplorerCamp_EntranceLantern",
                (hall_x - 8, front_y - 18, fh + 102), mats["iron"], mats["glow"])

    # The only lookout tower overlaps the hall's rear-left corner so it remains
    # one connected building and cannot be mistaken for a detached prop.
    tx, ty = -150, 72
    kit.box(collection, root, "ExplorerCamp_LookoutStoneFoot", (tw + 12, td + 12, 38),
            (tx, ty, fh + 19), mats["stone"], bevel_width=4)
    post_height = th - 48
    for x_sign in (-1, 1):
        for y_sign in (-1, 1):
            kit.box(collection, root,
                    f"ExplorerCamp_LookoutPost_{x_sign:+d}_{y_sign:+d}",
                    (14, 14, post_height),
                    (tx + x_sign * (tw / 2 - 9), ty + y_sign * (td / 2 - 9),
                     fh + 34 + post_height / 2), mats["timber"], bevel_width=2)
    deck_z = fh + th - 42
    kit.box(collection, root, "ExplorerCamp_LookoutDeck", (tw + 20, td + 20, 16),
            (tx, ty, deck_z), mats["timber"], bevel_width=3)
    kit.box(collection, root, "ExplorerCamp_LookoutCabin", (tw, td, 62),
            (tx, ty, deck_z + 38), mats["plaster"], bevel_width=3)
    kit.half_timber_facade(collection, root, "ExplorerCamp_LookoutFrontFrame",
                           tw, 62, ty - td / 2 - 4, deck_z + 7,
                           mats["timber"], bays=2, include_braces=False)
    kit.shutter_window(collection, root, "ExplorerCamp_LookoutWindow",
                       (tx, ty - td / 2 - 7, deck_z + 40),
                       mats["glass"], mats["timber"], mats["iron"], scale=0.62)
    cone(collection, root, "ExplorerCamp_LookoutCanvasCap", tower_roof_radius,
         tower_roof_height, (tx, ty, deck_z + 62 + tower_roof_height / 2 - 2),
         mats["plaster"], vertices=4)
    kit.box(collection, root, "ExplorerCamp_LookoutFinial", (8, 8, 24),
            (tx, ty, deck_z + 62 + tower_roof_height + 7), mats["iron"], bevel_width=2)
    # Fixed ladder and short connector bind the open tower into the command hall.
    ladder_y = ty - td / 2 - 8
    for x in (-13, 13):
        kit.box(collection, root, f"ExplorerCamp_LadderRail_{x:+d}", (7, 8, 154),
                (tx + x, ladder_y, fh + 104), mats["timber"], bevel_width=1)
    for index, z in enumerate(range(48, 180, 22)):
        kit.box(collection, root, f"ExplorerCamp_LadderRung_{index}", (32, 9, 5),
                (tx, ladder_y - 1, fh + z), mats["timber"], bevel_width=1)
    kit.box(collection, root, "ExplorerCamp_TowerConnector", (72, 94, 74),
            (-103, 78, fh + 71), mats["timber"], bevel_width=4)

    # One attached supply awning keeps the silhouette practical without adding
    # a second tent. Crates and map cases sit under and touch the structure.
    awning_x, awning_y = 174, -94
    kit.box(collection, root, "ExplorerCamp_SupplyAwningRoof", (126, 150, 12),
            (awning_x, awning_y, fh + 132), mats["plaster"],
            rotation=(8, 0, 0), bevel_width=3)
    for x in (132, 216):
        kit.box(collection, root, f"ExplorerCamp_AwningPost_{x}", (12, 12, 126),
                (x, -151, fh + 63), mats["timber"], bevel_width=2)
    kit.box(collection, root, "ExplorerCamp_SupplyLocker_Left", (48, 54, 58),
            (146, -132, fh + 29), mats["timber"], bevel_width=4)
    kit.box(collection, root, "ExplorerCamp_SupplyLocker_Right", (48, 54, 76),
            (199, -132, fh + 38), mats["timber"], bevel_width=4)
    for index, x in enumerate((146, 199)):
        kit.box(collection, root, f"ExplorerCamp_SupplyLockerBand_{index}", (52, 5, 10),
                (x, -160, fh + 30), mats["iron"], bevel_width=1)

    # Attached navigation identity: map board plus restrained compass medallion.
    kit.box(collection, root, "ExplorerCamp_MapBoard", (96, 8, 70),
            (hall_x + 58, front_y - 11, fh + 86), mats["timber"], bevel_width=4)
    kit.box(collection, root, "ExplorerCamp_MapSheet", (76, 5, 50),
            (hall_x + 58, front_y - 16, fh + 88), mats["plaster"], bevel_width=2)
    kit.cylinder(collection, root, "ExplorerCamp_CompassMedallion", 20, 8,
                 (hall_x + 58, front_y - 20, fh + 88), mats["brass"],
                 rotation=(90, 0, 0), vertices=32, bevel_width=1)
    kit.cylinder(collection, root, "ExplorerCamp_CompassHub", 6, 11,
                 (hall_x + 58, front_y - 24, fh + 88), mats["iron"],
                 rotation=(90, 0, 0), vertices=24, bevel_width=1)
    return root


def build_miner_camp(spec):
    collection, root, mats = common_context("miner_camp", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    hw, hd, hh = dims["hoist"]

    # One connected mining structure: a stone-cut portal inside a low timber
    # shed, with an attached ore hoist sharing the same roofline and slab.
    kit.box(collection, root, "MinerCamp_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)

    shed_x, shed_y = -54, 26
    kit.box(collection, root, "MinerCamp_Shed_StoneCore", (bw, bd, bh),
            (shed_x, shed_y, fh + bh / 2), mats["stone"], bevel_width=5)
    kit.box(collection, root, "MinerCamp_Shed_TimberUpper", (bw - 18, bd - 18, 92),
            (shed_x, shed_y, fh + bh - 46), mats["plaster"], bevel_width=4)
    front_y = shed_y - bd / 2 - 4
    left_x = shed_x - bw / 2 - 4
    kit.half_timber_side(collection, root, "MinerCamp_Shed_LeftFrame",
                         bd, bh - 26, left_x, fh + 18, mats["timber"], bays=4)
    for index, x in enumerate((shed_x - bw / 2 + 7, shed_x + 22, shed_x + bw / 2 - 7)):
        kit.box(collection, root, f"MinerCamp_Shed_FrontPost_{index}",
                (15, 14, bh - 12), (x, front_y, fh + bh / 2),
                mats["timber"], bevel_width=2)
    kit.box(collection, root, "MinerCamp_Shed_FrontTopBeam", (bw + 12, 16, 18),
            (shed_x, front_y, fh + bh - 10), mats["timber"], bevel_width=2)
    kit.box(collection, root, "MinerCamp_Shed_RightBrace", (112, 13, 14),
            (shed_x + 92, front_y - 1, fh + 88), mats["timber"],
            rotation=(0, -42, 0), bevel_width=1)

    roof_base = fh + bh - 3
    kit.gabled_prism(collection, root, "MinerCamp_SlateGableRoof",
                     rw, rd, rh, (shed_x, shed_y, roof_base),
                     mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "MinerCamp_SlateCourse", rw, rd, rh,
                  roof_base, mats["roof"], rows=12)
    kit.box(collection, root, "MinerCamp_RoofRidgeBeam", (rw + 16, 16, 17),
            (shed_x, shed_y, roof_base + rh - 1), mats["timber"], bevel_width=3)

    # The dark portal and radial stone voussoirs are separate editable pieces.
    portal_x = shed_x - 38
    opening_w, opening_h = 104, 142
    kit.box(collection, root, "MinerCamp_Portal_DarkInterior",
            (opening_w, 11, 108),
            (portal_x, front_y + 5, fh + 54), mats["iron"], bevel_width=4)
    kit.cylinder(collection, root, "MinerCamp_Portal_ArchVoid", opening_w / 2, 11,
                 (portal_x, front_y + 5, fh + 108), mats["iron"],
                 rotation=(90, 0, 0), vertices=48, bevel_width=2)
    kit.box(collection, root, "MinerCamp_Portal_WarmDepth",
            (64, 8, 72), (portal_x, front_y + 1, fh + 38),
            mats["glow"], bevel_width=8)
    column_height = 108
    for side in (-1, 1):
        kit.box(collection, root, f"MinerCamp_Portal_Jamb_{side:+d}",
                (28, 22, column_height),
                (portal_x + side * 63, front_y - 13, fh + column_height / 2),
                mats["stone"], bevel_width=4)
    arch_radius = 62
    arch_spring_z = fh + column_height
    for index, angle in enumerate(range(0, 181, 30)):
        radians = math.radians(angle)
        x = portal_x + arch_radius * math.cos(radians)
        z = arch_spring_z + arch_radius * math.sin(radians)
        kit.box(collection, root, f"MinerCamp_Portal_Voussoir_{index:02d}",
                (31, 23, 25), (x, front_y - 13, z), mats["stone"],
                rotation=(0, 90 - angle, 0), bevel_width=3)
    kit.box(collection, root, "MinerCamp_Portal_Threshold", (154, 44, 14),
            (portal_x, front_y - 25, fh + 7), mats["stone"], bevel_width=4)
    kit.lantern(collection, root, "MinerCamp_Portal_Lantern",
                (portal_x + 35, front_y - 22, fh + 74), mats["iron"], mats["glow"])

    # Attached ore-lift bay: fixed frame, drum, rope and guided ore cage.
    hoist_x, hoist_y = 154, -92
    post_xs = (hoist_x - hw / 2 + 9, hoist_x + hw / 2 - 9)
    post_ys = (hoist_y - hd / 2 + 9, hoist_y + hd / 2 - 9)
    for xi, x in enumerate(post_xs):
        for yi, y in enumerate(post_ys):
            kit.box(collection, root, f"MinerCamp_Hoist_Post_{xi}_{yi}",
                    (15, 15, hh), (x, y, fh + hh / 2), mats["timber"], bevel_width=2)
    kit.box(collection, root, "MinerCamp_Hoist_TopBeam", (hw + 22, 20, 20),
            (hoist_x, post_ys[0], fh + hh - 8), mats["timber"], bevel_width=3)
    kit.box(collection, root, "MinerCamp_Hoist_RearBeam", (hw + 22, 18, 18),
            (hoist_x, post_ys[1], fh + hh - 20), mats["timber"], bevel_width=2)
    kit.box(collection, root, "MinerCamp_Hoist_Connector", (88, 26, 24),
            (98, hoist_y + 10, fh + 138), mats["timber"], bevel_width=3)
    for side, x in enumerate(post_xs):
        kit.box(collection, root, f"MinerCamp_Hoist_FrontBrace_{side}",
                (72, 13, 12), (x, post_ys[0] - 1, fh + 88), mats["timber"],
                rotation=(0, 58 if side == 0 else -58, 0), bevel_width=1)

    drum_y = post_ys[0] - 4
    drum_z = fh + 118
    kit.cylinder(collection, root, "MinerCamp_Hoist_Drum", 19, 86,
                 (hoist_x, drum_y, drum_z), mats["timber"],
                 rotation=(0, 90, 0), vertices=32, bevel_width=2)
    for side, x in enumerate((hoist_x - 47, hoist_x + 47)):
        kit.cylinder(collection, root, f"MinerCamp_Hoist_DrumPlate_{side}", 25, 7,
                     (x, drum_y, drum_z), mats["iron"],
                     rotation=(0, 90, 0), vertices=24, bevel_width=1)
    kit.cylinder(collection, root, "MinerCamp_Hoist_Rope", 3, 78,
                 (hoist_x, drum_y - 1, fh + 70), mats["iron"], vertices=16, bevel_width=0.5)
    cage_z = fh + 31
    kit.box(collection, root, "MinerCamp_Hoist_OreCageBase", (82, 58, 12),
            (hoist_x, drum_y - 1, cage_z), mats["iron"], bevel_width=2)
    for side, x in enumerate((hoist_x - 36, hoist_x + 36)):
        kit.box(collection, root, f"MinerCamp_Hoist_OreCageRail_{side}",
                (7, 58, 48), (x, drum_y - 1, cage_z + 25), mats["iron"], bevel_width=1)
    for index, (dx, dy, dz) in enumerate(((-24, -12, 0), (-7, 8, 4), (12, -8, 2), (27, 10, 1))):
        kit.box(collection, root, f"MinerCamp_Hoist_OreChunk_{index}",
                (23, 20, 17 + dz), (hoist_x + dx, drum_y + dy, cage_z + 14 + dz / 2),
                mats["stone"], rotation=(0, index * 17, index * 11), bevel_width=4)

    # A single lean-to slate canopy overlaps both shed and hoist, preventing the
    # functional bay from reading as a detached second building.
    kit.box(collection, root, "MinerCamp_Hoist_SlateCanopy", (154, 194, 14),
            (hoist_x, hoist_y + 3, fh + hh + 23), mats["roof"],
            rotation=(8, 0, 0), bevel_width=3)
    kit.box(collection, root, "MinerCamp_Hoist_CanopyRidge", (168, 14, 14),
            (hoist_x, post_ys[1] + 8, fh + hh + 35), mats["timber"], bevel_width=2)
    return root


def build_market(spec):
    collection, root, mats = common_context("market", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    aw, ad, ah = dims["awning"]

    # One compact trading hall: the permanent counter arcade and striped
    # canopy overlap the main shell so the market never reads as loose stalls.
    kit.box(collection, root, "Market_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    hall_y = 28
    kit.box(collection, root, "Market_StonePlinth", (bw + 14, bd + 14, 54),
            (0, hall_y, fh + 27), mats["stone"], bevel_width=5)
    kit.box(collection, root, "Market_TradingHall", (bw, bd, bh - 46),
            (0, hall_y, fh + 54 + (bh - 46) / 2), mats["plaster"], bevel_width=4)
    front_y = hall_y - bd / 2 - 4
    side_x = -bw / 2 - 4
    kit.half_timber_facade(collection, root, "Market_FrontTimber",
                           bw, bh - 36, front_y, fh + 38, mats["timber"], bays=5)
    kit.half_timber_side(collection, root, "Market_LeftTimber",
                         bd, bh - 36, side_x, fh + 38, mats["timber"], bays=4)

    roof_base = fh + bh - 3
    hipped_roof(collection, root, "Market_BroadHippedRoof", rw, rd, rh,
                (0, hall_y, roof_base), mats["roof"])
    kit.box(collection, root, "Market_RoofRidge", (rw * 0.42 + 18, 14, 14),
            (0, hall_y, roof_base + rh - 1), mats["timber"], bevel_width=3)

    # Four fixed selling bays are recessed into the front wall. Each counter
    # touches the hall and sits beneath one continuous attached canopy.
    bay_centers = (-123, -41, 41, 123)
    for index, x in enumerate(bay_centers):
        kit.box(collection, root, f"Market_CounterBayDark_{index}", (68, 9, 84),
                (x, front_y - 5, fh + 91), mats["iron"], bevel_width=3)
        kit.box(collection, root, f"Market_CounterSlab_{index}", (76, 62, 14),
                (x, front_y - 33, fh + 58), mats["timber"], bevel_width=3)
        kit.box(collection, root, f"Market_CounterFront_{index}", (72, 12, 46),
                (x, front_y - 59, fh + 31), mats["timber"], bevel_width=2)
        kit.box(collection, root, f"Market_CounterIronBand_{index}", (76, 7, 8),
                (x, front_y - 66, fh + 31), mats["iron"], bevel_width=1)

    canopy_y = front_y - ad / 2 + 18
    canopy_z = fh + ah
    # Alternating permanent canvas panels keep the placeholder's market color
    # cue while remaining one structural canopy in the depth silhouette.
    panel_w = aw / 6
    for index in range(6):
        x = -aw / 2 + panel_w * (index + 0.5)
        mat = mats["roof"] if index % 2 == 0 else mats["plaster"]
        kit.box(collection, root, f"Market_CanopyPanel_{index}",
                (panel_w + 2, ad, 12), (x, canopy_y, canopy_z), mat,
                rotation=(8, 0, 0), bevel_width=2)
    kit.box(collection, root, "Market_CanopyWallBeam", (aw + 12, 16, 18),
            (0, front_y - 5, canopy_z + 8), mats["timber"], bevel_width=3)
    post_y = canopy_y - ad / 2 + 10
    for index, x in enumerate((-aw / 2 + 13, -86, 0, 86, aw / 2 - 13)):
        kit.box(collection, root, f"Market_CanopyPost_{index}", (14, 14, ah - 8),
                (x, post_y, fh + (ah - 8) / 2), mats["timber"], bevel_width=2)
    kit.box(collection, root, "Market_CanopyFrontBeam", (aw + 12, 16, 18),
            (0, post_y, canopy_z - 4), mats["timber"], bevel_width=3)

    # Two additional fixed stalls and a connected side awning turn the front
    # arcade into one busy L-shaped market frontage without loose tents.
    side_bay_centers = (-28, 72)
    for index, y in enumerate(side_bay_centers):
        kit.box(collection, root, f"Market_SideCounterBayDark_{index}", (9, 76, 84),
                (side_x - 5, y, fh + 91), mats["iron"], bevel_width=3)
        kit.box(collection, root, f"Market_SideCounterSlab_{index}", (62, 84, 14),
                (side_x - 33, y, fh + 58), mats["timber"], bevel_width=3)
        kit.box(collection, root, f"Market_SideCounterFront_{index}", (12, 80, 46),
                (side_x - 59, y, fh + 31), mats["timber"], bevel_width=2)
        kit.box(collection, root, f"Market_SideCounterIronBand_{index}", (7, 84, 8),
                (side_x - 66, y, fh + 31), mats["iron"], bevel_width=1)

    side_canopy_x = side_x - 52
    side_canopy_y = 22
    side_panel_d = 204 / 4
    for index in range(4):
        y = side_canopy_y - 102 + side_panel_d * (index + 0.5)
        mat = mats["plaster"] if index % 2 == 0 else mats["roof"]
        kit.box(collection, root, f"Market_SideCanopyPanel_{index}",
                (116, side_panel_d + 2, 12), (side_canopy_x, y, canopy_z), mat,
                rotation=(0, -8, 0), bevel_width=2)
    side_outer_x = side_x - 104
    for index, y in enumerate((-70, 20, 110)):
        kit.box(collection, root, f"Market_SideCanopyPost_{index}", (14, 14, ah - 8),
                (side_outer_x, y, fh + (ah - 8) / 2), mats["timber"], bevel_width=2)
    kit.box(collection, root, "Market_SideCanopyOuterBeam", (16, 222, 18),
            (side_outer_x, side_canopy_y, canopy_z - 4), mats["timber"], bevel_width=3)
    kit.box(collection, root, "Market_SideCanopyWallBeam", (16, 222, 18),
            (side_x - 5, side_canopy_y, canopy_z + 8), mats["timber"], bevel_width=3)

    # A large main advertisement board and smaller product placards create a
    # clear market identity while avoiding unreliable generated lettering.
    sign_z = roof_base - 8
    for index, x in enumerate((-48, 48)):
        kit.box(collection, root, f"Market_MainSignBracket_{index}", (12, 50, 12),
                (x, front_y - 28, sign_z + 16), mats["iron"], bevel_width=2)
    kit.box(collection, root, "Market_MainAdvertisementBoard", (148, 12, 68),
            (0, front_y - 56, sign_z - 4), mats["timber"], bevel_width=5)
    kit.box(collection, root, "Market_MainAdvertisementInset", (128, 7, 50),
            (0, front_y - 63, sign_z - 4), mats["plaster"], bevel_width=3)
    kit.cylinder(collection, root, "Market_CoinSign", 23, 10,
                 (0, front_y - 69, sign_z - 4), mats["brass"],
                 rotation=(90, 0, 0), vertices=32, bevel_width=2)
    kit.cylinder(collection, root, "Market_CoinSignInset", 12, 13,
                 (0, front_y - 72, sign_z - 4), mats["foundation"],
                 rotation=(90, 0, 0), vertices=32, bevel_width=1)

    placard_z = canopy_z - 28
    for index, x in enumerate(bay_centers):
        kit.box(collection, root, f"Market_ProductPlacard_{index}", (46, 8, 38),
                (x, post_y - 10, placard_z), mats["timber"], bevel_width=3)
        icon_mat = mats["brass"] if index % 2 == 0 else mats["plaster"]
        kit.cylinder(collection, root, f"Market_ProductIcon_{index}", 11, 10,
                     (x, post_y - 16, placard_z), icon_mat,
                     rotation=(90, 0, 0), vertices=20, bevel_width=1)

    scale_y = front_y - 68
    scale_z = fh + 82
    kit.box(collection, root, "Market_FixedScaleStem", (8, 8, 50),
            (0, scale_y, scale_z), mats["brass"], bevel_width=1)
    kit.box(collection, root, "Market_FixedScaleBeam", (72, 7, 7),
            (0, scale_y, scale_z + 23), mats["brass"], bevel_width=1)
    for side, x in enumerate((-30, 30)):
        kit.cylinder(collection, root, f"Market_FixedScalePan_{side}", 15, 5,
                     (x, scale_y, scale_z + 5), mats["brass"],
                     vertices=24, bevel_width=1)

    kit.lantern(collection, root, "Market_LeftLantern",
                (-148, front_y - 18, fh + 112), mats["iron"], mats["glow"])
    kit.lantern(collection, root, "Market_RightLantern",
                (148, front_y - 18, fh + 112), mats["iron"], mats["glow"])
    return root


def build_portal(spec):
    collection, root, mats = common_context("portal", spec)
    fw, fd, fh = spec["dimensions"]["foundation"]
    outer_radius, inner_radius, frame_depth, pier_height = spec["dimensions"]["arch"]
    upper_h = 14
    base_z = fh + upper_h
    spring_z = base_z + pier_height
    pier_width = outer_radius - inner_radius
    pier_x = (outer_radius + inner_radius) / 2

    # One restrained two-step marble platform.  Its four corners remain clear
    # in the fixed orthographic camera and define the complete 2x2 footprint.
    kit.box(collection, root, "Portal_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    kit.box(collection, root, "Portal_UpperPlinth", (fw - 44, fd - 36, upper_h),
            (0, 0, fh + upper_h / 2), mats["stone"], bevel_width=3)

    for side, x in (("Left", -pier_x), ("Right", pier_x)):
        kit.box(collection, root, f"Portal_{side}Pier",
                (pier_width, frame_depth, pier_height),
                (x, 0, base_z + pier_height / 2), mats["stone"], bevel_width=4)
        kit.box(collection, root, f"Portal_{side}PierFoot",
                (pier_width + 24, frame_depth + 22, 20),
                (x, 0, base_z + 10), mats["foundation"], bevel_width=3)
        kit.box(collection, root, f"Portal_{side}PierCapital",
                (pier_width + 22, frame_depth + 18, 18),
                (x, 0, spring_z - 9), mats["foundation"], bevel_width=3)
        kit.box(collection, root, f"Portal_{side}InsetPanel",
                (pier_width - 16, 7, pier_height * 0.48),
                (x, -frame_depth / 2 - 2, base_z + pier_height * 0.52),
                mats["plaster"], bevel_width=2)

    portal_arch_ring(collection, root, "Portal_MarbleArch", outer_radius,
                     inner_radius, frame_depth, spring_z, 0, mats["stone"])
    portal_arch_ring(collection, root, "Portal_BrassInnerInlay", inner_radius + 11,
                     inner_radius + 3, frame_depth + 5, spring_z, -3,
                     mats["brass"], segments=32)
    portal_core(collection, root, "Portal_CyanCore", inner_radius - 3,
                base_z + 5, spring_z, 7, 8, mats["glow"], segments=40)

    # A single keystone is the only focal ornament; no statues or rune clutter.
    kit.box(collection, root, "Portal_Keystone", (32, frame_depth + 14, 38),
            (0, -2, spring_z + outer_radius - 14), mats["foundation"],
            bevel_width=4)
    kit.box(collection, root, "Portal_ThresholdInlay", (inner_radius * 1.82, 10, 8),
            (0, -frame_depth / 2 - 3, base_z + 8), mats["brass"], bevel_width=2)
    return root


def build_jungle_temple(spec):
    collection, root, mats = common_context("jungle_temple", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    lower_w, lower_d, lower_h = dims["lowerTerrace"]
    middle_w, middle_d, middle_h = dims["middleTerrace"]
    upper_w, upper_d, upper_h = dims["upperTerrace"]
    shrine_w, shrine_d, shrine_h = dims["sanctuary"]
    upper_levels = dims["upperLevels"]
    tower_w, tower_d, tower_h = dims["towerPlatforms"]
    crown_w, crown_d, crown_h = dims["crown"]
    stair_w, stair_depth, stair_count = dims["stairs"]

    # One intact 2x2 foundation and three legible stepped terraces.  All
    # platforms stay centered so the fixed camera reads one functional temple.
    kit.box(collection, root, "JungleTemple_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    lower_z = fh
    kit.box(collection, root, "JungleTemple_LowerTerrace",
            (lower_w, lower_d, lower_h), (0, 0, lower_z + lower_h / 2),
            mats["stone"], bevel_width=4)
    middle_z = lower_z + lower_h
    kit.box(collection, root, "JungleTemple_MiddleTerrace",
            (middle_w, middle_d, middle_h), (0, 14, middle_z + middle_h / 2),
            mats["stone"], bevel_width=4)
    upper_z = middle_z + middle_h
    kit.box(collection, root, "JungleTemple_UpperTerrace",
            (upper_w, upper_d, upper_h), (0, 30, upper_z + upper_h / 2),
            mats["plaster"], bevel_width=4)

    # One centered route is split into three aligned flights.  The terraces are
    # the landings, so each height change is resolved by small readable steps.
    flights = (
        ("Lower", -lower_d / 2, fh, lower_z + lower_h),
        ("Middle", 14 - middle_d / 2, lower_z + lower_h, middle_z + middle_h),
        ("Upper", 30 - upper_d / 2, middle_z + middle_h, upper_z + upper_h),
    )
    for flight_name, terrace_front_y, base_top, target_top in flights:
        for index in range(int(stair_count)):
            progress = (index + 1) / stair_count
            top_z = base_top + (target_top - base_top) * progress
            height = top_z - base_top
            y = terrace_front_y - stair_depth * (stair_count - index - 1.5)
            kit.box(collection, root,
                    f"JungleTemple_CentralStep_{flight_name}_{index + 1:02d}",
                    (stair_w, stair_depth + 3, height),
                    (0, y, base_top + height / 2), mats["foundation"],
                    bevel_width=1.5)

    shrine_base = upper_z + upper_h
    shrine_y = 48
    shrine_front_y = shrine_y - shrine_d / 2 - 4
    kit.box(collection, root, "JungleTemple_Sanctuary",
            (shrine_w, shrine_d, shrine_h),
            (0, shrine_y, shrine_base + shrine_h / 2), mats["stone"], bevel_width=5)
    kit.box(collection, root, "JungleTemple_SanctuaryFoot",
            (shrine_w + 22, shrine_d + 20, 16),
            (0, shrine_y, shrine_base + 8), mats["foundation"], bevel_width=3)
    kit.box(collection, root, "JungleTemple_SanctuaryCornice",
            (shrine_w + 28, shrine_d + 24, 18),
            (0, shrine_y, shrine_base + shrine_h - 9), mats["plaster"], bevel_width=3)

    # Exactly one doorway; the amber plane stays inside the dark recess.
    doorway_w, doorway_h = 76, 94
    kit.box(collection, root, "JungleTemple_DoorwayRecess",
            (doorway_w, 12, doorway_h),
            (0, shrine_front_y - 1, shrine_base + doorway_h / 2 + 10),
            mats["iron"], bevel_width=5)
    kit.box(collection, root, "JungleTemple_DoorwayInnerGlow",
            (doorway_w - 18, 5, doorway_h - 18),
            (0, shrine_front_y - 8, shrine_base + doorway_h / 2 + 9),
            mats["glow"], bevel_width=4)
    for side, x in (("Left", -doorway_w / 2 - 13), ("Right", doorway_w / 2 + 13)):
        kit.box(collection, root, f"JungleTemple_{side}DoorPier",
                (24, 20, doorway_h + 24),
                (x, shrine_front_y - 2, shrine_base + (doorway_h + 24) / 2 + 4),
                mats["plaster"], bevel_width=3)
    kit.box(collection, root, "JungleTemple_DoorLintel",
            (doorway_w + 58, 22, 22),
            (0, shrine_front_y - 2, shrine_base + doorway_h + 21),
            mats["foundation"], bevel_width=3)

    # Three additional centered floors create a grand vertical hierarchy.  All
    # floors shrink evenly and keep paired front panels for strict symmetry.
    level_base_z = shrine_base + shrine_h
    for level_index, (level_w, level_d, level_h) in enumerate(upper_levels, start=1):
        deck_h = 14
        cornice_h = 12
        level_name = f"JungleTemple_UpperLevel_{level_index:02d}"
        kit.box(collection, root, level_name + "_Terrace",
                (level_w + 28, level_d + 24, deck_h),
                (0, shrine_y, level_base_z + deck_h / 2),
                mats["plaster"], bevel_width=3)
        body_base = level_base_z + deck_h
        kit.box(collection, root, level_name + "_Body",
                (level_w, level_d, level_h),
                (0, shrine_y, body_base + level_h / 2),
                mats["stone"], bevel_width=4)
        level_front_y = shrine_y - level_d / 2 - 4
        panel_h = max(24, level_h * 0.46)
        for side, x in (("Left", -level_w * 0.24), ("Right", level_w * 0.24)):
            kit.box(collection, root, f"{level_name}_{side}FrontPanel",
                    (level_w * 0.24, 7, panel_h),
                    (x, level_front_y, body_base + level_h * 0.52),
                    mats["iron"], bevel_width=3)
            kit.box(collection, root, f"{level_name}_{side}FrontGlow",
                    (level_w * 0.13, 4, panel_h * 0.62),
                    (x, level_front_y - 4, body_base + level_h * 0.52),
                    mats["glass"], bevel_width=2)
        kit.box(collection, root, level_name + "_Cornice",
                (level_w + 22, level_d + 20, cornice_h),
                (0, shrine_y, body_base + level_h - cornice_h / 2),
                mats["foundation"], bevel_width=3)
        level_base_z = body_base + level_h

    # Exactly two mirrored tower platforms are fused to the sanctuary sides.
    # Their decks, corner posts and caps remain architectural details, not
    # detached towers or a separate temple complex.
    # Pull the mirrored towers toward the facade and slightly outside the
    # sanctuary shoulders.  The fixed isometric camera can then read both
    # platforms at once instead of losing the far tower behind the main mass.
    tower_x = shrine_w / 2 + tower_w / 2 + 19
    tower_y = shrine_y - shrine_d / 2 + tower_d / 2 - 5
    for side, x in (("Left", -tower_x), ("Right", tower_x)):
        kit.box(collection, root, f"JungleTemple_{side}TowerFoot",
                (tower_w + 18, tower_d + 18, 16),
                (x, tower_y, shrine_base + 8),
                mats["foundation"], bevel_width=3)
        kit.box(collection, root, f"JungleTemple_{side}TowerShaft",
                (tower_w, tower_d, tower_h),
                (x, tower_y, shrine_base + tower_h / 2),
                mats["stone"], bevel_width=4)
        tower_front_y = tower_y - tower_d / 2 - 4
        kit.box(collection, root, f"JungleTemple_{side}TowerFrontPanel",
                (tower_w * 0.46, 7, tower_h * 0.40),
                (x, tower_front_y, shrine_base + tower_h * 0.50),
                mats["iron"], bevel_width=3)
        deck_z = shrine_base + tower_h
        kit.box(collection, root, f"JungleTemple_{side}TowerDeck",
                (tower_w + 34, tower_d + 30, 14),
                (x, tower_y, deck_z + 7), mats["plaster"], bevel_width=3)
        post_z = deck_z + 29
        for post_index, (ox, oy) in enumerate(((-1, -1), (-1, 1), (1, -1), (1, 1))):
            kit.box(collection, root,
                    f"JungleTemple_{side}TowerPost_{post_index + 1:02d}",
                    (9, 9, 34),
                    (x + ox * (tower_w / 2 - 7),
                     tower_y + oy * (tower_d / 2 - 7), post_z),
                    mats["foundation"], bevel_width=1.5)
        kit.box(collection, root, f"JungleTemple_{side}TowerCanopy",
                (tower_w + 24, tower_d + 22, 12),
                (x, tower_y, deck_z + 52), mats["foundation"], bevel_width=3)

    # A restrained stepped crown and roof comb finish the central hierarchy.
    crown_base_z = level_base_z
    kit.box(collection, root, "JungleTemple_CrownLower",
            (crown_w, crown_d, crown_h),
            (0, shrine_y, crown_base_z + crown_h / 2), mats["plaster"], bevel_width=3)
    kit.box(collection, root, "JungleTemple_CrownUpper",
            (crown_w * 0.72, crown_d * 0.66, crown_h + 4),
            (0, shrine_y + 4, crown_base_z + crown_h + (crown_h + 4) / 2),
            mats["stone"], bevel_width=3)
    comb_z = crown_base_z + crown_h * 2 + 30
    kit.box(collection, root, "JungleTemple_RoofComb",
            (84, 30, 70), (0, shrine_y + 8, comb_z),
            mats["foundation"], bevel_width=4)
    kit.cylinder(collection, root, "JungleTemple_SunMedallion", 22, 9,
                 (0, shrine_front_y - 11, shrine_base + shrine_h * 0.73),
                 mats["brass"], rotation=(90, 0, 0), vertices=36, bevel_width=1.2)
    kit.cylinder(collection, root, "JungleTemple_SunMedallionInset", 9, 12,
                 (0, shrine_front_y - 16, shrine_base + shrine_h * 0.73),
                 mats["glow"], rotation=(90, 0, 0), vertices=28, bevel_width=0.8)

    # Integrated buttresses and sparse attached vegetation keep the jungle
    # theme subordinate to the readable stone mass.
    for side, x in (("Left", -shrine_w / 2 - 12), ("Right", shrine_w / 2 + 12)):
        kit.box(collection, root, f"JungleTemple_{side}Buttress",
                (30, shrine_d * 0.72, shrine_h * 0.72),
                (x, shrine_y + 4, shrine_base + shrine_h * 0.36),
                mats["foundation"], bevel_width=3)
    kit.box(collection, root, "JungleTemple_Moss_CrownFront",
            (crown_w * 0.62, 7, 8),
            (-28, shrine_y - crown_d / 2 - 3, crown_base_z + crown_h - 2),
            mats["roof"], bevel_width=1)
    for side, sign in (("Left", -1), ("Right", 1)):
        vine_x = sign * (shrine_w / 2 - 18)
        kit.box(collection, root, f"JungleTemple_Vine_{side}Stem",
                (7, 7, 84),
                (vine_x, shrine_front_y - 6, shrine_base + 73),
                mats["roof"], rotation=(0, sign * 10, 0), bevel_width=1.2)
        for index, z in enumerate((shrine_base + 42, shrine_base + 68, shrine_base + 94)):
            kit.box(collection, root,
                    f"JungleTemple_Vine_{side}Leaf_{index + 1:02d}",
                    (24, 6, 10),
                    (vine_x + sign * ((index % 2) * 8 - 4), shrine_front_y - 8, z),
                    mats["roof"],
                    rotation=(0, sign * (-28 if index % 2 == 0 else 24), 0),
                    bevel_width=2)
    return root


def build_energy_node(building_id, spec):
    """Natural rock mound with one of the four runtime energy-crystal silhouettes."""
    collection, root, mats = common_context(building_id, spec)
    dims = spec["dimensions"]
    mound_w, mound_d, mound_h = dims["mound"]

    # One overlapping mass instead of a paved/foundation slab.  The front row
    # stays low so the crystals remain readable while their roots stay embedded.
    rocks = [
        (0.00, 0.02, 0.54, 0.52, 0.82, 8, 0, 12),
        (-0.28, -0.03, 0.34, 0.38, 0.62, 14, -7, 22),
        (0.29, 0.00, 0.36, 0.36, 0.66, -9, 13, -18),
        (-0.12, -0.27, 0.34, 0.31, 0.54, 7, 16, 9),
        (0.15, -0.28, 0.36, 0.30, 0.52, -12, 4, 20),
        (-0.38, -0.24, 0.27, 0.27, 0.44, 18, -8, -16),
        (0.40, -0.22, 0.28, 0.28, 0.46, -6, 18, 14),
        (-0.43, 0.18, 0.29, 0.31, 0.49, 12, 5, 25),
        (0.43, 0.20, 0.30, 0.31, 0.50, -16, 9, -22),
        (-0.20, 0.31, 0.34, 0.29, 0.50, 8, -14, 10),
        (0.20, 0.32, 0.33, 0.30, 0.52, -10, 6, -12),
        (0.00, 0.40, 0.31, 0.27, 0.45, 15, 8, 18),
    ]
    for index, (x, y, sx, sy, sz, rx, ry, rz) in enumerate(rocks, 1):
        rock_h = mound_h * sz
        kit.rough_boulder(
            collection, root, f"EnergyNode_Rock_{index:02d}",
            (mound_w * sx, mound_d * sy, rock_h),
            (mound_w * x, mound_d * y, rock_h * 0.40),
            mats["stone"], rotation=(rx, ry, rz), subdivisions=2)

    base_z = mound_h * 0.33
    for index, values in enumerate(dims["crystals"], 1):
        x, y, height, radius, lean_x, lean_y, rotation_z = values
        kit.faceted_crystal_prism(
            collection, root, f"EnergyNode_Crystal_{index:02d}",
            height, radius, (x, y, base_z), mats["crystal"],
            highlight_mat=mats["crystalHighlight"], lean=(lean_x, lean_y),
            sides=6, depth_scale=0.76, rotation_z=rotation_z)
    return root


def build_energy_node_1(spec):
    return build_energy_node("energy_node_1", spec)


def build_energy_node_2(spec):
    return build_energy_node("energy_node_2", spec)


def build_energy_node_3(spec):
    return build_energy_node("energy_node_3", spec)


def build_energy_node_4(spec):
    return build_energy_node("energy_node_4", spec)


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
    "research_institute": build_research_institute,
    "blacksmith": build_blacksmith,
    "shooting_range": build_shooting_range,
    "cavalry_school": build_cavalry_school,
    "hamster_barracks": build_hamster_barracks,
    "explorer_camp": build_explorer_camp,
    "miner_camp": build_miner_camp,
    "market": build_market,
    "portal": build_portal,
    "jungle_temple": build_jungle_temple,
    "energy_node_1": build_energy_node_1,
    "energy_node_2": build_energy_node_2,
    "energy_node_3": build_energy_node_3,
    "energy_node_4": build_energy_node_4,
    "thatch_hut": build_thatch_hut,
}


def main():
    manifest_path, building_id, blend_path, preview_path, depth_path, body_depth_path = parse_args()
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
    if body_depth_path:
        excluded_names = spec.get("bodyDepthExclude")
        if excluded_names is None and building_id == "research_institute":
            excluded_names = ["Research_Foundation"]
        if not excluded_names:
            raise SystemExit(f"body-depth output requires bodyDepthExclude for {building_id}")
        excluded = []
        for object_name in excluded_names:
            obj = bpy.data.objects.get(object_name)
            if obj is None:
                raise SystemExit(f"body-depth object not found: {object_name}")
            excluded.append(obj)
            obj.hide_render = True
        try:
            kit.render_depth(bpy.context.scene, root, camera, body_depth_path, building_id + "_Body")
        finally:
            for obj in excluded:
                obj.hide_render = False
    print("building id ->", building_id)
    print("model ->", blend_path)
    print("preview ->", preview_path)
    print("depth ->", depth_path)
    if body_depth_path:
        print("body depth ->", body_depth_path)


if __name__ == "__main__":
    main()
