#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build modular World-122 settlement buildings from one reusable component kit."""

import importlib.util
import json
import math
import os
import subprocess
import sys

import bpy
import mathutils


def load_kit():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "building-component-kit.py")
    spec = importlib.util.spec_from_file_location("world122_building_components", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kit = load_kit()


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    body_only = bool(argv and argv[-1] == "--body-only")
    if body_only:
        argv = argv[:-1]
    if len(argv) not in (5, 6):
        raise SystemExit("usage: blender --background --python settlement-building-pack-blender.py -- manifest.json id out.blend preview.png depth.png [body-depth.png] [--body-only]")
    manifest, building_id, blend, preview, depth = argv[:5]
    body_depth = os.path.abspath(argv[5]) if len(argv) == 6 else None
    return (os.path.abspath(manifest), building_id, os.path.abspath(blend),
            os.path.abspath(preview), os.path.abspath(depth), body_depth,
            body_only)


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


def desert_mansion_dome(collection, root, name, radius, height, location, mat,
                        segments=48):
    """One editable onion dome used by the desert mansion builder."""
    profile = (
        (radius * 0.82, 0.0),
        (radius, height * 0.12),
        (radius * 0.96, height * 0.34),
        (radius * 0.76, height * 0.58),
        (radius * 0.45, height * 0.78),
        (radius * 0.18, height * 0.93),
        (0.0, height),
    )
    vertices = []
    rings = []
    for ring_radius, z in profile:
        if ring_radius <= 0.001:
            rings.append([len(vertices)])
            vertices.append((0.0, 0.0, z))
            continue
        ring = []
        for index in range(segments):
            angle = math.tau * index / segments
            ring.append(len(vertices))
            vertices.append((ring_radius * math.cos(angle),
                             ring_radius * math.sin(angle), z))
        rings.append(ring)

    faces = []
    bottom_center = len(vertices)
    vertices.append((0.0, 0.0, profile[0][1]))
    for index in range(segments):
        nxt = (index + 1) % segments
        faces.append((bottom_center, rings[0][nxt], rings[0][index]))
    for lower, upper in zip(rings, rings[1:]):
        if len(upper) == 1:
            apex = upper[0]
            for index in range(segments):
                faces.append((lower[index], lower[(index + 1) % segments], apex))
        else:
            for index in range(segments):
                nxt = (index + 1) % segments
                faces.append((lower[index], lower[nxt], upper[nxt], upper[index]))

    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    obj.location = location
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
    if "snow" in palette:
        mats["snow"] = kit.material(
            "MAT_Packed_Roof_Snow", palette["snow"], roughness=0.96,
            noise={"scale": 9, "detail": 3, "bump": 0.10})
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
    """Four-sided Gothic tower roof with one apex."""
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


def research_diagonal_beam(collection, root, name, start, end, width, depth, mat):
    """Editable diagonal stone beam between two building-local points."""
    start_v = mathutils.Vector(start)
    end_v = mathutils.Vector(end)
    direction = end_v - start_v
    beam = kit.box(collection, root, name, (direction.length, width, depth),
                   tuple((start_v + end_v) * 0.5), mat, bevel_width=1.5)
    beam.rotation_mode = "QUATERNION"
    beam.rotation_quaternion = direction.to_track_quat("X", "Z")
    return beam


def research_pointed_panel(collection, root, name, location, width, height, depth,
                           mat, orientation="front"):
    """Extruded five-sided lancet panel for one Gothic window or tympanum."""
    half_w = width / 2
    lower_z = -height / 2
    spring_z = height * 0.18
    apex_z = height / 2
    profile = [(-half_w, lower_z), (half_w, lower_z), (half_w, spring_z),
               (0, apex_z), (-half_w, spring_z)]
    vertices = []
    if orientation == "front":
        for plane in (-depth / 2, depth / 2):
            vertices.extend((u, plane, z) for u, z in profile)
    else:
        for plane in (-depth / 2, depth / 2):
            vertices.extend((plane, u, z) for u, z in profile)
    count = len(profile)
    faces = [tuple(range(count)), tuple(reversed(range(count, count * 2)))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    obj.location = location
    kit.bevel(obj, 1.2, 2)
    return obj


def research_pointed_window(collection, root, mats, name, location, width, height,
                            orientation="front"):
    """Blue lancet glass with individually editable cool-gray Gothic tracery."""
    x, y, z = location
    frame = max(6.0, width * 0.13)
    depth = 7.0
    lower_z = z - height / 2
    spring_z = z + height * 0.18
    apex_z = z + height / 2
    jamb_h = spring_z - lower_z
    research_pointed_panel(collection, root, name + "_BlueGlass", location,
                           width, height, depth, mats["glass"], orientation)
    if orientation == "front":
        for side in (-1, 1):
            kit.box(collection, root, f"{name}_Jamb_{side:+d}",
                    (frame, depth + 4, jamb_h),
                    (x + side * width / 2, y, lower_z + jamb_h / 2),
                    mats["foundation"], bevel_width=1)
            research_diagonal_beam(
                collection, root, f"{name}_Arch_{side:+d}",
                (x + side * width / 2, y, spring_z), (x, y, apex_z),
                depth + 4, frame, mats["foundation"])
        kit.box(collection, root, name + "_Sill", (width + frame * 2, depth + 4, frame),
                (x, y, lower_z), mats["foundation"], bevel_width=1)
        kit.box(collection, root, name + "_Transom", (width, depth + 5, frame * 0.58),
                (x, y - 1, spring_z), mats["iron"], bevel_width=0.6)
        kit.box(collection, root, name + "_Mullion", (frame * 0.48, depth + 5, height * 0.84),
                (x, y - 1, z - height * 0.05), mats["iron"], bevel_width=0.6)
    else:
        for side in (-1, 1):
            kit.box(collection, root, f"{name}_Jamb_{side:+d}",
                    (depth + 4, frame, jamb_h),
                    (x, y + side * width / 2, lower_z + jamb_h / 2),
                    mats["foundation"], bevel_width=1)
            research_diagonal_beam(
                collection, root, f"{name}_Arch_{side:+d}",
                (x, y + side * width / 2, spring_z), (x, y, apex_z),
                depth + 4, frame, mats["foundation"])
        kit.box(collection, root, name + "_Sill", (depth + 4, width + frame * 2, frame),
                (x, y, lower_z), mats["foundation"], bevel_width=1)
        kit.box(collection, root, name + "_Transom", (depth + 5, width, frame * 0.58),
                (x - 1, y, spring_z), mats["iron"], bevel_width=0.6)
        kit.box(collection, root, name + "_Mullion", (depth + 5, frame * 0.48, height * 0.84),
                (x - 1, y, z - height * 0.05), mats["iron"], bevel_width=0.6)


def research_diamond_column(collection, root, mats, name, location, dimensions):
    """Low diamond-section perimeter column; deliberately not a second tower."""
    x, y, base_z = location
    shaft_w, shaft_d, shaft_h = dimensions
    kit.box(collection, root, name + "_Foot", (shaft_w + 24, shaft_d + 24, 18),
            (x, y, base_z + 9), mats["foundation"], rotation=(0, 0, 45), bevel_width=3)
    kit.box(collection, root, name + "_LowerStep", (shaft_w + 12, shaft_d + 12, 24),
            (x, y, base_z + 30), mats["stone"], rotation=(0, 0, 45), bevel_width=2)
    kit.box(collection, root, name + "_Shaft", (shaft_w, shaft_d, shaft_h),
            (x, y, base_z + 38 + shaft_h / 2), mats["plaster"],
            rotation=(0, 0, 45), bevel_width=2)
    kit.box(collection, root, name + "_MidBand", (shaft_w + 9, shaft_d + 9, 10),
            (x, y, base_z + 38 + shaft_h * 0.52), mats["foundation"],
            rotation=(0, 0, 45), bevel_width=1.5)
    cap_z = base_z + 38 + shaft_h
    kit.box(collection, root, name + "_Capital", (shaft_w + 18, shaft_d + 18, 16),
            (x, y, cap_z), mats["stone"], rotation=(0, 0, 45), bevel_width=2)
    kit.box(collection, root, name + "_FlatCap", (shaft_w + 28, shaft_d + 28, 10),
            (x, y, cap_z + 13), mats["foundation"], rotation=(0, 0, 45), bevel_width=2)
    return cap_z + 18


def build_research_institute_level(building_id, spec, level):
    """One Gothic institute family: fixed four-wing base, progressively taller single tower."""
    if level not in (1, 2, 3):
        raise ValueError(f"unsupported research institute level: {level}")
    collection, root, mats = common_context(building_id, spec)
    prefix = f"ResearchLV{level}"
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    wing_w, wing_l, wing_h = dims["wingBody"]
    roof_w, roof_l, roof_h = dims["wingRoof"]
    tower_w, tower_d, tower_h = dims["towerShaft"]
    chamber_w, chamber_d, chamber_h = dims["towerChamber"]
    tower_roof_w, tower_roof_d, tower_roof_h = dims["towerRoof"]
    column_w, column_d, column_h = dims["diamondColumn"]
    wing_offset = float(dims["wingOffset"])
    column_radius = float(dims["diamondRadius"])

    # Every level shares the exact LV1 square footprint, four skirt wings and
    # four perimeter columns. Only tower height and attached academic detail
    # progress, so the upgrade always reads as the same building.
    kit.box(collection, root, f"{prefix}_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)
    kit.box(collection, root, f"{prefix}_Foundation_Inset", (fw - 26, fd - 26, 10),
            (0, 0, fh + 5), mats["stone"], bevel_width=4)
    base_z = fh + 10

    wing_specs = (
        ("North", (0, wing_offset), (wing_w, wing_l, wing_h), 90),
        ("South", (0, -wing_offset), (wing_w, wing_l, wing_h), 90),
        ("East", (wing_offset, 0), (wing_l, wing_w, wing_h), 0),
        ("West", (-wing_offset, 0), (wing_l, wing_w, wing_h), 0),
    )
    roof_base = base_z + wing_h - 3
    for wing_name, (x, y), body_size, roof_rotation in wing_specs:
        kit.box(collection, root, f"{prefix}_{wing_name}Wing_WhiteHall", body_size,
                (x, y, base_z + wing_h / 2), mats["plaster"], bevel_width=4)
        kit.box(collection, root, f"{prefix}_{wing_name}Wing_GrayStoneSkirt",
                (body_size[0] + 8, body_size[1] + 8, 34),
                (x, y, base_z + 17), mats["stone"], bevel_width=3)
        roof = kit.gabled_prism(collection, root,
                                f"{prefix}_{wing_name}Wing_BlueGableRoof",
                                roof_l, roof_w, roof_h, (x, y, roof_base),
                                mats["plaster"], mats["roof"])
        roof.rotation_euler.z = math.radians(roof_rotation)
        ridge_size = (8, roof_l + 4, 9) if roof_rotation else (roof_l + 4, 8, 9)
        kit.box(collection, root, f"{prefix}_{wing_name}Wing_BlueRidge", ridge_size,
                (x, y, roof_base + roof_h + 1), mats["timber"], bevel_width=1)
        if level >= 2:
            kit.box(collection, root, f"{prefix}_{wing_name}Wing_AcademicCornice",
                    (body_size[0] + 14, body_size[1] + 14, 10),
                    (x, y, roof_base - 4), mats["foundation"],
                    bevel_width=1.5)

    south_face = -wing_offset - wing_l / 2 - 4
    north_face = wing_offset + wing_l / 2 + 4
    west_face = -wing_offset - wing_l / 2 - 4
    east_face = wing_offset + wing_l / 2 + 4
    window_z = base_z + 72
    for index, x in enumerate((-55, 55)):
        research_pointed_window(collection, root, mats,
                                f"{prefix}_SouthWing_Lancet_{index}",
                                (x, south_face, window_z), 30, 72)
        research_pointed_window(collection, root, mats,
                                f"{prefix}_NorthWing_Lancet_{index}",
                                (x, north_face, window_z), 30, 72)
    for index, y in enumerate((-55, 55)):
        research_pointed_window(collection, root, mats,
                                f"{prefix}_WestWing_Lancet_{index}",
                                (west_face, y, window_z), 30, 72,
                                orientation="side")
        research_pointed_window(collection, root, mats,
                                f"{prefix}_EastWing_Lancet_{index}",
                                (east_face, y, window_z), 30, 72,
                                orientation="side")

    kit.double_doors(collection, root, f"{prefix}_SouthWing_MainDoor",
                     (0, south_face - 5, base_z), 76, 92,
                     mats["timber"], mats["iron"], open_angle=0)
    research_pointed_window(collection, root, mats,
                            f"{prefix}_SouthWing_DoorTympanum",
                            (0, south_face - 2, base_z + 105), 54, 74)
    kit.box(collection, root, f"{prefix}_SouthWing_BlueDiamondSeal",
            (24, 7, 24), (0, south_face - 8, roof_base + 35), mats["roof"],
            rotation=(0, 0, 45), bevel_width=2)

    # The tower is the sole major silhouette upgrade: LV2 gains two readable
    # window stages and a gallery band; LV3 gains three stages, denser courses
    # and a taller crown while preserving the one-tower identity.
    kit.box(collection, root, f"{prefix}_CentralTower_WhiteShaft",
            (tower_w, tower_d, tower_h),
            (0, 0, base_z + tower_h / 2), mats["plaster"], bevel_width=5)
    kit.box(collection, root, f"{prefix}_CentralTower_GrayPlinth",
            (tower_w + 18, tower_d + 18, 22),
            (0, 0, base_z + 11), mats["foundation"], bevel_width=3)
    band_ratios = {
        1: (0.36, 0.72),
        2: (0.26, 0.50, 0.75),
        3: (0.20, 0.40, 0.60, 0.79),
    }[level]
    for band_index, z_ratio in enumerate(band_ratios):
        kit.box(collection, root, f"{prefix}_CentralTower_GrayBand_{band_index}",
                (tower_w + 14, tower_d + 14, 12),
                (0, 0, base_z + tower_h * z_ratio), mats["stone"], bevel_width=2)
    buttress_ratio = {1: 0.79, 2: 0.85, 3: 0.90}[level]
    buttress_h = tower_h * buttress_ratio
    for x_sign in (-1, 1):
        for y_sign in (-1, 1):
            kit.box(collection, root,
                    f"{prefix}_CentralTower_CornerButtress_{x_sign:+d}_{y_sign:+d}",
                    (18 + (level - 1) * 2, 18 + (level - 1) * 2, buttress_h),
                    (x_sign * (tower_w / 2 + 4), y_sign * (tower_d / 2 + 4),
                     base_z + buttress_h / 2), mats["foundation"],
                    rotation=(0, 0, 45), bevel_width=2)

    window_tiers = {
        1: ((0.56, 116),),
        2: ((0.34, 92), (0.68, 92)),
        3: ((0.25, 84), (0.50, 84), (0.75, 84)),
    }[level]
    for tier, (ratio, window_h) in enumerate(window_tiers):
        z = base_z + tower_h * ratio
        research_pointed_window(collection, root, mats,
                                f"{prefix}_CentralTower_ShaftTier_{tier}_FrontLancet",
                                (0, -tower_d / 2 - 5, z), 40, window_h)
        research_pointed_window(collection, root, mats,
                                f"{prefix}_CentralTower_ShaftTier_{tier}_BackLancet",
                                (0, tower_d / 2 + 5, z), 40, window_h)
        research_pointed_window(collection, root, mats,
                                f"{prefix}_CentralTower_ShaftTier_{tier}_LeftLancet",
                                (-tower_w / 2 - 5, 0, z), 40, window_h,
                                orientation="side")
        research_pointed_window(collection, root, mats,
                                f"{prefix}_CentralTower_ShaftTier_{tier}_RightLancet",
                                (tower_w / 2 + 5, 0, z), 40, window_h,
                                orientation="side")

    shaft_top = base_z + tower_h
    eaves_extra = {1: 22, 2: 38, 3: 54}[level]
    gallery_w = chamber_w + eaves_extra
    gallery_d = chamber_d + eaves_extra
    kit.box(collection, root, f"{prefix}_CentralTower_ChamberEaves",
            (gallery_w, gallery_d, 16),
            (0, 0, shaft_top + 2), mats["foundation"], bevel_width=3)
    if level >= 2:
        rail_h = 18 if level == 2 else 24
        rail_z = shaft_top + rail_h / 2 + 9
        kit.box(collection, root, f"{prefix}_CentralTower_GalleryFrontRail",
                (gallery_w, 7, rail_h), (0, -gallery_d / 2, rail_z),
                mats["stone"], bevel_width=1)
        kit.box(collection, root, f"{prefix}_CentralTower_GalleryBackRail",
                (gallery_w, 7, rail_h), (0, gallery_d / 2, rail_z),
                mats["stone"], bevel_width=1)
        kit.box(collection, root, f"{prefix}_CentralTower_GalleryLeftRail",
                (7, gallery_d, rail_h), (-gallery_w / 2, 0, rail_z),
                mats["stone"], bevel_width=1)
        kit.box(collection, root, f"{prefix}_CentralTower_GalleryRightRail",
                (7, gallery_d, rail_h), (gallery_w / 2, 0, rail_z),
                mats["stone"], bevel_width=1)

    kit.box(collection, root, f"{prefix}_CentralTower_WhiteCrownChamber",
            (chamber_w, chamber_d, chamber_h),
            (0, 0, shaft_top + chamber_h / 2 + 4), mats["stone"], bevel_width=4)
    if level >= 2:
        pier_h = chamber_h - 10
        for x_sign in (-1, 1):
            for y_sign in (-1, 1):
                kit.box(collection, root,
                        f"{prefix}_CentralTower_CrownPier_{x_sign:+d}_{y_sign:+d}",
                        (12, 12, pier_h),
                        (x_sign * (chamber_w / 2 + 3), y_sign * (chamber_d / 2 + 3),
                         shaft_top + chamber_h / 2 + 4), mats["foundation"],
                        rotation=(0, 0, 45), bevel_width=1.5)
    chamber_window_z = shaft_top + chamber_h * 0.54
    crown_window_w = {1: 48, 2: 52, 3: 56}[level]
    crown_window_h = {1: 64, 2: 72, 3: 82}[level]
    research_pointed_window(collection, root, mats,
                            f"{prefix}_CentralTower_CrownFront",
                            (0, -chamber_d / 2 - 5, chamber_window_z),
                            crown_window_w, crown_window_h)
    research_pointed_window(collection, root, mats,
                            f"{prefix}_CentralTower_CrownBack",
                            (0, chamber_d / 2 + 5, chamber_window_z),
                            crown_window_w, crown_window_h)
    research_pointed_window(collection, root, mats,
                            f"{prefix}_CentralTower_CrownLeft",
                            (-chamber_w / 2 - 5, 0, chamber_window_z),
                            crown_window_w, crown_window_h, orientation="side")
    research_pointed_window(collection, root, mats,
                            f"{prefix}_CentralTower_CrownRight",
                            (chamber_w / 2 + 5, 0, chamber_window_z),
                            crown_window_w, crown_window_h, orientation="side")

    chamber_top = shaft_top + chamber_h + 4
    kit.box(collection, root, f"{prefix}_CentralTower_BlueRoofEaves",
            (tower_roof_w + 10, tower_roof_d + 10, 12),
            (0, 0, chamber_top), mats["timber"], bevel_width=2)
    research_pyramid_roof(collection, root,
                          f"{prefix}_CentralTower_BlueSteepRoof",
                          tower_roof_w, tower_roof_d, tower_roof_h,
                          (0, 0, chamber_top + 2), mats["roof"])
    roof_apex = chamber_top + 2 + tower_roof_h
    if level >= 2:
        for x_sign in (-1, 1):
            for y_sign in (-1, 1):
                research_diagonal_beam(
                    collection, root,
                    f"{prefix}_CentralTower_RoofRib_{x_sign:+d}_{y_sign:+d}",
                    (x_sign * tower_roof_w * 0.48,
                     y_sign * tower_roof_d * 0.48, chamber_top + 5),
                    (0, 0, roof_apex), 5 + level, 5 + level, mats["timber"])
    finial_height = {1: 26, 2: 38, 3: 52}[level]
    finial_radius = {1: 7, 2: 8, 3: 10}[level]
    kit.cylinder(collection, root, f"{prefix}_CentralTower_FinialBase",
                 finial_radius, 13 + level * 2, (0, 0, roof_apex + 7),
                 mats["iron"], vertices=8, bevel_width=1)
    cone(collection, root, f"{prefix}_CentralTower_Finial",
         finial_radius, finial_height,
         (0, 0, roof_apex + 15 + finial_height / 2),
         mats["roof"], vertices=4)

    tower_corner = tower_w / 2 - 3
    for x_sign, y_sign, label in ((-1, -1, "SouthWest"), (1, -1, "SouthEast"),
                                  (-1, 1, "NorthWest"), (1, 1, "NorthEast")):
        x = x_sign * column_radius
        y = y_sign * column_radius
        name = f"{prefix}_DiamondColumn_{label}"
        cap_z = research_diamond_column(collection, root, mats, name,
                                        (x, y, base_z),
                                        (column_w, column_d, column_h))
        buttress_targets = (cap_z - 16, cap_z - 68)
        for tier, (outer_drop, inner_z) in enumerate(((18, buttress_targets[0]),
                                                       (46, buttress_targets[1]))):
            research_diagonal_beam(
                collection, root, f"{prefix}_FlyingButtress_{label}_{tier}",
                (x - x_sign * 6, y - y_sign * 6, cap_z - outer_drop),
                (x_sign * tower_corner, y_sign * tower_corner, inner_z),
                13 if tier == 0 else 10, 15 if tier == 0 else 12,
                mats["stone"] if tier == 0 else mats["foundation"])
    return root


def build_research_institute(spec):
    return build_research_institute_level("research_institute", spec, 1)


def build_research_institute_lv2(spec):
    return build_research_institute_level("research_institute_lv2", spec, 2)


def build_research_institute_lv3(spec):
    return build_research_institute_level("research_institute_lv3", spec, 3)


def build_church(spec):
    """Compact 2x2 chapel with one integrated bell tower on the screen-left side."""
    collection, root, mats = common_context("church", spec)
    dims = spec["dimensions"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    nw, nd, nh = dims["narthex"]
    tw, td, th = dims["bellTower"]
    parapet_w, parapet_d, parapet_h = dims["bellParapet"]
    stained_blue_color = kit.rgba((0.035, 0.15, 0.52, 1.0))
    stained_amber_color = kit.rgba((0.92, 0.24, 0.025, 1.0))
    stained_blue = kit.material("MAT_Church_StainedGlass_Blue", stained_blue_color,
                                roughness=0.18, emission=(stained_blue_color, 0.62))
    stained_amber = kit.material("MAT_Church_StainedGlass_Amber", stained_amber_color,
                                 roughness=0.16, emission=(stained_amber_color, 1.15))

    # Bearing masses touch z=0 directly; runtime road-fill supplies the paving.
    kit.box(collection, root, "Church_MainHall", (bw, bd, bh),
            (8, 12, bh / 2), mats["stone"], bevel_width=5)
    roof_base = bh - 4
    kit.gabled_prism(collection, root, "Church_MainRoof", rw, rd, rh,
                     (8, 12, roof_base), mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "Church_MainRoofCourse", rw, rd, rh,
                  roof_base, mats["roof"], rows=12)

    narthex_y = -bd / 2 - nd / 2 + 22
    kit.box(collection, root, "Church_Narthex", (nw, nd, nh),
            (10, narthex_y, nh / 2), mats["stone"], bevel_width=4)
    kit.gabled_prism(collection, root, "Church_NarthexRoof", nw + 20, nd + 18, 62,
                     (10, narthex_y, nh - 4), mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "Church_NarthexRoofCourse", nw + 20, nd + 18,
                  62, nh - 4, mats["roof"], rows=7)

    # Keep the screen-left tower integrated into the rear shoulder.  The
    # screen-right side stays as one uninterrupted chapel roof and entrance mass.
    tower_positions = ((-112, 72),)
    for tower_index, (tower_x, tower_y) in enumerate(tower_positions):
        kit.box(collection, root, f"Church_BellTower_{tower_index}", (tw, td, th),
                (tower_x, tower_y, th / 2), mats["stone"], bevel_width=5)
        kit.box(collection, root, f"Church_BellTowerCornice_{tower_index}",
                (tw + 14, td + 14, 14), (tower_x, tower_y, th - 48),
                mats["foundation"], bevel_width=2)
        # Selected seed 122960 uses a flat stone belfry with a crenellated
        # parapet.  Keep two adjacent openings so both visible faces read as a
        # working bell chamber from the fixed isometric camera.
        kit.box(collection, root, f"Church_BellTowerRoofDeck_{tower_index}",
                (parapet_w, parapet_d, 10), (tower_x, tower_y, th + 5),
                mats["foundation"], bevel_width=2)
        parapet_z = th + parapet_h / 2 + 9
        kit.box(collection, root, f"Church_ParapetFront_{tower_index}",
                (parapet_w, 10, parapet_h),
                (tower_x, tower_y - parapet_d / 2 + 5, parapet_z),
                mats["foundation"], bevel_width=1)
        kit.box(collection, root, f"Church_ParapetBack_{tower_index}",
                (parapet_w, 10, parapet_h),
                (tower_x, tower_y + parapet_d / 2 - 5, parapet_z),
                mats["foundation"], bevel_width=1)
        kit.box(collection, root, f"Church_ParapetLeft_{tower_index}",
                (10, parapet_d - 20, parapet_h),
                (tower_x - parapet_w / 2 + 5, tower_y, parapet_z),
                mats["foundation"], bevel_width=1)
        kit.box(collection, root, f"Church_ParapetRight_{tower_index}",
                (10, parapet_d - 20, parapet_h),
                (tower_x + parapet_w / 2 - 5, tower_y, parapet_z),
                mats["foundation"], bevel_width=1)
        merlon_z = th + parapet_h + 18
        for merlon_index, (mx, my) in enumerate((
                (-parapet_w / 2 + 10, -parapet_d / 2 + 10),
                (0, -parapet_d / 2 + 10),
                (parapet_w / 2 - 10, -parapet_d / 2 + 10),
                (-parapet_w / 2 + 10, 0),
                (parapet_w / 2 - 10, 0),
                (-parapet_w / 2 + 10, parapet_d / 2 - 10),
                (0, parapet_d / 2 - 10),
                (parapet_w / 2 - 10, parapet_d / 2 - 10))):
            kit.box(collection, root, f"Church_ParapetMerlon_{tower_index}_{merlon_index}",
                    (18, 18, 20), (tower_x + mx, tower_y + my, merlon_z),
                    mats["foundation"], bevel_width=1)

        belfry_faces = (
            ((tower_x - tw / 2 - 4, tower_y, th - 82), (7, 46, 54),
             (tower_x - tw / 2 - 11, tower_y, th - 84)),
            ((tower_x, tower_y - td / 2 - 4, th - 82), (46, 7, 54),
             (tower_x, tower_y - td / 2 - 11, th - 84)),
        )
        for face_index, (opening_pos, opening_size, bell_pos) in enumerate(belfry_faces):
            kit.box(collection, root, f"Church_BelfryOpening_{tower_index}_{face_index}",
                    opening_size, opening_pos, mats["iron"], bevel_width=4)
            bpy.ops.mesh.primitive_cone_add(vertices=24, radius1=14, radius2=8, depth=24)
            bell = bpy.context.object
            bell.name = f"Church_Bell_{tower_index}_{face_index}"
            bell.parent = root
            bell.location = bell_pos
            bell.data.materials.append(mats["brass"])
            kit.bevel(bell, 1.2, 2)
            kit.move_to_collection(bell, collection)
            kit.cylinder(collection, root,
                         f"Church_BellClapper_{tower_index}_{face_index}", 4, 12,
                         (bell_pos[0], bell_pos[1], bell_pos[2] - 15), mats["iron"],
                         vertices=16, bevel_width=0.8)

    front_y = narthex_y - nd / 2 - 4
    kit.double_doors(collection, root, "Church_MainDoor", (10, front_y, 0),
                     70, 106, mats["timber"], mats["iron"], open_angle=0)
    portal_arch_ring(collection, root, "Church_MainDoorArch", 47, 36, 12,
                     88, front_y - 2, mats["foundation"], segments=20)
    for x_offset in (-42, 42):
        kit.box(collection, root, f"Church_DoorJamb_{x_offset:+}", (10, 14, 90),
                (10 + x_offset, front_y - 2, 45), mats["foundation"], bevel_width=2)
    kit.cylinder(collection, root, "Church_RoseWindowFrame", 32, 7,
                 (10, front_y - 4, 121), mats["brass"],
                 rotation=(90, 0, 0), vertices=20, bevel_width=1)
    kit.cylinder(collection, root, "Church_RoseWindow", 24, 10,
                 (10, front_y - 8, 121), stained_blue,
                 rotation=(90, 0, 0), vertices=20, bevel_width=1)
    kit.cylinder(collection, root, "Church_RoseWindowAmberCore", 9, 12,
                 (10, front_y - 10, 121), stained_amber,
                 rotation=(90, 0, 0), vertices=16, bevel_width=1)

    main_front_y = 12 - bd / 2 - 4
    for index, x in enumerate((-92, 76, 122)):
        kit.box(collection, root, f"Church_FrontButtress_{index}", (20, 28, 92),
                (x, main_front_y - 6, 46), mats["foundation"], bevel_width=3)
    for index, x in enumerate((-48, 36, 94)):
        kit.box(collection, root, f"Church_FrontWindow_{index}", (24, 8, 64),
                (x, main_front_y - 5, 92), stained_blue, bevel_width=4)
        kit.box(collection, root, f"Church_FrontWindowAmber_{index}", (7, 10, 56),
                (x, main_front_y - 7, 92), stained_amber, bevel_width=2)
    side_x = 8 - bw / 2 - 4
    for index, y in enumerate((-58, 28, 92)):
        kit.box(collection, root, f"Church_SideButtress_{index}", (28, 20, 92),
                (side_x - 6, y, 46), mats["foundation"], bevel_width=3)
    for index, y in enumerate((-82, -28, 26)):
        kit.box(collection, root, f"Church_SideWindow_{index}", (8, 25, 68),
                (side_x - 5, y, 94), stained_blue, bevel_width=4)
        kit.box(collection, root, f"Church_SideWindowAmber_{index}", (10, 7, 60),
                (side_x - 7, y, 94), stained_amber, bevel_width=2)
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


def _build_main_space_warehouse_chest(spec, open_lid=False):
    """Shared closed/open marble treasure chest for the warehouse NPC."""
    asset_id = "main_space_warehouse_open" if open_lid else "main_space_warehouse"
    collection, root, mats = common_context(asset_id, spec)
    dims = spec["dimensions"]
    bw, bd, bh = dims["body"]
    lw, ld, lh = dims["lid"]
    fw, fd, fh = dims["feet"]
    body_base = fh - 2
    body_top = body_base + bh
    front_y = -bd / 2 - 4
    side_x = -bw / 2 - 4

    def filigree(name, points, bevel_depth=2.2):
        curve_data = bpy.data.curves.new(name + "_Curve", type="CURVE")
        curve_data.dimensions = "3D"
        curve_data.resolution_u = 3
        curve_data.bevel_depth = bevel_depth
        curve_data.bevel_resolution = 3
        curve_data.use_fill_caps = True
        spline = curve_data.splines.new("BEZIER")
        spline.bezier_points.add(len(points) - 1)
        for point, (x, z) in zip(spline.bezier_points, points):
            point.co = (x, front_y - 8, z)
            point.handle_left_type = "AUTO"
            point.handle_right_type = "AUTO"
        obj = bpy.data.objects.new(name, curve_data)
        collection.objects.link(obj)
        obj.parent = root
        obj.data.materials.append(mats["brass"])
        return obj

    def sapphire(name, location, size):
        bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1)
        gem = bpy.context.object
        gem.name = name
        gem.dimensions = size
        bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
        gem.parent = root
        gem.location = location
        gem.data.materials.append(mats["glow"])
        kit.move_to_collection(gem, collection)
        return gem

    # Four separate feet and a squat body keep the silhouette unmistakably chest-like.
    for index, (x, y) in enumerate(((-bw / 2 + 17, -bd / 2 + 15),
                                    (bw / 2 - 17, -bd / 2 + 15),
                                    (-bw / 2 + 17, bd / 2 - 15),
                                    (bw / 2 - 17, bd / 2 - 15))):
        kit.box(collection, root, f"WarehouseChest_GoldFoot_{index}", (fw, fd, fh),
                (x, y, fh / 2), mats["brass"], bevel_width=5)
    kit.box(collection, root, "WarehouseChest_MarbleBody", (bw, bd, bh),
            (0, 0, body_base + bh / 2), mats["plaster"], bevel_width=8)

    # Gold frame, corner guards and the strong lid seam are physical chest hardware.
    for index, z in enumerate((body_base + 8, body_top - 8)):
        kit.box(collection, root, f"WarehouseChest_FrontBand_{index}",
                (bw + 12, 9, 10), (0, front_y, z), mats["brass"], bevel_width=2)
        kit.box(collection, root, f"WarehouseChest_SideBand_{index}",
                (9, bd + 12, 10), (side_x, 0, z), mats["brass"], bevel_width=2)
    for x in (-bw / 2 - 2, bw / 2 + 2):
        kit.box(collection, root, f"WarehouseChest_FrontCorner_{int(x)}",
                (11, 10, bh + 4), (x, front_y, body_base + bh / 2),
                mats["brass"], bevel_width=2.5)
    for y in (-bd / 2 - 2, bd / 2 + 2):
        kit.box(collection, root, f"WarehouseChest_SideCorner_{int(y)}",
                (10, 11, bh + 4), (side_x, y, body_base + bh / 2),
                mats["brass"], bevel_width=2.5)
    kit.box(collection, root, "WarehouseChest_LidSeam", (lw + 10, ld + 10, 12),
            (0, 0, body_top + 2), mats["brass"], bevel_width=3)

    # One domed lid is parented to its rear hinge, so the open state changes only
    # that assembly and preserves the exact body, gems and filigree.
    lid_base = body_top + 7
    lid_pivot = bpy.data.objects.new("WarehouseChest_RearHingePivot", None)
    collection.objects.link(lid_pivot)
    lid_pivot.parent = root
    lid_pivot.location = (0, ld / 2, lid_base)
    lid_pivot.rotation_euler.x = math.radians(-float(spec.get("lidOpenDegrees", 0)) if open_lid else 0)
    kit.barrel_vault(collection, lid_pivot, "WarehouseChest_DomedLid", lw, ld, lh,
                     (0, -ld / 2, 0), mats["plaster"], mats["roof"], segments=32)
    for index, x in enumerate((-lw * 0.42, 0, lw * 0.42)):
        rib_width = 11 if index == 1 else 9
        kit.barrel_vault(collection, lid_pivot, f"WarehouseChest_GoldLidRib_{index}",
                         rib_width, ld + 8, lh + 4, (x, -ld / 2, -1),
                         mats["brass"], mats["brass"], segments=28)
    kit.box(collection, lid_pivot, "WarehouseChest_LidLatch", (18, 10, 48),
            (0, -ld - 1, -9), mats["brass"], bevel_width=4)

    if open_lid:
        # Dark lining under the raised lid and one empty magical storage cavity.
        # No loose treasure is modeled, so the result remains the warehouse prop.
        kit.box(collection, lid_pivot, "WarehouseChest_InnerLidLining",
                (lw - 24, ld - 20, 6), (0, -ld / 2, -5),
                mats["iron"], bevel_width=5)
        kit.box(collection, root, "WarehouseChest_OpenInterior",
                (bw - 24, bd - 24, 7), (0, 0, body_top + 9),
                mats["iron"], bevel_width=6)
        kit.box(collection, root, "WarehouseChest_OpenInteriorBlueGlow",
                (bw - 42, bd - 42, 4), (0, -2, body_top + 13),
                mats["glow"], bevel_width=7)
        for index, x in enumerate((-lw * 0.31, lw * 0.31)):
            kit.cylinder(collection, root, f"WarehouseChest_GoldHinge_{index}",
                         8, 44, (x, bd / 2 + 3, body_top + 8), mats["brass"],
                         rotation=(0, 90, 0), vertices=24, bevel_width=1.5)

    # Central sapphire lock with a deep gold sunburst frame.
    lock_z = body_base + bh * 0.56
    kit.gear(collection, root, "WarehouseChest_GoldLockRosette", 27,
             (0, front_y - 10, lock_z), mats["brass"], axis="Y", teeth=16)
    sapphire("WarehouseChest_MainSapphire",
             (0, front_y - 17, lock_z), (31, 11, 42))

    # Raised symmetrical scrollwork makes the gold carving readable in Depth.
    scroll_z = body_base + bh * 0.50
    left_scroll = [(-27, scroll_z), (-40, scroll_z + 17), (-62, scroll_z + 20),
                   (-76, scroll_z + 8), (-67, scroll_z - 2), (-52, scroll_z + 3)]
    lower_left = [(-28, scroll_z - 7), (-43, scroll_z - 22), (-67, scroll_z - 20),
                  (-78, scroll_z - 7), (-64, scroll_z - 3)]
    filigree("WarehouseChest_Filigree_LeftUpper", left_scroll, 2.6)
    filigree("WarehouseChest_Filigree_LeftLower", lower_left, 2.3)
    filigree("WarehouseChest_Filigree_RightUpper", [(-x, z) for x, z in left_scroll], 2.6)
    filigree("WarehouseChest_Filigree_RightLower", [(-x, z) for x, z in lower_left], 2.3)
    for index, x in enumerate((-78, -50, 50, 78)):
        sapphire(f"WarehouseChest_SapphireInlay_{index}",
                 (x, front_y - 13, body_base + 23), (12, 7, 15))

    # One decorated side panel reinforces that this is a portable container, not a house.
    kit.gear(collection, root, "WarehouseChest_SideGoldRosette", 23,
             (side_x - 9, 12, body_base + bh * 0.50), mats["brass"], axis="X", teeth=14)
    side_gem = kit.cylinder(collection, root, "WarehouseChest_SideSapphire", 12, 8,
                            (side_x - 14, 12, body_base + bh * 0.50), mats["glow"],
                            rotation=(0, 90, 0), vertices=8, bevel_width=1)
    side_gem.scale.z = 1.25
    return root


def build_main_space_warehouse(spec):
    return _build_main_space_warehouse_chest(spec, open_lid=False)


def build_main_space_warehouse_open(spec):
    return _build_main_space_warehouse_chest(spec, open_lid=True)


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


def armory_round_shield(collection, root, name, location, mats, radius=25):
    """One readable wall-mounted round shield with separate rim, boss and braces."""
    x, y, z = location
    kit.cylinder(collection, root, name + "_Board", radius, 7, (x, y, z),
                 mats["timber"], rotation=(90, 0, 0), vertices=32, bevel_width=1.2)
    kit.cylinder(collection, root, name + "_IronRim", radius + 2, 3, (x, y - 5, z),
                 mats["iron"], rotation=(90, 0, 0), vertices=32, bevel_width=0.8)
    kit.cylinder(collection, root, name + "_Boss", radius * 0.28, 10,
                 (x, y - 9, z), mats["brass"], rotation=(90, 0, 0),
                 vertices=24, bevel_width=1.0)
    for index, angle in enumerate((45, -45)):
        kit.box(collection, root, f"{name}_Brace_{index}",
                (radius * 1.42, 4, 5), (x, y - 8, z), mats["iron"],
                rotation=(0, angle, 0), bevel_width=0.5)


def armory_wall_spear(collection, root, name, x, y, bottom_z, height, mats):
    """One upright polearm for a fixed wall rack; all parts remain editable."""
    shaft_height = height - 24
    kit.cylinder(collection, root, name + "_Shaft", 3.2, shaft_height,
                 (x, y, bottom_z + shaft_height / 2), mats["timber"],
                 vertices=16, bevel_width=0.5)
    cone(collection, root, name + "_Head", 8, 25,
         (x, y, bottom_z + shaft_height + 12), mats["iron"], vertices=4)
    kit.box(collection, root, name + "_ButtCap", (8, 8, 9),
            (x, y, bottom_z + 4), mats["iron"], bevel_width=0.8)


def build_armory(spec):
    """Compact fortified 2x2 armory with all weapon storage fixed to the shell."""
    collection, root, mats = common_context("armory", spec)
    g = standard_shell(collection, root, mats, spec["dimensions"], bays=4)

    # The secure lower storey is visibly heavier than a house or barracks hall.
    lower_h = min(112, g["bh"] * 0.58)
    kit.box(collection, root, "Armory_LowerStoneVault", (g["bw"] + 10, g["bd"] + 10, lower_h),
            (0, 0, g["fh"] + lower_h / 2), mats["stone"], bevel_width=5)
    for side, x in (("Left", -g["bw"] / 2 - 7), ("Right", g["bw"] / 2 + 7)):
        kit.box(collection, root, f"Armory_{side}FrontButtress", (25, 34, 126),
                (x, g["frontY"] + 7, g["fh"] + 63), mats["foundation"], bevel_width=3)
        for z in (g["fh"] + 34, g["fh"] + 94):
            kit.box(collection, root, f"Armory_{side}ButtressBand_{int(z)}", (31, 40, 8),
                    (x, g["frontY"] + 5, z), mats["iron"], bevel_width=1)

    # Exactly one reinforced loading entrance with readable warm interior depth.
    door_x = -34
    kit.box(collection, root, "Armory_MainDoorDarkInterior", (112, 8, 128),
            (door_x, g["frontY"] - 9, g["fh"] + 65), mats["iron"], bevel_width=3)
    kit.double_doors(collection, root, "Armory_MainArmoredDoor",
                     (door_x, g["frontY"] - 14, g["fh"]), 106, 128,
                     mats["timber"], mats["iron"], open_angle=8)
    kit.box(collection, root, "Armory_MainDoorLintel", (142, 22, 20),
            (door_x, g["frontY"] - 3, g["fh"] + 139), mats["foundation"], bevel_width=4)
    for side in (-1, 1):
        kit.box(collection, root, f"Armory_MainDoorJamb_{side:+d}", (22, 22, 142),
                (door_x + side * 65, g["frontY"] - 3, g["fh"] + 71),
                mats["foundation"], bevel_width=4)

    # Upper secured loading hatch belongs to the same facade, not a second bay.
    hatch_x = 80
    hatch_z = g["fh"] + 143
    kit.box(collection, root, "Armory_UpperHatchDarkInterior", (78, 8, 66),
            (hatch_x, g["frontY"] - 8, hatch_z), mats["iron"], bevel_width=2)
    kit.double_doors(collection, root, "Armory_UpperLoadingHatch",
                     (hatch_x, g["frontY"] - 13, hatch_z - 32), 72, 64,
                     mats["timber"], mats["iron"], open_angle=0)
    kit.box(collection, root, "Armory_UpperHatchBeam", (100, 16, 14),
            (hatch_x, g["frontY"] - 5, hatch_z + 43), mats["timber"], bevel_width=2)

    # Left shield rack and right polearm rack are bolted directly to the wall.
    rack_y = g["frontY"] - 17
    kit.box(collection, root, "Armory_ShieldRack_Back", (112, 12, 76),
            (-116, rack_y + 5, g["fh"] + 72), mats["timber"], bevel_width=3)
    for index, x in enumerate((-142, -92)):
        armory_round_shield(collection, root, f"Armory_Shield_{index}",
                            (x, rack_y - 4, g["fh"] + 74), mats, radius=24)
    kit.box(collection, root, "Armory_PolearmRack_Back", (90, 12, 124),
            (129, rack_y + 5, g["fh"] + 76), mats["timber"], bevel_width=3)
    for rail_z in (g["fh"] + 44, g["fh"] + 105):
        kit.box(collection, root, f"Armory_PolearmRack_Rail_{int(rail_z)}", (98, 16, 9),
                (129, rack_y - 3, rail_z), mats["iron"], bevel_width=1)
    for index, x in enumerate((101, 129, 157)):
        armory_wall_spear(collection, root, f"Armory_Polearm_{index}", x,
                          rack_y - 8, g["fh"] + 18, 150 - index * 5, mats)

    # A large text-free shield-and-crossed-blades crest identifies the function.
    crest_z = g["roofBase"] - 25
    for index, angle in enumerate((-38, 38)):
        kit.box(collection, root, f"Armory_CrestBlade_{index}", (8, 6, 78),
                (8, g["frontY"] - 17, crest_z), mats["iron"],
                rotation=(0, angle, 0), bevel_width=1)
        kit.box(collection, root, f"Armory_CrestGuard_{index}", (34, 7, 6),
                (8, g["frontY"] - 20, crest_z - 27), mats["brass"],
                rotation=(0, angle, 0), bevel_width=1)
    armory_round_shield(collection, root, "Armory_CrestShield",
                        (8, g["frontY"] - 24, crest_z), mats, radius=29)

    # Small wall-bound stock reinforces the storage role without creating yard clutter.
    for index, (x, size) in enumerate(((88, 34), (126, 28))):
        kit.box(collection, root, f"Armory_WallCrate_{index}", (size, size, size),
                (x, g["frontY"] - 34, g["fh"] + size / 2), mats["timber"], bevel_width=3)
        for band in (-size * 0.25, size * 0.25):
            kit.box(collection, root, f"Armory_WallCrateBand_{index}_{int(band)}",
                    (4, size + 2, size - 5),
                    (x + band, g["frontY"] - 36, g["fh"] + size / 2),
                    mats["iron"], bevel_width=0.5)
    kit.lantern(collection, root, "Armory_DoorLantern",
                (-106, g["frontY"] - 18, g["fh"] + 117), mats["iron"], mats["glow"])
    kit.shutter_window(collection, root, "Armory_SideSlit",
                       (g["sideX"] - 3, 58, g["fh"] + 139), mats["glass"],
                       mats["timber"], mats["iron"], orientation="side", scale=0.52)
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


def bakery_loaf(collection, root, name, location, length, depth, height, bread_mat,
                score_mat, rotation_z=0):
    """One rounded, independently editable loaf with three readable score marks."""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, location=location)
    loaf = bpy.context.object
    loaf.name = name
    loaf.parent = root
    loaf.scale = (length / 2, depth / 2, height / 2)
    loaf.rotation_euler.z = math.radians(rotation_z)
    loaf.data.materials.append(bread_mat)
    for polygon in loaf.data.polygons:
        polygon.use_smooth = True
    kit.move_to_collection(loaf, collection)
    for index, offset in enumerate((-0.24, 0.0, 0.24)):
        local_x = length * offset
        angle = math.radians(rotation_z)
        x = location[0] + local_x * math.cos(angle)
        y = location[1] + local_x * math.sin(angle)
        kit.box(collection, root, f"{name}_Score_{index}",
                (3.0, depth * 0.72, 1.8),
                (x, y, location[2] + height * 0.47), score_mat,
                rotation=(0, 0, rotation_z + 18), bevel_width=0.5)
    return loaf


def build_bakery(spec):
    """Compact 2x2 bakery whose oven, shopfront and bread display stay attached."""
    collection, root, mats = common_context("bakery", spec)
    g = standard_shell(collection, root, mats, spec["dimensions"], bays=3)
    bread = kit.material(
        "MAT_Bakery_Golden_Crust", kit.rgba((0.58, 0.29, 0.075, 1.0)),
        roughness=0.78, noise={"scale": 7, "detail": 3, "bump": 0.18})
    flour = kit.material(
        "MAT_Bakery_Flour_Cloth", kit.rgba((0.62, 0.55, 0.40, 1.0)),
        roughness=0.94, noise={"scale": 11, "detail": 2, "bump": 0.10})
    soot = kit.material(
        "MAT_Bakery_Oven_Soot", kit.rgba((0.035, 0.025, 0.018, 1.0)),
        roughness=0.96)

    # The front reads as a working shop: one real entrance, one bright display
    # window and one shallow canopy fixed directly into the main wall.
    door_x = -88
    kit.double_doors(collection, root, "Bakery_MainDoor",
                     (door_x, g["frontY"] - 5, g["fh"]), 58, 104,
                     mats["timber"], mats["iron"], open_angle=0)
    kit.box(collection, root, "Bakery_DoorLintel", (78, 15, 14),
            (door_x, g["frontY"] - 4, g["fh"] + 109), mats["stone"],
            bevel_width=2)
    window_x = 54
    kit.shutter_window(collection, root, "Bakery_DisplayWindow",
                       (window_x, g["frontY"] - 4, g["fh"] + 84),
                       mats["glass"], mats["timber"], mats["iron"], scale=1.02)
    canopy_z = g["fh"] + 142
    kit.box(collection, root, "Bakery_ShopCanopy", (176, 84, 12),
            (54, g["frontY"] - 34, canopy_z), mats["roof"],
            rotation=(8, 0, 0), bevel_width=3)
    kit.box(collection, root, "Bakery_CanopyWallBeam", (180, 14, 16),
            (54, g["frontY"] - 4, canopy_z + 8), mats["timber"], bevel_width=2)
    for index, x in enumerate((-24, 132)):
        kit.box(collection, root, f"Bakery_CanopyPost_{index}", (12, 12, 126),
                (x, g["frontY"] - 70, g["fh"] + 63), mats["timber"],
                bevel_width=2)
    kit.box(collection, root, "Bakery_DisplayCounter", (150, 54, 17),
            (54, g["frontY"] - 35, g["fh"] + 40), mats["timber"],
            bevel_width=3)
    kit.box(collection, root, "Bakery_DisplayCounterFront", (150, 12, 44),
            (54, g["frontY"] - 60, g["fh"] + 19), mats["timber"],
            bevel_width=2)
    for index, (x, angle) in enumerate(((-2, -8), (36, 5), (76, -4), (114, 8))):
        bakery_loaf(collection, root, f"Bakery_DisplayLoaf_{index}",
                    (x, g["frontY"] - 38, g["fh"] + 56),
                    30, 18, 14, bread, mats["plaster"], angle)

    # A wall-mounted bread emblem avoids text while remaining legible at game scale.
    kit.box(collection, root, "Bakery_BreadSignBoard", (82, 10, 60),
            (55, g["frontY"] - 16, g["roofBase"] - 18), mats["timber"],
            bevel_width=5)
    bakery_loaf(collection, root, "Bakery_BreadSignEmblem",
                (55, g["frontY"] - 23, g["roofBase"] - 18),
                52, 7, 30, bread, mats["plaster"])

    # The masonry oven is built into the visible side wall. Its arch, hearth and
    # chimney overlap the main shell, so it cannot read as a detached hut.
    oven_y = 32
    side_surface = g["sideX"] - 5
    oven_bottom = g["fh"] + 8
    oven_spring = g["fh"] + 58
    oven_core = portal_core(collection, root, "Bakery_OvenDarkCore", 35,
                            oven_bottom, oven_spring, 10, 0, soot, segments=24)
    oven_core.rotation_euler.z = math.radians(90)
    oven_core.location = (side_surface - 8, oven_y, 0)
    oven_arch = portal_arch_ring(collection, root, "Bakery_OvenStoneArch", 46, 35,
                                 16, oven_spring, 0, mats["stone"], segments=24)
    oven_arch.rotation_euler.z = math.radians(90)
    oven_arch.location = (side_surface - 10, oven_y, 0)
    for side, y in (("Front", oven_y - 40), ("Back", oven_y + 40)):
        kit.box(collection, root, f"Bakery_Oven{side}Jamb", (18, 18, 54),
                (side_surface - 10, y, oven_bottom + 27), mats["stone"],
                bevel_width=2)
    kit.box(collection, root, "Bakery_OvenHearth", (28, 104, 13),
            (side_surface - 24, oven_y, oven_bottom - 1), mats["stone"],
            bevel_width=2)
    kit.box(collection, root, "Bakery_OvenEmberGlow", (8, 56, 12),
            (side_surface - 30, oven_y, oven_bottom + 9), mats["glow"],
            bevel_width=2)
    kit.chimney(collection, root, "Bakery_BroadOvenChimney",
                (-104, 45, g["roofBase"] + 52), mats["stone"], mats["iron"],
                height=146)

    # Production clutter remains fixed to the walls and under the shop canopy.
    for index, (x, y, angle) in enumerate(((-142, -74, -8), (-139, -38, 7))):
        kit.box(collection, root, f"Bakery_FlourSack_{index}", (38, 27, 48),
                (x, y, g["fh"] + 24), flour, rotation=(0, 0, angle),
                bevel_width=9)
        kit.box(collection, root, f"Bakery_FlourSackTie_{index}", (9, 9, 8),
                (x, y, g["fh"] + 50), mats["timber"], bevel_width=2)
    for index, (y, angle) in enumerate(((86, 2), (108, -4), (128, 5))):
        kit.cylinder(collection, root, f"Bakery_WallFirewood_{index}", 8, 58,
                     (g["sideX"] - 18, y, g["fh"] + 12), mats["timber"],
                     rotation=(0, 90, angle), vertices=18, bevel_width=1)
    kit.lantern(collection, root, "Bakery_EntranceLantern",
                (-45, g["frontY"] - 16, g["fh"] + 90), mats["iron"], mats["glow"])
    return root


def build_field_hospital(spec):
    """Compact 2x2 field hospital with one connected intake and treatment frontage."""
    collection, root, mats = common_context("field_hospital", spec)
    g = standard_shell(collection, root, mats, spec["dimensions"], bays=3)
    medical_cloth = kit.material(
        "MAT_FieldHospital_Medical_Cloth", kit.rgba((0.12, 0.34, 0.31, 1.0)),
        roughness=0.88, noise={"scale": 9, "detail": 2, "bump": 0.08})
    linen = kit.material(
        "MAT_FieldHospital_Linen", kit.rgba((0.62, 0.62, 0.53, 1.0)),
        roughness=0.94, noise={"scale": 12, "detail": 2, "bump": 0.08})

    # The front stays readable as a medical intake: one broad door, a fixed
    # shelter and a restrained no-text diamond-and-leaf emblem.
    door_x = -82
    kit.double_doors(collection, root, "FieldHospital_MainDoor",
                     (door_x, g["frontY"] - 5, g["fh"]), 72, 112,
                     mats["timber"], mats["iron"], open_angle=0)
    kit.box(collection, root, "FieldHospital_DoorStoneLintel", (96, 16, 16),
            (door_x, g["frontY"] - 4, g["fh"] + 118), mats["stone"],
            bevel_width=2)
    intake_z = g["fh"] + 142
    kit.box(collection, root, "FieldHospital_IntakeCanopy", (164, 88, 12),
            (door_x, g["frontY"] - 37, intake_z), medical_cloth,
            rotation=(8, 0, 0), bevel_width=3)
    kit.box(collection, root, "FieldHospital_IntakeCanopyBeam", (170, 14, 16),
            (door_x, g["frontY"] - 4, intake_z + 8), mats["timber"],
            bevel_width=2)
    for index, x in enumerate((door_x - 70, door_x + 70)):
        kit.box(collection, root, f"FieldHospital_IntakePost_{index}",
                (12, 12, 126), (x, g["frontY"] - 72, g["fh"] + 63),
                mats["timber"], bevel_width=2)

    kit.shutter_window(collection, root, "FieldHospital_FrontWindow",
                       (74, g["frontY"] - 4, g["fh"] + 88),
                       mats["glass"], mats["timber"], mats["iron"], scale=1.08)
    kit.shutter_window(collection, root, "FieldHospital_SideWindow",
                       (g["sideX"] - 3, 76, g["fh"] + 88),
                       mats["glass"], mats["timber"], mats["iron"],
                       orientation="side", scale=0.96)

    sign_x = 63
    sign_z = g["roofBase"] - 18
    kit.box(collection, root, "FieldHospital_MedicalSignBoard", (82, 10, 70),
            (sign_x, g["frontY"] - 16, sign_z), mats["timber"],
            bevel_width=7)
    kit.box(collection, root, "FieldHospital_MedicalDiamond", (38, 7, 38),
            (sign_x, g["frontY"] - 23, sign_z + 2), medical_cloth,
            rotation=(0, 0, 45), bevel_width=4)
    kit.box(collection, root, "FieldHospital_MedicalLeaf", (11, 6, 34),
            (sign_x, g["frontY"] - 28, sign_z + 2), linen,
            rotation=(0, 0, -22), bevel_width=5)

    # A covered treatment bay is bolted into the visible side wall. Every prop
    # stays beneath the attached awning and inside the authored foundation.
    bay_y = 22
    bay_x = g["sideX"] - 32
    bay_z = g["fh"] + 136
    kit.box(collection, root, "FieldHospital_TreatmentAwning", (92, 176, 12),
            (bay_x, bay_y, bay_z), medical_cloth,
            rotation=(0, -8, 0), bevel_width=3)
    kit.box(collection, root, "FieldHospital_TreatmentWallBeam", (14, 182, 16),
            (g["sideX"] - 4, bay_y, bay_z + 8), mats["timber"],
            bevel_width=2)
    for index, y in enumerate((bay_y - 75, bay_y + 75)):
        kit.box(collection, root, f"FieldHospital_TreatmentPost_{index}",
                (12, 12, 118), (bay_x - 34, y, g["fh"] + 59),
                mats["timber"], bevel_width=2)
    kit.box(collection, root, "FieldHospital_FixedStretcherBed", (64, 128, 14),
            (bay_x - 8, bay_y, g["fh"] + 40), linen, bevel_width=5)
    for index, y in enumerate((bay_y - 49, bay_y + 49)):
        kit.box(collection, root, f"FieldHospital_StretcherRail_{index}",
                (76, 8, 8), (bay_x - 8, y, g["fh"] + 44),
                mats["timber"], bevel_width=2)
    for index, (x, y) in enumerate(((bay_x - 34, bay_y - 48),
                                     (bay_x + 18, bay_y - 48),
                                     (bay_x - 34, bay_y + 48),
                                     (bay_x + 18, bay_y + 48))):
        kit.box(collection, root, f"FieldHospital_StretcherLeg_{index}",
                (8, 8, 34), (x, y, g["fh"] + 17), mats["iron"],
                bevel_width=1.5)

    # Medical storage is wall-mounted and intentionally sparse at game scale.
    kit.box(collection, root, "FieldHospital_HerbCabinet", (18, 82, 68),
            (g["sideX"] - 12, 98, g["fh"] + 74), mats["timber"],
            bevel_width=3)
    for index, z in enumerate((g["fh"] + 54, g["fh"] + 78, g["fh"] + 102)):
        kit.box(collection, root, f"FieldHospital_HerbShelf_{index}",
                (8, 76, 6), (g["sideX"] - 23, 98, z), mats["brass"],
                bevel_width=1)
    kit.lantern(collection, root, "FieldHospital_EntranceLantern",
                (-18, g["frontY"] - 16, g["fh"] + 96),
                mats["iron"], mats["glow"])
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


def resonator_torus_ring(collection, root, name, major_radius, minor_radius,
                         location, rotation, mat):
    """One complete editable gyroscopic ring for the planar resonator."""
    bpy.ops.mesh.primitive_torus_add(
        major_radius=float(major_radius), minor_radius=float(minor_radius),
        major_segments=64, minor_segments=12)
    ring = bpy.context.object
    ring.name = name
    ring.parent = root
    ring.location = location
    ring.rotation_euler = tuple(math.radians(value) for value in rotation)
    ring.data.materials.append(mat)
    for polygon in ring.data.polygons:
        polygon.use_smooth = True
    kit.move_to_collection(ring, collection)
    return ring


def build_planar_resonator(spec):
    """Connected 2x2 armillary generator with one hovering energy crystal."""
    collection, root, mats = common_context("planar_resonator", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    lower_w, lower_d, lower_h = dims["lowerPlinth"]
    upper_w, upper_d, upper_h = dims["upperPlinth"]
    pedestal_radius, pedestal_height = dims["pedestal"]
    ring_center_z = float(dims["ringCenterZ"])

    # A complete two-tier 2x2 platform keeps every mechanical component on one
    # footprint and gives the future runtime sprite an unambiguous ground line.
    kit.box(collection, root, "PlanarResonator_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    lower_z = fh
    kit.box(collection, root, "PlanarResonator_LowerPlinth",
            (lower_w, lower_d, lower_h),
            (0, 0, lower_z + lower_h / 2), mats["stone"], bevel_width=4)
    upper_z = lower_z + lower_h
    kit.box(collection, root, "PlanarResonator_UpperPlinth",
            (upper_w, upper_d, upper_h),
            (0, 0, upper_z + upper_h / 2), mats["plaster"], bevel_width=4)
    platform_top = upper_z + upper_h

    # Cross-shaped conductor rails visibly route the four bearing pylons into
    # the central emitter. Narrow glow inlays stay attached to the platform.
    conductor_z = platform_top + 3
    kit.box(collection, root, "PlanarResonator_Conductor_X",
            (upper_w - 34, 16, 6), (0, 0, conductor_z),
            mats["brass"], bevel_width=1.5)
    kit.box(collection, root, "PlanarResonator_Conductor_Y",
            (16, upper_d - 34, 6), (0, 0, conductor_z),
            mats["brass"], bevel_width=1.5)
    kit.box(collection, root, "PlanarResonator_ConductorGlow_X",
            (upper_w - 54, 5, 3), (0, 0, conductor_z + 4),
            mats["glow"], bevel_width=0.8)
    kit.box(collection, root, "PlanarResonator_ConductorGlow_Y",
            (5, upper_d - 54, 3), (0, 0, conductor_z + 4),
            mats["glow"], bevel_width=0.8)

    # The pedestal is a compact layered machine rather than a second building.
    pedestal_base_z = platform_top
    kit.cylinder(collection, root, "PlanarResonator_PedestalBase",
                 pedestal_radius, 20,
                 (0, 0, pedestal_base_z + 10), mats["foundation"],
                 vertices=16, bevel_width=3)
    core_height = pedestal_height - 20
    kit.cylinder(collection, root, "PlanarResonator_CorePedestal",
                 pedestal_radius * 0.68, core_height,
                 (0, 0, pedestal_base_z + 20 + core_height / 2),
                 mats["iron"], vertices=16, bevel_width=2)
    kit.cylinder(collection, root, "PlanarResonator_PedestalIronBand_Lower",
                 pedestal_radius * 0.79, 10,
                 (0, 0, pedestal_base_z + 28), mats["brass"],
                 vertices=16, bevel_width=1.5)
    pedestal_top = pedestal_base_z + pedestal_height
    kit.cylinder(collection, root, "PlanarResonator_PedestalIronBand_Upper",
                 pedestal_radius * 0.82, 12,
                 (0, 0, pedestal_top - 6), mats["brass"],
                 vertices=16, bevel_width=1.5)
    kit.cylinder(collection, root, "PlanarResonator_CoreEmitter",
                 pedestal_radius * 0.54, 9,
                 (0, 0, pedestal_top + 10), mats["glow"],
                 vertices=32, bevel_width=1.5)

    rings = dims["rings"]
    ring_by_name = {entry[0]: entry for entry in rings}
    outer_radius = float(ring_by_name["Outer"][1])
    middle_radius = float(ring_by_name["Middle"][1])

    # Four narrow bearing pylons make the armillary rings read as a real
    # generator rather than unrelated floating hoops. They remain independent
    # editable objects and stay inside the fixed foundation.
    pylon_bottom = platform_top
    pylon_top = ring_center_z - 12
    pylon_height = pylon_top - pylon_bottom
    pylon_specs = (
        ("OuterBearing_Left", -outer_radius, 0, 20, 28, "X"),
        ("OuterBearing_Right", outer_radius, 0, 20, 28, "X"),
        ("MiddleBearing_Front", 0, -middle_radius, 28, 20, "Y"),
        ("MiddleBearing_Back", 0, middle_radius, 28, 20, "Y"),
    )
    for name, x, y, width, depth, axis in pylon_specs:
        kit.box(collection, root, f"PlanarResonator_{name}_Foot",
                (width + 24, depth + 24, 16),
                (x, y, pylon_bottom + 8), mats["foundation"], bevel_width=3)
        kit.box(collection, root, f"PlanarResonator_{name}_Pylon",
                (width, depth, pylon_height),
                (x, y, pylon_bottom + pylon_height / 2),
                mats["iron"], bevel_width=2)
        kit.box(collection, root, f"PlanarResonator_{name}_BrassSpine",
                (6 if axis == "X" else width + 4,
                 depth + 4 if axis == "X" else 6,
                 pylon_height - 24),
                (x, y, pylon_bottom + pylon_height / 2),
                mats["brass"], bevel_width=1)
        bearing_rotation = (0, 90, 0) if axis == "X" else (90, 0, 0)
        kit.cylinder(collection, root, f"PlanarResonator_{name}_Pivot",
                     16, 30, (x, y, ring_center_z), mats["brass"],
                     rotation=bearing_rotation, vertices=24, bevel_width=1.5)
        kit.cylinder(collection, root, f"PlanarResonator_{name}_Core",
                     8, 34, (x, y, ring_center_z), mats["glow"],
                     rotation=bearing_rotation, vertices=20, bevel_width=1)

    # Exactly three complete rings: two perpendicular meridians and one
    # equatorial ring. Separate objects preserve future animation options.
    for ring_name, major_radius, minor_radius, rotation in rings:
        resonator_torus_ring(
            collection, root, f"PlanarResonator_BrassRing_{ring_name}",
            major_radius, minor_radius, (0, 0, ring_center_z),
            rotation, mats["brass"])

    crystal_height, crystal_radius, crystal_base_z = dims["crystal"]
    kit.faceted_crystal_prism(
        collection, root, "PlanarResonator_CoreCrystal",
        crystal_height, crystal_radius, (0, 0, crystal_base_z),
        mats["crystal"], highlight_mat=mats["crystalHighlight"],
        lean=(7, -4), sides=6, depth_scale=0.78, rotation_z=8)
    return root


def weather_parabolic_dish(collection, root, name, radius, depth, location,
                            tilt, reflector_mat, rim_mat):
    """Editable shallow weather-radar dish facing local camera side (-Y)."""
    ring_count = 6
    segments = 32
    vertices = [(0.0, 0.0, 0.0)]
    rings = []
    for ring_index in range(1, ring_count + 1):
        ratio = ring_index / ring_count
        ring_radius = radius * ratio
        ring_y = -depth * ratio * ratio
        ring = []
        for segment_index in range(segments):
            angle = math.tau * segment_index / segments
            ring.append(len(vertices))
            vertices.append((ring_radius * math.cos(angle), ring_y,
                             ring_radius * math.sin(angle)))
        rings.append(ring)
    faces = []
    for segment_index in range(segments):
        faces.append((0, rings[0][(segment_index + 1) % segments],
                      rings[0][segment_index]))
    for inner, outer in zip(rings, rings[1:]):
        for segment_index in range(segments):
            nxt = (segment_index + 1) % segments
            faces.append((inner[segment_index], inner[nxt],
                          outer[nxt], outer[segment_index]))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(reflector_mat)
    dish = bpy.data.objects.new(name, mesh)
    collection.objects.link(dish)
    dish.parent = root
    dish.location = location
    dish.rotation_euler.x = math.radians(tilt)
    kit.bevel(dish, 1.0, 2)

    bpy.ops.mesh.primitive_torus_add(
        major_radius=radius, minor_radius=max(2.2, radius * 0.045),
        major_segments=48, minor_segments=10)
    rim = bpy.context.object
    rim.name = name + "_Rim"
    rim.parent = root
    rim.location = (
        location[0],
        location[1] - depth * math.cos(math.radians(tilt)),
        location[2] - depth * math.sin(math.radians(tilt)),
    )
    rim.rotation_euler.x = math.radians(90 + tilt)
    rim.data.materials.append(rim_mat)
    kit.move_to_collection(rim, collection)
    return dish


def weather_anemometer(collection, root, name, location, mats):
    """Three-cup roof anemometer with individually editable arms and cups."""
    x, y, z = location
    kit.cylinder(collection, root, name + "_Axle", 4.5, 54,
                 (x, y, z + 27), mats["iron"], vertices=16,
                 bevel_width=0.8)
    hub_z = z + 56
    kit.cylinder(collection, root, name + "_Hub", 11, 10,
                 (x, y, hub_z), mats["brass"], vertices=20,
                 bevel_width=1.0)
    for index, angle in enumerate((0, 120, 240), start=1):
        radians = math.radians(angle)
        arm_length = 58
        arm_x = x + math.cos(radians) * arm_length * 0.5
        arm_y = y + math.sin(radians) * arm_length * 0.5
        kit.box(collection, root, f"{name}_Arm_{index:02d}",
                (arm_length, 5, 5), (arm_x, arm_y, hub_z), mats["iron"],
                rotation=(0, 0, angle), bevel_width=0.8)
        cup_x = x + math.cos(radians) * arm_length
        cup_y = y + math.sin(radians) * arm_length
        bpy.ops.mesh.primitive_uv_sphere_add(
            segments=20, ring_count=12, radius=10,
            location=(cup_x, cup_y, hub_z))
        cup = bpy.context.object
        cup.name = f"{name}_Cup_{index:02d}"
        cup.parent = root
        cup.scale = (1.25, 0.72, 0.72)
        cup.rotation_euler.z = radians + math.radians(90)
        cup.data.materials.append(mats["brass"])
        kit.move_to_collection(cup, collection)


def build_weather_forecast_tower(spec):
    """Connected 2x2 observatory with readable rooftop weather instruments."""
    collection, root, mats = common_context("weather_forecast_tower", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    pw, pd, ph = dims["plinth"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    tower_radius, tower_height = dims["observationTower"]
    tower_roof_radius, tower_roof_height = dims["towerRoof"]

    kit.box(collection, root, "WeatherTower_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    plinth_z = fh
    kit.box(collection, root, "WeatherTower_StonePlinth", (pw, pd, ph),
            (0, 0, plinth_z + ph / 2), mats["stone"], bevel_width=4)
    body_z = plinth_z + ph
    body_y = 12
    kit.box(collection, root, "WeatherTower_ObservationHall", (bw, bd, bh),
            (0, body_y, body_z + bh / 2), mats["plaster"], bevel_width=6)
    kit.box(collection, root, "WeatherTower_LowerStoneCourse",
            (bw + 8, bd + 8, 64), (0, body_y, body_z + 32),
            mats["stone"], bevel_width=4)
    kit.box(collection, root, "WeatherTower_Cornice",
            (bw + 22, bd + 20, 16),
            (0, body_y, body_z + bh - 8), mats["brass"], bevel_width=3)

    roof_base = body_z + bh - 5
    hipped_roof(collection, root, "WeatherTower_BlueHippedRoof",
                rw, rd, rh, (0, body_y, roof_base), mats["roof"])

    front_y = body_y - bd / 2 - 5
    kit.double_doors(collection, root, "WeatherTower_MainDoor",
                     (0, front_y, body_z + 55), 72, 108,
                     mats["timber"], mats["iron"], open_angle=0)
    for side, x in (("Left", -104), ("Right", 104)):
        kit.shutter_window(collection, root, f"WeatherTower_{side}FrontWindow",
                           (x, front_y - 1, body_z + 100),
                           mats["glass"], mats["timber"], mats["iron"],
                           scale=0.72)
        kit.box(collection, root, f"WeatherTower_{side}CornerButtress",
                (22, 28, bh + 12),
                (x * 1.47, front_y + 12, body_z + (bh + 12) / 2),
                mats["stone"], bevel_width=3)
    side_x = -bw / 2 - 4
    for y_index, window_y in enumerate((-54, 58), start=1):
        kit.shutter_window(collection, root,
                           f"WeatherTower_SideWindow_{y_index:02d}",
                           (side_x, window_y, body_z + 102),
                           mats["glass"], mats["timber"], mats["iron"],
                           orientation="side", scale=0.68)

    # The octagonal tower penetrates the roof and remains visibly fused to the
    # hall. Its low, wide silhouette avoids a fragile radio-mast reading.
    tower_base = body_z + bh - 12
    kit.cylinder(collection, root, "WeatherTower_ObservationDrum",
                 tower_radius, tower_height,
                 (0, body_y + 18, tower_base + tower_height / 2),
                 mats["stone"], vertices=8, bevel_width=4)
    drum_top = tower_base + tower_height
    kit.cylinder(collection, root, "WeatherTower_ObservationCornice",
                 tower_radius + 11, 15,
                 (0, body_y + 18, drum_top - 8), mats["brass"],
                 vertices=8, bevel_width=2)
    for index, angle in enumerate((225, 270, 315), start=1):
        radians = math.radians(angle)
        glass_x = math.cos(radians) * (tower_radius + 3)
        glass_y = body_y + 18 + math.sin(radians) * (tower_radius + 3)
        kit.box(collection, root, f"WeatherTower_PanoramicWindow_{index:02d}",
                (38, 8, 58), (glass_x, glass_y, tower_base + 70),
                mats["glass"], rotation=(0, 0, angle + 90),
                bevel_width=8)
    cone(collection, root, "WeatherTower_OctagonalBlueRoof",
         tower_roof_radius, tower_roof_height,
         (0, body_y + 18, drum_top + tower_roof_height / 2 - 4),
         mats["roof"], vertices=8)
    tower_roof_top = drum_top + tower_roof_height - 4

    kit.cylinder(collection, root, "WeatherTower_InstrumentMast", 5.5, 116,
                 (0, body_y + 18, tower_roof_top + 58), mats["iron"],
                 vertices=16, bevel_width=0.8)
    weather_anemometer(collection, root, "WeatherTower_Anemometer",
                       (0, body_y + 18, tower_roof_top + 62), mats)
    vane_z = tower_roof_top + 108
    kit.box(collection, root, "WeatherTower_WindVane_Shaft", (106, 5, 5),
            (0, body_y + 18, vane_z), mats["brass"], bevel_width=0.8)
    arrow = cone(collection, root, "WeatherTower_WindVane_Arrow", 11, 28,
                 (67, body_y + 18, vane_z), mats["brass"], vertices=4)
    arrow.rotation_euler.y = math.radians(90)
    kit.box(collection, root, "WeatherTower_WindVane_Tail_Upper",
            (28, 4, 12), (-58, body_y + 18, vane_z + 8),
            mats["brass"], rotation=(0, -24, 0), bevel_width=0.7)
    kit.box(collection, root, "WeatherTower_WindVane_Tail_Lower",
            (28, 4, 12), (-58, body_y + 18, vane_z - 8),
            mats["brass"], rotation=(0, 24, 0), bevel_width=0.7)
    kit.cylinder(collection, root, "WeatherTower_LightningRod", 2.3, 54,
                 (0, body_y + 18, vane_z + 34), mats["iron"],
                 vertices=12, bevel_width=0.4)

    radar_x, radar_y = 128, -20
    kit.box(collection, root, "WeatherTower_RadarAttachedPlatform",
            (116, 104, 16), (radar_x, radar_y, roof_base + 54),
            mats["stone"], bevel_width=4)
    kit.cylinder(collection, root, "WeatherTower_RadarPedestal", 26, 62,
                 (radar_x, radar_y, roof_base + 88), mats["iron"],
                 vertices=8, bevel_width=3)
    dish_center = (radar_x, radar_y - 2, roof_base + 143)
    weather_parabolic_dish(collection, root, "WeatherTower_RadarDish",
                           52, 18, dish_center, -16,
                           mats["plaster"], mats["brass"])
    kit.box(collection, root, "WeatherTower_RadarFeedArm", (6, 42, 6),
            (radar_x, radar_y - 35, roof_base + 135), mats["iron"],
            rotation=(-16, 0, 0), bevel_width=0.7)
    kit.cylinder(collection, root, "WeatherTower_RadarFeedHorn", 7, 13,
                 (radar_x, radar_y - 55, roof_base + 128), mats["brass"],
                 rotation=(90 - 16, 0, 0), vertices=16, bevel_width=0.8)

    gauge_x, gauge_y = -132, -18
    kit.box(collection, root, "WeatherTower_GaugeAttachedPlatform",
            (96, 86, 14), (gauge_x, gauge_y, roof_base + 48),
            mats["stone"], bevel_width=4)
    for index, x_offset in enumerate((-22, 22), start=1):
        kit.cylinder(collection, root, f"WeatherTower_RainGauge_{index:02d}",
                     13, 46, (gauge_x + x_offset, gauge_y, roof_base + 78),
                     mats["brass"], vertices=20, bevel_width=1.4)
        kit.cylinder(collection, root,
                     f"WeatherTower_RainGauge_Rim_{index:02d}",
                     17, 7, (gauge_x + x_offset, gauge_y, roof_base + 102),
                     mats["iron"], vertices=20, bevel_width=1.0)
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


def japanese_castle_roof(collection, root, name, length, width, height,
                         base_z, center_y, mats, *, center_x=0, snow_inset=16):
    """Broad tiled hipped roof with visible dark eaves and a shallow snow cap."""
    eave_h = 9
    kit.box(collection, root, name + "_FlaredEave",
            (length + 18, width + 18, eave_h),
            (center_x, center_y, base_z + eave_h / 2), mats["roof"], bevel_width=2)
    hipped_roof(collection, root, name + "_TiledRoof", length, width, height,
                (center_x, center_y, base_z + eave_h - 1), mats["roof"])
    snow_length = max(20, length - snow_inset * 2)
    snow_width = max(20, width - snow_inset * 2)
    snow_height = max(8, height - 8)
    hipped_roof(collection, root, name + "_SnowCap", snow_length, snow_width,
                snow_height, (center_x, center_y, base_z + eave_h + 12), mats["snow"])
    ridge_z = base_z + eave_h + height + 4
    kit.box(collection, root, name + "_DarkRidge",
            (length * 0.46, 12, 10), (center_x, center_y, ridge_z),
            mats["roof"], bevel_width=3)
    kit.box(collection, root, name + "_RidgeSnow",
            (length * 0.40, 15, 5), (center_x, center_y, ridge_z + 6),
            mats["snow"], bevel_width=2)
    # Raised corner blocks give the low-poly silhouette a restrained Japanese
    # upsweep without merging the editable roof and snow meshes.
    for corner_name, x, y in (
            ("FrontLeft", center_x - length / 2 - 7, center_y - width / 2 - 7),
            ("FrontRight", center_x + length / 2 + 7, center_y - width / 2 - 7),
            ("RearLeft", center_x - length / 2 - 7, center_y + width / 2 + 7),
            ("RearRight", center_x + length / 2 + 7, center_y + width / 2 + 7)):
        kit.box(collection, root, name + "_UpturnedCorner_" + corner_name,
                (22, 22, 8), (x, y, base_z + eave_h + 3),
                mats["roof"], rotation=(0, 0, 45), bevel_width=2)
    return base_z + eave_h + height + 10


def snow_castle_wall_details(collection, root, prefix, width, depth, base_z,
                             height, center_y, mats, *, window_count=3):
    """Dark timber framing and warm shuttered openings for one keep level."""
    front_y = center_y - depth / 2 - 3
    side_x = -width / 2 - 3
    band_z = base_z + height * 0.70
    kit.box(collection, root, prefix + "_FrontTimberBand", (width + 8, 7, 9),
            (0, front_y, band_z), mats["timber"], bevel_width=1)
    kit.box(collection, root, prefix + "_SideTimberBand", (7, depth + 8, 9),
            (side_x, center_y, band_z), mats["timber"], bevel_width=1)
    for index, x in enumerate((-(window_count - 1) * 25 + 50 * i
                               for i in range(window_count)), start=1):
        kit.box(collection, root, f"{prefix}_FrontWindow_{index:02d}",
                (22, 7, 31), (x, front_y - 2, base_z + height * 0.45),
                mats["glass"], bevel_width=3)
        kit.box(collection, root, f"{prefix}_FrontWindowFrame_{index:02d}",
                (30, 5, 39), (x, front_y + 1, base_z + height * 0.45),
                mats["timber"], bevel_width=2)
    for index, y in enumerate((center_y - depth * 0.22,
                               center_y + depth * 0.22), start=1):
        kit.box(collection, root, f"{prefix}_SideWindow_{index:02d}",
                (7, 22, 30), (side_x - 2, y, base_z + height * 0.45),
                mats["glass"], bevel_width=3)
        kit.box(collection, root, f"{prefix}_SideWindowFrame_{index:02d}",
                (5, 30, 38), (side_x + 1, y, base_z + height * 0.45),
                mats["timber"], bevel_width=2)
    for side_name, x in (("Left", -width / 2 + 9),
                         ("Right", width / 2 - 9)):
        kit.box(collection, root, prefix + "_FrontPost_" + side_name,
                (11, 8, height - 12),
                (x, front_y, base_z + height / 2), mats["timber"], bevel_width=1)


def snow_castle_stair_flight(collection, root, prefix, width, depth,
                             step_count, front_y, base_z, target_z, mats):
    """Centered stair flight whose final tread lands on the next terrace."""
    for index in range(int(step_count)):
        progress = (index + 1) / step_count
        top_z = base_z + (target_z - base_z) * progress
        height = top_z - base_z
        y = front_y - depth * (step_count - index - 0.5)
        kit.box(collection, root, f"{prefix}_Step_{index + 1:02d}",
                (width, depth + 2, height), (0, y, base_z + height / 2),
                mats["foundation"], bevel_width=1.5)
        kit.box(collection, root, f"{prefix}_SnowLip_{index + 1:02d}",
                (width - 8, depth - 2, 3), (0, y, top_z + 1.5),
                mats["snow"], bevel_width=0.8)


def build_snow_castle(spec):
    """Snowfield landmark: Japanese castle keep, linked yagura and tiered ascent."""
    collection, root, mats = common_context("snow_castle", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    terraces = dims["terraces"]
    keep_levels = dims["keepLevels"]
    tower_dims = dims["sideTower"]
    stair_w, stair_depth, stair_count = dims["stairs"]

    kit.box(collection, root, "SnowCastle_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)
    kit.box(collection, root, "SnowCastle_FoundationSnowFront",
            (fw - 28, 16, 5), (0, -fd / 2 + 11, fh + 2.5),
            mats["snow"], bevel_width=2)
    kit.box(collection, root, "SnowCastle_FoundationSnowLeft",
            (16, fd - 30, 5), (-fw / 2 + 11, 0, fh + 2.5),
            mats["snow"], bevel_width=2)

    terrace_records = []
    previous_top = fh
    for index, (width, depth, height, center_y) in enumerate(terraces, start=1):
        name = f"SnowCastle_Terrace_{index:02d}"
        kit.box(collection, root, name, (width, depth, height),
                (0, center_y, previous_top + height / 2), mats["stone"],
                bevel_width=5)
        top_z = previous_top + height
        kit.box(collection, root, name + "_FrontSnowShelf",
                (width - 20, 13, 5),
                (0, center_y - depth / 2 + 8, top_z + 2.5),
                mats["snow"], bevel_width=2)
        kit.box(collection, root, name + "_LeftSnowShelf",
                (13, depth - 20, 5),
                (-width / 2 + 8, center_y, top_z + 2.5),
                mats["snow"], bevel_width=2)
        snow_castle_stair_flight(
            collection, root, f"SnowCastle_Terrace_{index:02d}_CentralFlight",
            stair_w - (index - 1) * 10, stair_depth, stair_count,
            center_y - depth / 2, previous_top, top_z, mats)
        terrace_records.append((width, depth, height, center_y, top_z))
        previous_top = top_z

    upper_top = terrace_records[-1][4]
    keep_y = 54
    level_base = upper_top
    for index, (width, depth, height, roof_w, roof_d, roof_h) in enumerate(
            keep_levels, start=1):
        prefix = f"SnowCastle_KeepLevel_{index:02d}"
        kit.box(collection, root, prefix + "_Body", (width, depth, height),
                (0, keep_y, level_base + height / 2), mats["plaster"],
                bevel_width=4)
        kit.box(collection, root, prefix + "_StoneFoot",
                (width + 10, depth + 10, 12),
                (0, keep_y, level_base + 6), mats["foundation"], bevel_width=2)
        snow_castle_wall_details(collection, root, prefix, width, depth,
                                 level_base, height, keep_y, mats,
                                 window_count=3 if index < 3 else 2)
        roof_base = level_base + height - 5
        level_base = japanese_castle_roof(
            collection, root, prefix + "_Roof", roof_w, roof_d, roof_h,
            roof_base, keep_y, mats, snow_inset=17)

    # A restrained golden shachi-like ridge pair identifies the keep without
    # turning the silhouette into a shrine or pagoda.
    for side_name, x in (("Left", -34), ("Right", 34)):
        kit.cylinder(collection, root, "SnowCastle_CrownFinial_" + side_name,
                     7, 24, (x, keep_y, level_base + 12), mats["brass"],
                     vertices=16, bevel_width=1)
        cone(collection, root, "SnowCastle_CrownPoint_" + side_name,
             9, 26, (x, keep_y, level_base + 37), mats["brass"], vertices=18)

    # Gatehouse remains embedded in the upper terrace and aligns with all three
    # stair flights. The recess is the only large entrance in the model.
    gate_w, gate_d, gate_h = dims["gatehouse"]
    gate_y = terrace_records[-1][3] - terrace_records[-1][1] / 2 + gate_d / 2 + 10
    kit.box(collection, root, "SnowCastle_GatehouseBody", (gate_w, gate_d, gate_h),
            (0, gate_y, upper_top + gate_h / 2), mats["stone"], bevel_width=4)
    gate_front_y = gate_y - gate_d / 2 - 4
    kit.box(collection, root, "SnowCastle_GateRecess", (58, 11, 68),
            (0, gate_front_y, upper_top + 34), mats["iron"], bevel_width=5)
    kit.box(collection, root, "SnowCastle_GateTimberDoors", (48, 7, 58),
            (0, gate_front_y - 4, upper_top + 31), mats["timber"], bevel_width=3)
    japanese_castle_roof(collection, root, "SnowCastle_GatehouseRoof",
                         gate_w + 42, gate_d + 44, 40,
                         upper_top + gate_h - 5, gate_y, mats, snow_inset=14)

    # Two mirrored two-storey yagura sit on the middle terrace and connect to
    # the keep through roofed galleries, preserving a single castle footprint.
    tower_w, tower_d, lower_h, upper_w, upper_d, upper_h = tower_dims
    tower_base = terrace_records[1][4]
    tower_y = 58
    tower_x = terrace_records[1][0] / 2 - tower_w / 2 - 18
    for side_name, sign in (("Left", -1), ("Right", 1)):
        x = sign * tower_x
        prefix = "SnowCastle_" + side_name + "Yagura"
        bridge_inner = sign * (keep_levels[0][0] / 2 + 5)
        bridge_outer = x - sign * tower_w / 2
        bridge_center = (bridge_inner + bridge_outer) / 2
        bridge_width = abs(bridge_outer - bridge_inner) + 16
        kit.box(collection, root, prefix + "_ConnectedGallery",
                (bridge_width, 66, 52),
                (bridge_center, tower_y, tower_base + 26),
                mats["plaster"], bevel_width=3)
        japanese_castle_roof(collection, root, prefix + "_GalleryRoof",
                             bridge_width + 24, 90, 24,
                             tower_base + 47, tower_y, mats,
                             center_x=bridge_center, snow_inset=11)
        kit.box(collection, root, prefix + "_LowerBody", (tower_w, tower_d, lower_h),
                (x, tower_y, tower_base + lower_h / 2), mats["plaster"],
                bevel_width=4)
        # Wall details use local objects and are mirrored by translating the
        # complete side-specific detail group after creation.
        lower_detail_prefix = prefix + "_Lower"
        front_y = tower_y - tower_d / 2 - 3
        kit.box(collection, root, lower_detail_prefix + "_FrontBand",
                (tower_w + 6, 7, 8),
                (x, front_y, tower_base + lower_h * 0.68), mats["timber"],
                bevel_width=1)
        kit.box(collection, root, lower_detail_prefix + "_WarmWindow",
                (24, 7, 30), (x, front_y - 2, tower_base + lower_h * 0.43),
                mats["glass"], bevel_width=3)
        lower_roof_top = japanese_castle_roof(
            collection, root, prefix + "_LowerRoof", tower_w + 42,
            tower_d + 40, 38, tower_base + lower_h - 5, tower_y, mats,
            center_x=x, snow_inset=14)
        upper_base = lower_roof_top
        kit.box(collection, root, prefix + "_UpperBody", (upper_w, upper_d, upper_h),
                (x, tower_y, upper_base + upper_h / 2), mats["plaster"],
                bevel_width=4)
        kit.box(collection, root, prefix + "_UpperTimberBand",
                (upper_w + 6, 7, 8),
                (x, tower_y - upper_d / 2 - 3, upper_base + upper_h * 0.68),
                mats["timber"], bevel_width=1)
        kit.box(collection, root, prefix + "_UpperWarmWindow", (20, 7, 26),
                (x, tower_y - upper_d / 2 - 5, upper_base + upper_h * 0.43),
                mats["glass"], bevel_width=3)
        japanese_castle_roof(collection, root, prefix + "_UpperRoof",
                             upper_w + 38, upper_d + 38, 34,
                             upper_base + upper_h - 5, tower_y, mats,
                             center_x=x, snow_inset=13)
    return root


def build_desert_mansion(spec):
    collection, root, mats = common_context("desert_mansion", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    lower_w, lower_d, lower_h = dims["lowerTier"]
    middle_w, middle_d, middle_h = dims["middleTier"]
    upper_w, upper_d, upper_h = dims["upperTier"]
    wing_w, wing_d, wing_h = dims["wing"]
    main_dome_radius, main_dome_height = dims["mainDome"]
    wing_dome_radius, wing_dome_height = dims["wingDome"]
    tower_radius, tower_height = dims["tower"]
    body_offset_x, body_offset_y = dims.get("bodyOffset", (0, 0))

    # One intact residence on one foundation. Three centered levels step back
    # toward the dome while both wings overlap the lowest floor, so the whole
    # silhouette remains one residence instead of a detached palace group.
    kit.box(collection, root, "DesertMansion_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)
    kit.box(collection, root, "DesertMansion_UpperPlinth", (fw - 42, fd - 38, 18),
            (0, 8, fh + 9), mats["stone"], bevel_width=4)
    body_base = fh + 18
    body_y = 28
    tier_specs = (
        ("Lower", lower_w, lower_d, lower_h, 0),
        ("Middle", middle_w, middle_d, middle_h, 16),
        ("Upper", upper_w, upper_d, upper_h, 30),
    )
    tier_records = []
    tier_top_z = body_base
    for tier_index, (tier_name, tier_w, tier_d, tier_h, y_offset) in enumerate(tier_specs):
        deck_h = 0 if tier_index == 0 else 14
        if deck_h:
            kit.box(collection, root, f"DesertMansion_{tier_name}StepDeck",
                    (tier_w + 34, tier_d + 28, deck_h),
                    (0, body_y + y_offset, tier_top_z + deck_h / 2),
                    mats["stone"], bevel_width=4)
        tier_base_z = tier_top_z + deck_h
        kit.box(collection, root, f"DesertMansion_{tier_name}Hall",
                (tier_w, tier_d, tier_h),
                (0, body_y + y_offset, tier_base_z + tier_h / 2),
                mats["plaster" if tier_index != 1 else "stone"], bevel_width=8)
        if tier_index == 0:
            kit.box(collection, root, "DesertMansion_LowerHallStoneFoot",
                    (tier_w + 18, tier_d + 16, 34),
                    (0, body_y + y_offset, tier_base_z + 17),
                    mats["stone"], bevel_width=5)
        tier_top_z = tier_base_z + tier_h
        kit.box(collection, root, f"DesertMansion_{tier_name}Cornice",
                (tier_w + 26, tier_d + 22, 16),
                (0, body_y + y_offset, tier_top_z - 8),
                mats["foundation"], bevel_width=4)
        tier_records.append({
            "name": tier_name, "w": tier_w, "d": tier_d, "h": tier_h,
            "y": body_y + y_offset, "base": tier_base_z, "top": tier_top_z,
        })

    # Keep both attached wings inside the fixed placement foundation.  The
    # previous center offset put each outer wall about 40 units past the slab.
    wing_x = min(
        lower_w / 2 + wing_w * 0.28,
        fw / 2 - wing_w / 2 - 8,
    )
    for side, x in (("Left", -wing_x), ("Right", wing_x)):
        kit.box(collection, root, f"DesertMansion_{side}Wing",
                (wing_w, wing_d, wing_h),
                (x, body_y + 4, body_base + wing_h / 2),
                mats["stone"], bevel_width=7)
        kit.box(collection, root, f"DesertMansion_{side}WingCornice",
                (wing_w + 20, wing_d + 18, 16),
                (x, body_y + 4, body_base + wing_h - 8),
                mats["plaster"], bevel_width=4)
        wing_drum_z = body_base + wing_h
        kit.cylinder(collection, root, f"DesertMansion_{side}WingDomeDrum",
                     wing_dome_radius * 0.82, 28,
                     (x, body_y + 4, wing_drum_z + 14), mats["plaster"],
                     vertices=32, bevel_width=2)
        desert_mansion_dome(
            collection, root, f"DesertMansion_{side}WingDome",
            wing_dome_radius, wing_dome_height,
            (x, body_y + 4, wing_drum_z + 28), mats["roof"], segments=40)
        kit.cylinder(collection, root, f"DesertMansion_{side}WingDomeFinial",
                     5, 34,
                     (x, body_y + 4, wing_drum_z + 28 + wing_dome_height + 14),
                     mats["brass"], vertices=16, bevel_width=1)

    # The central onion dome is the residence hierarchy marker. Its drum and
    # brass band remain attached to the hall roof instead of floating above it.
    main_drum_z = tier_top_z
    kit.cylinder(collection, root, "DesertMansion_MainDomeDrum",
                 main_dome_radius * 0.84, 52,
                 (0, body_y, main_drum_z + 26), mats["plaster"],
                 vertices=40, bevel_width=3)
    kit.cylinder(collection, root, "DesertMansion_MainDomeBrassBand",
                 main_dome_radius * 0.90, 10,
                 (0, body_y, main_drum_z + 49), mats["brass"],
                 vertices=40, bevel_width=1.5)
    desert_mansion_dome(collection, root, "DesertMansion_MainOnionDome",
                        main_dome_radius, main_dome_height,
                        (0, body_y, main_drum_z + 52), mats["roof"], segments=56)
    kit.cylinder(collection, root, "DesertMansion_MainDomeFinial",
                 6, 48,
                 (0, body_y, main_drum_z + 52 + main_dome_height + 18),
                 mats["brass"], vertices=18, bevel_width=1)
    cone(collection, root, "DesertMansion_MainDomeFinialPoint", 10, 34,
         (0, body_y, main_drum_z + 52 + main_dome_height + 56),
         mats["brass"], vertices=18)

    # One monumental pointed-arch entrance. The warm inner door stays behind
    # the masonry frame so 12-step candidates retain one readable main access.
    front_y = body_y - lower_d / 2 - 6
    entry_spring_z = body_base + 106
    kit.box(collection, root, "DesertMansion_EntryRecess",
            (94, 12, 142), (0, front_y - 2, body_base + 77),
            mats["iron"], bevel_width=10)
    kit.box(collection, root, "DesertMansion_EntryWarmInterior",
            (68, 6, 118), (0, front_y - 9, body_base + 67),
            mats["glow"], bevel_width=8)
    portal_arch_ring(collection, root, "DesertMansion_EntryPointedFrame",
                     72, 50, 20, entry_spring_z, front_y - 7,
                     mats["stone"], segments=28)
    for side, x in (("Left", -64), ("Right", 64)):
        kit.box(collection, root, f"DesertMansion_Entry_{side}Pier",
                (28, 24, 146), (x, front_y - 7, body_base + 73),
                mats["stone"], bevel_width=4)

    # Three broad shallow steps tie the entrance to the visible front edge and
    # echo the stepped vertical hierarchy without adding a second access route.
    for step_index in range(3):
        step_height = 6 * (step_index + 1)
        kit.box(collection, root, f"DesertMansion_EntryStep_{step_index + 1:02d}",
                (154 - step_index * 12, 22, step_height),
                (0, front_y - 30 + step_index * 13,
                 fh + step_height / 2), mats["stone"], bevel_width=2)

    # Paired arched window bays keep the facade palatial without creating
    # additional doors. Matching side bays preserve the strict bilateral read.
    for side, sign in (("Left", -1), ("Right", 1)):
        x = sign * 104
        kit.box(collection, root, f"DesertMansion_{side}LowerFrontWindow",
                (36, 8, 68), (x, front_y - 2, body_base + 80),
                mats["glass"], bevel_width=12)
        kit.box(collection, root, f"DesertMansion_{side}LowerFrontWindowSill",
                (48, 13, 8), (x, front_y - 5, body_base + 45),
                mats["brass"], bevel_width=2)
        wing_front_y = body_y + 4 - wing_d / 2 - 5
        kit.box(collection, root, f"DesertMansion_{side}WingFrontWindow",
                (34, 8, 62), (sign * wing_x, wing_front_y,
                              body_base + wing_h * 0.55),
                mats["glass"], bevel_width=11)

    # Upper-floor windows and brass sills are paired at every setback. Their
    # reduced scale makes all three levels legible at RTS distance.
    for record_index, record in enumerate(tier_records[1:], start=2):
        tier_front_y = record["y"] - record["d"] / 2 - 5
        window_h = 48 if record_index == 2 else 38
        for side, sign in (("Left", -1), ("Right", 1)):
            x = sign * record["w"] * 0.25
            kit.box(collection, root,
                    f"DesertMansion_{record['name']}_{side}ArchedWindow",
                    (30, 8, window_h),
                    (x, tier_front_y, record["base"] + record["h"] * 0.52),
                    mats["glass"], bevel_width=10)
            kit.box(collection, root,
                    f"DesertMansion_{record['name']}_{side}WindowSill",
                    (42, 12, 7),
                    (x, tier_front_y - 2,
                     record["base"] + record["h"] * 0.52 - window_h / 2),
                    mats["brass"], bevel_width=2)

    # Exactly two integrated torch-shaped towers. Both now sit on the front
    # shoulders of the side wings, flanking the entrance instead of reading as
    # one near tower and one detached rear tower in the fixed isometric view.
    # The shaft still widens into the same balcony, lantern room and flame crown.
    tower_x = min(fw / 2 - tower_radius - 24, wing_x - 18)
    tower_y = body_y - wing_d / 2 + tower_radius * 0.60
    shaft_base_z = body_base
    for side, x in (("Left", -tower_x), ("Right", tower_x)):
        prefix = f"DesertMansion_{side}TorchTower"
        bridge_y = (tower_y + body_y) / 2
        kit.box(collection, root, prefix + "_AttachedBridge",
                (82, abs(body_y - tower_y) + 76, 88),
                (x * 0.82, bridge_y, body_base + 44),
                mats["stone"], bevel_width=6)
        kit.cylinder(collection, root, prefix + "_Foot", tower_radius + 12, 22,
                     (x, tower_y, shaft_base_z + 11), mats["foundation"],
                     vertices=8, bevel_width=3)
        kit.cylinder(collection, root, prefix + "_Shaft", tower_radius, tower_height,
                     (x, tower_y, shaft_base_z + tower_height / 2), mats["stone"],
                     vertices=8, bevel_width=4)
        for band_index, z in enumerate((shaft_base_z + 76,
                                        shaft_base_z + tower_height - 34), start=1):
            kit.cylinder(collection, root, prefix + f"_Band_{band_index:02d}",
                         tower_radius + 5, 10, (x, tower_y, z), mats["brass"],
                         vertices=8, bevel_width=1.5)
        balcony_z = shaft_base_z + tower_height
        kit.cylinder(collection, root, prefix + "_FlaredBalcony",
                     tower_radius + 22, 16, (x, tower_y, balcony_z + 8),
                     mats["plaster"], vertices=16, bevel_width=3)
        lantern_z = balcony_z + 16
        kit.cylinder(collection, root, prefix + "_LanternDrum",
                     tower_radius + 4, 62, (x, tower_y, lantern_z + 31),
                     mats["iron"], vertices=8, bevel_width=3)
        for slit_index, (ox, oy) in enumerate(((0, -tower_radius - 5),
                                                (-tower_radius - 5, 0)), start=1):
            kit.box(collection, root, prefix + f"_GlowSlit_{slit_index:02d}",
                    (18 if ox == 0 else 7, 7 if ox == 0 else 18, 38),
                    (x + ox, tower_y + oy, lantern_z + 31),
                    mats["glow"], bevel_width=5)
        flame_base_z = lantern_z + 62
        desert_mansion_dome(collection, root, prefix + "_FlameCrown",
                            tower_radius + 12, 74,
                            (x, tower_y, flame_base_z), mats["roof"], segments=40)
        cone(collection, root, prefix + "_FlamePoint", 9, 38,
             (x, tower_y, flame_base_z + 88), mats["brass"], vertices=18)

    # Restrained attached geometric panels support the Arabic residence theme;
    # they are architectural relief, never text or free-standing ornament.
    for side, sign in (("Left", -1), ("Right", 1)):
        kit.box(collection, root, f"DesertMansion_{side}FacadeRelief",
                (54, 7, 20),
                (sign * 76, front_y - 7, body_base + lower_h - 28),
                mats["brass"], rotation=(0, 0, sign * 45), bevel_width=3)

    # Keep both foundation layers fixed while shifting the residence along
    # local +Y. With the 44.8-degree building rotation this is the requested
    # screen-space upper-left direction. The centered upper plinth remains a
    # visible inset border instead of projecting beyond the rear slab edge.
    for obj in root.children_recursive:
        if obj.type != "MESH" or obj.name in {
            "DesertMansion_Foundation",
            "DesertMansion_UpperPlinth",
        }:
            continue
        obj.location.x += body_offset_x
        obj.location.y += body_offset_y
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


def house_flower_box(collection, root, name, location, orientation, mats,
                     flower_mats, scale=1.0):
    """Attached planter with individually editable stems and blossoms."""
    x, y, z = location
    if orientation == "front":
        box_size = (58 * scale, 15 * scale, 14 * scale)
        soil_size = (50 * scale, 10 * scale, 5 * scale)
        offsets = ((-20, 0), (-10, 4), (0, -2), (11, 3), (21, -1))
    else:
        box_size = (15 * scale, 58 * scale, 14 * scale)
        soil_size = (10 * scale, 50 * scale, 5 * scale)
        offsets = ((0, -20), (4, -10), (-2, 0), (3, 11), (-1, 21))
    kit.box(collection, root, name + "_Planter", box_size, (x, y, z),
            mats["timber"], bevel_width=1.5)
    kit.box(collection, root, name + "_Soil", soil_size, (x, y, z + 8 * scale),
            mats["foundation"], bevel_width=0.8)
    for index, (dx, dy) in enumerate(offsets):
        stem_x = x + dx * scale
        stem_y = y + dy * scale
        stem_h = (11 + (index % 3) * 3) * scale
        kit.cylinder(collection, root, f"{name}_Stem_{index}", 1.4 * scale,
                     stem_h, (stem_x, stem_y, z + 9 * scale + stem_h / 2),
                     flower_mats["leaf"], vertices=10, bevel_width=0.25)
        bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8,
                                             radius=4.5 * scale,
                                             location=(stem_x, stem_y,
                                                       z + 10 * scale + stem_h))
        blossom = bpy.context.object
        blossom.name = f"{name}_Blossom_{index}"
        blossom.parent = root
        blossom.data.materials.append(flower_mats[("red", "purple", "gold")[index % 3]])
        kit.move_to_collection(blossom, collection)


def house_balcony(collection, root, name, side_x, center_y, base_z, mats,
                  *, length=108, ornate=False):
    """Side-wall balcony shared by the level-2 and level-3 house variants."""
    platform_x = side_x - 25
    outer_x = side_x - 47
    kit.box(collection, root, name + "_Platform", (48, length, 11),
            (platform_x, center_y, base_z), mats["timber"], bevel_width=2)
    kit.box(collection, root, name + "_OuterRail", (8, length + 4, 9),
            (outer_x, center_y, base_z + 39),
            mats["brass"] if ornate else mats["timber"], bevel_width=1)
    for index, y in enumerate((center_y - length * 0.43,
                               center_y - length * 0.22,
                               center_y,
                               center_y + length * 0.22,
                               center_y + length * 0.43)):
        kit.box(collection, root, f"{name}_Baluster_{index}", (7, 7, 38),
                (outer_x, y, base_z + 20),
                mats["brass"] if ornate else mats["timber"], bevel_width=1.2)
        if ornate:
            kit.cylinder(collection, root, f"{name}_BalusterCap_{index}", 5, 5,
                         (outer_x, y, base_z + 43), mats["brass"],
                         vertices=16, bevel_width=0.6)
    for post_y in (center_y - length / 2 + 5, center_y + length / 2 - 5):
        kit.box(collection, root, name + f"_EndPost_{int(post_y)}", (9, 9, 48),
                (outer_x, post_y, base_z + 24), mats["timber"], bevel_width=1.4)
    return platform_x, outer_x


def build_house_level(building_id, spec, level):
    """One shared two-storey house shell with additive upgrade detail."""
    collection, root, mats = common_context(building_id, spec)
    dims = spec["dimensions"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    lower_h = float(dims.get("lowerStoneHeight", 76))

    flower_mats = {
        "leaf": kit.material("MAT_House_Leaf", kit.rgba((0.10, 0.24, 0.07, 1.0)), roughness=0.82),
        "red": kit.material("MAT_House_Flower_Red", kit.rgba((0.62, 0.035, 0.025, 1.0)), roughness=0.65),
        "purple": kit.material("MAT_House_Flower_Purple", kit.rgba((0.34, 0.06, 0.50, 1.0)), roughness=0.62),
        "gold": kit.material("MAT_House_Flower_Gold", kit.rgba((0.94, 0.42, 0.035, 1.0)), roughness=0.60),
    }

    # All levels share the same bearing mass and roof footprint.  Upgrade
    # replacement therefore changes only visual richness, never the 2x2 base.
    kit.box(collection, root, "House_MainBody", (bw, bd, bh),
            (0, 0, bh / 2), mats["plaster"], bevel_width=5)
    kit.box(collection, root, "House_LowerStone", (bw + 6, bd + 6, lower_h),
            (0, 0, lower_h / 2), mats["stone"], bevel_width=4)
    roof_base = bh - 3
    kit.gabled_prism(collection, root, "House_MainGabledRoof", rw, rd, rh,
                     (0, 0, roof_base), mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "House_RoofCourse", rw, rd, rh,
                  roof_base, mats["roof"], rows=11 + level)

    front_y = -bd / 2 - 4
    side_x = -bw / 2 - 4
    upper_h = bh - lower_h
    kit.half_timber_facade(collection, root, "House_FrontUpperTimber", bw,
                           upper_h, front_y, lower_h, mats["timber"], bays=3)
    kit.half_timber_side(collection, root, "House_SideUpperTimber", bd,
                         upper_h, side_x, lower_h, mats["timber"], bays=3)
    for index, (x, y) in enumerate(((-bw / 2 - 2, -bd / 2 - 2),
                                     (bw / 2 + 2, -bd / 2 - 2),
                                     (-bw / 2 - 2, bd / 2 + 2))):
        kit.box(collection, root, f"House_CornerPost_{index}", (12, 12, bh),
                (x, y, bh / 2), mats["timber"], bevel_width=1.2)
    kit.box(collection, root, "House_MidFrontBand", (bw + 10, 10, 12),
            (0, front_y, lower_h), mats["timber"], bevel_width=1)
    kit.box(collection, root, "House_MidSideBand", (10, bd + 10, 12),
            (side_x, 0, lower_h), mats["timber"], bevel_width=1)

    door_x = -74
    kit.double_doors(collection, root, "House_MainDoor", (door_x, front_y - 4, 0),
                     58, 104, mats["timber"], mats["iron"], open_angle=0)
    kit.box(collection, root, "House_DoorLintel", (76, 14, 13),
            (door_x, front_y - 3, 108), mats["foundation"], bevel_width=2)
    kit.shutter_window(collection, root, "House_FrontWindow",
                       (48, front_y - 3, lower_h + upper_h * 0.55),
                       mats["glass"], mats["timber"], mats["iron"], scale=0.82)
    kit.shutter_window(collection, root, "House_SideWindow",
                       (side_x - 2, 42, lower_h + upper_h * 0.55),
                       mats["glass"], mats["timber"], mats["iron"],
                       orientation="side", scale=0.82)
    kit.chimney(collection, root, "House_Chimney",
                (76, 44, roof_base + 34), mats["stone"], mats["iron"], height=86)
    kit.lantern(collection, root, "House_FrontLantern",
                (-30, front_y - 16, 70), mats["iron"], mats["glow"])
    kit.lantern(collection, root, "House_SideLantern",
                (side_x - 16, -50, 72), mats["iron"], mats["glow"], orientation="side")

    if level >= 2:
        # The level-2 upgrade reads as prosperity without changing the shell:
        # covered entrance, compact balcony, flowers and stored supplies.
        kit.gabled_prism(collection, root, "House_DoorCanopy", 92, 48, 25,
                         (door_x, front_y - 27, 106), mats["timber"], mats["roof"])
        for post_x in (door_x - 38, door_x + 38):
            kit.box(collection, root, f"House_CanopyPost_{int(post_x)}", (7, 7, 78),
                    (post_x, front_y - 45, 39), mats["timber"], bevel_width=1)
        if level == 2:
            house_balcony(collection, root, "House_Level2Balcony", side_x, 42,
                          lower_h + 18, mats, length=102, ornate=False)
        house_flower_box(collection, root, "House_FrontFlowerBox",
                         (48, front_y - 15, lower_h + upper_h * 0.26),
                         "front", mats, flower_mats, scale=0.88)
        house_flower_box(collection, root, "House_SideFlowerBox",
                         (side_x - 15, 42, lower_h + upper_h * 0.22),
                         "side", mats, flower_mats, scale=0.92)
        kit.cylinder(collection, root, "House_SupplyBarrel", 18, 42,
                     (93, front_y - 12, 21), mats["timber"], vertices=24, bevel_width=2)
        for band_z in (8, 34):
            kit.cylinder(collection, root, f"House_SupplyBarrelBand_{band_z}", 19, 4,
                         (93, front_y - 12, band_z), mats["iron"],
                         vertices=24, bevel_width=0.5)
        kit.box(collection, root, "House_SupplyCrate", (30, 28, 26),
                (55, front_y - 13, 13), mats["timber"], bevel_width=2)

    if level >= 3:
        # Level 3 remains the same home, but gains noble joinery, a larger
        # brass-detailed balcony, crest, tall colored windows and roof finials.
        house_balcony(collection, root, "House_Level3OrnateBalcony", side_x, 38,
                      lower_h + 25, mats, length=132, ornate=True)
        for index, z in enumerate((lower_h + 18, bh - 22)):
            kit.box(collection, root, f"House_GiltFrontBand_{index}", (bw + 14, 6, 6),
                    (0, front_y - 7, z), mats["brass"], bevel_width=0.8)
            kit.box(collection, root, f"House_GiltSideBand_{index}", (6, bd + 14, 6),
                    (side_x - 7, 0, z), mats["brass"], bevel_width=0.8)
        for index, x in enumerate((-bw / 2, 0, bw / 2)):
            kit.box(collection, root, f"House_GiltFrontPlaque_{index}", (18, 6, 18),
                    (x, front_y - 8, bh - 18), mats["brass"], bevel_width=2)
        kit.cylinder(collection, root, "House_FamilyCrest_Backplate", 25, 7,
                     (door_x, front_y - 11, 132), mats["brass"],
                     rotation=(90, 0, 0), vertices=24, bevel_width=1)
        kit.cylinder(collection, root, "House_FamilyCrest_Emblem", 16, 9,
                     (door_x, front_y - 16, 132), mats["iron"],
                     rotation=(90, 0, 0), vertices=12, bevel_width=1)
        house_flower_box(collection, root, "House_Level3FrontUpperFlowers",
                         (48, front_y - 17, bh - 36), "front", mats,
                         flower_mats, scale=1.05)
        house_flower_box(collection, root, "House_Level3SideUpperFlowers",
                         (side_x - 17, 42, bh - 38), "side", mats,
                         flower_mats, scale=1.05)
        for finial_index, x in enumerate((-rw * 0.40, rw * 0.40)):
            kit.cylinder(collection, root, f"House_RidgeFinialBase_{finial_index}",
                         7, 12, (x, 0, roof_base + rh + 6), mats["brass"],
                         vertices=16, bevel_width=0.8)
            cone(collection, root, f"House_RidgeFinial_{finial_index}", 8, 22,
                 (x, 0, roof_base + rh + 23), mats["brass"], vertices=20)
        kit.lantern(collection, root, "House_Level3BalconyLantern",
                    (side_x - 48, 104, lower_h + 82), mats["iron"],
                    mats["glow"], orientation="side")
    return root


def build_house_lv1(spec):
    return build_house_level("house_lv1", spec, 1)


def build_house_lv2(spec):
    return build_house_level("house_lv2", spec, 2)


def build_house_lv3(spec):
    return build_house_level("house_lv3", spec, 3)


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
    "main_space_warehouse": build_main_space_warehouse,
    "main_space_warehouse_open": build_main_space_warehouse_open,
    "research_institute": build_research_institute,
    "research_institute_lv2": build_research_institute_lv2,
    "research_institute_lv3": build_research_institute_lv3,
    "church": build_church,
    "blacksmith": build_blacksmith,
    "armory": build_armory,
    "shooting_range": build_shooting_range,
    "cavalry_school": build_cavalry_school,
    "hamster_barracks": build_hamster_barracks,
    "explorer_camp": build_explorer_camp,
    "miner_camp": build_miner_camp,
    "market": build_market,
    "bakery": build_bakery,
    "field_hospital": build_field_hospital,
    "portal": build_portal,
    "planar_resonator": build_planar_resonator,
    "weather_forecast_tower": build_weather_forecast_tower,
    "jungle_temple": build_jungle_temple,
    "snow_castle": build_snow_castle,
    "desert_mansion": build_desert_mansion,
    "energy_node_1": build_energy_node_1,
    "energy_node_2": build_energy_node_2,
    "energy_node_3": build_energy_node_3,
    "energy_node_4": build_energy_node_4,
    "house_lv1": build_house_lv1,
    "house_lv2": build_house_lv2,
    "house_lv3": build_house_lv3,
    "thatch_hut": build_thatch_hut,
}


def body_depth_exclude_names(building_id, spec):
    excluded_names = spec.get("bodyDepthExclude")
    if excluded_names is None and building_id.startswith("research_institute"):
        level = 3 if building_id.endswith("_lv3") else 2 if building_id.endswith("_lv2") else 1
        excluded_names = [
            f"ResearchLV{level}_Foundation_Base",
            f"ResearchLV{level}_Foundation_Inset",
        ]
    if not excluded_names:
        raise SystemExit(f"body-depth output requires bodyDepthExclude for {building_id}")
    return excluded_names


def render_saved_body_depth(building_id, spec, blend_path, body_depth_path):
    """Render Body Depth from a clean Blender process to avoid 5.1 compositor reuse bugs."""
    if not body_depth_path:
        raise SystemExit("--body-only requires a body-depth output path")
    bpy.ops.wm.open_mainfile(filepath=blend_path)
    root_name = building_id.upper() + "_ROOT_ROT_Z_44_8"
    root = bpy.data.objects.get(root_name)
    camera = bpy.data.objects.get("World122_Ortho_Camera_30deg")
    if root is None or camera is None:
        raise SystemExit(f"body-depth scene objects missing for {building_id}")
    bpy.context.scene.camera = camera
    for object_name in body_depth_exclude_names(building_id, spec):
        obj = bpy.data.objects.get(object_name)
        if obj is None:
            raise SystemExit(f"body-depth object not found: {object_name}")
        obj.hide_render = True
    bpy.context.view_layer.update()
    kit.render_depth(
        bpy.context.scene, root, camera, body_depth_path,
        building_id + "_BodyFresh")


def spawn_saved_body_depth(manifest_path, building_id, blend_path,
                           preview_path, depth_path, body_depth_path):
    command = [
        bpy.app.binary_path,
        "--background",
        "--factory-startup",
        "--python",
        os.path.abspath(__file__),
        "--",
        manifest_path,
        building_id,
        blend_path,
        preview_path,
        depth_path,
        body_depth_path,
        "--body-only",
    ]
    completed = subprocess.run(command, check=False)
    if completed.returncode != 0:
        raise SystemExit(
            f"isolated body-depth render failed for {building_id}: "
            f"exit {completed.returncode}")


def main():
    (manifest_path, building_id, blend_path, preview_path, depth_path,
     body_depth_path, body_only) = parse_args()
    with open(manifest_path, "r", encoding="utf-8-sig") as handle:
        manifest = json.load(handle)
    if building_id not in BUILDERS:
        raise SystemExit(f"unknown building id: {building_id}")
    spec = manifest["buildings"][building_id]
    camera_config = dict(manifest["camera"])
    camera_config.update(spec.get("cameraOverrides", {}))
    spec["camera"] = camera_config
    spec["palette"] = manifest["palette"]
    if body_only:
        render_saved_body_depth(building_id, spec, blend_path, body_depth_path)
        print("building id ->", building_id)
        print("body depth ->", body_depth_path)
        return
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
        spawn_saved_body_depth(
            manifest_path, building_id, blend_path, preview_path,
            depth_path, body_depth_path)
    print("building id ->", building_id)
    print("model ->", blend_path)
    print("preview ->", preview_path)
    print("depth ->", depth_path)
    if body_depth_path:
        print("body depth ->", body_depth_path)


if __name__ == "__main__":
    main()
