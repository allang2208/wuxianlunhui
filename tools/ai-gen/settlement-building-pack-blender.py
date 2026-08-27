#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build modular World-122 settlement buildings from one reusable component kit."""

import importlib.util
import json
import math
import os
import shutil
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


def publish_approval_preview(building_id, preview_path):
    """Publish a stable Codex-facing copy and its paste-ready Markdown path."""
    preview_path = os.path.abspath(preview_path)
    stem, extension = os.path.splitext(preview_path)
    if stem.endswith("_model_preview"):
        approval_stem = stem[:-len("_model_preview")] + "_model_approval_preview"
    else:
        approval_stem = stem + "_approval_preview"
    approval_path = approval_stem + extension
    shutil.copy2(preview_path, approval_path)
    codex_path = approval_path.replace("\\", "/")
    print(f"codex markdown -> ![{building_id} model approval preview](<{codex_path}>)")
    return approval_path


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    depth_only_mode = argv[-1] if argv and argv[-1] in ("--body-only", "--cutout-only") else None
    if depth_only_mode:
        argv = argv[:-1]
    if len(argv) not in (5, 6):
        raise SystemExit("usage: blender --background --python settlement-building-pack-blender.py -- manifest.json id out.blend preview.png depth.png [depth-only.png] [--body-only|--cutout-only]")
    manifest, building_id, blend, preview, depth = argv[:5]
    body_depth = os.path.abspath(argv[5]) if len(argv) == 6 else None
    return (os.path.abspath(manifest), building_id, os.path.abspath(blend),
            os.path.abspath(preview), os.path.abspath(depth), body_depth,
            depth_only_mode)


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
    kit.wind_rotor(
        collection, root, "Sail", (0, front_y - 18, fh + lower_h + upper_h * 0.60),
        mats["iron"], mats["timber"], mats["timber"], mats["brass"],
        axis="Y", blade_count=4, start_angle=45,
        inner_radius=23, outer_radius=277,
        root_width=48, tip_width=48, thickness=9,
        style="lattice", lattice_slats=5)
    return root


def build_warehouse_level(building_id, spec, level=1):
    """One four-storey warehouse family; higher levels add attached logistics structure."""
    collection, root, mats = common_context(building_id, spec)
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

    if level >= 2:
        # LV2 remains the same medieval warehouse: capacity growth comes from a
        # thicker shell, a second loading bay and grounded reinforcement rather
        # than a fifth floor, detached annex or machinery reserved for LV3.
        second_door_x = 86
        kit.double_doors(
            collection, root, "WarehouseLV2_SecondLoadingDoor",
            (second_door_x, g["frontY"] - 6, g["fh"]), 106, 126,
            mats["timber"], mats["iron"], open_angle=0)

        buttress_z = g["fh"] + 58
        front_corner_x = g["bw"] / 2 - 17
        for side, x in enumerate((-front_corner_x, front_corner_x)):
            kit.box(
                collection, root, f"WarehouseLV2_FrontButtress_{side}",
                (25, 34, 116), (x, g["frontY"] - 9, buttress_z),
                mats["stone"], bevel_width=3)
            kit.box(
                collection, root, f"WarehouseLV2_FrontButtressFoot_{side}",
                (37, 46, 18), (x, g["frontY"] - 9, g["fh"] + 9),
                mats["foundation"], bevel_width=3)
        side_buttress_x = g["sideX"] - 9
        side_corner_y = g["bd"] / 2 - 20
        for side, y in enumerate((-side_corner_y, side_corner_y)):
            kit.box(
                collection, root, f"WarehouseLV2_SideButtress_{side}",
                (34, 25, 116), (side_buttress_x, y, buttress_z),
                mats["stone"], bevel_width=3)
            kit.box(
                collection, root, f"WarehouseLV2_SideButtressFoot_{side}",
                (46, 37, 18), (side_buttress_x, y, g["fh"] + 9),
                mats["foundation"], bevel_width=3)

        band_z = g["fh"] + 66
        kit.box(
            collection, root, "WarehouseLV2_FrontReinforcementBand",
            (g["bw"] + 13, 9, 11), (0, g["frontY"] - 5, band_z),
            mats["iron"], bevel_width=1)
        kit.box(
            collection, root, "WarehouseLV2_SideReinforcementBand",
            (9, g["bd"] + 13, 11), (g["sideX"] - 5, 0, band_z),
            mats["iron"], bevel_width=1)

        dock_x = 62
        dock_y = g["frontY"] - 39
        dock_z = g["fh"] + 10
        kit.box(
            collection, root, "WarehouseLV2_GroundLoadingDock",
            (218, 68, 20), (dock_x, dock_y, dock_z),
            mats["stone"], bevel_width=4)
        for index, (x, y, size) in enumerate((
                (20, dock_y - 2, 31), (57, dock_y - 3, 37),
                (101, dock_y - 1, 29), (132, dock_y + 1, 24))):
            kit.box(
                collection, root, f"WarehouseLV2_DockCrate_{index}",
                (size, size, size), (x, y, g["fh"] + 20 + size / 2),
                mats["timber"], bevel_width=2)
            for band in (-size * 0.27, size * 0.27):
                kit.box(
                    collection, root,
                    f"WarehouseLV2_DockCrateBand_{index}_{int(band)}",
                    (4, size + 2, size - 5),
                    (x + band, y - 1, g["fh"] + 20 + size / 2),
                    mats["iron"], bevel_width=0.4)
        kit.box(
            collection, root, "WarehouseLV2_OrderedSackStack",
            (72, 42, 27), (-45, dock_y + 1, g["fh"] + 34),
            mats["straw"], bevel_width=9)

    if level >= 3:
        # LV3 mechanises the existing loading route without changing the
        # four-storey shell. The wall-mounted lift, winch and guarded drive
        # remain one connected installation inside the original 2x2 slab.
        wall_x = g["sideX"]
        lift_x = wall_x + 12
        lift_y = 34
        rail_bottom = g["fh"] + 18
        rail_top = g["fh"] + g["bh"] - 12
        rail_height = rail_top - rail_bottom
        rail_ys = (lift_y - 43, lift_y + 43)

        for index, y in enumerate(rail_ys):
            kit.box(
                collection, root, f"WarehouseLV3_CargoLift_VerticalRail_{index}",
                (12, 12, rail_height),
                (lift_x, y, rail_bottom + rail_height / 2),
                mats["iron"], bevel_width=1.5)
            for anchor_index, z in enumerate((g["fh"] + 86, g["fh"] + 188,
                                               g["fh"] + 290, g["fh"] + 390)):
                kit.box(
                    collection, root,
                    f"WarehouseLV3_CargoLift_WallAnchor_{index}_{anchor_index}",
                    (34, 18, 13), (wall_x + 2, y, z),
                    mats["brass"], bevel_width=1.2)

        kit.box(
            collection, root, "WarehouseLV3_CargoLift_TopCrossbeam",
            (24, 118, 24), (lift_x, lift_y, rail_top - 2),
            mats["iron"], bevel_width=2.5)
        kit.box(
            collection, root, "WarehouseLV3_CargoLift_TransferBeam",
            (70, 22, 20), (wall_x + 19, lift_y, rail_top - 20),
            mats["timber"], bevel_width=2)
        kit.cylinder(
            collection, root, "WarehouseLV3_CargoLift_TopPulley_Rim",
            24, 16, (lift_x + 3, lift_y, rail_top - 26),
            mats["brass"], rotation=(0, 90, 0), vertices=40,
            bevel_width=1.5)
        kit.cylinder(
            collection, root, "WarehouseLV3_CargoLift_TopPulley_Hub",
            8, 24, (lift_x + 3, lift_y, rail_top - 26),
            mats["iron"], rotation=(0, 90, 0), vertices=24,
            bevel_width=1)

        lift_platform_z = g["fh"] + 245
        kit.box(
            collection, root, "WarehouseLV3_CargoLift_Platform",
            (58, 88, 14), (wall_x + 29, lift_y, lift_platform_z),
            mats["iron"], bevel_width=2)
        cage_xs = (wall_x + 6, wall_x + 52)
        for xi, x in enumerate(cage_xs):
            for yi, y in enumerate((lift_y - 36, lift_y + 36)):
                kit.box(
                    collection, root,
                    f"WarehouseLV3_CargoLift_CagePost_{xi}_{yi}",
                    (7, 7, 58), (x, y, lift_platform_z + 32),
                    mats["iron"], bevel_width=1)
        for z in (lift_platform_z + 23, lift_platform_z + 57):
            for xi, x in enumerate(cage_xs):
                kit.box(
                    collection, root,
                    f"WarehouseLV3_CargoLift_CageSideRail_{xi}_{int(z)}",
                    (7, 79, 7), (x, lift_y, z),
                    mats["iron"], bevel_width=0.8)
        kit.box(
            collection, root, "WarehouseLV3_CargoLift_Crate",
            (42, 48, 36), (wall_x + 29, lift_y,
                            lift_platform_z + 25),
            mats["timber"], bevel_width=3)
        for y in (lift_y - 15, lift_y + 15):
            kit.box(
                collection, root, f"WarehouseLV3_CargoLift_CrateBand_{int(y)}",
                (44, 4, 32), (wall_x + 29, y, lift_platform_z + 25),
                mats["iron"], bevel_width=0.5)

        cable_height = rail_top - 26 - (lift_platform_z + 58)
        kit.cylinder(
            collection, root, "WarehouseLV3_CargoLift_HoistCable",
            3, cable_height,
            (lift_x + 3, lift_y,
             lift_platform_z + 58 + cable_height / 2),
            mats["iron"], vertices=16, bevel_width=0.5)

        # A compact wall-powered drum avoids reading as a detached engine house.
        # Open gears supply the LV3 identity while the guard remains workmanlike.
        drive_y = -82
        drive_z = g["fh"] + 104
        kit.box(
            collection, root, "WarehouseLV3_PoweredWinch_GroundedBed",
            (64, 116, 14), (wall_x + 26, drive_y, g["fh"] + 7),
            mats["foundation"], bevel_width=3)
        kit.cylinder(
            collection, root, "WarehouseLV3_PoweredWinch_Drum",
            20, 62, (wall_x + 18, drive_y, drive_z),
            mats["iron"], rotation=(0, 90, 0), vertices=32,
            bevel_width=2)
        kit.gear(
            collection, root, "WarehouseLV3_PoweredWinch_MainGear",
            38, (wall_x + 45, drive_y, drive_z),
            mats["brass"], axis="X", teeth=16)
        kit.gear(
            collection, root, "WarehouseLV3_PoweredWinch_DriveGear",
            24, (wall_x + 45, drive_y + 49, drive_z - 34),
            mats["iron"], axis="X", teeth=12)
        kit.cylinder(
            collection, root, "WarehouseLV3_PoweredWinch_DriveHousing",
            27, 54, (wall_x + 17, drive_y + 51, g["fh"] + 58),
            mats["iron"], rotation=(0, 90, 0), vertices=32,
            bevel_width=3)
        for x in (wall_x + 3, wall_x + 31):
            kit.cylinder(
                collection, root,
                f"WarehouseLV3_PoweredWinch_DriveHousingBand_{int(x)}",
                29, 5, (x, drive_y + 51, g["fh"] + 58),
                mats["brass"], rotation=(0, 90, 0), vertices=32,
                bevel_width=0.8)
        kit.cylinder(
            collection, root, "WarehouseLV3_PoweredWinch_TransmissionShaft",
            7, 52, (wall_x + 25, drive_y + 28, drive_z - 22),
            mats["brass"], rotation=(0, 90, 0), vertices=24,
            bevel_width=1)

        guard_x = wall_x + 52
        for y in (drive_y - 54, drive_y + 75):
            kit.box(
                collection, root,
                f"WarehouseLV3_PoweredWinch_GuardPost_{int(y)}",
                (8, 8, 126), (guard_x, y, g["fh"] + 63),
                mats["iron"], bevel_width=1)
        for z in (g["fh"] + 24, g["fh"] + 124):
            kit.box(
                collection, root,
                f"WarehouseLV3_PoweredWinch_GuardRail_{int(z)}",
                (8, 137, 8), (guard_x, drive_y + 10, z),
                mats["iron"], bevel_width=1)
        kit.box(
            collection, root, "WarehouseLV3_PoweredWinch_WallBracket",
            (58, 20, 18), (wall_x + 8, drive_y, drive_z + 46),
            mats["iron"], bevel_width=2)

    if level >= 4:
        # LV4 automates the accepted LV3 loading route instead of enlarging the
        # shell. One enclosed sorter remains bolted to the visible side wall;
        # a short roller bridge takes cargo from the existing lift cage, then
        # two attached gravity chutes feed grounded receiving bins. The whole
        # route stays inside the original 2x2 slab and creates no annex/roof.
        wall_x = g["sideX"]
        lift_y = 34
        lift_platform_z = g["fh"] + 245
        sorter_x = wall_x + 32
        sorter_y = -62
        sorter_z = g["fh"] + 312

        conveyor_center_y = -10
        conveyor_z = lift_platform_z + 12
        kit.box(
            collection, root, "WarehouseLV4_AutomatedConveyor_MainBed",
            (58, 92, 12), (sorter_x, conveyor_center_y, conveyor_z),
            mats["iron"], bevel_width=2)
        kit.box(
            collection, root, "WarehouseLV4_AutomatedConveyor_BeltSurface",
            (46, 86, 5), (sorter_x, conveyor_center_y, conveyor_z + 8),
            mats["timber"], bevel_width=1)
        for index, y in enumerate((-48, -32, -16, 0, 16, 32)):
            kit.cylinder(
                collection, root,
                f"WarehouseLV4_AutomatedConveyor_Roller_{index}",
                6, 48, (sorter_x, y, conveyor_z + 12),
                mats["brass"], rotation=(0, 90, 0), vertices=24,
                bevel_width=0.8)
        for side, x in enumerate((sorter_x - 29, sorter_x + 29)):
            kit.box(
                collection, root,
                f"WarehouseLV4_AutomatedConveyor_SideRail_{side}",
                (7, 96, 22), (x, conveyor_center_y, conveyor_z + 17),
                mats["iron"], bevel_width=1)
        for index, y in enumerate((-38, 14)):
            kit.box(
                collection, root,
                f"WarehouseLV4_AutomatedConveyor_WallBracket_{index}",
                (48, 12, 18), (wall_x + 6, y, conveyor_z - 13),
                mats["iron"], bevel_width=1.5)

        # The sorting enclosure is one wall-mounted machine, not a new room.
        kit.box(
            collection, root, "WarehouseLV4_EnclosedSorter_MainHousing",
            (72, 106, 104), (sorter_x, sorter_y, sorter_z),
            mats["iron"], bevel_width=7)
        kit.box(
            collection, root, "WarehouseLV4_EnclosedSorter_WallBackplate",
            (18, 118, 116), (wall_x + 2, sorter_y, sorter_z),
            mats["foundation"], bevel_width=4)
        outer_x = sorter_x - 39
        kit.box(
            collection, root, "WarehouseLV4_EnclosedSorter_InspectionGlass",
            (7, 68, 48), (outer_x, sorter_y, sorter_z + 7),
            mats["glass"], bevel_width=3)
        for side, y in enumerate((sorter_y - 37, sorter_y + 37)):
            kit.box(
                collection, root,
                f"WarehouseLV4_EnclosedSorter_InspectionFrameVertical_{side}",
                (9, 7, 58), (outer_x - 2, y, sorter_z + 7),
                mats["brass"], bevel_width=1)
        for side, z in enumerate((sorter_z - 20, sorter_z + 34)):
            kit.box(
                collection, root,
                f"WarehouseLV4_EnclosedSorter_InspectionFrameHorizontal_{side}",
                (9, 78, 7), (outer_x - 2, sorter_y, z),
                mats["brass"], bevel_width=1)
        kit.cylinder(
            collection, root, "WarehouseLV4_EnclosedSorter_IndexingDrum",
            27, 14, (outer_x - 7, sorter_y, sorter_z + 7),
            mats["brass"], rotation=(0, 90, 0), vertices=36,
            bevel_width=1.5)
        for spoke_index, angle in enumerate((0, 45, 90, 135)):
            kit.box(
                collection, root,
                f"WarehouseLV4_EnclosedSorter_DrumSpoke_{spoke_index}",
                (7, 48, 5), (outer_x - 16, sorter_y, sorter_z + 7),
                mats["iron"], rotation=(angle, 0, 0), bevel_width=0.8)
        kit.box(
            collection, root, "WarehouseLV4_EnclosedSorter_ServicePanel",
            (8, 58, 26), (outer_x - 3, sorter_y, sorter_z - 39),
            mats["foundation"], bevel_width=2)
        for index, y in enumerate((sorter_y - 18, sorter_y, sorter_y + 18)):
            kit.cylinder(
                collection, root,
                f"WarehouseLV4_EnclosedSorter_StatusLamp_{index}",
                4, 10, (outer_x - 9, y, sorter_z - 38),
                mats["glow"] if index == 1 else mats["brass"],
                rotation=(0, 90, 0), vertices=20, bevel_width=0.5)

        # One compact branching manifold and two fixed enclosed chutes make the
        # automated route legible while avoiding a second exterior conveyor.
        manifold_z = g["fh"] + 250
        kit.box(
            collection, root, "WarehouseLV4_AutoRouting_Manifold",
            (48, 94, 28), (wall_x + 24, -73, manifold_z),
            mats["iron"], bevel_width=5)
        for route_index, route_y in enumerate((-96, -50)):
            chute_top = manifold_z - 8
            chute_bottom = g["fh"] + 78
            chute_height = chute_top - chute_bottom
            kit.box(
                collection, root,
                f"WarehouseLV4_AutoRouting_EnclosedChute_{route_index}",
                (34, 34, chute_height),
                (wall_x + 18, route_y, chute_bottom + chute_height / 2),
                mats["iron"], bevel_width=4)
            for band_index, z in enumerate((g["fh"] + 112,
                                             g["fh"] + 178,
                                             g["fh"] + 228)):
                kit.box(
                    collection, root,
                    f"WarehouseLV4_AutoRouting_ChuteBand_{route_index}_{band_index}",
                    (39, 39, 7), (wall_x + 18, route_y, z),
                    mats["brass"], bevel_width=1)
            kit.box(
                collection, root,
                f"WarehouseLV4_AutoRouting_ReceivingBin_{route_index}",
                (58, 48, 54),
                (wall_x + 28, route_y, g["fh"] + 27),
                mats["foundation"], bevel_width=6)
            kit.box(
                collection, root,
                f"WarehouseLV4_AutoRouting_BinMouth_{route_index}",
                (46, 38, 7),
                (wall_x + 28, route_y, g["fh"] + 56),
                mats["iron"], bevel_width=2)

    if level >= 5:
        # LV5 encloses the inherited LV4 routing leg in one wall-mounted phase
        # vault. The single core, stabilizer ring and paired reserve canisters
        # stay attached to the same side wall and original 2x2 foundation.
        wall_x = g["sideX"]
        vault_y = -73
        vault_center_z = g["fh"] + 150
        vault_face_x = wall_x - 16
        kit.box(
            collection, root, "WarehouseLV5_PhaseVault_WallBackplate",
            (18, 142, 178), (wall_x + 2, vault_y, vault_center_z),
            mats["foundation"], bevel_width=5)
        kit.box(
            collection, root, "WarehouseLV5_PhaseVault_MainHousing",
            (62, 130, 164), (wall_x + 23, vault_y, vault_center_z),
            mats["iron"], bevel_width=10)
        kit.box(
            collection, root, "WarehouseLV5_PhaseVault_FrontInset",
            (10, 112, 140), (vault_face_x + 4, vault_y, vault_center_z),
            mats["foundation"], bevel_width=8)

        phase_center_z = g["fh"] + 165
        kit.cylinder(
            collection, root, "WarehouseLV5_PhaseCore_Recess",
            42, 12, (vault_face_x - 2, vault_y, phase_center_z),
            mats["iron"], rotation=(0, 90, 0), vertices=48,
            bevel_width=2)
        kit.torus_ring(
            collection, root, "WarehouseLV5_PhaseCore_StabilizerRing",
            54, 7, (vault_face_x - 10, vault_y, phase_center_z),
            mats["brass"], rotation=(0, 90, 0))
        kit.faceted_crystal_prism(
            collection, root, "WarehouseLV5_PhaseCore_Crystal",
            74, 19, (vault_face_x - 13, vault_y, phase_center_z - 37),
            mats["crystal"], mats["crystalHighlight"], sides=8,
            depth_scale=0.72, rotation_z=22.5)
        kit.box(
            collection, root, "WarehouseLV5_PhaseCore_LowerSocket",
            (24, 34, 18), (vault_face_x - 7, vault_y,
                           phase_center_z - 48),
            mats["brass"], bevel_width=4)
        kit.box(
            collection, root, "WarehouseLV5_PhaseCore_UpperClamp",
            (18, 30, 12), (vault_face_x - 7, vault_y,
                           phase_center_z + 48),
            mats["brass"], bevel_width=3)
        for clamp_index, (y, z) in enumerate((
                (vault_y - 54, phase_center_z),
                (vault_y + 54, phase_center_z),
                (vault_y, phase_center_z - 54),
                (vault_y, phase_center_z + 54))):
            size = (15, 18, 34) if y != vault_y else (15, 34, 18)
            kit.box(
                collection, root,
                f"WarehouseLV5_PhaseCore_RingClamp_{clamp_index}",
                size, (vault_face_x - 5, y, z), mats["iron"],
                bevel_width=3)

        # Two sealed wall-mounted reserve canisters make the cross-dimensional
        # storage function legible without adding a detached tank or annex.
        for reserve_index, reserve_y in enumerate((vault_y - 55,
                                                    vault_y + 55)):
            canister_z = g["fh"] + 108
            kit.cylinder(
                collection, root,
                f"WarehouseLV5_ReserveCanister_{reserve_index}",
                17, 82, (vault_face_x - 7, reserve_y, canister_z),
                mats["foundation"], vertices=32, bevel_width=2)
            for band_index, z in enumerate((canister_z - 27,
                                             canister_z + 27)):
                kit.cylinder(
                    collection, root,
                    f"WarehouseLV5_ReserveCanisterBand_{reserve_index}_{band_index}",
                    19, 6, (vault_face_x - 7, reserve_y, z),
                    mats["brass"], vertices=32, bevel_width=1)
            kit.cylinder(
                collection, root,
                f"WarehouseLV5_ReserveCanisterCap_{reserve_index}",
                12, 13, (vault_face_x - 7, reserve_y, canister_z + 47),
                mats["iron"], vertices=24, bevel_width=1.5)
            conduit_height = phase_center_z - (canister_z + 47)
            kit.cylinder(
                collection, root,
                f"WarehouseLV5_ReserveConduitVertical_{reserve_index}",
                5, conduit_height,
                (vault_face_x - 7, reserve_y,
                 canister_z + 47 + conduit_height / 2),
                mats["brass"], vertices=20, bevel_width=0.8)

        kit.cylinder(
            collection, root, "WarehouseLV5_ReserveConduitCrossfeed",
            5, 110, (vault_face_x - 7, vault_y, phase_center_z),
            mats["brass"], rotation=(90, 0, 0), vertices=20,
            bevel_width=0.8)
        bridge_bottom = vault_center_z + 82
        bridge_top = g["fh"] + 238
        kit.cylinder(
            collection, root, "WarehouseLV5_PhaseVault_SorterBridge",
            7, bridge_top - bridge_bottom,
            (wall_x + 25, vault_y, (bridge_bottom + bridge_top) / 2),
            mats["brass"], vertices=24, bevel_width=1)
        kit.box(
            collection, root, "WarehouseLV5_PhaseVault_SorterCoupler",
            (42, 36, 24), (wall_x + 25, vault_y, bridge_top + 7),
            mats["iron"], bevel_width=5)
    return root


def build_warehouse(spec):
    return build_warehouse_level("warehouse", spec, level=1)


def build_warehouse_lv2(spec):
    return build_warehouse_level("warehouse_lv2", spec, level=2)


def build_warehouse_lv3(spec):
    return build_warehouse_level("warehouse_lv3", spec, level=3)


def build_warehouse_lv4(spec):
    return build_warehouse_level("warehouse_lv4", spec, level=4)


def build_warehouse_lv5(spec):
    return build_warehouse_level("warehouse_lv5", spec, level=5)


def _build_treasure_chest(asset_id, spec, open_lid=False, dungeon_style=False):
    """Shared editable chest assembly for warehouse and dungeon variants."""
    collection, root, mats = common_context(asset_id, spec)
    dims = spec["dimensions"]
    bw, bd, bh = dims["body"]
    lw, ld, lh = dims["lid"]
    fw, fd, fh = dims["feet"]
    body_base = fh - 2
    body_top = body_base + bh
    front_y = -bd / 2 - 4
    side_x = -bw / 2 - 4
    prefix = "DungeonChest" if dungeon_style else "WarehouseChest"
    body_mat = mats["iron"] if dungeon_style else mats["plaster"]
    lid_end_mat = mats["iron"] if dungeon_style else mats["plaster"]
    lid_roof_mat = mats["iron"] if dungeon_style else mats["roof"]

    def filigree(name, points, parent=root, bevel_depth=2.2):
        curve_data = bpy.data.curves.new(name + "_Curve", type="CURVE")
        curve_data.dimensions = "3D"
        curve_data.resolution_u = 3
        curve_data.bevel_depth = bevel_depth
        curve_data.bevel_resolution = 3
        curve_data.use_fill_caps = True
        spline = curve_data.splines.new("BEZIER")
        spline.bezier_points.add(len(points) - 1)
        for point, coordinates in zip(spline.bezier_points, points):
            point.co = coordinates
            point.handle_left_type = "AUTO"
            point.handle_right_type = "AUTO"
        obj = bpy.data.objects.new(name, curve_data)
        collection.objects.link(obj)
        obj.parent = parent
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
        kit.box(collection, root, f"{prefix}_GoldFoot_{index}", (fw, fd, fh),
                (x, y, fh / 2), mats["brass"], bevel_width=5)
    kit.box(collection, root, f"{prefix}_Body", (bw, bd, bh),
            (0, 0, body_base + bh / 2), body_mat, bevel_width=8)

    # Gold frame, corner guards and the strong lid seam are physical chest hardware.
    for index, z in enumerate((body_base + 8, body_top - 8)):
        kit.box(collection, root, f"{prefix}_FrontBand_{index}",
                (bw + 12, 9, 10), (0, front_y, z), mats["brass"], bevel_width=2)
        kit.box(collection, root, f"{prefix}_SideBand_{index}",
                (9, bd + 12, 10), (side_x, 0, z), mats["brass"], bevel_width=2)
    for x in (-bw / 2 - 2, bw / 2 + 2):
        kit.box(collection, root, f"{prefix}_FrontCorner_{int(x)}",
                (11, 10, bh + 4), (x, front_y, body_base + bh / 2),
                mats["brass"], bevel_width=2.5)
    for y in (-bd / 2 - 2, bd / 2 + 2):
        kit.box(collection, root, f"{prefix}_SideCorner_{int(y)}",
                (10, 11, bh + 4), (side_x, y, body_base + bh / 2),
                mats["brass"], bevel_width=2.5)
    kit.box(collection, root, f"{prefix}_LidSeam", (lw + 10, ld + 10, 12),
            (0, 0, body_top + 2), mats["brass"], bevel_width=3)

    # One domed lid is parented to its rear hinge, so the open state changes only
    # that assembly and preserves the exact body, gems and filigree.
    lid_base = body_top + 7
    lid_pivot = bpy.data.objects.new(f"{prefix}_RearHingePivot", None)
    collection.objects.link(lid_pivot)
    lid_pivot.parent = root
    lid_pivot.location = (0, ld / 2, lid_base)
    lid_pivot.rotation_euler.x = math.radians(-float(spec.get("lidOpenDegrees", 0)) if open_lid else 0)
    kit.barrel_vault(collection, lid_pivot, f"{prefix}_DomedLid", lw, ld, lh,
                     (0, -ld / 2, 0), lid_end_mat, lid_roof_mat, segments=32)
    rib_positions = (-lw * 0.43, lw * 0.43) if dungeon_style else (-lw * 0.42, 0, lw * 0.42)
    for index, x in enumerate(rib_positions):
        rib_width = 11 if index == 1 else 9
        kit.barrel_vault(collection, lid_pivot, f"{prefix}_GoldLidRib_{index}",
                         rib_width, ld + 8, lh + 4, (x, -ld / 2, -1),
                         mats["brass"], mats["brass"], segments=28)
    kit.box(collection, lid_pivot, f"{prefix}_LidLatch", (18, 10, 48),
            (0, -ld - 1, -9), mats["brass"], bevel_width=4)

    if open_lid:
        # Dark lining under the raised lid and one empty magical storage cavity.
        # No loose treasure is modeled, so the result remains the warehouse prop.
        kit.box(collection, lid_pivot, f"{prefix}_InnerLidLining",
                (lw - 24, ld - 20, 6), (0, -ld / 2, -5),
                mats["iron"], bevel_width=5)
        kit.box(collection, root, f"{prefix}_OpenInterior",
                (bw - 24, bd - 24, 7), (0, 0, body_top + 9),
                mats["iron"], bevel_width=6)
        if not dungeon_style:
            kit.box(collection, root, f"{prefix}_OpenInteriorBlueGlow",
                    (bw - 42, bd - 42, 4), (0, -2, body_top + 13),
                    mats["glow"], bevel_width=7)
        for index, x in enumerate((-lw * 0.31, lw * 0.31)):
            kit.cylinder(collection, root, f"{prefix}_GoldHinge_{index}",
                         8, 44, (x, bd / 2 + 3, body_top + 8), mats["brass"],
                         rotation=(0, 90, 0), vertices=24, bevel_width=1.5)

    # Central sapphire lock with a deep gold sunburst frame.
    lock_z = body_base + bh * 0.56
    kit.gear(collection, root, f"{prefix}_GoldLockRosette", 27,
             (0, front_y - 10, lock_z), mats["brass"], axis="Y", teeth=16)
    if dungeon_style:
        kit.box(collection, root, f"{prefix}_LockPlate", (34, 9, 44),
                (0, front_y - 18, lock_z - 2), mats["brass"], bevel_width=6)
        kit.cylinder(collection, root, f"{prefix}_KeyholeRound", 5.5, 4,
                     (0, front_y - 24, lock_z + 2), mats["iron"],
                     rotation=(90, 0, 0), vertices=24, bevel_width=0.5)
        kit.box(collection, root, f"{prefix}_KeyholeStem", (5, 4, 13),
                (0, front_y - 24, lock_z - 7), mats["iron"], bevel_width=1)
    else:
        sapphire(f"{prefix}_MainSapphire",
                 (0, front_y - 17, lock_z), (31, 11, 42))

    # Raised symmetrical scrollwork makes the gold carving readable in Depth.
    scroll_z = body_base + bh * 0.50
    left_scroll = [(-27, front_y - 8, scroll_z), (-40, front_y - 8, scroll_z + 17),
                   (-62, front_y - 8, scroll_z + 20), (-76, front_y - 8, scroll_z + 8),
                   (-67, front_y - 8, scroll_z - 2), (-52, front_y - 8, scroll_z + 3)]
    lower_left = [(-28, front_y - 8, scroll_z - 7), (-43, front_y - 8, scroll_z - 22),
                  (-67, front_y - 8, scroll_z - 20), (-78, front_y - 8, scroll_z - 7),
                  (-64, front_y - 8, scroll_z - 3)]
    filigree(f"{prefix}_Filigree_LeftUpper", left_scroll, bevel_depth=2.6)
    filigree(f"{prefix}_Filigree_LeftLower", lower_left, bevel_depth=2.3)
    filigree(f"{prefix}_Filigree_RightUpper", [(-x, y, z) for x, y, z in left_scroll], bevel_depth=2.6)
    filigree(f"{prefix}_Filigree_RightLower", [(-x, y, z) for x, y, z in lower_left], bevel_depth=2.3)
    if not dungeon_style:
        for index, x in enumerate((-78, -50, 50, 78)):
            sapphire(f"{prefix}_SapphireInlay_{index}",
                     (x, front_y - 13, body_base + 23), (12, 7, 15))

    # One decorated side panel reinforces that this is a portable container, not a house.
    if dungeon_style:
        handle_mount_z = body_base + bh * 0.60
        for index, y in enumerate((-21, 43)):
            kit.cylinder(collection, root, f"{prefix}_SideHandleMount_{index}", 7, 7,
                         (side_x - 17, y, handle_mount_z), mats["brass"],
                         rotation=(0, 90, 0), vertices=24, bevel_width=1)
        handle_x = side_x - 19
        filigree(f"{prefix}_SideDropHandle", [
            (handle_x, -21, handle_mount_z),
            (handle_x, -15, handle_mount_z - 17),
            (handle_x, 11, handle_mount_z - 27),
            (handle_x, 37, handle_mount_z - 17),
            (handle_x, 43, handle_mount_z),
        ], bevel_depth=4.2)

        medallion_y = -ld / 2
        medallion_z = lh + 4
        kit.cylinder(collection, lid_pivot, f"{prefix}_LidMedallionOuter", 31, 5,
                     (0, medallion_y, medallion_z), mats["brass"],
                     vertices=48, bevel_width=1.2)
        kit.cylinder(collection, lid_pivot, f"{prefix}_LidMedallionInset", 18, 7,
                     (0, medallion_y, medallion_z + 1), mats["iron"],
                     vertices=40, bevel_width=1)
        for index in range(12):
            angle = index * 30
            radians = math.radians(angle)
            kit.box(collection, lid_pivot, f"{prefix}_LidMedallionPetal_{index:02d}",
                    (10, 25, 4),
                    (math.sin(radians) * 31,
                     medallion_y + math.cos(radians) * 31,
                     medallion_z - 1), mats["brass"],
                    rotation=(0, 0, -angle), bevel_width=3)
        for side in (-1, 1):
            end_x = side * (lw / 2 + 3)
            lid_scroll = [
                (end_x, -ld * 0.70, lh * 0.18),
                (end_x, -ld * 0.56, lh * 0.40),
                (end_x, -ld * 0.39, lh * 0.32),
                (end_x, -ld * 0.34, lh * 0.16),
                (end_x, -ld * 0.47, lh * 0.12),
            ]
            filigree(f"{prefix}_LidEndFiligree_{side:+d}", lid_scroll,
                     parent=lid_pivot, bevel_depth=2.3)
    else:
        kit.gear(collection, root, f"{prefix}_SideGoldRosette", 23,
                 (side_x - 9, 12, body_base + bh * 0.50), mats["brass"],
                 axis="X", teeth=14)
        side_gem = kit.cylinder(collection, root, f"{prefix}_SideSapphire", 12, 8,
                                (side_x - 14, 12, body_base + bh * 0.50), mats["glow"],
                                rotation=(0, 90, 0), vertices=8, bevel_width=1)
        side_gem.scale.z = 1.25
    return root


def build_main_space_warehouse(spec):
    return _build_treasure_chest("main_space_warehouse", spec, open_lid=False)


def build_main_space_warehouse_open(spec):
    return _build_treasure_chest("main_space_warehouse_open", spec, open_lid=True)


def build_dungeon_chest_closed(spec):
    return _build_treasure_chest("dungeon_chest_closed", spec,
                                 open_lid=False, dungeon_style=True)


def build_dungeon_chest_open(spec):
    return _build_treasure_chest("dungeon_chest_open", spec,
                                 open_lid=True, dungeon_style=True)


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
    kit.post_and_rail_enclosure(
        collection, root, "Range_Yard", fw - 28, yard_front, yard_back, fh,
        mats["timber"], gate_width=92, rail_offsets=(30, 67),
        post_height=82, post_spacing=max(1, yard_depth / 2),
        include_back=False, gate_leaves=False)
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


def build_hamster_barracks_level(building_id, spec, level=1):
    """Connected two-tower barracks family with tier-specific attached upgrades."""
    collection, root, mats = common_context(building_id, spec)
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

    if level >= 2:
        # LV2 reads as the same barracks hardened for champion and phalanx
        # training: all additions remain attached to the hall or its two towers.
        for side_name, sign in (("Left", -1), ("Right", 1)):
            buttress_x = sign * (bw / 2 - 13)
            kit.box(collection, root, f"BarracksLV2_{side_name}GateButtress",
                    (26, 38, 138), (buttress_x, front_y - 2, fh + 69),
                    mats["foundation"], bevel_width=4)
            kit.box(collection, root, f"BarracksLV2_{side_name}GateButtressFoot",
                    (38, 50, 18), (buttress_x, front_y - 2, fh + 9),
                    mats["foundation"], bevel_width=3)

            tower_center_x = sign * tower_x
            tower_front_y = tower_y - td / 2 - 5
            for band_index, band_z in enumerate((fh + 116, fh + 224)):
                kit.box(collection, root,
                        f"BarracksLV2_{side_name}TowerIronBand_{band_index}",
                        (tw + 16, 9, 10),
                        (tower_center_x, tower_front_y, band_z),
                        mats["iron"], bevel_width=2)

            shoulder_z = fh + th - 34
            kit.box(collection, root, f"BarracksLV2_{side_name}TowerShoulder",
                    (tw + 28, td + 28, 16),
                    (tower_center_x, tower_y, shoulder_z),
                    mats["foundation"], bevel_width=3)
            for merlon_index, (dx, dy) in enumerate((
                    (-tw * 0.36, -td * 0.36), (tw * 0.36, -td * 0.36),
                    (-tw * 0.36, td * 0.36), (tw * 0.36, td * 0.36))):
                kit.box(collection, root,
                        f"BarracksLV2_{side_name}TowerMerlon_{merlon_index}",
                        (24, 24, 30),
                        (tower_center_x + dx, tower_y + dy, shoulder_z + 20),
                        mats["foundation"], bevel_width=2)

        wall_walk_z = fh + bh - 24
        kit.box(collection, root, "BarracksLV2_GateWallWalkDeck",
                (bw - 38, 42, 14), (0, front_y - 5, wall_walk_z),
                mats["foundation"], bevel_width=3)
        for post_index, x in enumerate((-108, -54, 0, 54, 108)):
            kit.box(collection, root, f"BarracksLV2_GateWallWalkMerlon_{post_index}",
                    (30, 22, 34), (x, front_y - 13, wall_walk_z + 22),
                    mats["foundation"], bevel_width=2)
        for bar_index, x in enumerate((-34, -17, 0, 17, 34)):
            kit.box(collection, root, f"BarracksLV2_RaisedPortcullisBar_{bar_index}",
                    (5, 7, 58), (x, front_y - 11, fh + 128),
                    mats["iron"], bevel_width=1)
            cone(collection, root, f"BarracksLV2_RaisedPortcullisSpike_{bar_index}",
                 5, 16, (x, front_y - 11, fh + 95), mats["iron"], vertices=4)

        # Ordered shield racks stay wall-mounted and leave the gate clear.
        for side_name, sign in (("Left", -1), ("Right", 1)):
            rack_x = sign * (tower_x + 2)
            rack_y = tower_y - td / 2 - 12
            kit.box(collection, root, f"BarracksLV2_{side_name}ShieldRackBack",
                    (74, 8, 76), (rack_x, rack_y, fh + 92),
                    mats["timber"], bevel_width=2)
            for shield_index, dx in enumerate((-23, 0, 23)):
                kit.cylinder(collection, root,
                             f"BarracksLV2_{side_name}Shield_{shield_index}",
                             18, 7, (rack_x + dx, rack_y - 7, fh + 92),
                             mats["iron"], rotation=(90, 0, 0),
                             vertices=24, bevel_width=1.5)
                kit.box(collection, root,
                        f"BarracksLV2_{side_name}ShieldBoss_{shield_index}",
                        (7, 6, 7), (rack_x + dx, rack_y - 13, fh + 92),
                        mats["brass"], bevel_width=2)

    return root


def build_hamster_barracks(spec):
    return build_hamster_barracks_level("hamster_barracks", spec, level=1)


def build_hamster_barracks_lv2(spec):
    """Compact medieval Roman legion barracks with flags and crenellations."""
    collection, root, mats = common_context("hamster_barracks_lv2", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["body"]
    flat_roof_w, flat_roof_d, flat_roof_h = dims["flatRoof"]
    tw, td, th = dims["tower"]
    gate_w, gate_d, gate_h = dims["gatehouse"]
    curtain_w, curtain_d, curtain_h = dims["curtainWall"]

    roman_red = kit.material(
        "MAT_BarracksLV2_LegionCrimson", kit.rgba((0.34, 0.055, 0.035, 1.0)),
        roughness=0.88, noise={"scale": 11, "detail": 3, "bump": 0.09})
    roman_red_dark = kit.material(
        "MAT_BarracksLV2_LegionCrimsonDark", kit.rgba((0.19, 0.028, 0.02, 1.0)),
        roughness=0.92)

    def add_merlon(name, x, y, z, size=(25, 24, 32)):
        kit.box(collection, root, name, size, (x, y, z),
                mats["foundation"], bevel_width=2)

    def add_legion_standard(name, x, y, base_z, height=118):
        """Roman vexillum: vertical pole, crossbar, cloth, edging and finial."""
        pole_top = base_z + height
        kit.cylinder(collection, root, f"{name}_Pole", 4, height,
                     (x, y, base_z + height / 2), mats["iron"],
                     vertices=18, bevel_width=1)
        kit.cylinder(collection, root, f"{name}_Crossbar", 4, 62,
                     (x, y - 1, pole_top - 25), mats["brass"],
                     rotation=(0, 90, 0), vertices=18, bevel_width=1)
        kit.box(collection, root, f"{name}_CrimsonCloth", (48, 6, 58),
                (x, y - 4, pole_top - 57), roman_red,
                rotation=(0, 0, -2 if x < 0 else 2), bevel_width=2)
        kit.box(collection, root, f"{name}_GoldTopTrim", (50, 7, 7),
                (x, y - 5, pole_top - 31), mats["brass"], bevel_width=1)
        kit.box(collection, root, f"{name}_DarkLowerTrim", (48, 7, 6),
                (x, y - 5, pole_top - 84), roman_red_dark, bevel_width=1)
        cone(collection, root, f"{name}_SpearFinial", 7, 22,
             (x, y, pole_top + 11), mats["brass"], vertices=4)

    kit.box(collection, root, "Barracks_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)

    # A low, connected Roman barracks hall remains the dominant horizontal mass.
    hall_y = 36
    kit.box(collection, root, "BarracksLV2_RomanHall_StoneBase",
            (bw, bd, 92), (0, hall_y, fh + 46), mats["stone"],
            bevel_width=5)
    kit.box(collection, root, "BarracksLV2_RomanHall_WarmPlaster",
            (bw + 2, bd + 2, bh - 88),
            (0, hall_y, fh + 92 + (bh - 88) / 2), mats["plaster"],
            bevel_width=3)
    flat_roof_z = fh + bh
    kit.box(collection, root, "BarracksLV2_RomanHall_FlatRoofDeck",
            (flat_roof_w, flat_roof_d, flat_roof_h),
            (0, hall_y, flat_roof_z + flat_roof_h / 2),
            mats["foundation"], bevel_width=4)
    parapet_z = flat_roof_z + flat_roof_h + 12
    kit.box(collection, root, "BarracksLV2_RomanHall_RearParapet",
            (flat_roof_w, 12, 24),
            (0, hall_y + flat_roof_d / 2 - 6, parapet_z),
            mats["stone"], bevel_width=2)
    for side_name, sign in (("Left", -1), ("Right", 1)):
        kit.box(collection, root, f"BarracksLV2_RomanHall_{side_name}Parapet",
                (12, flat_roof_d - 24, 24),
                (sign * (flat_roof_w / 2 - 6), hall_y, parapet_z),
                mats["stone"], bevel_width=2)

    # Twin flat-topped corner towers replace the previous generic pointed roofs.
    tower_x, tower_y = 155, -34
    tower_top = fh + th
    for side_name, sign in (("Left", -1), ("Right", 1)):
        x = sign * tower_x
        prefix = f"BarracksLV2_Roman{side_name}Tower"
        kit.box(collection, root, f"{prefix}_Shaft", (tw, td, th),
                (x, tower_y, fh + th / 2), mats["stone"], bevel_width=5)
        kit.box(collection, root, f"{prefix}_StonePlinth", (tw + 14, td + 14, 18),
                (x, tower_y, fh + 9), mats["foundation"], bevel_width=3)
        for band_index, band_z in enumerate((fh + 78, fh + 156, tower_top - 18)):
            kit.box(collection, root, f"{prefix}_CourseBand_{band_index}",
                    (tw + 12, td + 12, 11), (x, tower_y, band_z),
                    mats["foundation"], bevel_width=2)
        kit.box(collection, root, f"{prefix}_FrontArrowSlit", (13, 8, 54),
                (x, tower_y - td / 2 - 4, fh + 142), mats["glass"],
                bevel_width=5)
        kit.box(collection, root, f"{prefix}_ParapetDeck", (tw + 24, td + 24, 16),
                (x, tower_y, tower_top), mats["foundation"], bevel_width=3)

        merlon_z = tower_top + 23
        for index, dx in enumerate((-34, 0, 34)):
            add_merlon(f"{prefix}_FrontMerlon_{index}", x + dx,
                       tower_y - td / 2 - 7, merlon_z)
            add_merlon(f"{prefix}_RearMerlon_{index}", x + dx,
                       tower_y + td / 2 + 7, merlon_z)
        for edge_name, edge_x in (("Outer", x + sign * (tw / 2 + 7)),
                                  ("Inner", x - sign * (tw / 2 + 7))):
            add_merlon(f"{prefix}_{edge_name}SideMerlon", edge_x, tower_y,
                       merlon_z, size=(24, 28, 32))

        # One Roman scutum identifies each tower without adding loose weapons.
        shield_y = tower_y - td / 2 - 9
        kit.box(collection, root, f"{prefix}_CrimsonScutum", (46, 8, 64),
                (x, shield_y, fh + 92), roman_red, bevel_width=10)
        kit.box(collection, root, f"{prefix}_ScutumSpine", (8, 9, 54),
                (x, shield_y - 4, fh + 92), mats["brass"], bevel_width=2)
        kit.cylinder(collection, root, f"{prefix}_ScutumBoss", 9, 8,
                     (x, shield_y - 7, fh + 92), mats["brass"],
                     rotation=(90, 0, 0), vertices=20, bevel_width=1)

        add_legion_standard(f"{prefix}_LegionStandard", x,
                            tower_y + 10, tower_top + 8)

    # A connected front curtain and central arched gatehouse form one compact fort.
    curtain_y = -82
    gate_opening_w = 84
    wall_segment_w = (curtain_w - gate_opening_w) / 2
    for side_name, sign in (("Left", -1), ("Right", 1)):
        segment_x = sign * (gate_opening_w / 2 + wall_segment_w / 2)
        kit.box(collection, root, f"BarracksLV2_RomanCurtain_{side_name}Wall",
                (wall_segment_w, curtain_d, curtain_h),
                (segment_x, curtain_y, fh + curtain_h / 2), mats["stone"],
                bevel_width=4)
        for merlon_index, dx in enumerate((-48, 0, 48)):
            add_merlon(f"BarracksLV2_RomanCurtain_{side_name}Merlon_{merlon_index}",
                       segment_x + dx, curtain_y - 4,
                       fh + curtain_h + 18, size=(24, 25, 32))

    gate_front = curtain_y - gate_d / 2 - 4
    kit.box(collection, root, "BarracksLV2_RomanGatehouse_Body",
            (gate_w, gate_d, gate_h),
            (0, curtain_y, fh + gate_h / 2), mats["stone"], bevel_width=5)
    portal_core(collection, root, "BarracksLV2_RomanGatehouse_DarkPortal",
                42, fh + 2, fh + 74, 8, gate_front - 4, roman_red_dark)
    portal_arch_ring(collection, root, "BarracksLV2_RomanGatehouse_StoneArch",
                     55, 42, 12, fh + 74, gate_front - 6,
                     mats["foundation"], segments=28)
    for side_name, sign in (("Left", -1), ("Right", 1)):
        kit.box(collection, root, f"BarracksLV2_RomanGatehouse_{side_name}Jamb",
                (18, 18, 92), (sign * 49, gate_front - 5, fh + 47),
                mats["foundation"], bevel_width=3)
        kit.box(collection, root, f"BarracksLV2_RomanGatehouse_{side_name}Pilaster",
                (20, 18, 148), (sign * 66, gate_front - 2, fh + 74),
                mats["plaster"], bevel_width=3)
    kit.box(collection, root, "BarracksLV2_RomanGatehouse_WallWalk",
            (gate_w + 20, gate_d + 16, 16),
            (0, curtain_y, fh + gate_h), mats["foundation"], bevel_width=3)
    for merlon_index, x in enumerate((-64, -32, 0, 32, 64)):
        add_merlon(f"BarracksLV2_RomanGatehouse_FrontMerlon_{merlon_index}",
                   x, gate_front - 2, fh + gate_h + 22,
                   size=(22, 24, 32))

    kit.box(collection, root, "BarracksLV2_RomanGatehouse_GoldEaglePlaque",
            (42, 8, 30), (0, gate_front - 9, fh + 148),
            mats["brass"], bevel_width=10)
    kit.box(collection, root, "BarracksLV2_RomanGatehouse_PlaqueWingLeft",
            (28, 7, 9), (-26, gate_front - 10, fh + 148),
            mats["brass"], rotation=(0, 0, -15), bevel_width=3)
    kit.box(collection, root, "BarracksLV2_RomanGatehouse_PlaqueWingRight",
            (28, 7, 9), (26, gate_front - 10, fh + 148),
            mats["brass"], rotation=(0, 0, 15), bevel_width=3)
    kit.lantern(collection, root, "BarracksLV2_RomanGatehouse_LeftLantern",
                (-68, gate_front - 15, fh + 96), mats["iron"], mats["glow"])
    kit.lantern(collection, root, "BarracksLV2_RomanGatehouse_RightLantern",
                (68, gate_front - 15, fh + 96), mats["iron"], mats["glow"])
    return root


def build_hamster_barracks_lv3(spec):
    """Modern infantry field barracks: compact tent, lookout tower and kit zones."""
    collection, root, mats = common_context("hamster_barracks_lv3", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    tent_w, tent_d, tent_wall_h = dims["tentWall"]
    tent_roof_w, tent_roof_d, tent_roof_h = dims["tentRoof"]
    tower_w, tower_d, tower_h = dims["watchtower"]
    tower_roof_w, tower_roof_d, tower_roof_h = dims["watchtowerRoof"]

    concrete = kit.material(
        "MAT_BarracksLV3_FieldConcrete", kit.rgba((0.24, 0.25, 0.225, 1.0)),
        roughness=0.96, noise={"scale": 10, "detail": 3, "bump": 0.11})
    olive_canvas = kit.material(
        "MAT_BarracksLV3_OliveCanvas", kit.rgba((0.18, 0.215, 0.125, 1.0)),
        roughness=0.98, noise={"scale": 14, "detail": 4, "bump": 0.16})
    dark_canvas = kit.material(
        "MAT_BarracksLV3_DarkCanvas", kit.rgba((0.075, 0.105, 0.06, 1.0)),
        roughness=0.99, noise={"scale": 12, "detail": 3, "bump": 0.12})
    webbing = kit.material(
        "MAT_BarracksLV3_CanvasWebbing", kit.rgba((0.11, 0.125, 0.07, 1.0)),
        roughness=0.94)
    sandbag = kit.material(
        "MAT_BarracksLV3_Sandbag", kit.rgba((0.34, 0.31, 0.21, 1.0)),
        roughness=0.99, noise={"scale": 16, "detail": 4, "bump": 0.18})
    ammo_olive = kit.material(
        "MAT_BarracksLV3_AmmoOlive", kit.rgba((0.12, 0.145, 0.075, 1.0)),
        metallic=0.22, roughness=0.88,
        noise={"scale": 18, "detail": 3, "bump": 0.08})
    equipment_dark = kit.material(
        "MAT_BarracksLV3_EquipmentDark", kit.rgba((0.075, 0.082, 0.065, 1.0)),
        metallic=0.48, roughness=0.8)

    def add_ammo_crate(name, x, y, z, rotation=0):
        """One editable, closed military crate with structural bands and handles."""
        kit.box(collection, root, f"{name}_Body", (56, 38, 28),
                (x, y, z + 14), ammo_olive, rotation=(0, 0, rotation),
                bevel_width=3)
        kit.box(collection, root, f"{name}_Lid", (58, 40, 5),
                (x, y, z + 29), equipment_dark,
                rotation=(0, 0, rotation), bevel_width=1.5)
        for band_index, offset in enumerate((-18, 18)):
            kit.box(collection, root, f"{name}_Band_{band_index}", (5, 41, 32),
                    (x + offset, y, z + 15), equipment_dark,
                    rotation=(0, 0, rotation), bevel_width=1)
        kit.box(collection, root, f"{name}_Handle", (22, 6, 8),
                (x, y - 22, z + 17), equipment_dark,
                rotation=(0, 0, rotation), bevel_width=2)

    def add_jerry_can(name, x, y, rotation=0):
        """Compact fuel/water can used only as fixed barracks dressing."""
        kit.box(collection, root, f"{name}_Body", (24, 17, 38),
                (x, y, fh + 19), ammo_olive, rotation=(0, 0, rotation),
                bevel_width=4)
        kit.box(collection, root, f"{name}_TopHandle", (14, 7, 8),
                (x, y, fh + 42), equipment_dark,
                rotation=(0, 0, rotation), bevel_width=2)
        kit.cylinder(collection, root, f"{name}_Cap", 4, 7,
                     (x + 7, y, fh + 44), equipment_dark,
                     rotation=(90, 0, 0), vertices=16, bevel_width=1)

    kit.box(collection, root, "BarracksLV3_FieldFoundation", (fw, fd, fh),
            (0, 0, fh / 2), concrete, bevel_width=5)

    # One complete modern infantry tent is the dominant mass.
    tent_x, tent_y = -48, 34
    tent_front = tent_y - tent_d / 2 - 4
    kit.box(collection, root, "BarracksLV3_InfantryTent_LowCanvasWall",
            (tent_w, tent_d, tent_wall_h),
            (tent_x, tent_y, fh + tent_wall_h / 2), olive_canvas,
            bevel_width=4)
    kit.box(collection, root, "BarracksLV3_InfantryTent_ConcreteSkirt",
            (tent_w + 10, tent_d + 10, 18),
            (tent_x, tent_y, fh + 9), concrete, bevel_width=3)
    tent_roof_base = fh + tent_wall_h - 3
    kit.gabled_prism(collection, root, "BarracksLV3_InfantryTent_CanvasRoof",
                     tent_roof_w, tent_roof_d, tent_roof_h,
                     (tent_x, tent_y, tent_roof_base),
                     dark_canvas, olive_canvas)
    kit.box(collection, root, "BarracksLV3_InfantryTent_RidgeWebbing",
            (tent_roof_w + 8, 9, 9),
            (tent_x, tent_y, tent_roof_base + tent_roof_h + 2),
            webbing, bevel_width=2)

    # The open entrance and tied-back flaps are part of the authored Body Depth.
    kit.box(collection, root, "BarracksLV3_InfantryTent_DarkEntrance",
            (96, 8, 76), (tent_x, tent_front - 2, fh + 39),
            dark_canvas, bevel_width=5)
    for side_name, sign in (("Left", -1), ("Right", 1)):
        flap_x = tent_x + sign * 54
        kit.box(collection, root,
                f"BarracksLV3_InfantryTent_{side_name}TiedFlap",
                (42, 8, 82), (flap_x, tent_front - 8, fh + 43),
                olive_canvas, rotation=(0, 0, sign * 10), bevel_width=5)
        kit.box(collection, root,
                f"BarracksLV3_InfantryTent_{side_name}FlapTie",
                (12, 11, 9),
                (tent_x + sign * 70, tent_front - 13, fh + 41),
                webbing, bevel_width=3)
    for post_index, x in enumerate((tent_x - 63, tent_x + 63)):
        kit.box(collection, root, f"BarracksLV3_InfantryTent_EntrancePost_{post_index}",
                (10, 10, tent_wall_h + 18),
                (x, tent_front - 3, fh + (tent_wall_h + 18) / 2),
                mats["iron"], bevel_width=1.5)
    kit.box(collection, root, "BarracksLV3_InfantryTent_EntranceHeader",
            (136, 11, 10), (tent_x, tent_front - 3, fh + tent_wall_h + 12),
            mats["iron"], bevel_width=1.5)

    # Rolled canvas windows make the tent read as a present-day field barracks.
    for side_name, sign in (("Left", -1), ("Right", 1)):
        window_x = tent_x + sign * 92
        kit.box(collection, root,
                f"BarracksLV3_InfantryTent_{side_name}Window",
                (44, 7, 28), (window_x, tent_front - 6, fh + 44),
                mats["glass"], bevel_width=4)
        kit.cylinder(collection, root,
                     f"BarracksLV3_InfantryTent_{side_name}RolledWindowCover",
                     7, 48, (window_x, tent_front - 11, fh + 67),
                     dark_canvas, rotation=(0, 90, 0), vertices=20,
                     bevel_width=1.5)

    # A low sandbag breastwork stays beside the entrance without becoming a wall.
    for side_name, sign in (("Left", -1), ("Right", 1)):
        base_x = tent_x + sign * 108
        for row_index, z in enumerate((fh + 10, fh + 27)):
            count = 3 if row_index == 0 else 2
            for bag_index in range(count):
                offset = (bag_index - (count - 1) / 2) * 39
                kit.box(collection, root,
                        f"BarracksLV3_{side_name}Sandbag_R{row_index}_{bag_index}",
                        (43, 25, 17),
                        (base_x + sign * offset, tent_front - 24, z),
                        sandbag, rotation=(0, 0, sign * 3), bevel_width=8)

    # Exactly one open lookout tower touches the tent's right side.
    tower_x, tower_y = 160, 58
    post_inset_x, post_inset_y = tower_w * 0.34, tower_d * 0.34
    for x_sign, x_label in ((-1, "Left"), (1, "Right")):
        for y_sign, y_label in ((-1, "Front"), (1, "Rear")):
            px = tower_x + x_sign * post_inset_x
            py = tower_y + y_sign * post_inset_y
            kit.box(collection, root,
                    f"BarracksLV3_Watchtower_{x_label}{y_label}Post",
                    (14, 14, tower_h), (px, py, fh + tower_h / 2),
                    mats["iron"], bevel_width=2)
    brace_z = fh + tower_h * 0.46
    for face_name, y in (("Front", tower_y - post_inset_y),
                         ("Rear", tower_y + post_inset_y)):
        for brace_index, angle in enumerate((-34, 34)):
            kit.box(collection, root,
                    f"BarracksLV3_Watchtower_{face_name}Brace_{brace_index}",
                    (10, 10, tower_h * 0.72),
                    (tower_x, y, brace_z), mats["iron"],
                    rotation=(0, angle, 0), bevel_width=1.2)
    for face_name, x in (("Left", tower_x - post_inset_x),
                         ("Right", tower_x + post_inset_x)):
        for brace_index, angle in enumerate((-34, 34)):
            kit.box(collection, root,
                    f"BarracksLV3_Watchtower_{face_name}Brace_{brace_index}",
                    (10, 10, tower_h * 0.72),
                    (x, tower_y, brace_z), mats["iron"],
                    rotation=(angle, 0, 0), bevel_width=1.2)

    deck_z = fh + tower_h
    kit.box(collection, root, "BarracksLV3_Watchtower_Deck",
            (tower_w + 24, tower_d + 24, 16),
            (tower_x, tower_y, deck_z), concrete, bevel_width=4)
    rail_z = deck_z + 36
    for x_sign, x_label in ((-1, "Left"), (1, "Right")):
        for y_sign, y_label in ((-1, "Front"), (1, "Rear")):
            kit.box(collection, root,
                    f"BarracksLV3_Watchtower_RailPost_{x_label}{y_label}",
                    (9, 9, 58),
                    (tower_x + x_sign * (tower_w / 2 + 7),
                     tower_y + y_sign * (tower_d / 2 + 7), rail_z),
                    mats["iron"], bevel_width=1)
    for side_name, dx, dy, sx, sy in (
            ("Front", 0, -tower_d / 2 - 7, tower_w + 22, 8),
            ("Rear", 0, tower_d / 2 + 7, tower_w + 22, 8),
            ("Left", -tower_w / 2 - 7, 0, 8, tower_d + 22),
            ("Right", tower_w / 2 + 7, 0, 8, tower_d + 22)):
        for rail_index, dz in enumerate((16, 42)):
            kit.box(collection, root,
                    f"BarracksLV3_Watchtower_{side_name}Rail_{rail_index}",
                    (sx, sy, 7), (tower_x + dx, tower_y + dy, deck_z + dz),
                    mats["iron"], bevel_width=1)
    canopy_base = deck_z + 56
    kit.gabled_prism(collection, root, "BarracksLV3_Watchtower_CanvasCanopy",
                     tower_roof_w, tower_roof_d, tower_roof_h,
                     (tower_x, tower_y, canopy_base), dark_canvas, olive_canvas)
    kit.box(collection, root, "BarracksLV3_Watchtower_CanopyRidge",
            (tower_roof_w + 6, 8, 8),
            (tower_x, tower_y, canopy_base + tower_roof_h + 2),
            webbing, bevel_width=1.5)

    # Fixed ladder and short landing make the tower part of the same barracks.
    ladder_y = tower_y - tower_d / 2 - 13
    for side in (-1, 1):
        kit.box(collection, root, f"BarracksLV3_Watchtower_LadderRail_{side:+d}",
                (8, 8, tower_h - 18),
                (tower_x + side * 22, ladder_y, fh + (tower_h - 18) / 2),
                mats["iron"], bevel_width=1)
    for rung_index, z in enumerate(range(int(fh + 22), int(deck_z - 10), 22)):
        kit.box(collection, root, f"BarracksLV3_Watchtower_LadderRung_{rung_index}",
                (52, 9, 6), (tower_x, ladder_y - 1, z),
                mats["iron"], bevel_width=1)
    tent_right = tent_x + tent_w / 2
    tower_left = tower_x - tower_w / 2
    connector_w = max(24, tower_left - tent_right + 36)
    kit.box(collection, root, "BarracksLV3_TentTowerConnectorLanding",
            (connector_w, 68, 12),
            ((tent_right + tower_left) / 2, tower_y, fh + 66),
            mats["iron"], bevel_width=3)
    kit.lantern(collection, root, "BarracksLV3_EntranceLantern",
                (tent_x - 72, tent_front - 18, fh + 74),
                mats["iron"], mats["glow"])

    # Three deliberate equipment zones use the space released by the smaller tent.
    # They stay clear of the open entrance and the tower's fixed front ladder.
    add_ammo_crate("BarracksLV3_LeftAmmoStack_LowerA", -202, 92, fh, rotation=-4)
    add_ammo_crate("BarracksLV3_LeftAmmoStack_LowerB", -151, 99, fh, rotation=-4)
    add_ammo_crate("BarracksLV3_LeftAmmoStack_Upper", -177, 96, fh + 32,
                   rotation=-4)

    add_ammo_crate("BarracksLV3_RightSupplyCrate_A", 74, -145, fh, rotation=5)
    add_ammo_crate("BarracksLV3_RightSupplyCrate_B", 125, -139, fh, rotation=5)
    add_jerry_can("BarracksLV3_RightSupplyJerryCan_A", 73, -109, rotation=-4)
    add_jerry_can("BarracksLV3_RightSupplyJerryCan_B", 102, -108, rotation=4)

    kit.box(collection, root, "BarracksLV3_TowerService_FieldRadio",
            (44, 28, 46), (215, 15, fh + 23), ammo_olive,
            rotation=(0, 0, -5), bevel_width=3)
    kit.box(collection, root, "BarracksLV3_TowerService_RadioFace",
            (30, 5, 22), (215, -1, fh + 26), mats["glass"],
            rotation=(0, 0, -5), bevel_width=2)
    kit.cylinder(collection, root, "BarracksLV3_TowerService_CableSpoolLeft",
                 17, 7, (220, 51, fh + 19), equipment_dark,
                 rotation=(90, 0, 0), vertices=20, bevel_width=2)
    kit.cylinder(collection, root, "BarracksLV3_TowerService_CableSpoolRight",
                 17, 7, (220, 70, fh + 19), equipment_dark,
                 rotation=(90, 0, 0), vertices=20, bevel_width=2)
    kit.cylinder(collection, root, "BarracksLV3_TowerService_CableSpoolAxle",
                 6, 26, (220, 60, fh + 19), ammo_olive,
                 rotation=(90, 0, 0), vertices=16, bevel_width=1)
    return root


def build_explorer_camp(spec):
    collection, root, mats = common_context("explorer_camp", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    tw, td, th = dims["tower"]
    tower_roof_radius, tower_roof_height = dims["towerRoof"]
    archive_w, archive_d, archive_h = dims["archiveWing"]

    # A single connected 4x4 expedition headquarters: monumental command hall,
    # cartography archive, attached signal tower and covered supply court.
    kit.box(collection, root, "ExplorerCamp_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)

    hall_x, hall_y = 72, 50
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
    for index, x in enumerate((-rw * 0.34, -rw * 0.12, rw * 0.10, rw * 0.32)):
        kit.box(collection, root, f"ExplorerCamp_FrontRoofTie_{index}",
                (9, 14, 76), (hall_x + x, front_y - 15, roof_base + 37),
                mats["timber"], rotation=(45, 0, 0), bevel_width=1)

    entrance_x = hall_x - 88
    kit.double_doors(collection, root, "ExplorerCamp_CommandEntrance",
                     (entrance_x, front_y - 6, fh + 34), 104, 150,
                     mats["timber"], mats["iron"], open_angle=16)
    kit.box(collection, root, "ExplorerCamp_CommandWarmInterior", (82, 6, 128),
            (entrance_x, front_y + 2, fh + 108), mats["glow"], bevel_width=3)
    kit.shutter_window(collection, root, "ExplorerCamp_CommandWindow",
                       (hall_x + 112, front_y - 4, fh + 132),
                       mats["glass"], mats["timber"], mats["iron"], scale=0.96)
    kit.lantern(collection, root, "ExplorerCamp_EntranceLantern",
                (hall_x - 18, front_y - 18, fh + 132), mats["iron"], mats["glow"])

    # A raised chart room and signal cupola make the camp read as a major
    # plane landmark instead of a low temporary tent.
    cupola_base = roof_base + rh - 10
    kit.box(collection, root, "ExplorerCamp_CartographyCupolaBody",
            (166, 122, 84), (hall_x + 18, hall_y + 28, cupola_base + 42),
            mats["stone"], bevel_width=5)
    for side_name, x in (("Left", hall_x - 26), ("Right", hall_x + 62)):
        kit.box(collection, root, f"ExplorerCamp_CartographyCupolaWindow_{side_name}",
                (34, 7, 42), (x, hall_y - 36, cupola_base + 45),
                mats["glass"], bevel_width=6)
    cone(collection, root, "ExplorerCamp_CartographyCupolaRoof", 112, 92,
         (hall_x + 18, hall_y + 28, cupola_base + 84 + 44),
         mats["plaster"], vertices=4)
    kit.cylinder(collection, root, "ExplorerCamp_CartographyAstrolabe", 28, 10,
                 (hall_x + 18, hall_y - 39, cupola_base + 46), mats["brass"],
                 rotation=(90, 0, 0), vertices=36, bevel_width=2)

    # The archive wing overlaps the command hall and remains one connected
    # structure. Its buttresses and clerestory store expedition maps and relics.
    archive_x = hall_x + bw / 2 - 72
    archive_y = hall_y + bd / 2 - archive_d / 2 - 20
    kit.box(collection, root, "ExplorerCamp_ArchiveWing_ConnectedShell",
            (archive_w, archive_d, archive_h),
            (archive_x, archive_y, fh + archive_h / 2), mats["stone"], bevel_width=6)
    kit.gabled_prism(collection, root, "ExplorerCamp_ArchiveWing_Roof",
                     archive_w + 38, archive_d + 42, 92,
                     (archive_x, archive_y, fh + archive_h - 4),
                     mats["timber"], mats["roof"])
    for index, y in enumerate((archive_y - 58, archive_y + 8, archive_y + 72)):
        kit.shutter_window(collection, root, f"ExplorerCamp_ArchiveWindow_{index:02d}",
                           (archive_x + archive_w / 2 + 5, y, fh + 94),
                           mats["glass"], mats["timber"], mats["iron"],
                           orientation="side", scale=0.68)

    # The only lookout tower overlaps the hall's rear-left corner so it remains
    # one connected building and cannot be mistaken for a detached prop.
    tx, ty = -fw * 0.31, fd * 0.18
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
    rail_z = deck_z + 24
    for side_name, dx, dy, sx, sy in (
            ("Front", 0, -td / 2 - 10, tw + 28, 8),
            ("Back", 0, td / 2 + 10, tw + 28, 8),
            ("Left", -tw / 2 - 10, 0, 8, td + 28),
            ("Right", tw / 2 + 10, 0, 8, td + 28)):
        kit.box(collection, root, f"ExplorerCamp_LookoutBalustrade_{side_name}",
                (sx, sy, 18), (tx + dx, ty + dy, rail_z), mats["timber"],
                bevel_width=2)
    mast_base_z = deck_z + 62 + tower_roof_height + 18
    kit.cylinder(collection, root, "ExplorerCamp_SignalMast", 6, 118,
                 (tx, ty, mast_base_z + 59), mats["iron"], vertices=20,
                 bevel_width=1)
    for index, z in enumerate((mast_base_z + 36, mast_base_z + 70, mast_base_z + 104)):
        kit.box(collection, root, f"ExplorerCamp_SignalPennant_{index:02d}",
                (58 - index * 8, 5, 18),
                (tx + 26 - index * 3, ty, z), mats["brass"], bevel_width=2)
    # Fixed ladder and short connector bind the open tower into the command hall.
    ladder_y = ty - td / 2 - 8
    for x in (-13, 13):
        kit.box(collection, root, f"ExplorerCamp_LadderRail_{x:+d}", (7, 8, 154),
                (tx + x, ladder_y, fh + 104), mats["timber"], bevel_width=1)
    for index, z in enumerate(range(48, 180, 22)):
        kit.box(collection, root, f"ExplorerCamp_LadderRung_{index}", (32, 9, 5),
                (tx, ladder_y - 1, fh + z), mats["timber"], bevel_width=1)
    connector_left = tx + tw / 2 - 10
    connector_right = hall_x - bw / 2 + 28
    connector_w = abs(connector_right - connector_left) + 24
    kit.box(collection, root, "ExplorerCamp_TowerConnector", (connector_w, 118, 92),
            ((connector_left + connector_right) / 2, ty - 8, fh + 72),
            mats["timber"], bevel_width=4)

    # One attached supply awning keeps the silhouette practical without adding
    # a second tent. Crates and map cases sit under and touch the structure.
    awning_x, awning_y = fw * 0.31, -fd * 0.23
    kit.box(collection, root, "ExplorerCamp_SupplyAwningRoof", (196, 226, 14),
            (awning_x, awning_y, fh + 132), mats["plaster"],
            rotation=(8, 0, 0), bevel_width=3)
    for x in (awning_x - 74, awning_x + 74):
        kit.box(collection, root, f"ExplorerCamp_AwningPost_{x}", (12, 12, 126),
                (x, awning_y - 88, fh + 63), mats["timber"], bevel_width=2)
    kit.box(collection, root, "ExplorerCamp_SupplyLocker_Left", (48, 54, 58),
            (awning_x - 42, awning_y - 70, fh + 29), mats["timber"], bevel_width=4)
    kit.box(collection, root, "ExplorerCamp_SupplyLocker_Right", (48, 54, 76),
            (awning_x + 18, awning_y - 70, fh + 38), mats["timber"], bevel_width=4)
    for index, x in enumerate((awning_x - 42, awning_x + 18)):
        kit.box(collection, root, f"ExplorerCamp_SupplyLockerBand_{index}", (52, 5, 10),
                (x, awning_y - 99, fh + 30), mats["iron"], bevel_width=1)

    # Monumental expedition portal: two attached pylons, a heavy lintel and a
    # no-text compass crest. It frames the sole command entrance.
    for side_name, x in (("Left", entrance_x - 92), ("Right", entrance_x + 92)):
        kit.box(collection, root, f"ExplorerCamp_ExpeditionGatePylon_{side_name}",
                (34, 38, 178), (x, front_y - 28, fh + 89), mats["stone"],
                bevel_width=5)
    kit.box(collection, root, "ExplorerCamp_ExpeditionGateLintel",
            (222, 42, 28), (entrance_x, front_y - 28, fh + 174),
            mats["timber"], bevel_width=4)
    kit.cylinder(collection, root, "ExplorerCamp_ExpeditionCompassCrest", 34, 12,
                 (entrance_x, front_y - 52, fh + 174), mats["brass"],
                 rotation=(90, 0, 0), vertices=40, bevel_width=2)

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


def build_mine_cave(spec):
    """Compact one-cell cave entrance built from editable rock and timber parts."""
    collection, root, mats = common_context("mine_cave", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    opening_radius = float(dims["openingRadius"])
    spring_z = float(dims["openingSpringZ"])
    arch_outer = float(dims["archOuterRadius"])
    timber_width = float(dims["timberWidth"])
    timber_height = float(dims["timberHeight"])

    # The thin diamond-shaped bed is visual grounding only. Runtime collision
    # remains the standard 1x1 grid footprint and never follows these pixels.
    kit.box(collection, root, "MineCave_RockBed", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)

    # Recessed arched opening: a dark full portal with a smaller green depth
    # glow. Both surfaces sit behind the stone/timber face toward +Y.
    portal_core(collection, root, "MineCave_DarkInterior", opening_radius,
                fh, spring_z, 10, -72, mats["iron"], segments=40)
    # A restrained point glow sits deep in the tunnel; the runtime smoke
    # supplies the larger green atmospheric motion without flattening the hole.
    kit.faceted_crystal_prism(collection, root, "MineCave_InnerGreenShard_A",
                              24, 7, (8, -77, fh + 2), mats["glass"],
                              highlight_mat=mats["glow"], lean=(2, 1), sides=5,
                              depth_scale=0.72, rotation_z=18)
    kit.faceted_crystal_prism(collection, root, "MineCave_InnerGreenShard_B",
                              16, 5, (24, -76, fh + 2), mats["glass"],
                              highlight_mat=mats["glow"], lean=(-1, 1), sides=5,
                              depth_scale=0.72, rotation_z=-12)
    portal_arch_ring(collection, root, "MineCave_StoneArch", arch_outer,
                     opening_radius, 24, spring_z, -88, mats["stone"], segments=36)
    for side in (-1, 1):
        kit.box(collection, root, f"MineCave_StoneJamb_{side:+d}",
                (arch_outer - opening_radius + 18, 26, spring_z - fh),
                (side * (opening_radius + (arch_outer - opening_radius) / 2),
                 -88, fh + (spring_z - fh) / 2), mats["stone"], bevel_width=4)

    # Irregular rock mass forms one connected mound without a square building
    # shell. Keep every boulder independent for later silhouette adjustment.
    boulders = (
        ("RearLeft", (118, 104, 116), (-70, 28, 64), (8, 14, -18)),
        ("RearCenter", (142, 112, 128), (2, 42, 73), (-7, -8, 5)),
        ("RearRight", (112, 100, 110), (74, 28, 61), (11, 4, 20)),
        ("LeftShoulder", (80, 92, 92), (-84, -32, 49), (-5, 15, -8)),
        ("RightShoulder", (82, 94, 88), (86, -30, 47), (7, -12, 14)),
        ("CrownLeft", (82, 78, 68), (-37, 9, 119), (18, -6, 7)),
        ("CrownRight", (88, 82, 72), (35, 12, 121), (-12, 10, -11)),
    )
    for name, size, location, rotation in boulders:
        kit.rough_boulder(collection, root, "MineCave_Boulder_" + name,
                          size, location, mats["stone"], rotation=rotation, subdivisions=2)

    # Heavy timber support sits in front of the rock arch. The small side
    # braces and iron straps read clearly at game scale without text/signage.
    post_x = timber_width / 2
    for side in (-1, 1):
        x = side * post_x
        kit.box(collection, root, f"MineCave_TimberPost_{side:+d}",
                (18, 22, timber_height), (x, -108, fh + timber_height / 2),
                mats["timber"], rotation=(0, side * 3, side * 2), bevel_width=3)
        kit.box(collection, root, f"MineCave_TimberFoot_{side:+d}",
                (34, 38, 14), (x, -108, fh + 7), mats["timber"], bevel_width=3)
        kit.box(collection, root, f"MineCave_TimberBrace_{side:+d}",
                (48, 14, 13), (side * (post_x + 15), -110, fh + 52),
                mats["timber"], rotation=(0, -side * 47, 0), bevel_width=2)
        kit.box(collection, root, f"MineCave_IronPostBand_{side:+d}",
                (23, 27, 10), (x, -108, fh + 60), mats["brass"], bevel_width=1)
    kit.box(collection, root, "MineCave_TimberHeader", (timber_width + 34, 25, 24),
            (0, -108, fh + timber_height - 7), mats["timber"],
            rotation=(0, 0, -1.5), bevel_width=4)
    kit.box(collection, root, "MineCave_IronHeaderBand_Left", (11, 29, 30),
            (-43, -108, fh + timber_height - 7), mats["brass"], bevel_width=1)
    kit.box(collection, root, "MineCave_IronHeaderBand_Right", (11, 29, 30),
            (43, -108, fh + timber_height - 7), mats["brass"], bevel_width=1)

    # Two rails and five sleepers lead into the opening while staying inside
    # the modeled bed; they establish depth direction and the 30-degree view.
    for side in (-1, 1):
        kit.box(collection, root, f"MineCave_Rail_{side:+d}",
                (7, 138, 7), (side * 20, -48, fh + 8), mats["brass"], bevel_width=1)
    for index, y in enumerate((-102, -74, -46, -18, 10)):
        kit.box(collection, root, f"MineCave_Sleeper_{index}",
                (70, 12, 8), (0, y, fh + 5), mats["timber"], bevel_width=1)

    # A few attached rubble pieces break the foundation edge without creating
    # a second disconnected prop cluster.
    rubble = ((-94, -70, 17, 34), (92, -62, 15, 29), (-73, 54, 13, 26), (70, 60, 14, 28))
    for index, (x, y, z, size) in enumerate(rubble):
        kit.rough_boulder(collection, root, f"MineCave_Rubble_{index}",
                          (size, size * 0.75, size * 0.55), (x, y, z),
                          mats["foundation"], rotation=(index * 11, 7, index * 23),
                          subdivisions=1)
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


def build_royal_mint(spec):
    """Fortified 2x2 mint hall with one treasury tower and attached coin press."""
    collection, root, mats = common_context("royal_mint", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    vw, vd, vh = dims["lowerVault"]
    uw, ud, uh = dims["upperHall"]
    rw, rd, rh = dims["roof"]
    tw, td, th = dims["fiscalTower"]
    trw, trd, trh = dims["towerRoof"]

    # One connected official mint: the heavy lower vault supports the treasury
    # floor and the single fiscal tower; no detached workshop or palace wings.
    kit.box(collection, root, "RoyalMint_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=4)
    hall_y = 22
    kit.box(collection, root, "RoyalMint_LowerVault", (vw, vd, vh),
            (0, hall_y, fh + vh / 2), mats["stone"], bevel_width=6)
    kit.box(collection, root, "RoyalMint_VaultCourse", (vw + 14, vd + 14, 16),
            (0, hall_y, fh + vh - 12), mats["foundation"], bevel_width=3)
    kit.box(collection, root, "RoyalMint_UpperTreasuryHall", (uw, ud, uh),
            (0, hall_y, fh + vh + uh / 2 - 4), mats["plaster"], bevel_width=4)

    upper_base = fh + vh - 4
    front_y = hall_y - ud / 2 - 4
    side_x = -uw / 2 - 4
    kit.half_timber_facade(collection, root, "RoyalMint_FrontTreasuryTimber",
                           uw, uh, front_y, upper_base, mats["timber"], bays=4)
    kit.half_timber_side(collection, root, "RoyalMint_SideTreasuryTimber",
                         ud, uh, side_x, upper_base, mats["timber"], bays=3)

    roof_base = fh + vh + uh - 9
    hipped_roof(collection, root, "RoyalMint_MainHippedRoof", rw, rd, rh,
                (0, hall_y, roof_base), mats["roof"])
    kit.box(collection, root, "RoyalMint_MainRoofRidge",
            (rw * 0.42 + 18, 14, 14),
            (0, hall_y, roof_base + rh - 1), mats["timber"], bevel_width=3)

    # Exactly one fiscal tower grows through the rear shoulder of the roof.
    tower_x, tower_y = 42, 66
    tower_base = roof_base + 30
    kit.box(collection, root, "RoyalMint_FiscalTower", (tw, td, th),
            (tower_x, tower_y, tower_base + th / 2), mats["stone"], bevel_width=5)
    for z_offset in (20, 78, 136):
        kit.box(collection, root, f"RoyalMint_FiscalTowerCourse_{z_offset}",
                (tw + 12, td + 12, 10),
                (tower_x, tower_y, tower_base + z_offset), mats["brass"],
                bevel_width=2)
    for orientation, location in (
            ("front", (tower_x, tower_y - td / 2 - 4, tower_base + 88)),
            ("side", (tower_x - tw / 2 - 4, tower_y, tower_base + 88))):
        kit.shutter_window(collection, root,
                           f"RoyalMint_FiscalTowerWindow_{orientation}",
                           location, mats["glass"], mats["timber"], mats["iron"],
                           orientation=orientation, scale=0.74)
    research_pyramid_roof(collection, root, "RoyalMint_FiscalTowerRoof",
                          trw, trd, trh,
                          (tower_x, tower_y, tower_base + th - 4), mats["roof"])
    kit.cylinder(collection, root, "RoyalMint_TowerFinial", 7, 34,
                 (tower_x, tower_y, tower_base + th + trh + 13), mats["brass"],
                 vertices=12, bevel_width=1)

    # Front vault entrance and official coin seal stay attached to the main hall.
    door_x = -66
    vault_front_y = hall_y - vd / 2 - 5
    kit.double_doors(collection, root, "RoyalMint_MainVaultDoor",
                     (door_x, vault_front_y, fh), 78, 118,
                     mats["timber"], mats["iron"], open_angle=0)
    kit.box(collection, root, "RoyalMint_VaultDoorFrameTop", (106, 22, 18),
            (door_x, vault_front_y - 2, fh + 126), mats["foundation"],
            bevel_width=3)
    for index, x in enumerate((door_x - 49, door_x + 49)):
        kit.box(collection, root, f"RoyalMint_VaultDoorJamb_{index}",
                (18, 22, 130), (x, vault_front_y - 2, fh + 65),
                mats["foundation"], bevel_width=3)

    seal_x = 72
    seal_z = fh + vh + 48
    kit.box(collection, root, "RoyalMint_CoinSealBackplate", (92, 14, 88),
            (seal_x, front_y - 14, seal_z), mats["timber"], bevel_width=7)
    kit.cylinder(collection, root, "RoyalMint_CoinSeal", 34, 12,
                 (seal_x, front_y - 25, seal_z), mats["brass"],
                 rotation=(90, 0, 0), vertices=40, bevel_width=2)
    kit.cylinder(collection, root, "RoyalMint_CoinSealInset", 23, 14,
                 (seal_x, front_y - 29, seal_z), mats["foundation"],
                 rotation=(90, 0, 0), vertices=40, bevel_width=1)
    for index, x in enumerate((-11, 0, 11)):
        height = 19 if index == 1 else 13
        kit.box(collection, root, f"RoyalMint_CoinSealCrown_{index}",
                (9, 5, height), (seal_x + x, front_y - 37, seal_z + 9),
                mats["brass"], rotation=(0, 0, -x * 0.7), bevel_width=2)

    kit.shutter_window(collection, root, "RoyalMint_FrontTreasuryWindow",
                       (-2, front_y - 2, fh + vh + 58),
                       mats["glass"], mats["timber"], mats["iron"], scale=0.9)

    # The side press is a wall-bolted machine, not a detached workshop.
    press_y = 24
    press_z = fh + 72
    kit.box(collection, root, "RoyalMint_PressHousing", (54, 142, 138),
            (side_x - 20, press_y, press_z), mats["iron"], bevel_width=5)
    kit.box(collection, root, "RoyalMint_PressInnerGlow", (12, 72, 58),
            (side_x - 50, press_y, press_z - 6), mats["glow"], bevel_width=4)
    kit.box(collection, root, "RoyalMint_PressPiston", (22, 22, 98),
            (side_x - 58, press_y, press_z + 8), mats["brass"], bevel_width=3)
    kit.box(collection, root, "RoyalMint_PressDieTable", (68, 112, 16),
            (side_x - 58, press_y, press_z - 52), mats["brass"], bevel_width=3)
    kit.gear(collection, root, "RoyalMint_PressFlywheel", 46,
             (side_x - 61, press_y + 48, press_z + 18), mats["brass"],
             axis="X", teeth=14)
    kit.gear(collection, root, "RoyalMint_PressDriveGear", 26,
             (side_x - 63, press_y - 47, press_z - 2), mats["iron"],
             axis="X", teeth=12)
    for index, y in enumerate((press_y - 62, press_y + 62)):
        kit.box(collection, root, f"RoyalMint_PressWallBrace_{index}",
                (72, 14, 22), (side_x - 29, y, press_z + 54),
                mats["foundation"], bevel_width=2)

    # One squat furnace chimney marks energy-driven production without turning
    # the official mint into a blacksmith shop.
    kit.chimney(collection, root, "RoyalMint_FurnaceChimney",
                (-102, 78, roof_base + 44), mats["stone"], mats["iron"],
                height=118)
    kit.lantern(collection, root, "RoyalMint_EntranceLantern",
                (4, vault_front_y - 18, fh + 92), mats["iron"], mats["glow"])
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


def build_steam_power_plant(spec):
    """Integrated biomass steam plant with two fuel stations and visible machinery."""
    collection, root, mats = common_context("steam_power_plant", spec)
    dims = spec["dimensions"]
    g = standard_shell(collection, root, mats, dims, bays=3)
    boiler_radius = float(dims.get("boilerRadius", 47))
    boiler_length = float(dims.get("boilerLength", 164))
    station_count = max(1, int(dims.get("workerStations", 2)))
    boiler_x = g["sideX"] - boiler_radius * 0.42
    boiler_y = 38
    boiler_z = g["fh"] + boiler_radius + 13

    fire_color = kit.rgba((0.95, 0.16, 0.018, 1.0))
    fire = kit.material("MAT_SteamPlant_FurnaceGlow", fire_color,
                        roughness=0.24, emission=(fire_color, 1.8))
    energy_color = kit.rgba((0.025, 0.34, 0.62, 1.0))
    energy = kit.material("MAT_SteamPlant_StoredEnergy", energy_color,
                          roughness=0.20, emission=(energy_color, 0.82))

    # One real entrance keeps the facade readable as a workplace.  The pair of
    # fuel stations below encode the initial two-boiler-worker staffing contract.
    kit.double_doors(collection, root, "SteamPlant_MainDoor",
                     (90, g["frontY"] - 5, g["fh"]), 62, 106,
                     mats["timber"], mats["iron"], open_angle=0)
    kit.box(collection, root, "SteamPlant_MainDoorLintel", (84, 16, 14),
            (90, g["frontY"] - 4, g["fh"] + 111), mats["stone"],
            bevel_width=2)

    station_xs = tuple(-116 + index * 66 for index in range(station_count))
    for index, station_x in enumerate(station_xs, start=1):
        station_name = f"SteamPlant_BoilerWorkerStation_{index:02d}"
        bpy.ops.mesh.primitive_cone_add(
            vertices=4, radius1=30, radius2=22, depth=44,
            location=(station_x, g["frontY"] - 40, g["fh"] + 49),
            rotation=(0, 0, math.radians(45)))
        hopper = bpy.context.object
        hopper.name = station_name + "_FuelHopper"
        hopper.parent = root
        hopper.data.materials.append(mats["iron"])
        kit.bevel(hopper, 1.2, 2)
        kit.move_to_collection(hopper, collection)
        kit.box(collection, root, station_name + "_TopRim", (48, 48, 7),
                (station_x, g["frontY"] - 40, g["fh"] + 72), mats["brass"],
                rotation=(0, 0, 45), bevel_width=1)
        for leg_offset in (-13, 13):
            kit.box(collection, root,
                    station_name + f"_SupportLeg_{leg_offset:+d}",
                    (7, 7, 39),
                    (station_x + leg_offset, g["frontY"] - 31,
                     g["fh"] + 18), mats["iron"], bevel_width=1)
        chute = kit.box(collection, root, station_name + "_FeedChute",
                        (28, 68, 24),
                        (station_x, g["frontY"] - 7, g["fh"] + 35),
                        mats["iron"], rotation=(-17, 0, 0), bevel_width=2)
        chute.parent = root

    # The horizontal riveted boiler overlaps the visible side wall and remains
    # a component of the same building rather than a detached prop.
    kit.cylinder(collection, root, "SteamPlant_HorizontalBoiler_Shell",
                 boiler_radius, boiler_length, (boiler_x, boiler_y, boiler_z),
                 mats["iron"], rotation=(90, 0, 0), vertices=48, bevel_width=2)
    for label, y in (("Front", boiler_y - boiler_length / 2 - 2),
                     ("Rear", boiler_y + boiler_length / 2 + 2)):
        kit.cylinder(collection, root, f"SteamPlant_HorizontalBoiler_{label}Cap",
                     boiler_radius + 3, 10, (boiler_x, y, boiler_z),
                     mats["brass"], rotation=(90, 0, 0), vertices=48,
                     bevel_width=1.5)
    for index, y in enumerate((boiler_y - 50, boiler_y, boiler_y + 50)):
        kit.cylinder(collection, root, f"SteamPlant_BoilerBand_{index}",
                     boiler_radius + 5, 8, (boiler_x, y, boiler_z),
                     mats["brass"], rotation=(90, 0, 0), vertices=48,
                     bevel_width=1)
    for index, y in enumerate((boiler_y - 51, boiler_y + 51)):
        kit.box(collection, root, f"SteamPlant_BoilerCradle_{index}",
                (boiler_radius * 1.36, 22, 34),
                (boiler_x, y, g["fh"] + 17), mats["stone"], bevel_width=4)

    furnace_y = boiler_y - boiler_length / 2 - 9
    kit.cylinder(collection, root, "SteamPlant_FurnaceDoor_Frame",
                 boiler_radius * 0.56, 8, (boiler_x, furnace_y, boiler_z),
                 mats["brass"], rotation=(90, 0, 0), vertices=32,
                 bevel_width=1)
    kit.cylinder(collection, root, "SteamPlant_FurnaceDoor_Glow",
                 boiler_radius * 0.40, 11, (boiler_x, furnace_y - 5, boiler_z),
                 fire, rotation=(90, 0, 0), vertices=32, bevel_width=1)
    kit.cylinder(collection, root, "SteamPlant_FurnaceDoor_Hub", 6, 16,
                 (boiler_x, furnace_y - 12, boiler_z), mats["iron"],
                 rotation=(90, 0, 0), vertices=20, bevel_width=1)

    # Large exposed turbine gear, pressure gauge and pipe run make the function
    # readable at game scale without labels or a second detached workshop.
    turbine_x = g["sideX"] - 15
    turbine_y = -66
    turbine_z = g["fh"] + 88
    kit.gear(collection, root, "SteamPlant_TurbineFlywheel", 49,
             (turbine_x, turbine_y, turbine_z), mats["brass"], axis="X", teeth=16)
    kit.cylinder(collection, root, "SteamPlant_TurbineAxle", 8, 52,
                 (turbine_x + 2, turbine_y, turbine_z), mats["iron"],
                 rotation=(0, 90, 0), vertices=24, bevel_width=1)

    gauge_x = g["sideX"] - 8
    kit.cylinder(collection, root, "SteamPlant_PressureGauge_Frame", 22, 9,
                 (gauge_x, 8, g["fh"] + 151), mats["brass"],
                 rotation=(0, 90, 0), vertices=32, bevel_width=1)
    kit.cylinder(collection, root, "SteamPlant_PressureGauge_Face", 17, 12,
                 (gauge_x - 5, 8, g["fh"] + 151), mats["plaster"],
                 rotation=(0, 90, 0), vertices=32, bevel_width=1)
    kit.box(collection, root, "SteamPlant_PressureGauge_Needle", (5, 4, 15),
            (gauge_x - 12, 8, g["fh"] + 157), mats["iron"],
            rotation=(0, 0, -28), bevel_width=0.5)

    pipe_x = boiler_x + 12
    kit.cylinder(collection, root, "SteamPlant_MainSteamPipe_Vertical", 9, 116,
                 (pipe_x, boiler_y + 38, boiler_z + 94), mats["brass"],
                 vertices=24, bevel_width=1)
    kit.cylinder(collection, root, "SteamPlant_MainSteamPipe_Header", 9, 112,
                 (pipe_x + 48, boiler_y + 38, boiler_z + 152), mats["brass"],
                 rotation=(0, 90, 0), vertices=24, bevel_width=1)
    for index, z in enumerate((boiler_z + 54, boiler_z + 120)):
        kit.cylinder(collection, root, f"SteamPlant_SteamPipeCollar_{index}",
                     13, 7, (pipe_x, boiler_y + 38, z), mats["iron"],
                     vertices=24, bevel_width=1)

    # A small fixed energy buffer communicates the food-to-energy output.  It
    # stays attached to the facade and never becomes a separate storage building.
    buffer_x = 148
    buffer_y = g["frontY"] - 31
    buffer_z = g["fh"] + 49
    kit.cylinder(collection, root, "SteamPlant_EnergyBuffer_Core", 23, 66,
                 (buffer_x, buffer_y, buffer_z), energy, vertices=32,
                 bevel_width=2)
    for index, z in enumerate((buffer_z - 29, buffer_z + 29)):
        kit.cylinder(collection, root, f"SteamPlant_EnergyBuffer_Cap_{index}",
                     28, 8, (buffer_x, buffer_y, z), mats["brass"],
                     vertices=32, bevel_width=1)

    kit.chimney(collection, root, "SteamPlant_MainChimney",
                (98, 52, g["roofBase"] + 38), mats["stone"], mats["iron"],
                height=168)
    kit.lantern(collection, root, "SteamPlant_EntranceLantern",
                (51, g["frontY"] - 16, g["fh"] + 92), mats["iron"],
                mats["glow"])
    return root


def build_wind_power_plant(spec):
    """One connected 4x4 wind power station with a three-blade main rotor."""
    collection, root, mats = common_context("wind_power_plant", spec)
    dims = spec["dimensions"]
    fw, fd, fh = (float(value) for value in dims["foundation"])
    hall_w, hall_d, hall_h = (float(value) for value in dims["generatorHall"])
    roof_w, roof_d, roof_h = (float(value) for value in dims["generatorRoof"])
    tower_w, tower_d, tower_base_h = (
        float(value) for value in dims["towerBase"])
    tower_span_x, tower_span_y = (
        float(value) for value in dims["towerSpan"])
    hub_z = float(dims["hubZ"])
    rotor_radius = float(dims["rotorRadius"])
    hall_y = float(dims.get("hallY", 96))
    buffer_offset_x = float(dims.get("bufferOffsetX", hall_w / 2 + 26))

    energy_color = kit.rgba((0.025, 0.44, 0.66, 1.0))
    energy = kit.material(
        "MAT_WindPower_StoredEnergy", energy_color,
        roughness=0.18, emission=(energy_color, 0.95))

    # The complete 4x4 foundation is the ground-contract reference.  The low
    # inset plinth and every tower foot remain attached to the same station.
    kit.box(collection, root, "WindPowerPlant_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=6)
    kit.box(collection, root, "WindPowerPlant_InsetPlinth",
            (fw - 48, fd - 48, 18), (0, 0, fh + 9),
            mats["stone"], bevel_width=5)

    hall_base_z = fh + 18
    lower_h = hall_h * 0.58
    upper_h = hall_h - lower_h
    kit.box(collection, root, "WindPowerPlant_GeneratorHall_LowerStone",
            (hall_w, hall_d, lower_h),
            (0, hall_y, hall_base_z + lower_h / 2),
            mats["stone"], bevel_width=5)
    kit.box(collection, root, "WindPowerPlant_GeneratorHall_UpperPlaster",
            (hall_w - 12, hall_d - 12, upper_h),
            (0, hall_y, hall_base_z + lower_h + upper_h / 2),
            mats["plaster"], bevel_width=4)
    hall_front_y = hall_y - hall_d / 2 - 4
    hall_side_x = -hall_w / 2 - 4
    kit.half_timber_facade(
        collection, root, "WindPowerPlant_GeneratorHall_FrontTimber",
        hall_w - 12, upper_h, hall_front_y,
        hall_base_z + lower_h, mats["timber"], bays=4)
    kit.half_timber_side(
        collection, root, "WindPowerPlant_GeneratorHall_SideTimber",
        hall_d - 12, upper_h, hall_side_x,
        hall_base_z + lower_h, mats["timber"], bays=3)
    roof_base_z = hall_base_z + hall_h - 3
    kit.gabled_prism(
        collection, root, "WindPowerPlant_GeneratorHall_Roof",
        roof_w, roof_d, roof_h, (0, hall_y, roof_base_z),
        mats["timber"], mats["roof"])
    kit.roof_rows(
        collection, root, "WindPowerPlant_GeneratorHall_RoofCourse",
        roof_w, roof_d, roof_h, roof_base_z, mats["roof"], rows=11)

    # One real service entrance and two restrained windows keep the hall a
    # readable workplace without turning the power station into a windmill.
    kit.double_doors(
        collection, root, "WindPowerPlant_MainServiceDoor",
        (112, hall_front_y - 5, hall_base_z), 76, 112,
        mats["timber"], mats["iron"], open_angle=0)
    kit.shutter_window(
        collection, root, "WindPowerPlant_FrontGeneratorWindow",
        (-92, hall_front_y - 3, hall_base_z + 116),
        mats["glass"], mats["timber"], mats["iron"], scale=0.74)
    kit.shutter_window(
        collection, root, "WindPowerPlant_SideGeneratorWindow",
        (hall_side_x - 2, hall_y + 34, hall_base_z + 116),
        mats["glass"], mats["timber"], mats["iron"],
        orientation="side", scale=0.70)

    # A reinforced stone transmission base rises through the hall.  Above it,
    # four blackened-iron legs and explicit cross braces support one nacelle.
    tower_y = hall_y + 12
    kit.box(collection, root, "WindPowerPlant_Tower_StoneBase",
            (tower_w, tower_d, tower_base_h),
            (0, tower_y, hall_base_z + tower_base_h / 2),
            mats["stone"], bevel_width=6)
    for side_x in (-1, 1):
        kit.box(
            collection, root,
            f"WindPowerPlant_Tower_Foot_{'L' if side_x < 0 else 'R'}",
            (76, tower_d + 36, 34),
            (side_x * (tower_w / 2 + 20), tower_y, hall_base_z + 17),
            mats["foundation"], bevel_width=5)

    lattice_base_z = hall_base_z + tower_base_h - 8
    lattice_top_z = hub_z - 42
    lattice_center_z = (lattice_base_z + lattice_top_z) / 2
    post_height = lattice_top_z - lattice_base_z
    post_positions = []
    for side_x in (-1, 1):
        for side_y in (-1, 1):
            x = side_x * tower_span_x / 2
            y = tower_y + side_y * tower_span_y / 2
            post_positions.append((side_x, side_y, x, y))
            kit.box(
                collection, root,
                f"WindPowerPlant_TowerPost_{side_x:+d}_{side_y:+d}",
                (18, 18, post_height), (x, y, lattice_center_z),
                mats["iron"], bevel_width=2)
    brace_levels = 3
    brace_step = post_height / brace_levels
    for level in range(brace_levels):
        z0 = lattice_base_z + level * brace_step + 8
        z1 = lattice_base_z + (level + 1) * brace_step - 8
        for face_y, face_label in (
                (tower_y - tower_span_y / 2, "Front"),
                (tower_y + tower_span_y / 2, "Back")):
            research_diagonal_beam(
                collection, root,
                f"WindPowerPlant_TowerBrace_{face_label}_{level}_A",
                (-tower_span_x / 2, face_y, z0),
                (tower_span_x / 2, face_y, z1), 10, 10, mats["iron"])
            research_diagonal_beam(
                collection, root,
                f"WindPowerPlant_TowerBrace_{face_label}_{level}_B",
                (tower_span_x / 2, face_y, z0),
                (-tower_span_x / 2, face_y, z1), 10, 10, mats["iron"])
        for face_x, face_label in (
                (-tower_span_x / 2, "Left"),
                (tower_span_x / 2, "Right")):
            research_diagonal_beam(
                collection, root,
                f"WindPowerPlant_TowerBrace_{face_label}_{level}_A",
                (face_x, tower_y - tower_span_y / 2, z0),
                (face_x, tower_y + tower_span_y / 2, z1), 10, 10,
                mats["iron"])
            research_diagonal_beam(
                collection, root,
                f"WindPowerPlant_TowerBrace_{face_label}_{level}_B",
                (face_x, tower_y + tower_span_y / 2, z0),
                (face_x, tower_y - tower_span_y / 2, z1), 10, 10,
                mats["iron"])

    nacelle_y = tower_y - 24
    kit.box(collection, root, "WindPowerPlant_Nacelle_MainHousing",
            (156, 132, 72), (0, nacelle_y, hub_z),
            mats["iron"], bevel_width=12)
    kit.box(collection, root, "WindPowerPlant_Nacelle_BrassBand",
            (168, 18, 82), (0, nacelle_y - 28, hub_z),
            mats["brass"], bevel_width=4)
    rotor_hub_y = nacelle_y - 82
    kit.cylinder(collection, root, "WindPowerPlant_MainDriveShaft",
                 18, 130, (0, nacelle_y - 48, hub_z), mats["iron"],
                 rotation=(90, 0, 0), vertices=36, bevel_width=1.5)
    kit.wind_rotor(
        collection, root, "WindPowerPlant_MainRotor",
        (0, rotor_hub_y, hub_z), mats["iron"], mats["brass"],
        mats["roof"], mats["brass"], axis="Y",
        blade_count=3, start_angle=90,
        inner_radius=58, outer_radius=rotor_radius,
        root_width=66, tip_width=28, thickness=13,
        style="turbine")

    # Exposed generator gearing, a vertical transfer shaft and two fixed
    # buffers explain how wind becomes stored energy without labels.
    gear_x = hall_side_x - 14
    gear_y = hall_y - 42
    gear_z = hall_base_z + 104
    kit.gear(collection, root, "WindPowerPlant_GeneratorFlywheel", 70,
             (gear_x, gear_y, gear_z), mats["brass"], axis="X", teeth=20)
    kit.cylinder(collection, root, "WindPowerPlant_GeneratorFlywheelAxle",
                 13, 60, (gear_x + 22, gear_y, gear_z), mats["iron"],
                 rotation=(0, 90, 0), vertices=28, bevel_width=1.2)
    kit.cylinder(collection, root, "WindPowerPlant_TransferShaft_Vertical",
                 10, 214, (-38, tower_y, hall_base_z + 238),
                 mats["iron"], vertices=28, bevel_width=1.2)
    kit.cylinder(collection, root, "WindPowerPlant_TransferShaft_Header",
                 10, 92, (-38, tower_y - 38, hall_base_z + 338),
                 mats["brass"], rotation=(90, 0, 0), vertices=28,
                 bevel_width=1.2)
    for side_x in (-1, 1):
        buffer_x = side_x * buffer_offset_x
        buffer_y = hall_front_y - 34
        buffer_z = hall_base_z + 82
        kit.cylinder(
            collection, root,
            f"WindPowerPlant_EnergyBuffer_{side_x:+d}_Core",
            30, 112, (buffer_x, buffer_y, buffer_z), energy,
            vertices=36, bevel_width=3)
        for cap_index, z in enumerate((buffer_z - 55, buffer_z + 55)):
            kit.cylinder(
                collection, root,
                f"WindPowerPlant_EnergyBuffer_{side_x:+d}_Cap_{cap_index}",
                37, 10, (buffer_x, buffer_y, z), mats["brass"],
                vertices=36, bevel_width=1.2)
        kit.box(
            collection, root,
            f"WindPowerPlant_EnergyBuffer_{side_x:+d}_Bracket",
            (54, 32, 122),
            (buffer_x, buffer_y + 18, buffer_z), mats["iron"],
            bevel_width=2)
        kit.cylinder(
            collection, root,
            f"WindPowerPlant_EnergyConduit_{side_x:+d}",
            7, abs(buffer_x) - hall_w / 2 + 30,
            (side_x * (hall_w / 2 + (abs(buffer_x) - hall_w / 2) / 2),
             buffer_y, hall_base_z + 68),
            mats["brass"], rotation=(0, 90, 0), vertices=20,
            bevel_width=0.8)
    return root


def build_solar_power_plant(spec):
    """4x4 photovoltaic station with ordered arrays and a two-storey office."""
    collection, root, mats = common_context("solar_power_plant", spec)
    dims = spec["dimensions"]
    fw, fd, fh = (float(value) for value in dims["foundation"])
    office_w, office_d, ground_h = (
        float(value) for value in dims["officeGroundFloor"])
    second_w, second_d, second_h = (
        float(value) for value in dims["officeSecondFloor"])
    roof_w, roof_d, roof_h = (float(value) for value in dims["officeRoof"])
    ground_panel = tuple(float(value) for value in dims["groundPanel"])
    roof_panel = tuple(float(value) for value in dims["roofPanel"])
    office_x, office_y = (float(value) for value in dims["officeOffset"])

    pv_blue = kit.rgba((0.018, 0.105, 0.19, 1.0))
    pv_cell = kit.material(
        "MAT_SolarPower_Photovoltaic_Cell", pv_blue, roughness=0.20,
        metallic=0.22, noise={"scale": 18, "detail": 2, "bump": 0.035})
    office_glass_color = kit.rgba((0.028, 0.20, 0.27, 1.0))
    office_glass = kit.material(
        "MAT_SolarPower_Office_Glass", office_glass_color,
        roughness=0.22, metallic=0.05,
        emission=(office_glass_color, 0.22))
    concrete_color = kit.rgba((0.38, 0.40, 0.39, 1.0))
    concrete = kit.material(
        "MAT_SolarPower_Weathered_Concrete", concrete_color,
        roughness=0.88, noise={"scale": 7, "detail": 3, "bump": 0.11})
    dark_interior = kit.material(
        "MAT_SolarPower_Office_Interior", kit.rgba((0.012, 0.016, 0.018, 1.0)),
        roughness=0.92)

    # The complete 4x4 slab remains the placement reference. The inset pad is
    # excluded from Body Depth so the candidate stage cannot inflate it into a
    # second plinth; all remaining open ground is reserved for aligned panels.
    kit.box(collection, root, "SolarPowerPlant_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=8)
    kit.box(collection, root, "SolarPowerPlant_InsetServicePad",
            (fw - 34, fd - 34, 8), (0, 0, fh + 4), concrete,
            bevel_width=5)

    # Two aligned bearing shells make the office count unambiguous. It stays on
    # the rear-right of the site, leaving three ordered ground-array banks visible.
    office_base_z = fh + 14
    kit.box(collection, root, "SolarPowerPlant_OfficeContactPlinth",
            (office_w + 24, office_d + 24, 12),
            (office_x, office_y, office_base_z + 6), mats["stone"],
            bevel_width=5)
    floor1_base = office_base_z + 12
    kit.box(collection, root, "SolarPowerPlant_OfficeFloor1_ConnectedShell",
            (office_w, office_d, ground_h),
            (office_x, office_y, floor1_base + ground_h / 2), concrete,
            bevel_width=5)
    floor2_base = floor1_base + ground_h
    kit.box(collection, root, "SolarPowerPlant_OfficeFloor2_ConnectedShell",
            (second_w, second_d, second_h),
            (office_x, office_y, floor2_base + second_h / 2), mats["plaster"],
            bevel_width=5)
    for index, (width, depth, base_z) in enumerate((
            (office_w, office_d, floor1_base),
            (second_w, second_d, floor2_base)), start=1):
        front_y = office_y - depth / 2 - 4
        side_x = office_x - width / 2 - 4
        kit.box(collection, root, f"SolarPowerPlant_OfficeFloor{index}_FrontBand",
                (width + 18, 14, 13), (office_x, front_y, base_z),
                mats["iron"], bevel_width=2)
        kit.box(collection, root, f"SolarPowerPlant_OfficeFloor{index}_SideBand",
                (14, depth + 18, 13), (side_x, office_y, base_z),
                mats["iron"], bevel_width=2)
        for side in (-1, 1):
            kit.box(collection, root,
                    f"SolarPowerPlant_OfficeFloor{index}_FrontPier_{side:+d}",
                    (18, 17, ground_h if index == 1 else second_h),
                    (office_x + side * (width / 2 - 11), front_y - 1,
                     base_z + (ground_h if index == 1 else second_h) / 2),
                    mats["iron"], bevel_width=2)

    office_front_y = office_y - office_d / 2 - 5
    lobby_w, lobby_h = 126, 92
    kit.box(collection, root, "SolarPowerPlant_OfficeLobby_DarkOpening",
            (lobby_w + 18, 11, lobby_h + 12),
            (office_x, office_front_y, floor1_base + lobby_h / 2),
            dark_interior, bevel_width=4)
    for side in (-1, 1):
        kit.box(collection, root, f"SolarPowerPlant_OfficeLobby_Door_{side:+d}",
                (52, 6, 82),
                (office_x + side * 28, office_front_y - 8, floor1_base + 41),
                office_glass, bevel_width=2)
        kit.box(collection, root,
                f"SolarPowerPlant_OfficeLobby_DoorFrame_{side:+d}",
                (6, 10, 88),
                (office_x + side * 58, office_front_y - 9, floor1_base + 44),
                mats["iron"], bevel_width=1)
    kit.box(collection, root, "SolarPowerPlant_OfficeLobby_Canopy",
            (174, 76, 12),
            (office_x, office_front_y - 31, floor1_base + lobby_h + 14),
            mats["iron"], bevel_width=4)

    for index, x in enumerate((office_x - 105, office_x + 105)):
        kit.framed_glass_panel(
            collection, root, f"SolarPowerPlant_OfficeFloor1_Window_{index}",
            (x, office_front_y - 3, floor1_base + 61), 70, 72,
            office_glass, mats["iron"], mats["brass"],
            vertical_divisions=2, horizontal_divisions=2, depth=8)
        kit.framed_glass_panel(
            collection, root, f"SolarPowerPlant_OfficeFloor2_Window_{index}",
            (x, office_y - second_d / 2 - 8, floor2_base + second_h * 0.54),
            82, 66, office_glass, mats["iron"], mats["brass"],
            vertical_divisions=2, horizontal_divisions=2, depth=8)
    for index, y in enumerate((office_y - 62, office_y + 62)):
        kit.framed_glass_panel(
            collection, root, f"SolarPowerPlant_OfficeFloor2_SideWindow_{index}",
            (office_x - second_w / 2 - 8, y, floor2_base + second_h * 0.54),
            72, 66, office_glass, mats["iron"], mats["brass"],
            orientation="side", vertical_divisions=2,
            horizontal_divisions=2, depth=8)

    # A fixed no-text sun-and-cell emblem identifies the control office without
    # creating a readable corporate sign.
    emblem_z = floor2_base + second_h * 0.57
    kit.cylinder(collection, root, "SolarPowerPlant_OfficeSunEmblem_Disc",
                 19, 8, (office_x, office_y - second_d / 2 - 15, emblem_z),
                 mats["brass"], rotation=(90, 0, 0), vertices=24,
                 bevel_width=1.5)
    for ray_index, angle in enumerate(range(0, 360, 45)):
        radians = math.radians(angle)
        kit.box(collection, root,
                f"SolarPowerPlant_OfficeSunEmblem_Ray_{ray_index}",
                (6, 7, 18),
                (office_x + math.sin(radians) * 30,
                 office_y - second_d / 2 - 17,
                 emblem_z + math.cos(radians) * 30),
                mats["brass"], rotation=(0, angle, 0), bevel_width=1)

    roof_base_z = floor2_base + second_h
    kit.box(collection, root, "SolarPowerPlant_OfficeFlatRoofSlab",
            (roof_w, roof_d, roof_h),
            (office_x, office_y, roof_base_z + roof_h / 2),
            mats["iron"], bevel_width=5)
    parapet_h = 24
    for side in (-1, 1):
        kit.box(collection, root,
                f"SolarPowerPlant_OfficeRoofParapet_FrontBack_{side:+d}",
                (roof_w, 13, parapet_h),
                (office_x, office_y + side * (roof_d / 2 - 6.5),
                 roof_base_z + roof_h + parapet_h / 2),
                concrete, bevel_width=2)
        kit.box(collection, root,
                f"SolarPowerPlant_OfficeRoofParapet_Sides_{side:+d}",
                (13, roof_d - 24, parapet_h),
                (office_x + side * (roof_w / 2 - 6.5), office_y,
                 roof_base_z + roof_h + parapet_h / 2),
                concrete, bevel_width=2)

    # The two calls consume one global 6x6 lattice: the front half is a full
    # 3x6 field and the rear-left half is 3x3. Their centers are separated by
    # exact whole row/column pitches, so the office simply occupies the rear-
    # right cells without introducing any staggered or shortened panel row.
    array_base_z = fh + 8
    kit.solar_panel_array(
        collection, root, "SolarPowerPlant_FrontGroundArray",
        (-5, -195, array_base_z), 3, 6, ground_panel, pv_cell,
        mats["iron"], row_gap=36, column_gap=18, tilt_degrees=14,
        support_height=58)
    kit.solar_panel_array(
        collection, root, "SolarPowerPlant_RearLeftGroundArray",
        (-182, 123, array_base_z), 3, 3, ground_panel, pv_cell,
        mats["iron"], row_gap=36, column_gap=18, tilt_degrees=14,
        support_height=58)

    kit.solar_panel_array(
        collection, root, "SolarPowerPlant_OfficeRoofArray",
        (office_x, office_y, roof_base_z + roof_h), 2, 2,
        roof_panel, pv_cell, mats["iron"], row_gap=18, column_gap=18,
        tilt_degrees=12, support_height=38)

    # Two fixed inverter/storage cabinets and their conduits remain attached to
    # the visible office side; they are equipment, never a detached annex.
    side_x = office_x - office_w / 2 - 23
    for index, y in enumerate((office_y - 62, office_y + 62)):
        cabinet_z = floor1_base + 48
        kit.box(collection, root, f"SolarPowerPlant_InverterCabinet_{index}",
                (42, 68, 92), (side_x, y, cabinet_z), mats["iron"],
                bevel_width=5)
        kit.box(collection, root, f"SolarPowerPlant_InverterFace_{index}",
                (7, 52, 68), (side_x - 22, y, cabinet_z), mats["stone"],
                bevel_width=3)
        kit.box(collection, root, f"SolarPowerPlant_InverterStatus_{index}",
                (5, 30, 16), (side_x - 26, y, cabinet_z + 22), mats["glow"],
                bevel_width=2)
        kit.cylinder(collection, root,
                     f"SolarPowerPlant_InverterConduit_{index}",
                     6, 40, (side_x + 8, y, floor1_base + 17), mats["brass"],
                     rotation=(0, 90, 0), vertices=16, bevel_width=0.8)
    return root


def build_computing_center(spec):
    """4x4 connected computing campus with server wings and liquid cooling."""
    collection, root, mats = common_context("computing_center", spec)
    dims = spec["dimensions"]
    fw, fd, fh = (float(value) for value in dims["foundation"])
    core_floor_sizes = [
        tuple(float(value) for value in dims[key])
        for key in ("coreGroundFloor", "coreSecondFloor",
                    "coreThirdFloor", "coreFourthFloor")
    ]
    core_roof = tuple(float(value) for value in dims["coreRoof"])
    hall_ground = tuple(float(value) for value in dims["serverHallGroundFloor"])
    hall_second = tuple(float(value) for value in dims["serverHallSecondFloor"])
    hall_roof = tuple(float(value) for value in dims["serverHallRoof"])
    wing_offset_x = float(dims["serverWingOffsetX"])
    wing_offset_y = float(dims.get("serverWingOffsetY", 24))
    cooling_size = tuple(float(value) for value in dims["coolingBank"])

    dark_steel_color = kit.rgba((0.035, 0.052, 0.063, 1.0))
    server_glass_color = kit.rgba((0.022, 0.145, 0.205, 1.0))
    operations_glass_color = kit.rgba((0.035, 0.245, 0.285, 1.0))
    coolant_color = kit.rgba((0.025, 0.43, 0.58, 1.0))
    concrete_color = kit.rgba((0.37, 0.39, 0.39, 1.0))
    dark_interior_color = kit.rgba((0.010, 0.016, 0.020, 1.0))
    dark_steel = kit.material(
        "MAT_ComputingCenter_DarkSteel", dark_steel_color,
        roughness=0.34, metallic=0.68,
        noise={"scale": 18, "detail": 2, "bump": 0.025})
    server_glass = kit.material(
        "MAT_ComputingCenter_ServerGlass", server_glass_color,
        roughness=0.18, metallic=0.08,
        emission=(server_glass_color, 0.30))
    operations_glass = kit.material(
        "MAT_ComputingCenter_OperationsGlass", operations_glass_color,
        roughness=0.20, metallic=0.05,
        emission=(operations_glass_color, 0.34))
    coolant = kit.material(
        "MAT_ComputingCenter_Coolant", coolant_color,
        roughness=0.20, metallic=0.12,
        emission=(coolant_color, 0.70))
    concrete = kit.material(
        "MAT_ComputingCenter_WeatheredConcrete", concrete_color,
        roughness=0.88,
        noise={"scale": 8, "detail": 3, "bump": 0.10})
    dark_interior = kit.material(
        "MAT_ComputingCenter_DimInterior", dark_interior_color,
        roughness=0.94)

    # The full 4x4 slab stays visible in Preview/Depth. The inset service pad is
    # excluded only from Body Depth so candidate extraction cannot promote it
    # into a second thick platform.
    kit.box(collection, root, "ComputingCenter_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=9)
    kit.box(collection, root, "ComputingCenter_InsetServicePad",
            (fw - 34, fd - 34, 8), (0, 0, fh + 4), concrete,
            bevel_width=6)

    core_base_z = fh + 14
    core_ground_w, core_ground_d, _ = core_floor_sizes[0]
    kit.box(collection, root, "ComputingCenter_CoreContactPlinth",
            (core_ground_w + 28, core_ground_d + 30, 14),
            (0, -10, core_base_z + 7), mats["stone"], bevel_width=6)
    core_base_z += 14
    core_faces = []
    for floor_index, (width, depth, height) in enumerate(core_floor_sizes, start=1):
        prefix = f"ComputingCenter_CoreFloor{floor_index}"
        shell_mat = concrete if floor_index == 1 else mats["plaster"]
        kit.box(collection, root, prefix + "_ConnectedBearingShell",
                (width, depth, height),
                (0, -10, core_base_z + height / 2), shell_mat,
                bevel_width=5)
        front_y = -10 - depth / 2 - 4
        side_x = -width / 2 - 4
        kit.box(collection, root, prefix + "_FrontSlabBand",
                (width + 26, 17, 15), (0, front_y, core_base_z),
                dark_steel, bevel_width=2)
        kit.box(collection, root, prefix + "_SideSlabBand",
                (17, depth + 26, 15), (side_x, -10, core_base_z),
                dark_steel, bevel_width=2)
        for side in (-1, 1):
            kit.box(collection, root,
                    f"{prefix}_FrontStructuralPier_{side:+d}",
                    (24, 20, height),
                    (side * (width / 2 - 14), front_y - 2,
                     core_base_z + height / 2),
                    dark_steel, bevel_width=2)
            kit.box(collection, root,
                    f"{prefix}_SideStructuralPier_{side:+d}",
                    (20, 24, height),
                    (side_x - 2, -10 + side * (depth / 2 - 14),
                     core_base_z + height / 2),
                    dark_steel, bevel_width=2)
        core_faces.append((core_base_z, width, depth, height, front_y, side_x))
        core_base_z += height

    # A broad closed operations lobby anchors the exact center of the facility.
    ground_z, _ground_w, _ground_d, _ground_h, ground_front, _ground_side = core_faces[0]
    lobby_width = 216
    lobby_height = 104
    kit.box(collection, root, "ComputingCenter_OperationsLobby_DarkOpening",
            (lobby_width + 22, 13, lobby_height + 16),
            (0, ground_front - 1, ground_z + lobby_height / 2),
            dark_interior, bevel_width=4)
    kit.box(collection, root, "ComputingCenter_OperationsLobby_GlassWall",
            (lobby_width, 7, lobby_height),
            (0, ground_front - 9, ground_z + lobby_height / 2),
            operations_glass, bevel_width=2)
    for x in (-72, 0, 72):
        kit.box(collection, root,
                f"ComputingCenter_OperationsLobby_Mullion_{x:+d}",
                (8, 11, lobby_height + 8),
                (x, ground_front - 13, ground_z + lobby_height / 2),
                dark_steel, bevel_width=1)
    for side in (-1, 1):
        kit.box(collection, root,
                f"ComputingCenter_OperationsLobby_DoorLeaf_{side:+d}",
                (68, 6, 92),
                (side * 38, ground_front - 17, ground_z + 46),
                server_glass, bevel_width=1.5)
        kit.box(collection, root,
                f"ComputingCenter_OperationsLobby_DoorHandle_{side:+d}",
                (6, 8, 32),
                (side * 10, ground_front - 23, ground_z + 49),
                mats["brass"], bevel_width=1)
    kit.box(collection, root, "ComputingCenter_OperationsLobby_Canopy",
            (270, 92, 14),
            (0, ground_front - 38, ground_z + lobby_height + 16),
            dark_steel, bevel_width=5)

    # Upper operations floors use repeated broad glazing, keeping the four
    # bearing shells legible instead of blending them into a generic glass tower.
    for floor_index, (floor_z, width, depth, height, front_y, side_x) in enumerate(
            core_faces[1:], start=2):
        center_z = floor_z + height * 0.54
        for window_index, x in enumerate((-82, 82)):
            kit.framed_glass_panel(
                collection, root,
                f"ComputingCenter_CoreFloor{floor_index}_FrontWindow_{window_index}",
                (x, front_y - 4, center_z), 132, 74,
                operations_glass if (floor_index + window_index) % 2 else server_glass,
                dark_steel, mats["brass"], vertical_divisions=3,
                horizontal_divisions=2, depth=8)
        for window_index, y in enumerate((-122, 4, 130)):
            kit.framed_glass_panel(
                collection, root,
                f"ComputingCenter_CoreFloor{floor_index}_SideWindow_{window_index}",
                (side_x - 4, y, center_z), 94, 72,
                server_glass, dark_steel, mats["brass"],
                orientation="side", vertical_divisions=2,
                horizontal_divisions=2, depth=8)

    # The no-text processor emblem is a physical facade assembly: a hexagonal
    # backing plate, nine compute nodes and four broad circuit traces.
    emblem_z = core_faces[2][0] + core_faces[2][3] * 0.54
    emblem_y = core_faces[2][4] - 13
    kit.cylinder(collection, root, "ComputingCenter_ProcessorEmblem_Backplate",
                 54, 10, (0, emblem_y, emblem_z), dark_steel,
                 rotation=(90, 0, 0), vertices=6, bevel_width=3)
    for row in range(3):
        for column in range(3):
            node_x = (column - 1) * 24
            node_z = emblem_z + (1 - row) * 24
            kit.box(collection, root,
                    f"ComputingCenter_ProcessorEmblem_Node_{row}_{column}",
                    (15, 7, 15), (node_x, emblem_y - 7, node_z),
                    coolant if (row + column) % 2 == 0 else mats["brass"],
                    bevel_width=2)
    for side in (-1, 1):
        kit.box(collection, root,
                f"ComputingCenter_ProcessorEmblem_HorizontalTrace_{side:+d}",
                (34, 6, 7), (side * 66, emblem_y - 7, emblem_z),
                mats["brass"], bevel_width=1)
        kit.box(collection, root,
                f"ComputingCenter_ProcessorEmblem_VerticalTrace_{side:+d}",
                (7, 6, 34), (side * 38, emblem_y - 7,
                              emblem_z + side * 52),
                mats["brass"], bevel_width=1)

    # Two attached two-storey server halls fill the 4x4 site. Their broad front
    # rack windows and outer-side intake fins expose the computing function while
    # keeping every room physically joined to the central operations core.
    hall_total_height = hall_ground[2] + hall_second[2]
    hall_roof_top_by_side = {}
    for side in (-1, 1):
        wing_x = side * wing_offset_x
        wing_prefix = f"ComputingCenter_ServerWing_{'Left' if side < 0 else 'Right'}"
        wing_base_z = fh + 14
        kit.box(collection, root, wing_prefix + "_ContactPlinth",
                (hall_ground[0] + 24, hall_ground[1] + 26, 14),
                (wing_x, wing_offset_y, wing_base_z + 7),
                mats["stone"], bevel_width=6)
        wing_base_z += 14
        for floor_index, (width, depth, height) in enumerate(
                (hall_ground, hall_second), start=1):
            floor_base = wing_base_z
            kit.box(collection, root,
                    f"{wing_prefix}_Floor{floor_index}_ConnectedBearingShell",
                    (width, depth, height),
                    (wing_x, wing_offset_y, floor_base + height / 2),
                    concrete if floor_index == 1 else mats["plaster"],
                    bevel_width=5)
            front_y = wing_offset_y - depth / 2 - 4
            outer_x = wing_x + side * (width / 2 + 4)
            kit.box(collection, root,
                    f"{wing_prefix}_Floor{floor_index}_FrontSlabBand",
                    (width + 20, 16, 14),
                    (wing_x, front_y, floor_base), dark_steel,
                    bevel_width=2)
            kit.box(collection, root,
                    f"{wing_prefix}_Floor{floor_index}_OuterSlabBand",
                    (16, depth + 20, 14),
                    (outer_x, wing_offset_y, floor_base), dark_steel,
                    bevel_width=2)
            center_z = floor_base + height * 0.53
            for bay_index, local_x in enumerate((-72, 0, 72)):
                kit.framed_glass_panel(
                    collection, root,
                    f"{wing_prefix}_Floor{floor_index}_ServerBay_{bay_index}",
                    (wing_x + local_x, front_y - 4, center_z), 58, 82,
                    server_glass, dark_steel, mats["brass"],
                    vertical_divisions=2, horizontal_divisions=4, depth=8)
            for intake_index, local_y in enumerate((-150, -50, 50, 150)):
                intake_y = wing_offset_y + local_y
                kit.box(collection, root,
                        f"{wing_prefix}_Floor{floor_index}_OuterIntakeFrame_{intake_index}",
                        (11, 84, 76), (outer_x + side * 4, intake_y, center_z),
                        dark_steel, bevel_width=3)
                for slat_index in range(5):
                    kit.box(collection, root,
                            f"{wing_prefix}_Floor{floor_index}_OuterIntakeSlat_{intake_index}_{slat_index}",
                            (8, 70, 6),
                            (outer_x + side * 10, intake_y,
                             center_z - 28 + slat_index * 14),
                            mats["iron"], bevel_width=0.8)
            wing_base_z += height

        roof_w, roof_d, roof_h = hall_roof
        kit.box(collection, root, wing_prefix + "_FlatRoofSlab",
                hall_roof, (wing_x, wing_offset_y, wing_base_z + roof_h / 2),
                dark_steel, bevel_width=5)
        parapet_h = 25
        for edge in (-1, 1):
            kit.box(collection, root,
                    f"{wing_prefix}_RoofParapet_FrontBack_{edge:+d}",
                    (roof_w, 13, parapet_h),
                    (wing_x, wing_offset_y + edge * (roof_d / 2 - 6.5),
                     wing_base_z + roof_h + parapet_h / 2),
                    concrete, bevel_width=2)
            kit.box(collection, root,
                    f"{wing_prefix}_RoofParapet_Sides_{edge:+d}",
                    (13, roof_d - 24, parapet_h),
                    (wing_x + edge * (roof_w / 2 - 6.5), wing_offset_y,
                     wing_base_z + roof_h + parapet_h / 2),
                    concrete, bevel_width=2)
        hall_roof_top_by_side[side] = wing_base_z + roof_h

        # One fixed liquid-cooling bank per roof. Three broad radiator cassettes
        # share one attached base and remain separate for direct Blender editing.
        bank_w, bank_d, bank_h = cooling_size
        bank_z = wing_base_z + roof_h
        kit.box(collection, root, wing_prefix + "_CoolingBank_Base",
                (bank_w + 28, bank_d + 24, 16),
                (wing_x, wing_offset_y + 32, bank_z + 8),
                mats["iron"], bevel_width=5)
        cassette_w = (bank_w - 36) / 3
        for cassette_index in range(3):
            cassette_x = wing_x - bank_w / 2 + cassette_w / 2 + 18 + cassette_index * cassette_w
            kit.box(collection, root,
                    f"{wing_prefix}_CoolingBank_Radiator_{cassette_index}",
                    (cassette_w - 8, bank_d, bank_h),
                    (cassette_x, wing_offset_y + 32,
                     bank_z + 16 + bank_h / 2),
                    dark_steel, bevel_width=4)
            for fin_index in range(5):
                fin_z = bank_z + 30 + fin_index * (bank_h - 28) / 4
                kit.box(collection, root,
                        f"{wing_prefix}_CoolingBank_Fin_{cassette_index}_{fin_index}",
                        (cassette_w - 18, bank_d + 7, 5),
                        (cassette_x, wing_offset_y + 29, fin_z),
                        coolant if fin_index == 2 else mats["brass"],
                        bevel_width=0.8)

        # One vertical buffer tank is bolted to each outer wing face. Its bracket
        # and pipe overlap the building so it cannot read as detached scenery.
        tank_x = wing_x + side * (hall_ground[0] / 2 + 20)
        tank_y = wing_offset_y - 128
        tank_z = fh + 14 + 88
        kit.cylinder(collection, root, wing_prefix + "_CoolantTank_Core",
                     28, 132, (tank_x, tank_y, tank_z), coolant,
                     vertices=32, bevel_width=2)
        for cap_index, cap_z in enumerate((tank_z - 64, tank_z + 64)):
            kit.cylinder(collection, root,
                         f"{wing_prefix}_CoolantTank_Cap_{cap_index}",
                         34, 10, (tank_x, tank_y, cap_z), mats["brass"],
                         vertices=32, bevel_width=1.2)
        kit.box(collection, root, wing_prefix + "_CoolantTank_WallBracket",
                (48, 60, 144),
                (tank_x - side * 14, tank_y + 20, tank_z),
                dark_steel, bevel_width=3)
        kit.cylinder(collection, root, wing_prefix + "_CoolantTank_Conduit",
                     7, 48,
                     (tank_x - side * 24, tank_y, fh + 14 + 34),
                     mats["brass"], rotation=(0, 90, 0), vertices=18,
                     bevel_width=0.8)

    # The four-storey core ends in one flat roof and low attached coolant
    # manifold, never an antenna, spire, satellite dish or inhabited fifth floor.
    core_roof_w, core_roof_d, core_roof_h = core_roof
    kit.box(collection, root, "ComputingCenter_CoreFlatRoofSlab",
            core_roof, (0, -10, core_base_z + core_roof_h / 2),
            dark_steel, bevel_width=5)
    core_parapet_h = 28
    for side in (-1, 1):
        kit.box(collection, root,
                f"ComputingCenter_CoreRoofParapet_FrontBack_{side:+d}",
                (core_roof_w, 14, core_parapet_h),
                (0, -10 + side * (core_roof_d / 2 - 7),
                 core_base_z + core_roof_h + core_parapet_h / 2),
                concrete, bevel_width=2)
        kit.box(collection, root,
                f"ComputingCenter_CoreRoofParapet_Sides_{side:+d}",
                (14, core_roof_d - 26, core_parapet_h),
                (side * (core_roof_w / 2 - 7), -10,
                 core_base_z + core_roof_h + core_parapet_h / 2),
                concrete, bevel_width=2)
    manifold_z = core_base_z + core_roof_h + 29
    kit.box(collection, root, "ComputingCenter_CoreCoolingManifold_Housing",
            (214, 126, 42), (0, 40, manifold_z),
            dark_steel, bevel_width=8)
    kit.box(collection, root, "ComputingCenter_CoreCoolingManifold_Face",
            (172, 132, 18), (0, 38, manifold_z),
            coolant, bevel_width=6)
    for side in (-1, 1):
        wing_top = hall_roof_top_by_side[side]
        pipe_start_x = side * wing_offset_x
        pipe_end_x = side * 107
        pipe_length = abs(pipe_start_x - pipe_end_x)
        pipe_center_x = (pipe_start_x + pipe_end_x) / 2
        pipe_z = max(wing_top + 34, manifold_z)
        kit.box(collection, root,
                f"ComputingCenter_CoolingTrunk_{side:+d}",
                (pipe_length, 22, 18),
                (pipe_center_x, 40, pipe_z), dark_steel,
                bevel_width=5)
        kit.box(collection, root,
                f"ComputingCenter_CoolingTrunkGlow_{side:+d}",
                (pipe_length - 10, 24, 7),
                (pipe_center_x, 38, pipe_z), coolant,
                bevel_width=3)
    return root


def university_ellipse_disk(collection, root, name, radius_x, radius_y,
                            location, mat, segments=64):
    """Create one flat editable ellipse for the university sports field."""
    vertices = [(0.0, 0.0, 0.0)]
    for index in range(segments):
        angle = math.tau * index / segments
        vertices.append((radius_x * math.cos(angle),
                         radius_y * math.sin(angle), 0.0))
    faces = [
        (0, index + 1, (index + 1) % segments + 1)
        for index in range(segments)
    ]
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    obj.location = location
    return obj


def university_ellipse_ring(collection, root, name, outer_x, outer_y,
                            inner_x, inner_y, location, mat, segments=64):
    """Create one independently editable annular ellipse for track courses."""
    vertices = []
    for radius_x, radius_y in ((outer_x, outer_y), (inner_x, inner_y)):
        for index in range(segments):
            angle = math.tau * index / segments
            vertices.append((radius_x * math.cos(angle),
                             radius_y * math.sin(angle), 0.0))
    faces = []
    for index in range(segments):
        nxt = (index + 1) % segments
        faces.append((index, nxt, segments + nxt, segments + index))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    obj.location = location
    return obj


def build_university_initial_campus(spec):
    """Archived initial campus layout retained as an editable modeling variant."""
    collection, root, mats = common_context("university", spec)
    dims = spec["dimensions"]
    fw, fd, fh = (float(value) for value in dims["foundation"])
    teaching_floors = [
        tuple(float(value) for value in dims[key])
        for key in ("teachingGroundFloor", "teachingSecondFloor",
                    "teachingThirdFloor")
    ]
    teaching_roof = tuple(float(value) for value in dims["teachingRoof"])
    teaching_x, teaching_y = (
        float(value) for value in dims["teachingOffset"])
    dorm_floors = [
        tuple(float(value) for value in dims[key])
        for key in ("dormGroundFloor", "dormSecondFloor")
    ]
    dorm_roof = tuple(float(value) for value in dims["dormRoof"])
    dorm_x, dorm_y = (float(value) for value in dims["dormOffset"])
    field_x, field_y = (float(value) for value in dims["fieldCenter"])
    field_outer_x, field_outer_y = (
        float(value) / 2 for value in dims["fieldOuter"])
    field_inner_x, field_inner_y = (
        float(value) / 2 for value in dims["fieldInner"])

    academic_glass_color = kit.rgba((0.035, 0.19, 0.225, 1.0))
    track_color = kit.rgba((0.34, 0.105, 0.075, 1.0))
    grass_color = kit.rgba((0.15, 0.245, 0.12, 1.0))
    walkway_color = kit.rgba((0.39, 0.39, 0.355, 1.0))
    dark_interior_color = kit.rgba((0.018, 0.022, 0.024, 1.0))
    academic_glass = kit.material(
        "MAT_University_AcademicGlass", academic_glass_color,
        roughness=0.22, metallic=0.04,
        emission=(academic_glass_color, 0.16))
    track = kit.material(
        "MAT_University_WeatheredTrack", track_color, roughness=0.94,
        noise={"scale": 20, "detail": 2, "bump": 0.035})
    grass = kit.material(
        "MAT_University_FieldGrass", grass_color, roughness=0.98,
        noise={"scale": 14, "detail": 2, "bump": 0.04})
    walkway = kit.material(
        "MAT_University_CampusWalkway", walkway_color, roughness=0.94,
        noise={"scale": 9, "detail": 2, "bump": 0.06})
    field_line = kit.material(
        "MAT_University_FieldLine", kit.rgba((0.72, 0.69, 0.57, 1.0)),
        roughness=0.86)
    dark_interior = kit.material(
        "MAT_University_DimInterior", dark_interior_color, roughness=0.98)

    # The full 4x4 foundation is the authoritative placement footprint.  The
    # inset campus pad is excluded only from Body Depth so it cannot become a
    # second heavy plinth during later image generation.
    kit.box(collection, root, "University_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=9)
    kit.box(collection, root, "University_InsetCampusPad",
            (fw - 34, fd - 34, 8), (0, 0, fh + 4), walkway,
            bevel_width=6)

    # Fixed campus circulation keeps all three zones visually connected.
    path_z = fh + 10
    for name, size, location in (
            ("University_CampusWalkway_MainAxis", (64, 486, 10),
             (teaching_x, -32, path_z)),
            ("University_CampusWalkway_DormitoryLink", (342, 58, 10),
             (-70, -26, path_z)),
            ("University_CampusPlaza", (172, 112, 10),
             (teaching_x, 32, path_z))):
        kit.box(collection, root, name, size, location, walkway,
                bevel_width=5)

    # Rear teaching building: exactly three connected storeys, broad repeated
    # classroom glazing, one portico and one continuous institutional roof.
    teaching_base_z = fh + 14
    ground_w, ground_d, _ = teaching_floors[0]
    kit.box(collection, root, "University_TeachingHall_ContactPlinth",
            (ground_w + 26, ground_d + 28, 14),
            (teaching_x, teaching_y, teaching_base_z + 7), mats["stone"],
            bevel_width=6)
    teaching_base_z += 14
    teaching_records = []
    for floor_index, (width, depth, height) in enumerate(
            teaching_floors, start=1):
        prefix = f"University_TeachingHall_Floor{floor_index}"
        kit.box(collection, root, prefix + "_ConnectedBearingShell",
                (width, depth, height),
                (teaching_x, teaching_y, teaching_base_z + height / 2),
                mats["stone"] if floor_index == 1 else mats["plaster"],
                bevel_width=5)
        front_y = teaching_y - depth / 2 - 4
        side_x = teaching_x - width / 2 - 4
        kit.box(collection, root, prefix + "_FrontFloorBand",
                (width + 22, 16, 14),
                (teaching_x, front_y, teaching_base_z), mats["stone"],
                bevel_width=2)
        kit.box(collection, root, prefix + "_SideFloorBand",
                (16, depth + 22, 14),
                (side_x, teaching_y, teaching_base_z), mats["stone"],
                bevel_width=2)
        window_z = teaching_base_z + height * 0.56
        front_bays = (-190, -95, 0, 95, 190)
        for bay_index, local_x in enumerate(front_bays):
            if floor_index == 1 and local_x == 0:
                continue
            kit.framed_glass_panel(
                collection, root,
                f"{prefix}_FrontClassroomWindow_{bay_index}",
                (teaching_x + local_x, front_y - 4, window_z),
                70, min(66, height - 30), academic_glass,
                mats["timber"], mats["brass"], vertical_divisions=2,
                horizontal_divisions=2, depth=8)
        for bay_index, local_y in enumerate((-64, 32, 96)):
            kit.framed_glass_panel(
                collection, root,
                f"{prefix}_SideClassroomWindow_{bay_index}",
                (side_x - 4, teaching_y + local_y, window_z),
                58, min(66, height - 30), academic_glass,
                mats["timber"], mats["brass"], orientation="side",
                vertical_divisions=2, horizontal_divisions=2, depth=8)
        teaching_records.append((teaching_base_z, width, depth, height, front_y))
        teaching_base_z += height

    entrance_front_y = teaching_records[0][4]
    kit.box(collection, root, "University_TeachingHall_MainEntrance_DarkOpening",
            (126, 14, 96),
            (teaching_x, entrance_front_y - 2,
             teaching_records[0][0] + 48), dark_interior, bevel_width=4)
    kit.double_doors(
        collection, root, "University_TeachingHall_MainEntrance_Doors",
        (teaching_x, entrance_front_y - 12, teaching_records[0][0]),
        108, 92, mats["timber"], mats["iron"], open_angle=34)
    for side in (-1, 1):
        kit.cylinder(
            collection, root,
            f"University_TeachingHall_PorticoColumn_{side:+d}",
            13, 112,
            (teaching_x + side * 66, entrance_front_y - 48,
             teaching_records[0][0] + 56), mats["stone"], vertices=20,
            bevel_width=1.5)
    kit.gabled_prism(
        collection, root, "University_TeachingHall_PorticoPediment",
        172, 86, 48,
        (teaching_x, entrance_front_y - 44,
         teaching_records[0][0] + 112), mats["stone"], mats["roof"])

    # A no-text open-book emblem supplies a readable academic identity without
    # introducing signage or a logo that image generation could hallucinate.
    emblem_z = teaching_records[1][0] + teaching_records[1][3] * 0.56
    emblem_y = teaching_records[1][4] - 12
    for side in (-1, 1):
        kit.box(collection, root,
                f"University_TeachingHall_OpenBook_Page_{side:+d}",
                (46, 7, 58),
                (teaching_x + side * 23, emblem_y, emblem_z),
                mats["stone"], rotation=(0, 0, side * 9), bevel_width=3)
    kit.box(collection, root, "University_TeachingHall_OpenBook_Spine",
            (7, 10, 60), (teaching_x, emblem_y - 4, emblem_z),
            mats["brass"], bevel_width=1)

    roof_w, roof_d, roof_h = teaching_roof
    hipped_roof(collection, root,
                 "University_TeachingHall_ContinuousHippedRoof",
                 roof_w, roof_d, roof_h,
                 (teaching_x, teaching_y, teaching_base_z), mats["roof"])

    # Left dormitory: exactly two connected storeys with repeated residential
    # windows and a separate entrance, making its function distinct at a glance.
    dorm_base_z = fh + 14
    dorm_ground_w, dorm_ground_d, _ = dorm_floors[0]
    kit.box(collection, root, "University_Dormitory_ContactPlinth",
            (dorm_ground_w + 24, dorm_ground_d + 26, 14),
            (dorm_x, dorm_y, dorm_base_z + 7), mats["stone"],
            bevel_width=6)
    dorm_base_z += 14
    dorm_records = []
    for floor_index, (width, depth, height) in enumerate(dorm_floors, start=1):
        prefix = f"University_Dormitory_Floor{floor_index}"
        kit.box(collection, root, prefix + "_ConnectedBearingShell",
                (width, depth, height),
                (dorm_x, dorm_y, dorm_base_z + height / 2),
                mats["stone"] if floor_index == 1 else mats["plaster"],
                bevel_width=5)
        front_y = dorm_y - depth / 2 - 4
        side_x = dorm_x + width / 2 + 4
        kit.box(collection, root, prefix + "_FrontFloorBand",
                (width + 20, 15, 13),
                (dorm_x, front_y, dorm_base_z), mats["stone"],
                bevel_width=2)
        window_z = dorm_base_z + height * 0.56
        for bay_index, local_x in enumerate((-68, 0, 68)):
            if floor_index == 1 and local_x == 0:
                continue
            kit.framed_glass_panel(
                collection, root,
                f"{prefix}_FrontBedroomWindow_{bay_index}",
                (dorm_x + local_x, front_y - 4, window_z),
                48, min(62, height - 28), academic_glass,
                mats["timber"], mats["brass"], vertical_divisions=2,
                horizontal_divisions=2, depth=8)
        for bay_index, local_y in enumerate((-82, 0, 82)):
            kit.framed_glass_panel(
                collection, root,
                f"{prefix}_SideBedroomWindow_{bay_index}",
                (side_x + 4, dorm_y + local_y, window_z),
                48, min(62, height - 28), academic_glass,
                mats["timber"], mats["brass"], orientation="side",
                vertical_divisions=2, horizontal_divisions=2, depth=8)
        dorm_records.append((dorm_base_z, width, depth, height, front_y))
        dorm_base_z += height
    dorm_front_y = dorm_records[0][4]
    kit.box(collection, root, "University_Dormitory_Entrance_DarkOpening",
            (74, 13, 84),
            (dorm_x, dorm_front_y - 2, dorm_records[0][0] + 42),
            dark_interior, bevel_width=3)
    kit.double_doors(
        collection, root, "University_Dormitory_Entrance_Doors",
        (dorm_x, dorm_front_y - 11, dorm_records[0][0]),
        66, 80, mats["timber"], mats["iron"], open_angle=24)
    dorm_roof_w, dorm_roof_d, dorm_roof_h = dorm_roof
    hipped_roof(collection, root, "University_Dormitory_ContinuousHippedRoof",
                 dorm_roof_w, dorm_roof_d, dorm_roof_h,
                 (dorm_x, dorm_y, dorm_base_z), mats["roof"])

    # Front athletics ground: one clean oval track, three aligned lane courses,
    # one green infield and two miniature goals.  Nothing is randomly scattered.
    field_z = fh + 15.5
    university_ellipse_ring(
        collection, root, "University_Playground_RunningTrack",
        field_outer_x, field_outer_y, field_inner_x, field_inner_y,
        (field_x, field_y, field_z), track)
    university_ellipse_disk(
        collection, root, "University_Playground_GrassInfield",
        field_inner_x - 5, field_inner_y - 5,
        (field_x, field_y, field_z + 0.6), grass)
    lane_steps = ((0.84, 0.88), (0.70, 0.75), (0.57, 0.63))
    for lane_index, (outer_factor, inner_factor) in enumerate(lane_steps, start=1):
        outer_lane_x = field_inner_x + (field_outer_x - field_inner_x) * outer_factor
        outer_lane_y = field_inner_y + (field_outer_y - field_inner_y) * outer_factor
        inner_lane_x = field_inner_x + (field_outer_x - field_inner_x) * inner_factor
        inner_lane_y = field_inner_y + (field_outer_y - field_inner_y) * inner_factor
        university_ellipse_ring(
            collection, root,
            f"University_Playground_LaneDivider_{lane_index}",
            outer_lane_x, outer_lane_y, inner_lane_x, inner_lane_y,
            (field_x, field_y, field_z + 1.2), field_line)
    kit.box(collection, root, "University_Playground_CenterLine",
            (4, field_inner_y * 1.46, 3),
            (field_x, field_y, field_z + 2.0), field_line,
            bevel_width=0.5)
    goal_offset_x = field_inner_x * 0.76
    for side in (-1, 1):
        goal_x = field_x + side * goal_offset_x
        prefix = f"University_Playground_Goal_{side:+d}"
        for goal_y in (-28, 28):
            kit.box(collection, root, prefix + f"_Post_{goal_y:+d}",
                    (6, 6, 34),
                    (goal_x, field_y + goal_y, field_z + 18),
                    field_line, bevel_width=1)
        kit.box(collection, root, prefix + "_Crossbar",
                (6, 62, 6), (goal_x, field_y, field_z + 34),
                field_line, bevel_width=1)
    return root


def build_university(spec):
    """4x4 enclosed medieval college with three halls and a statue court."""
    collection, root, mats = common_context("university", spec)
    dims = spec["dimensions"]
    fw, fd, fh = (float(value) for value in dims["foundation"])
    main_floors = [
        tuple(float(value) for value in dims[key])
        for key in ("mainGroundFloor", "mainSecondFloor", "mainThirdFloor")
    ]
    main_roof = tuple(float(value) for value in dims["mainRoof"])
    main_x, main_y = (float(value) for value in dims["mainOffset"])
    side_floors = [
        tuple(float(value) for value in dims[key])
        for key in ("sideGroundFloor", "sideSecondFloor")
    ]
    side_roof = tuple(float(value) for value in dims["sideRoof"])
    side_offset_x = float(dims["sideOffsetX"])
    side_offset_y = float(dims["sideOffsetY"])
    statue_x, statue_y = (float(value) for value in dims["statueCenter"])

    courtyard_color = kit.rgba((0.34, 0.335, 0.295, 1.0))
    dark_interior_color = kit.rgba((0.018, 0.014, 0.012, 1.0))
    stained_glass_color = kit.rgba((0.035, 0.19, 0.22, 1.0))
    statue_color = kit.rgba((0.30, 0.255, 0.16, 1.0))
    courtyard = kit.material(
        "MAT_University_MedievalCourtyard", courtyard_color,
        roughness=0.96,
        noise={"scale": 10, "detail": 2, "bump": 0.08})
    dark_interior = kit.material(
        "MAT_University_MedievalDimInterior", dark_interior_color,
        roughness=0.98)
    stained_glass = kit.material(
        "MAT_University_MedievalStainedGlass", stained_glass_color,
        roughness=0.22, metallic=0.04,
        emission=(stained_glass_color, 0.14))
    statue_bronze = kit.material(
        "MAT_University_AgedScholarBronze", statue_color,
        roughness=0.48, metallic=0.70,
        noise={"scale": 18, "detail": 2, "bump": 0.025})
    mats["glass"] = stained_glass

    # The logical 4x4 foundation remains unchanged while the medieval college
    # massing is pulled inward, leaving a readable wall circuit around it.
    kit.box(collection, root, "University_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=9)
    kit.box(collection, root, "University_InsetCampusPad",
            (fw - 34, fd - 34, 8), (0, 0, fh + 4), courtyard,
            bevel_width=6)
    courtyard_z = fh + 10
    kit.box(collection, root, "University_Courtyard_Paving",
            (420, 390, 8), (0, -45, courtyard_z), courtyard,
            bevel_width=8)
    for name, size, location in (
            ("University_Courtyard_MainProcessionalPath", (74, 510, 9),
             (0, -76, courtyard_z + 1)),
            ("University_Courtyard_CrossPath", (610, 62, 9),
             (0, -44, courtyard_z + 1))):
        kit.box(collection, root, name, size, location, mats["stone"],
                bevel_width=5)

    def add_floor_buttresses(prefix, center_x, center_y, width, depth,
                             base_z, height):
        buttress_h = height * 0.82
        for x_side in (-1, 1):
            for y_side in (-1, 1):
                kit.box(
                    collection, root,
                    f"{prefix}_CornerButtress_{x_side:+d}_{y_side:+d}",
                    (24, 24, buttress_h),
                    (center_x + x_side * (width / 2 + 5),
                     center_y + y_side * (depth / 2 + 5),
                     base_z + buttress_h / 2), mats["foundation"],
                    rotation=(0, 0, 45), bevel_width=2)

    # Smaller rear main hall: three aligned storeys, steep gable and lancets.
    main_base_z = fh + 14
    main_w, main_d, _ = main_floors[0]
    kit.box(collection, root, "University_MainHall_ContactPlinth",
            (main_w + 28, main_d + 30, 14),
            (main_x, main_y, main_base_z + 7), mats["stone"],
            bevel_width=6)
    main_base_z += 14
    main_records = []
    for floor_index, (width, depth, height) in enumerate(main_floors, start=1):
        prefix = f"University_MainHall_Floor{floor_index}"
        kit.box(collection, root, prefix + "_ConnectedBearingShell",
                (width, depth, height),
                (main_x, main_y, main_base_z + height / 2),
                mats["stone"] if floor_index == 1 else mats["plaster"],
                bevel_width=5)
        front_y = main_y - depth / 2 - 4
        side_x = main_x - width / 2 - 4
        kit.box(collection, root, prefix + "_FrontTimberCourse",
                (width + 18, 15, 14), (main_x, front_y, main_base_z),
                mats["timber"], bevel_width=2)
        kit.box(collection, root, prefix + "_SideTimberCourse",
                (15, depth + 18, 14), (side_x, main_y, main_base_z),
                mats["timber"], bevel_width=2)
        window_z = main_base_z + height * 0.56
        bays = (-150, -75, 0, 75, 150)
        for bay_index, local_x in enumerate(bays):
            if floor_index == 1 and local_x == 0:
                continue
            research_pointed_window(
                collection, root, mats,
                f"{prefix}_FrontLancet_{bay_index}",
                (main_x + local_x, front_y - 4, window_z),
                38, min(64, height - 24))
        for bay_index, local_y in enumerate((-44, 44)):
            research_pointed_window(
                collection, root, mats,
                f"{prefix}_SideLancet_{bay_index}",
                (side_x - 4, main_y + local_y, window_z),
                36, min(62, height - 24), orientation="side")
        add_floor_buttresses(prefix, main_x, main_y, width, depth,
                             main_base_z, height)
        main_records.append((main_base_z, width, depth, height, front_y))
        main_base_z += height

    main_front_y = main_records[0][4]
    kit.box(collection, root, "University_MainHall_Entrance_DarkArch",
            (104, 14, 94),
            (main_x, main_front_y - 2, main_records[0][0] + 47),
            dark_interior, bevel_width=4)
    kit.double_doors(
        collection, root, "University_MainHall_Entrance_Doors",
        (main_x, main_front_y - 12, main_records[0][0]),
        88, 88, mats["timber"], mats["iron"], open_angle=28)
    research_pointed_window(
        collection, root, mats, "University_MainHall_Entrance_Tympanum",
        (main_x, main_front_y - 13, main_records[0][0] + 116),
        66, 78)
    for side in (-1, 1):
        kit.box(collection, root,
                f"University_MainHall_OpenBook_Page_{side:+d}",
                (34, 7, 44),
                (main_x + side * 17, main_front_y - 14,
                 main_records[1][0] + main_records[1][3] * 0.54),
                mats["stone"], rotation=(0, 0, side * 10),
                bevel_width=3)
    main_roof_w, main_roof_d, main_roof_h = main_roof
    kit.gabled_prism(
        collection, root, "University_MainHall_SteepGabledRoof",
        main_roof_w, main_roof_d, main_roof_h,
        (main_x, main_y, main_base_z), mats["plaster"], mats["roof"])
    kit.box(collection, root, "University_MainHall_RoofRidge",
            (main_roof_w + 8, 9, 10),
            (main_x, main_y, main_base_z + main_roof_h + 1),
            mats["brass"], bevel_width=1)

    # Opposing two-storey side halls form a closed collegiate court.  The left
    # wing is residential; the right wing is a library and lecture annex.
    wing_records = {}
    for side, wing_name in ((-1, "Dormitory"), (1, "LibraryAnnex")):
        wing_x = side * side_offset_x
        wing_base_z = fh + 14
        wing_w, wing_d, _ = side_floors[0]
        kit.box(collection, root, f"University_{wing_name}_ContactPlinth",
                (wing_w + 24, wing_d + 26, 14),
                (wing_x, side_offset_y, wing_base_z + 7), mats["stone"],
                bevel_width=6)
        wing_base_z += 14
        records = []
        for floor_index, (width, depth, height) in enumerate(
                side_floors, start=1):
            prefix = f"University_{wing_name}_Floor{floor_index}"
            kit.box(collection, root, prefix + "_ConnectedBearingShell",
                    (width, depth, height),
                    (wing_x, side_offset_y, wing_base_z + height / 2),
                    mats["stone"] if floor_index == 1 else mats["plaster"],
                    bevel_width=5)
            inner_x = wing_x - side * (width / 2 + 4)
            kit.box(collection, root, prefix + "_InnerTimberCourse",
                    (15, depth + 18, 14),
                    (inner_x, side_offset_y, wing_base_z), mats["timber"],
                    bevel_width=2)
            window_z = wing_base_z + height * 0.56
            for bay_index, local_y in enumerate((-94, -42, 42, 94)):
                if floor_index == 1 and abs(local_y) == 42:
                    continue
                research_pointed_window(
                    collection, root, mats,
                    f"{prefix}_InnerLancet_{bay_index}",
                    (inner_x - side * 4, side_offset_y + local_y, window_z),
                    34, min(60, height - 24), orientation="side")
            front_y = side_offset_y - depth / 2 - 4
            for bay_index, local_x in enumerate((-48, 48)):
                research_pointed_window(
                    collection, root, mats,
                    f"{prefix}_FrontLancet_{bay_index}",
                    (wing_x + local_x, front_y - 4, window_z),
                    34, min(60, height - 24))
            add_floor_buttresses(prefix, wing_x, side_offset_y, width, depth,
                                 wing_base_z, height)
            records.append((wing_base_z, width, depth, height, inner_x))
            wing_base_z += height
        wing_records[wing_name] = records

        # Side-oriented inner-court door assembly.
        inner_x = records[0][4]
        door_x = inner_x - side * 9
        kit.box(collection, root, f"University_{wing_name}_Entrance_DarkOpening",
                (13, 74, 84),
                (door_x + side * 3, side_offset_y,
                 records[0][0] + 42), dark_interior, bevel_width=3)
        for leaf_side in (-1, 1):
            kit.box(collection, root,
                    f"University_{wing_name}_Entrance_DoorLeaf_{leaf_side:+d}",
                    (8, 31, 78),
                    (door_x, side_offset_y + leaf_side * 18,
                     records[0][0] + 39), mats["timber"], bevel_width=2)
            for band_index, band_z in enumerate((-22, 0, 22)):
                kit.box(collection, root,
                        f"University_{wing_name}_Entrance_DoorBand_{leaf_side:+d}_{band_index}",
                        (11, 27, 5),
                        (door_x - side * 5,
                         side_offset_y + leaf_side * 18,
                         records[0][0] + 39 + band_z), mats["iron"],
                        bevel_width=0.5)
        roof_l, roof_w, roof_h = side_roof
        roof = kit.gabled_prism(
            collection, root, f"University_{wing_name}_SteepGabledRoof",
            roof_l, roof_w, roof_h,
            (wing_x, side_offset_y, wing_base_z),
            mats["plaster"], mats["roof"])
        roof.rotation_euler.z = math.radians(90)
        kit.box(collection, root, f"University_{wing_name}_RoofRidge",
                (9, roof_l + 8, 10),
                (wing_x, side_offset_y, wing_base_z + roof_h + 1),
                mats["brass"], bevel_width=1)

    # Covered cloisters reinforce the medieval college reading and connect both
    # side halls to the central court without adding detached buildings.
    for side, wing_name in ((-1, "Dormitory"), (1, "LibraryAnnex")):
        cloister_x = side * 181
        roof = kit.gabled_prism(
            collection, root, f"University_{wing_name}_CloisterRoof",
            260, 72, 34, (cloister_x, side_offset_y, fh + 108),
            mats["stone"], mats["roof"])
        roof.rotation_euler.z = math.radians(90)
        for column_index, local_y in enumerate((-104, -52, 0, 52, 104)):
            kit.cylinder(
                collection, root,
                f"University_{wing_name}_CloisterColumn_{column_index}",
                10, 86,
                (side * 159, side_offset_y + local_y, fh + 57),
                mats["stone"], vertices=12, bevel_width=1.2)

    # Central scholar statue replaces the sports field completely.
    statue_base_z = fh + 16
    kit.box(collection, root, "University_CourtyardStatue_LowerStep",
            (104, 104, 18),
            (statue_x, statue_y, statue_base_z + 9), mats["stone"],
            bevel_width=7)
    kit.box(collection, root, "University_CourtyardStatue_UpperStep",
            (78, 78, 18),
            (statue_x, statue_y, statue_base_z + 27), mats["foundation"],
            bevel_width=5)
    kit.box(collection, root, "University_CourtyardStatue_Pedestal",
            (52, 52, 70),
            (statue_x, statue_y, statue_base_z + 71), mats["stone"],
            bevel_width=4)
    scholar_base_z = statue_base_z + 106
    kit.box(collection, root, "University_CourtyardStatue_ScholarRobe",
            (38, 30, 66),
            (statue_x, statue_y, scholar_base_z + 33), statue_bronze,
            bevel_width=5)
    kit.cylinder(collection, root, "University_CourtyardStatue_ScholarHead",
                 15, 27,
                 (statue_x, statue_y, scholar_base_z + 80), statue_bronze,
                 vertices=24, bevel_width=1.5)
    kit.box(collection, root, "University_CourtyardStatue_OpenBook_LeftPage",
            (28, 7, 34),
            (statue_x - 13, statue_y - 20, scholar_base_z + 43),
            mats["brass"], rotation=(0, 0, -8), bevel_width=2)
    kit.box(collection, root, "University_CourtyardStatue_OpenBook_RightPage",
            (28, 7, 34),
            (statue_x + 13, statue_y - 20, scholar_base_z + 43),
            mats["brass"], rotation=(0, 0, 8), bevel_width=2)
    for side in (-1, 1):
        kit.cylinder(
            collection, root,
            f"University_CourtyardStatue_ScholarArm_{side:+d}",
            6, 42,
            (statue_x + side * 19, statue_y - 8, scholar_base_z + 48),
            statue_bronze, rotation=(0, side * 28, 0), vertices=12,
            bevel_width=1)

    # Low crenellated stone walls define the entire campus boundary.  A single
    # front gatehouse supplies the only opening and remains inside the 4x4 slab.
    wall_base_z = fh + 12
    wall_h = 62
    wall_specs = (
        ("University_EnclosureWall_Back", (840, 18, wall_h),
         (0, 330, wall_base_z + wall_h / 2)),
        ("University_EnclosureWall_Left", (18, 660, wall_h),
         (-420, 0, wall_base_z + wall_h / 2)),
        ("University_EnclosureWall_Right", (18, 660, wall_h),
         (420, 0, wall_base_z + wall_h / 2)),
        ("University_EnclosureWall_FrontLeft", (325, 18, wall_h),
         (-257.5, -330, wall_base_z + wall_h / 2)),
        ("University_EnclosureWall_FrontRight", (325, 18, wall_h),
         (257.5, -330, wall_base_z + wall_h / 2)),
    )
    for name, size, location in wall_specs:
        kit.box(collection, root, name, size, location, mats["stone"],
                bevel_width=3)
    for x_index, x in enumerate(range(-385, 386, 70)):
        for y_side in (-1, 1):
            kit.box(collection, root,
                    f"University_EnclosureWall_CrenelFrontBack_{y_side:+d}_{x_index}",
                    (34, 26, 24),
                    (x, y_side * 330, wall_base_z + wall_h + 12),
                    mats["foundation"], bevel_width=2)
    for y_index, y in enumerate(range(-290, 291, 58)):
        for x_side in (-1, 1):
            kit.box(collection, root,
                    f"University_EnclosureWall_CrenelSide_{x_side:+d}_{y_index}",
                    (26, 32, 24),
                    (x_side * 420, y, wall_base_z + wall_h + 12),
                    mats["foundation"], bevel_width=2)
    for x_side in (-1, 1):
        for y_side in (-1, 1):
            kit.box(collection, root,
                    f"University_EnclosureWall_CornerPier_{x_side:+d}_{y_side:+d}",
                    (34, 34, 88),
                    (x_side * 420, y_side * 330,
                     wall_base_z + 44), mats["foundation"],
                    bevel_width=4)

    gate_y = -316
    gate_base_z = fh + 14
    kit.box(collection, root, "University_MainGate_GatehouseShell",
            (176, 74, 110),
            (0, gate_y, gate_base_z + 55), mats["stone"],
            bevel_width=5)
    kit.box(collection, root, "University_MainGate_DarkOpening",
            (96, 14, 92),
            (0, gate_y - 33, gate_base_z + 46), dark_interior,
            bevel_width=4)
    kit.double_doors(
        collection, root, "University_MainGate_OpenDoors",
        (0, gate_y - 43, gate_base_z), 86, 88,
        mats["timber"], mats["iron"], open_angle=34)
    kit.gabled_prism(
        collection, root, "University_MainGate_SteepGabledRoof",
        206, 108, 62, (0, gate_y, gate_base_z + 110),
        mats["stone"], mats["roof"])
    research_pointed_window(
        collection, root, mats, "University_MainGate_AcademicSeal",
        (0, gate_y - 42, gate_base_z + 92), 42, 54)
    return root


def build_deep_drill(spec):
    """Open 2x2 magitech drilling rig with fixed maintenance clutter."""
    collection, root, mats = common_context("deep_drill", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    deck_w, deck_d, deck_h = dims["machineDeck"]
    span_x, span_y = (float(value) for value in dims["derrickSpan"])
    derrick_height = float(dims["derrickHeight"])
    collar_radius = float(dims["drillCollarRadius"])
    winch_radius = float(dims["winchRadius"])

    energy_color = kit.rgba((0.018, 0.47, 0.72, 1.0))
    energy = kit.material("MAT_DeepDrill_EnergyFlow", energy_color,
                          roughness=0.18, emission=(energy_color, 1.15))
    bore_color = kit.rgba((0.012, 0.016, 0.018, 1.0))
    bore = kit.material("MAT_DeepDrill_BoreDark", bore_color, roughness=0.98)

    # The full 2x2 foundation is the authoritative building footprint.  The
    # low machinery deck and all four tower feet overlap it as one structure.
    kit.box(collection, root, "DeepDrill_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)
    kit.box(collection, root, "DeepDrill_MachineDeck",
            (deck_w, deck_d, deck_h),
            (0, 8, fh + deck_h / 2), mats["stone"], bevel_width=6)
    deck_top = fh + deck_h
    for index, y in enumerate((-deck_d / 2 + 10, deck_d / 2 - 10)):
        kit.box(collection, root, f"DeepDrill_DeckBrassRail_{index}",
                (deck_w - 30, 8, 9), (0, y + 8, deck_top + 2),
                mats["brass"], bevel_width=1.2)

    # A dark bore, cyan extraction core and heavy collar keep the central
    # function readable even after the 1x1 surface vein below is occluded.
    kit.cylinder(collection, root, "DeepDrill_BoreAperture",
                 collar_radius * 0.76, 16, (0, 0, deck_top + 8), bore,
                 vertices=48, bevel_width=1)
    kit.cylinder(collection, root, "DeepDrill_EnergyWellCore",
                 collar_radius * 0.43, 19, (0, 0, deck_top + 10), energy,
                 vertices=40, bevel_width=1)
    kit.cylinder(collection, root, "DeepDrill_OuterCollar",
                 collar_radius, 12, (0, 0, deck_top + 15), mats["iron"],
                 vertices=48, bevel_width=2)
    kit.cylinder(collection, root, "DeepDrill_BrassCollar",
                 collar_radius * 0.84, 16, (0, 0, deck_top + 18), mats["brass"],
                 vertices=48, bevel_width=1.5)
    # Re-cover the center of the solid collar disks with the authored bore.
    kit.cylinder(collection, root, "DeepDrill_CollarVisibleBore",
                 collar_radius * 0.57, 20, (0, 0, deck_top + 21), bore,
                 vertices=48, bevel_width=1)
    kit.cylinder(collection, root, "DeepDrill_CollarEnergyCore",
                 collar_radius * 0.37, 22, (0, 0, deck_top + 23), energy,
                 vertices=40, bevel_width=1)

    bpy.ops.mesh.primitive_cone_add(
        vertices=12, radius1=8, radius2=27, depth=48,
        location=(0, 0, deck_top + 37))
    drill_head = bpy.context.object
    drill_head.name = "DeepDrill_FacetedDrillHead"
    drill_head.parent = root
    drill_head.data.materials.append(mats["iron"])
    kit.bevel(drill_head, 1.2, 2)
    kit.move_to_collection(drill_head, collection)

    post_bottom = deck_top + 10
    post_top = post_bottom + derrick_height
    post_z = (post_bottom + post_top) / 2
    half_x, half_y = span_x / 2, span_y / 2
    for x_label, x in (("Left", -half_x), ("Right", half_x)):
        for y_label, y in (("Front", -half_y), ("Rear", half_y)):
            prefix = f"DeepDrill_DerrickPost_{x_label}_{y_label}"
            kit.box(collection, root, prefix + "_Foot", (38, 38, 22),
                    (x, y, deck_top + 11), mats["foundation"], bevel_width=4)
            kit.box(collection, root, prefix, (19, 19, derrick_height),
                    (x, y, post_z), mats["timber"], bevel_width=2)
            for band_index, band_z in enumerate((post_bottom + 70,
                                                  post_bottom + 166,
                                                  post_bottom + 250)):
                kit.box(collection, root, f"{prefix}_IronBand_{band_index}",
                        (25, 25, 9), (x, y, band_z), mats["iron"],
                        bevel_width=1)

    # Cross-braced faces lock the drilling tower as one connected derrick, not
    # four unrelated poles.  Every brace remains separately editable.
    front_back_brace_len = math.sqrt(span_x * span_x + 214 * 214)
    front_back_angle = math.degrees(math.atan2(span_x, 214))
    side_brace_len = math.sqrt(span_y * span_y + 214 * 214)
    side_angle = math.degrees(math.atan2(span_y, 214))
    brace_z = post_bottom + 112
    for y_label, y in (("Front", -half_y), ("Rear", half_y)):
        for index, angle in enumerate((-front_back_angle, front_back_angle)):
            kit.box(collection, root,
                    f"DeepDrill_DerrickBrace_{y_label}_{index}",
                    (13, 13, front_back_brace_len), (0, y, brace_z),
                    mats["iron"], rotation=(0, angle, 0), bevel_width=1.2)
    for x_label, x in (("Left", -half_x), ("Right", half_x)):
        for index, angle in enumerate((-side_angle, side_angle)):
            kit.box(collection, root,
                    f"DeepDrill_DerrickBrace_{x_label}_{index}",
                    (13, 13, side_brace_len), (x, 0, brace_z),
                    mats["iron"], rotation=(angle, 0, 0), bevel_width=1.2)
    for band_index, band_z in enumerate((post_bottom + 104, post_bottom + 214)):
        kit.box(collection, root, f"DeepDrill_DerrickFrontBand_{band_index}",
                (span_x + 30, 18, 15), (0, -half_y, band_z),
                mats["brass"], bevel_width=1.5)
        kit.box(collection, root, f"DeepDrill_DerrickSideBand_{band_index}",
                (18, span_y + 30, 15), (-half_x, 0, band_z),
                mats["brass"], bevel_width=1.5)

    kit.box(collection, root, "DeepDrill_DerrickTopBeam",
            (span_x + 44, 28, 24), (0, 0, post_top - 8),
            mats["iron"], bevel_width=3)
    kit.gabled_prism(collection, root, "DeepDrill_DerrickCanopy",
                     span_x + 70, span_y + 58, 62,
                     (0, 0, post_top - 1), mats["timber"], mats["roof"])

    # Top pulley, cable and vertical drill shaft form one unmistakable extraction
    # line.  The large side winch and drive gear remain bolted to the deck.
    pulley_z = post_top - 42
    kit.cylinder(collection, root, "DeepDrill_TopPulley_Rim", 31, 13,
                 (0, -half_y - 10, pulley_z), mats["brass"],
                 rotation=(90, 0, 0), vertices=40, bevel_width=1.5)
    kit.cylinder(collection, root, "DeepDrill_TopPulley_Hub", 9, 19,
                 (0, -half_y - 10, pulley_z), mats["iron"],
                 rotation=(90, 0, 0), vertices=24, bevel_width=1)
    shaft_height = pulley_z - deck_top - 13
    kit.cylinder(collection, root, "DeepDrill_MainDrillShaft", 9,
                 shaft_height, (0, 0, deck_top + 30 + shaft_height / 2),
                 mats["iron"], vertices=24, bevel_width=1)
    kit.cylinder(collection, root, "DeepDrill_HoistCable", 3,
                 shaft_height + 18,
                 (0, -half_y - 10, deck_top + 20 + shaft_height / 2),
                 mats["iron"], vertices=16, bevel_width=0.5)

    winch_x = -half_x - 48
    winch_y = 18
    winch_z = deck_top + 104
    kit.gear(collection, root, "DeepDrill_MainWinchFlywheel", winch_radius,
             (winch_x, winch_y, winch_z), mats["brass"], axis="X", teeth=16)
    kit.cylinder(collection, root, "DeepDrill_MainWinchDrum",
                 winch_radius * 0.42, 74, (winch_x + 8, winch_y, winch_z),
                 mats["iron"], rotation=(0, 90, 0), vertices=32,
                 bevel_width=2)
    kit.gear(collection, root, "DeepDrill_WinchDriveGear", winch_radius * 0.58,
             (winch_x, winch_y - 56, winch_z - 42), mats["iron"],
             axis="X", teeth=12)
    for y in (winch_y - 39, winch_y + 39):
        kit.box(collection, root, f"DeepDrill_WinchBearing_{int(y)}",
                (34, 28, 72), (winch_x + 10, y, deck_top + 45),
                mats["foundation"], bevel_width=4)

    # Irregular maintenance clutter replaces the former four identical operator
    # consoles.  Every item stays inside the 2x2 foundation and touches either
    # the deck or a fixed rack, so the group reads as tools rather than stations.
    clutter_y = -fd / 2 + 50
    chest_x = -118
    kit.box(collection, root, "DeepDrill_MaintenanceToolChest",
            (82, 56, 44), (chest_x, clutter_y, fh + 22),
            mats["timber"], bevel_width=6)
    for index, x in enumerate((chest_x - 28, chest_x + 28)):
        kit.box(collection, root, f"DeepDrill_ToolChestBand_{index}",
                (8, 60, 48), (x, clutter_y, fh + 23),
                mats["iron"], bevel_width=1)
    kit.box(collection, root, "DeepDrill_ToolChestLatch", (18, 7, 16),
            (chest_x, clutter_y - 30, fh + 25), mats["brass"],
            bevel_width=2)

    pipe_rack_x = 8
    for index, x in enumerate((pipe_rack_x - 38, pipe_rack_x + 38)):
        kit.box(collection, root, f"DeepDrill_SparePipeRackSupport_{index}",
                (14, 48, 30), (x, clutter_y, fh + 15),
                mats["foundation"], bevel_width=3)
    for index, (y_offset, z_offset) in enumerate(((-13, 30), (0, 42), (13, 30))):
        kit.cylinder(collection, root, f"DeepDrill_SparePipe_{index}",
                     7, 96, (pipe_rack_x, clutter_y + y_offset, fh + z_offset),
                     mats["iron"], rotation=(0, 90, 0), vertices=20,
                     bevel_width=1)
        kit.cylinder(collection, root, f"DeepDrill_SparePipeCollar_{index}",
                     10, 8, (pipe_rack_x - 35, clutter_y + y_offset,
                             fh + z_offset), mats["brass"],
                     rotation=(0, 90, 0), vertices=20, bevel_width=1)

    bit_rack_x = 122
    kit.box(collection, root, "DeepDrill_SpareBitRack_Base", (92, 62, 24),
            (bit_rack_x, clutter_y, fh + 12), mats["iron"], bevel_width=4)
    for index, (x_offset, height, radius) in enumerate(((-27, 46, 13),
                                                        (0, 58, 16),
                                                        (29, 40, 12))):
        bpy.ops.mesh.primitive_cone_add(
            vertices=10, radius1=radius, radius2=5, depth=height,
            location=(bit_rack_x + x_offset, clutter_y, fh + 24 + height / 2))
        spare_bit = bpy.context.object
        spare_bit.name = f"DeepDrill_SpareDrillBit_{index}"
        spare_bit.parent = root
        spare_bit.data.materials.append(mats["iron"] if index != 1 else mats["brass"])
        kit.bevel(spare_bit, 0.9, 2)
        kit.move_to_collection(spare_bit, collection)

    # A rear extraction manifold communicates continuous energy flow from the
    # central bore to the future 600px mining service, without implying storage.
    manifold_x, manifold_y = half_x + 39, 43
    kit.box(collection, root, "DeepDrill_ExtractionManifoldHousing",
            (62, 118, 96), (manifold_x, manifold_y, deck_top + 48),
            mats["iron"], bevel_width=5)
    for index, y in enumerate((manifold_y - 36, manifold_y, manifold_y + 36)):
        kit.cylinder(collection, root, f"DeepDrill_ExtractionCell_{index}",
                     13, 49, (manifold_x - 32, y, deck_top + 48), energy,
                     rotation=(0, 90, 0), vertices=24, bevel_width=1)
    kit.cylinder(collection, root, "DeepDrill_EnergyHeader_Vertical", 8, 122,
                 (manifold_x, manifold_y + 54, deck_top + 89), mats["brass"],
                 vertices=24, bevel_width=1)
    kit.cylinder(collection, root, "DeepDrill_EnergyHeader_ToBore", 8, 132,
                 (manifold_x - 62, manifold_y + 54, deck_top + 28),
                 mats["brass"], rotation=(0, 90, 0), vertices=24,
                 bevel_width=1)
    return root


def build_tavern(spec):
    """Connected three-storey tavern with an open entrance and no-text mug sign."""
    collection, root, mats = common_context("tavern", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    floor_specs = (
        ("Ground", dims["groundFloor"]),
        ("Second", dims["secondFloor"]),
        ("Third", dims["thirdFloor"]),
    )
    rw, rd, rh = dims["roof"]

    amber_color = kit.rgba((0.53, 0.245, 0.055, 1.0))
    teal_color = kit.rgba((0.055, 0.30, 0.29, 1.0))
    interior_color = kit.rgba((0.115, 0.032, 0.018, 1.0))
    amber_glass = kit.material("MAT_Tavern_Amber_StainedGlass", amber_color,
                               roughness=0.24, emission=(amber_color, 0.52))
    teal_glass = kit.material("MAT_Tavern_Teal_StainedGlass", teal_color,
                              roughness=0.24, emission=(teal_color, 0.46))
    interior = kit.material("MAT_Tavern_WarmDark_Interior", interior_color,
                            roughness=0.86, emission=(interior_color, 0.34))
    sign_wood = kit.material(
        "MAT_Tavern_Sign_Oak", kit.rgba((0.28, 0.125, 0.045, 1.0)),
        roughness=0.88, noise={"scale": 5, "detail": 4, "bump": 0.18})

    # The complete 2x2 foundation is the single support for three connected,
    # vertically aligned storeys. Their shared wall line prevents the ground
    # floor from reading as a recessed plinth or a separate lower annex.
    kit.box(collection, root, "Tavern_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)
    base_z = fh
    floor_faces = []
    for index, (label, size) in enumerate(floor_specs, start=1):
        width, depth, height = size
        prefix = f"Tavern_Floor{index}_{label}"
        kit.box(collection, root, prefix + "_ConnectedShell", size,
                (0, 0, base_z + height / 2), mats["plaster"], bevel_width=4)
        if index == 1:
            kit.box(collection, root, prefix + "_StoneSkirt",
                    (width + 8, depth + 8, 48),
                    (0, 0, base_z + 24), mats["stone"], bevel_width=4)
        front_y = -depth / 2 - 4
        side_x = -width / 2 - 4
        kit.half_timber_facade(collection, root, prefix + "_FrontTimber",
                               width, height, front_y, base_z, mats["timber"], bays=3)
        kit.half_timber_side(collection, root, prefix + "_SideTimber",
                             depth, height, side_x, base_z, mats["timber"], bays=2)
        kit.box(collection, root, prefix + "_FrontFloorBand",
                (width + 14, 12, 13), (0, front_y, base_z),
                mats["timber"], bevel_width=1.5)
        kit.box(collection, root, prefix + "_SideFloorBand",
                (12, depth + 14, 13), (side_x, 0, base_z),
                mats["timber"], bevel_width=1.5)
        floor_faces.append((base_z, width, depth, height, front_y, side_x))
        base_z += height

    ground_z, ground_w, ground_d, ground_h, ground_front, ground_side = floor_faces[0]
    second_z, second_w, second_d, second_h, second_front, second_side = floor_faces[1]
    third_z, third_w, third_d, third_h, third_front, third_side = floor_faces[2]

    # A modeled dark recess, warm interior plane and two visibly opened leaves
    # make the main door unambiguous in both preview and ControlNet depth.
    door_x = -58
    door_width = 94
    door_height = 104
    kit.box(collection, root, "Tavern_MainDoor_WarmDarkOpening",
            (door_width + 8, 10, door_height + 8),
            (door_x, ground_front - 2, ground_z + door_height / 2),
            interior, bevel_width=2)
    kit.double_doors(collection, root, "Tavern_MainDoor_OpenDouble",
                     (door_x, ground_front - 11, ground_z), door_width, door_height,
                     mats["timber"], mats["iron"], open_angle=58)
    for side in (-1, 1):
        kit.box(collection, root, f"Tavern_MainDoor_Jamb_{side:+d}",
                (13, 16, door_height + 18),
                (door_x + side * (door_width / 2 + 8), ground_front - 3,
                 ground_z + (door_height + 18) / 2), mats["stone"], bevel_width=2)
    kit.box(collection, root, "Tavern_MainDoor_Lintel",
            (door_width + 30, 16, 15),
            (door_x, ground_front - 3, ground_z + door_height + 12),
            mats["stone"], bevel_width=2)
    kit.box(collection, root, "Tavern_MainDoor_Threshold",
            (door_width + 18, 34, 10),
            (door_x, ground_front - 17, ground_z + 5), mats["stone"], bevel_width=2)
    research_pointed_window(
        collection, root, dict(mats, glass=amber_glass), "Tavern_Ground_AmberWindow",
        (73, ground_front - 2, ground_z + 68), 42, 76)

    # Two readable stained-glass stages lock the upper-storey count. Alternating
    # low-saturation amber and blue-green panes keep the facade lively but sober.
    window_sets = (
        (2, second_z, second_h, second_front, second_side,
         ((-76, amber_glass), (46, teal_glass))),
        (3, third_z, third_h, third_front, third_side,
         ((-86, teal_glass), (48, amber_glass))),
    )
    for floor_no, floor_z, floor_h, front_y, side_x, windows in window_sets:
        center_z = floor_z + floor_h * 0.54
        for index, (x, glass_mat) in enumerate(windows):
            research_pointed_window(
                collection, root, dict(mats, glass=glass_mat),
                f"Tavern_Floor{floor_no}_FrontStainedWindow_{index}",
                (x, front_y - 2, center_z), 38, 68)
        for index, (y, glass_mat) in enumerate(((-52, windows[1][1]), (54, windows[0][1]))):
            research_pointed_window(
                collection, root, dict(mats, glass=glass_mat),
                f"Tavern_Floor{floor_no}_SideStainedWindow_{index}",
                (side_x - 2, y, center_z), 34, 64, orientation="side")

    # The sign remains physically attached by one wall bracket and two chains.
    # Its mug emblem is pure geometry and contains no lettering.
    sign_x = 126
    sign_y = second_front - 54
    bracket_z = second_z + second_h + 8
    board_z = bracket_z - 54
    kit.box(collection, root, "Tavern_MugSign_WallBracket",
            (11, 112, 9), (sign_x, second_front - 25, bracket_z),
            mats["iron"], bevel_width=1.5)
    kit.box(collection, root, "Tavern_MugSign_BracketBrace",
            (10, 66, 8), (sign_x, second_front - 19, bracket_z - 17),
            mats["iron"], rotation=(-28, 0, 0), bevel_width=1.2)
    kit.box(collection, root, "Tavern_MugSign_OakBoard",
            (76, 11, 76), (sign_x, sign_y, board_z), sign_wood,
            rotation=(0, 0, 3), bevel_width=10)
    for chain_x in (sign_x - 24, sign_x + 24):
        kit.box(collection, root, f"Tavern_MugSign_Chain_{int(chain_x)}",
                (5, 5, 28), (chain_x, sign_y, bracket_z - 17),
                mats["iron"], bevel_width=1)
    kit.box(collection, root, "Tavern_MugSign_EmblemCup",
            (35, 6, 35), (sign_x - 5, sign_y - 9, board_z - 2),
            mats["brass"], bevel_width=5)
    kit.box(collection, root, "Tavern_MugSign_EmblemRim",
            (42, 7, 7), (sign_x - 5, sign_y - 10, board_z + 17),
            mats["brass"], bevel_width=2)
    for handle_z in (board_z - 11, board_z + 8):
        kit.box(collection, root, f"Tavern_MugSign_EmblemHandle_{int(handle_z)}",
                (18, 7, 7), (sign_x + 21, sign_y - 10, handle_z),
                mats["brass"], bevel_width=2)
    kit.box(collection, root, "Tavern_MugSign_EmblemHandleOuter",
            (7, 7, 25), (sign_x + 29, sign_y - 10, board_z - 1),
            mats["brass"], bevel_width=2)

    roof_base = base_z - 3
    kit.gabled_prism(collection, root, "Tavern_ContinuousSteepGabledRoof",
                     rw, rd, rh, (0, 0, roof_base), mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "Tavern_RoofCourse", rw, rd, rh,
                  roof_base, mats["roof"], rows=14)
    kit.box(collection, root, "Tavern_RoofRidge",
            (rw + 8, 10, 11), (0, 0, roof_base + rh + 1),
            mats["timber"], bevel_width=1.5)
    kit.lantern(collection, root, "Tavern_EntranceLantern",
                (4, ground_front - 18, ground_z + 83), mats["iron"], mats["glow"])
    return root


def build_chain_restaurant(spec):
    """Three-storey bakery successor with dining halls and a fixed pickup window."""
    collection, root, mats = common_context("chain_restaurant", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    floor_specs = (
        ("GroundKitchen", dims["groundFloor"]),
        ("SecondDining", dims["secondFloor"]),
        ("ThirdDining", dims["thirdFloor"]),
    )
    rw, rd, rh = dims["roof"]

    interior_color = kit.rgba((0.12, 0.035, 0.018, 1.0))
    warm_glass_color = kit.rgba((0.48, 0.19, 0.035, 1.0))
    teal_glass_color = kit.rgba((0.055, 0.27, 0.27, 1.0))
    interior = kit.material("MAT_ChainRestaurant_WarmDarkInterior", interior_color,
                            roughness=0.88, emission=(interior_color, 0.32))
    warm_glass = kit.material("MAT_ChainRestaurant_AmberDiningGlass", warm_glass_color,
                              roughness=0.24, emission=(warm_glass_color, 0.46))
    teal_glass = kit.material("MAT_ChainRestaurant_TealDiningGlass", teal_glass_color,
                              roughness=0.24, emission=(teal_glass_color, 0.40))

    # One complete 2x2 base supports three independently named, vertically
    # aligned floors. The kitchen is the ground floor, never a detached annex.
    kit.box(collection, root, "ChainRestaurant_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)
    floor_records = kit.stacked_bearing_shells(
        collection, root, "ChainRestaurant",
        [size for _, size in floor_specs], mats["plaster"], base_z=fh,
        band_mat=mats["timber"], band_height=13, bevel_width=4)
    for index, ((label, _), floor) in enumerate(zip(floor_specs, floor_records), start=1):
        prefix = f"ChainRestaurant_Floor{index}_{label}"
        if index == 1:
            kit.box(collection, root, prefix + "_StoneSkirt",
                    (floor["width"] + 8, floor["depth"] + 8, 50),
                    (0, 0, floor["base"] + 25), mats["stone"], bevel_width=4)
        kit.half_timber_facade(
            collection, root, prefix + "_FrontTimber", floor["width"],
            floor["height"], floor["front_y"], floor["base"], mats["timber"], bays=4)
        kit.half_timber_side(
            collection, root, prefix + "_SideTimber", floor["depth"],
            floor["height"], floor["side_x"], floor["base"], mats["timber"], bays=3)

    ground, second, third = floor_records

    # Broad open guest doors and a separate fixed pickup window make customer
    # entry and the delivery-worker handoff readable without any lettering.
    door_x = -82
    door_width = 98
    door_height = 94
    door_spring_z = ground["base"] + 66
    door_opening = portal_core(
        collection, root, "ChainRestaurant_MainDoor_WarmDarkOpening",
        52, ground["base"], door_spring_z, 11, ground["front_y"] - 2,
        interior, segments=32)
    door_opening.location.x = door_x
    door_arch = portal_arch_ring(
        collection, root, "ChainRestaurant_MainDoor_StoneArch",
        63, 52, 17, door_spring_z, ground["front_y"] - 4,
        mats["stone"], segments=32)
    door_arch.location.x = door_x
    kit.double_doors(collection, root, "ChainRestaurant_MainDoor_OpenDouble",
                     (door_x, ground["front_y"] - 22, ground["base"]),
                     door_width, door_height, mats["timber"], mats["iron"],
                     open_angle=70)
    for side in (-1, 1):
        kit.box(collection, root, f"ChainRestaurant_MainDoor_Jamb_{side:+d}",
                (14, 18, door_spring_z - ground["base"]),
                (door_x + side * (door_width / 2 + 8), ground["front_y"] - 3,
                 ground["base"] + (door_spring_z - ground["base"]) / 2),
                mats["stone"], bevel_width=2)
    kit.box(collection, root, "ChainRestaurant_MainDoor_Threshold",
            (door_width + 20, 34, 10),
            (door_x, ground["front_y"] - 17, ground["base"] + 5),
            mats["stone"], bevel_width=2)

    pickup_x = 84
    pickup_z = ground["base"] + 68
    kit.framed_glass_panel(
        collection, root, "ChainRestaurant_PickupWindow",
        (pickup_x, ground["front_y"] - 3, pickup_z), 116, 72,
        warm_glass, mats["stone"], mats["brass"],
        vertical_divisions=2, horizontal_divisions=1, ornaments=False, depth=10)
    kit.box(collection, root, "ChainRestaurant_PickupCounter",
            (142, 40, 15),
            (pickup_x, ground["front_y"] - 24, ground["base"] + 29),
            mats["stone"], bevel_width=3)
    canopy_z = ground["base"] + 124
    kit.box(collection, root, "ChainRestaurant_PickupCanopy",
            (158, 74, 11), (pickup_x, ground["front_y"] - 36, canopy_z),
            mats["roof"], rotation=(8, 0, 0), bevel_width=3)
    kit.box(collection, root, "ChainRestaurant_PickupCanopyWallBeam",
            (162, 14, 15), (pickup_x, ground["front_y"] - 4, canopy_z + 7),
            mats["timber"], bevel_width=2)

    # Repeated dining-room windows communicate a standardized chain interior
    # while preserving the project's restrained medieval commercial language.
    for floor_no, floor, glass_pair in (
            (2, second, (warm_glass, teal_glass)),
            (3, third, (teal_glass, warm_glass))):
        center_z = floor["base"] + floor["height"] * 0.53
        for window_index, (x, glass_mat) in enumerate(((-78, glass_pair[0]),
                                                        (70, glass_pair[1]))):
            kit.framed_glass_panel(
                collection, root,
                f"ChainRestaurant_Floor{floor_no}_FrontDiningWindow_{window_index}",
                (x, floor["front_y"] - 2, center_z), 92, 68,
                glass_mat, mats["stone"], mats["brass"],
                vertical_divisions=2, horizontal_divisions=2,
                horizontal_bias=0.08, ornaments=True, depth=9)
        for window_index, (y, glass_mat) in enumerate(((-55, glass_pair[1]),
                                                        (52, glass_pair[0]))):
            kit.framed_glass_panel(
                collection, root,
                f"ChainRestaurant_Floor{floor_no}_SideDiningWindow_{window_index}",
                (floor["side_x"] - 2, y, center_z), 76, 64,
                glass_mat, mats["stone"], mats["brass"], orientation="side",
                vertical_divisions=2, horizontal_divisions=2,
                horizontal_bias=0.06, ornaments=True, depth=9)

    # A side-wall plate keeps the roof silhouette continuous. Separate fork
    # and spoon geometry makes the restaurant identity readable without text.
    sign_x = ground["side_x"] - 15
    sign_y = 50
    sign_z = ground["base"] + 74
    kit.cylinder(collection, root, "ChainRestaurant_PlateSign_Back",
                 42, 10, (sign_x, sign_y, sign_z), mats["timber"],
                 rotation=(0, 90, 0), vertices=48, bevel_width=2)
    kit.cylinder(collection, root, "ChainRestaurant_PlateSign_Rim",
                 34, 12, (sign_x - 2, sign_y, sign_z), mats["brass"],
                 rotation=(0, 90, 0), vertices=48, bevel_width=1)
    kit.cylinder(collection, root, "ChainRestaurant_PlateSign_Face",
                 26, 14, (sign_x - 3, sign_y, sign_z), mats["stone"],
                 rotation=(0, 90, 0), vertices=48, bevel_width=1)
    fork_y = sign_y - 9
    kit.box(collection, root, "ChainRestaurant_PlateSign_ForkStem",
            (5, 6, 36), (sign_x - 12, fork_y, sign_z - 4),
            mats["brass"], rotation=(-16, 0, 0), bevel_width=1)
    for tine in (-6, 0, 6):
        kit.box(collection, root, f"ChainRestaurant_PlateSign_ForkTine_{tine:+d}",
                (5, 4, 15), (sign_x - 12, fork_y + tine, sign_z + 18),
                mats["brass"], rotation=(-16, 0, 0), bevel_width=0.8)
    spoon_y = sign_y + 10
    kit.box(collection, root, "ChainRestaurant_PlateSign_SpoonStem",
            (5, 6, 34), (sign_x - 12, spoon_y, sign_z - 7),
            mats["brass"], rotation=(16, 0, 0), bevel_width=1)
    spoon_bowl = kit.cylinder(
        collection, root, "ChainRestaurant_PlateSign_SpoonBowl",
        9, 5, (sign_x - 12, spoon_y + 6, sign_z + 17), mats["brass"],
        rotation=(0, 90, 0), vertices=32, bevel_width=1)
    spoon_bowl.scale.y = 0.72

    roof_base = third["top"] - 3
    hipped_roof(collection, root, "ChainRestaurant_ContinuousHippedRoof",
                rw, rd, rh, (0, 0, roof_base), mats["roof"])
    kit.box(collection, root, "ChainRestaurant_RoofCrownRidge",
            (rw * 0.44, 12, 12), (0, 0, roof_base + rh + 1),
            mats["brass"], bevel_width=1.5)
    for index, x in enumerate((-118, 116)):
        kit.chimney(collection, root, f"ChainRestaurant_KitchenChimney_{index + 1}",
                    (x, 66, roof_base + 30), mats["stone"], mats["iron"],
                    height=118)
    kit.lantern(collection, root, "ChainRestaurant_EntranceLantern",
                (-18, ground["front_y"] - 18, ground["base"] + 84),
                mats["iron"], mats["glow"])
    return root


def grand_mall_display_window(collection, root, name, location, width, height,
                              glass_mat, stone_mat, brass_mat,
                              orientation="front"):
    """Large brass-trimmed commercial window with editable mullions and rosettes."""
    kit.framed_glass_panel(
        collection, root, name, location, width, height,
        glass_mat, stone_mat, brass_mat, orientation=orientation,
        vertical_divisions=2, horizontal_divisions=2,
        horizontal_bias=0.12, ornaments=True)


def build_grand_mall(spec):
    """Four-storey grand emporium with ornate glass and a revolving entrance."""
    collection, root, mats = common_context("grand_mall", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    floor_specs = (
        ("Ground", dims["groundFloor"]),
        ("Second", dims["secondFloor"]),
        ("Third", dims["thirdFloor"]),
        ("Fourth", dims["fourthFloor"]),
    )
    rw, rd, rh = dims["roof"]

    teal = kit.rgba((0.035, 0.27, 0.31, 1.0))
    amber = kit.rgba((0.54, 0.245, 0.055, 1.0))
    burgundy = kit.rgba((0.24, 0.025, 0.04, 1.0))
    dark_interior_color = kit.rgba((0.035, 0.022, 0.025, 1.0))
    teal_glass = kit.material("MAT_GrandMall_TealGlass", teal,
                              roughness=0.18, emission=(teal, 0.52))
    amber_glass = kit.material("MAT_GrandMall_AmberGlass", amber,
                               roughness=0.2, emission=(amber, 0.46))
    burgundy_mat = kit.material("MAT_GrandMall_BurgundyEnamel", burgundy,
                                roughness=0.5, metallic=0.08)
    dark_interior = kit.material("MAT_GrandMall_DimInterior", dark_interior_color,
                                 roughness=0.9,
                                 emission=(dark_interior_color, 0.22))

    # One complete 2x2 base and four independently named, vertically aligned
    # load-bearing shells lock the exact storey count into the editable model.
    kit.box(collection, root, "GrandMall_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=6)
    base_z = fh
    floor_faces = []
    for index, (label, size) in enumerate(floor_specs, start=1):
        width, depth, height = size
        prefix = f"GrandMall_Floor{index}_{label}"
        kit.box(collection, root, prefix + "_ConnectedShell", size,
                (0, 0, base_z + height / 2), mats["plaster"], bevel_width=4)
        front_y = -depth / 2 - 4
        side_x = -width / 2 - 4
        band_mat = mats["stone"] if index in (1, 4) else burgundy_mat
        kit.box(collection, root, prefix + "_FrontFloorBand",
                (width + 20, 15, 16), (0, front_y, base_z),
                band_mat, bevel_width=2)
        kit.box(collection, root, prefix + "_SideFloorBand",
                (15, depth + 20, 16), (side_x, 0, base_z),
                band_mat, bevel_width=2)
        for side in (-1, 1):
            kit.box(collection, root, f"{prefix}_FrontCornerPilaster_{side:+d}",
                    (22, 19, height),
                    (side * (width / 2 - 11), front_y - 1, base_z + height / 2),
                    mats["stone"], bevel_width=2)
            kit.box(collection, root, f"{prefix}_SideCornerPilaster_{side:+d}",
                    (19, 22, height),
                    (side_x - 1, side * (depth / 2 - 11), base_z + height / 2),
                    mats["stone"], bevel_width=2)
        floor_faces.append((base_z, width, depth, height, front_y, side_x))
        base_z += height

    ground_z, ground_w, ground_d, ground_h, ground_front, ground_side = floor_faces[0]

    # The modeled entrance includes a dark interior opening, circular threshold
    # and canopy, central spindle, four radial glass leaves and brass edge frames.
    # These parts remain visible in Body Depth so generation cannot turn the
    # revolving door into an ordinary flat double door.
    door_x = 0
    door_width = 116
    door_height = 104
    drum_center_y = ground_front - 27
    kit.box(collection, root, "GrandMall_RevolvingDoor_DarkOpening",
            (door_width + 14, 11, door_height + 12),
            (door_x, ground_front - 1, ground_z + door_height / 2),
            dark_interior, bevel_width=3)
    for level, z in (("Threshold", ground_z + 5),
                     ("Canopy", ground_z + door_height + 8)):
        kit.cylinder(collection, root, f"GrandMall_RevolvingDoor_{level}Disc",
                     64, 10, (door_x, drum_center_y, z),
                     mats["stone"] if level == "Threshold" else mats["brass"],
                     vertices=48, bevel_width=2)
    kit.cylinder(collection, root, "GrandMall_RevolvingDoor_CentralSpindle",
                 7, door_height + 6,
                 (door_x, drum_center_y, ground_z + door_height / 2 + 3),
                 mats["brass"], vertices=24, bevel_width=1)
    wing_length = 58
    for index, angle in enumerate((22, 112, 202, 292), start=1):
        angle_rad = math.radians(angle)
        cx = door_x + math.cos(angle_rad) * wing_length / 2
        cy = drum_center_y + math.sin(angle_rad) * wing_length / 2
        wing_z = ground_z + door_height / 2
        kit.box(collection, root, f"GrandMall_RevolvingDoor_Wing{index}_Glass",
                (wing_length, 5, door_height - 10), (cx, cy, wing_z),
                teal_glass, rotation=(0, 0, angle), bevel_width=1)
        for z_offset, label in ((-(door_height - 10) / 2, "Bottom"),
                                ((door_height - 10) / 2, "Top")):
            kit.box(collection, root,
                    f"GrandMall_RevolvingDoor_Wing{index}_{label}Rail",
                    (wing_length + 4, 7, 6), (cx, cy, wing_z + z_offset),
                    mats["brass"], rotation=(0, 0, angle), bevel_width=1)
        ex = door_x + math.cos(angle_rad) * wing_length
        ey = drum_center_y + math.sin(angle_rad) * wing_length
        kit.box(collection, root, f"GrandMall_RevolvingDoor_Wing{index}_OuterPost",
                (7, 7, door_height), (ex, ey, ground_z + door_height / 2),
                mats["brass"], bevel_width=1)

    # Large display glazing on all four readable floors makes this a grand
    # commercial building rather than another treasury or stone civic hall.
    for x in (-126, 126):
        grand_mall_display_window(
            collection, root, f"GrandMall_Floor1_DisplayWindow_{int(x)}",
            (x, ground_front - 3, ground_z + 61), 82, 88,
            amber_glass if x < 0 else teal_glass, mats["stone"], mats["brass"])
    for floor_index, (floor_z, width, depth, height, front_y, side_x) in enumerate(
            floor_faces[1:], start=2):
        center_z = floor_z + height * 0.53
        for window_index, x in enumerate((-116, 0, 116)):
            glass_mat = teal_glass if (floor_index + window_index) % 2 else amber_glass
            grand_mall_display_window(
                collection, root,
                f"GrandMall_Floor{floor_index}_FrontWindow_{window_index}",
                (x, front_y - 3, center_z), 70, 70,
                glass_mat, mats["stone"], mats["brass"])
        for window_index, y in enumerate((-72, 42)):
            glass_mat = amber_glass if (floor_index + window_index) % 2 else teal_glass
            grand_mall_display_window(
                collection, root,
                f"GrandMall_Floor{floor_index}_SideWindow_{window_index}",
                (side_x - 3, y, center_z), 72, 68,
                glass_mat, mats["stone"], mats["brass"], orientation="side")

    # A wall-fixed sign with a geometric coin-and-arcade emblem. It deliberately
    # contains no lettering, avoiding unstable generated text in later stages.
    sign_z = ground_z + ground_h + 12
    kit.box(collection, root, "GrandMall_MainSign_BurgundyBoard",
            (190, 12, 38), (0, ground_front - 12, sign_z),
            burgundy_mat, bevel_width=11)
    kit.box(collection, root, "GrandMall_MainSign_BrassBorderTop",
            (168, 7, 5), (0, ground_front - 20, sign_z + 13),
            mats["brass"], bevel_width=1)
    kit.box(collection, root, "GrandMall_MainSign_BrassBorderBottom",
            (168, 7, 5), (0, ground_front - 20, sign_z - 13),
            mats["brass"], bevel_width=1)
    for index, x in enumerate((-28, 0, 28)):
        kit.cylinder(collection, root, f"GrandMall_MainSign_Coin_{index}",
                     11, 7, (x, ground_front - 21, sign_z), mats["brass"],
                     rotation=(90, 0, 0), vertices=24, bevel_width=1)
    for side in (-1, 1):
        kit.box(collection, root, f"GrandMall_MainSign_WallBracket_{side:+d}",
                (9, 32, 9), (side * 88, ground_front + 2, sign_z + 12),
                mats["iron"], rotation=(-18, 0, 0), bevel_width=1)

    roof_base = base_z - 3
    hipped_roof(collection, root, "GrandMall_ContinuousHippedRoof",
                rw, rd, rh, (0, 0, roof_base), mats["roof"])
    kit.box(collection, root, "GrandMall_RoofCrownRidge",
            (rw * 0.43, 12, 12), (0, 0, roof_base + rh + 2),
            mats["brass"], bevel_width=2)
    for x in (-ground_w / 2 + 42, ground_w / 2 - 42):
        kit.lantern(collection, root, f"GrandMall_EntranceLantern_{int(x)}",
                    (x, ground_front - 17, ground_z + 82),
                    mats["iron"], mats["glow"])
    return root


def build_stock_exchange(spec):
    """Six-storey 4x4 modern fantasy stock exchange and office block."""
    collection, root, mats = common_context("stock_exchange", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    floor_specs = (
        ("Ground", dims["groundFloor"]),
        ("Second", dims["secondFloor"]),
        ("Third", dims["thirdFloor"]),
        ("Fourth", dims["fourthFloor"]),
        ("Fifth", dims["fifthFloor"]),
        ("Sixth", dims["sixthFloor"]),
    )
    rw, rd, rh = dims["roof"]

    steel_color = kit.rgba((0.055, 0.075, 0.09, 1.0))
    blue_glass_color = kit.rgba((0.035, 0.19, 0.27, 1.0))
    amber_glass_color = kit.rgba((0.46, 0.22, 0.055, 1.0))
    ticker_color = kit.rgba((0.025, 0.095, 0.13, 1.0))
    rising_color = kit.rgba((0.10, 0.62, 0.48, 1.0))
    dark_interior_color = kit.rgba((0.018, 0.026, 0.032, 1.0))
    steel = kit.material("MAT_StockExchange_DarkSteel", steel_color,
                         roughness=0.32, metallic=0.72)
    blue_glass = kit.material("MAT_StockExchange_BlueGlass", blue_glass_color,
                              roughness=0.16, metallic=0.08,
                              emission=(blue_glass_color, 0.38))
    amber_glass = kit.material("MAT_StockExchange_AmberGlass", amber_glass_color,
                               roughness=0.2, emission=(amber_glass_color, 0.32))
    ticker = kit.material("MAT_StockExchange_TickerScreen", ticker_color,
                          roughness=0.24, emission=(ticker_color, 0.5))
    rising = kit.material("MAT_StockExchange_RisingIndicator", rising_color,
                          roughness=0.28, emission=(rising_color, 0.72))
    dark_interior = kit.material("MAT_StockExchange_DimLobby", dark_interior_color,
                                 roughness=0.9,
                                 emission=(dark_interior_color, 0.18))

    # The complete 4x4 slab and six separately named aligned shells make the
    # requested footprint and exact storey count explicit in both .blend and Depth.
    kit.box(collection, root, "StockExchange_Foundation_Base", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=9)
    base_z = fh
    floor_faces = []
    for index, (label, size) in enumerate(floor_specs, start=1):
        width, depth, height = size
        prefix = f"StockExchange_Floor{index}_{label}"
        shell_mat = mats["stone"] if index == 1 else mats["plaster"]
        kit.box(collection, root, prefix + "_ConnectedShell", size,
                (0, 0, base_z + height / 2), shell_mat, bevel_width=5)
        front_y = -depth / 2 - 4
        side_x = -width / 2 - 4
        kit.box(collection, root, prefix + "_FrontSlabBand",
                (width + 28, 18, 16), (0, front_y - 1, base_z),
                steel, bevel_width=2)
        kit.box(collection, root, prefix + "_SideSlabBand",
                (18, depth + 28, 16), (side_x - 1, 0, base_z),
                steel, bevel_width=2)
        for side in (-1, 1):
            kit.box(collection, root, f"{prefix}_FrontStructuralPier_{side:+d}",
                    (28, 21, height),
                    (side * (width / 2 - 16), front_y - 2, base_z + height / 2),
                    steel, bevel_width=2)
            kit.box(collection, root, f"{prefix}_SideStructuralPier_{side:+d}",
                    (21, 28, height),
                    (side_x - 2, side * (depth / 2 - 16), base_z + height / 2),
                    steel, bevel_width=2)
        floor_faces.append((base_z, width, depth, height, front_y, side_x))
        base_z += height

    ground_z, ground_w, _ground_d, ground_h, ground_front, _ground_side = floor_faces[0]

    # One broad transparent office lobby, with a recessed dark interior, paired
    # glass leaves and a shallow fixed canopy. No detached plaza furniture is used.
    lobby_width = 214
    lobby_height = 112
    kit.box(collection, root, "StockExchange_MainLobby_DarkOpening",
            (lobby_width + 22, 13, lobby_height + 14),
            (0, ground_front - 1, ground_z + lobby_height / 2),
            dark_interior, bevel_width=4)
    kit.box(collection, root, "StockExchange_MainLobby_GlassWall",
            (lobby_width, 7, lobby_height),
            (0, ground_front - 9, ground_z + lobby_height / 2),
            blue_glass, bevel_width=2)
    for x in (-72, 0, 72):
        kit.box(collection, root, f"StockExchange_MainLobby_SteelPost_{x:+d}",
                (8, 11, lobby_height + 8),
                (x, ground_front - 12, ground_z + lobby_height / 2),
                steel, bevel_width=1)
    for side in (-1, 1):
        leaf_x = side * 38
        kit.box(collection, root, f"StockExchange_MainLobby_DoorLeaf_{side:+d}",
                (68, 6, 98), (leaf_x, ground_front - 16, ground_z + 49),
                amber_glass, bevel_width=1.5)
        kit.box(collection, root, f"StockExchange_MainLobby_DoorHandle_{side:+d}",
                (7, 8, 34), (side * 10, ground_front - 22, ground_z + 51),
                mats["brass"], bevel_width=1)
    kit.box(collection, root, "StockExchange_MainLobby_Canopy",
            (278, 104, 15), (0, ground_front - 43, ground_z + lobby_height + 18),
            steel, bevel_width=5)
    for side in (-1, 1):
        kit.box(collection, root, f"StockExchange_MainLobby_CanopyStay_{side:+d}",
                (9, 72, 9), (side * 112, ground_front - 18, ground_z + lobby_height + 3),
                mats["brass"], rotation=(0, side * 16, 0), bevel_width=1)

    # Ground-floor finance hall glazing flanks the lobby. Upper floors use four
    # front office bays and three side bays, producing a readable curtain-wall rhythm.
    for index, x in enumerate((-245, 245)):
        kit.framed_glass_panel(
            collection, root, f"StockExchange_Floor1_FrontHallWindow_{index}",
            (x, ground_front - 4, ground_z + 68), 152, 96,
            amber_glass if index == 0 else blue_glass,
            mats["stone"], steel, vertical_divisions=3, horizontal_divisions=2)
    for floor_index, (floor_z, width, depth, height, front_y, side_x) in enumerate(
            floor_faces[1:], start=2):
        center_z = floor_z + height * 0.53
        for window_index, x in enumerate((-252, -84, 84, 252)):
            kit.framed_glass_panel(
                collection, root,
                f"StockExchange_Floor{floor_index}_FrontOfficeWindow_{window_index}",
                (x, front_y - 4, center_z), 132, 76,
                blue_glass if (floor_index + window_index) % 3 else amber_glass,
                steel, mats["brass"], vertical_divisions=3,
                horizontal_divisions=2)
        for window_index, y in enumerate((-164, 0, 164)):
            kit.framed_glass_panel(
                collection, root,
                f"StockExchange_Floor{floor_index}_SideOfficeWindow_{window_index}",
                (side_x - 4, y, center_z), 126, 76,
                blue_glass if (floor_index + window_index) % 3 else amber_glass,
                steel, mats["brass"], orientation="side", vertical_divisions=3,
                horizontal_divisions=2)

    # A fixed no-text market sign: dark ticker face, rising segmented chart,
    # coin discs and an opening bell. All elements stay physically attached.
    sign_z = ground_z + ground_h + 23
    kit.box(collection, root, "StockExchange_MainSign_TickerBoard",
            (392, 15, 58), (0, ground_front - 13, sign_z),
            ticker, bevel_width=8)
    kit.box(collection, root, "StockExchange_MainSign_SteelFrame",
            (420, 20, 76), (0, ground_front - 8, sign_z),
            steel, bevel_width=10)
    kit.box(collection, root, "StockExchange_MainSign_TickerFace",
            (390, 9, 54), (0, ground_front - 20, sign_z),
            ticker, bevel_width=7)
    chart_points = ((-132, -11), (-78, 5), (-18, -2), (48, 19), (118, 34))
    for index, ((x0, z0), (x1, z1)) in enumerate(zip(chart_points, chart_points[1:])):
        dx, dz = x1 - x0, z1 - z0
        length = math.hypot(dx, dz)
        angle = -math.degrees(math.atan2(dz, dx))
        kit.box(collection, root, f"StockExchange_MainSign_RisingChart_{index}",
                (length, 7, 8), ((x0 + x1) / 2, ground_front - 27,
                                 sign_z + (z0 + z1) / 2),
                rising, rotation=(0, angle, 0), bevel_width=2)
    for index, x in enumerate((156, 184)):
        kit.cylinder(collection, root, f"StockExchange_MainSign_Coin_{index}",
                     13, 8, (x, ground_front - 27, sign_z - 7),
                     mats["brass"], rotation=(90, 0, 0), vertices=32,
                     bevel_width=1)
    kit.cylinder(collection, root, "StockExchange_MainSign_OpeningBell",
                 18, 9, (-171, ground_front - 27, sign_z + 2),
                 mats["brass"], rotation=(90, 0, 0), vertices=20,
                 bevel_width=2)
    kit.box(collection, root, "StockExchange_MainSign_BellClapper",
            (7, 7, 17), (-171, ground_front - 32, sign_z - 15),
            mats["brass"], bevel_width=2)

    # Flat office roof with a continuous parapet and one low attached crown.
    # A compact communications antenna tower is bolted into that crown; its
    # open lattice remains roof equipment and never reads as a seventh storey.
    roof_z = base_z
    kit.box(collection, root, "StockExchange_FlatRoofSlab", (rw, rd, rh),
            (0, 0, roof_z + rh / 2), steel, bevel_width=5)
    parapet_h = 30
    for side in (-1, 1):
        kit.box(collection, root, f"StockExchange_RoofParapet_FrontBack_{side:+d}",
                (rw, 16, parapet_h),
                (0, side * (rd / 2 - 8), roof_z + rh + parapet_h / 2),
                mats["stone"], bevel_width=2)
        kit.box(collection, root, f"StockExchange_RoofParapet_Sides_{side:+d}",
                (16, rd - 28, parapet_h),
                (side * (rw / 2 - 8), 0, roof_z + rh + parapet_h / 2),
                mats["stone"], bevel_width=2)
    kit.box(collection, root, "StockExchange_RoofAttachedCrown",
            (248, 118, 24), (0, 18, roof_z + rh + 12),
            mats["brass"], bevel_width=8)

    antenna_w, antenna_d, antenna_h = dims.get(
        "antennaTower", (164, 108, 228))
    antenna_y = 18
    antenna_base_z = roof_z + rh + 24
    lattice_h = antenna_h * 0.68
    mast_h = antenna_h - lattice_h
    leg_x = antenna_w * 0.36
    leg_y = antenna_d * 0.34
    kit.box(collection, root, "StockExchange_AntennaTower_RoofMount",
            (antenna_w + 24, antenna_d + 20, 12),
            (0, antenna_y, antenna_base_z + 6), steel, bevel_width=3)
    for x_side in (-1, 1):
        for y_side in (-1, 1):
            kit.box(
                collection, root,
                f"StockExchange_AntennaTower_Leg_{x_side:+d}_{y_side:+d}",
                (12, 12, lattice_h),
                (x_side * leg_x, antenna_y + y_side * leg_y,
                 antenna_base_z + 12 + lattice_h / 2),
                steel, bevel_width=1.5)

    rail_levels = (18, lattice_h * 0.36, lattice_h * 0.68, lattice_h)
    for level_index, local_z in enumerate(rail_levels):
        rail_z = antenna_base_z + 12 + local_z
        for y_side in (-1, 1):
            kit.box(
                collection, root,
                f"StockExchange_AntennaTower_FrontBackRail_{level_index}_{y_side:+d}",
                (leg_x * 2 + 16, 9, 9),
                (0, antenna_y + y_side * leg_y, rail_z),
                steel, bevel_width=1)
        for x_side in (-1, 1):
            kit.box(
                collection, root,
                f"StockExchange_AntennaTower_SideRail_{level_index}_{x_side:+d}",
                (9, leg_y * 2 + 16, 9),
                (x_side * leg_x, antenna_y, rail_z),
                steel, bevel_width=1)

    for band_index, (z0, z1) in enumerate(zip(rail_levels, rail_levels[1:])):
        dz = z1 - z0
        front_length = math.hypot(leg_x * 2, dz)
        front_angle = -math.degrees(math.atan2(dz, leg_x * 2))
        side_length = math.hypot(leg_y * 2, dz)
        side_angle = math.degrees(math.atan2(dz, leg_y * 2))
        center_z = antenna_base_z + 12 + (z0 + z1) / 2
        direction = -1 if band_index % 2 else 1
        for y_side in (-1, 1):
            kit.box(
                collection, root,
                f"StockExchange_AntennaTower_FrontBackBrace_{band_index}_{y_side:+d}",
                (front_length, 7, 7),
                (0, antenna_y + y_side * leg_y, center_z), steel,
                rotation=(0, direction * front_angle, 0), bevel_width=0.8)
        for x_side in (-1, 1):
            kit.box(
                collection, root,
                f"StockExchange_AntennaTower_SideBrace_{band_index}_{x_side:+d}",
                (7, side_length, 7),
                (x_side * leg_x, antenna_y, center_z), steel,
                rotation=(direction * side_angle, 0, 0), bevel_width=0.8)

    lattice_top_z = antenna_base_z + 12 + lattice_h
    kit.cylinder(collection, root, "StockExchange_AntennaTower_CentralMast",
                 9, mast_h + 42,
                 (0, antenna_y, lattice_top_z + (mast_h + 42) / 2),
                 steel, vertices=16, bevel_width=1.5)
    crossarm_z = lattice_top_z + mast_h * 0.46
    kit.box(collection, root, "StockExchange_AntennaTower_Crossarm",
            (antenna_w + 38, 12, 12), (0, antenna_y, crossarm_z),
            steel, bevel_width=2)
    for panel_index, x in enumerate((-antenna_w * 0.48, 0, antenna_w * 0.48)):
        kit.box(
            collection, root,
            f"StockExchange_AntennaTower_Panel_{panel_index}",
            (30, 12, 62), (x, antenna_y - 8, crossarm_z - 2),
            mats["stone"], bevel_width=6)
        kit.box(
            collection, root,
            f"StockExchange_AntennaTower_PanelFace_{panel_index}",
            (22, 5, 52), (x, antenna_y - 16, crossarm_z - 2),
            blue_glass, bevel_width=5)
    kit.cylinder(collection, root, "StockExchange_AntennaTower_LightningRod",
                 3.5, 54, (0, antenna_y, lattice_top_z + mast_h + 69),
                 mats["brass"], vertices=12, bevel_width=0.6)
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
    return kit.torus_ring(
        collection, root, name, major_radius, minor_radius, location, mat,
        rotation=rotation, major_segments=64, minor_segments=12)


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

    # One intact 4x4 foundation and three monumental stepped terraces. All
    # platforms stay centered so the fixed camera reads one connected temple.
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

    # Broad ceremonial balustrades preserve the 4x4 scale while leaving the
    # central stair axis open. Corner pylons and braziers establish the forest
    # plane identity without adding detached shrines.
    lower_front_y = -lower_d / 2 + 12
    balustrade_z = lower_z + lower_h + 18
    front_segment_w = (lower_w - stair_w - 64) / 2
    for side_name, sign in (("Left", -1), ("Right", 1)):
        segment_x = sign * (stair_w / 2 + 32 + front_segment_w / 2)
        kit.box(collection, root, f"JungleTemple_LowerBalustrade_{side_name}",
                (front_segment_w, 18, 36), (segment_x, lower_front_y, balustrade_z),
                mats["foundation"], bevel_width=3)
        pylon_x = sign * (lower_w / 2 - 46)
        pylon_y = lower_front_y + 28
        kit.box(collection, root, f"JungleTemple_CeremonialPylon_{side_name}",
                (68, 74, 126), (pylon_x, pylon_y, lower_z + lower_h + 63),
                mats["stone"], bevel_width=6)
        kit.box(collection, root, f"JungleTemple_CeremonialPylonCap_{side_name}",
                (84, 90, 18), (pylon_x, pylon_y, lower_z + lower_h + 132),
                mats["plaster"], bevel_width=3)
        kit.cylinder(collection, root, f"JungleTemple_RitualBrazier_{side_name}",
                     24, 16, (pylon_x, pylon_y, lower_z + lower_h + 149),
                     mats["brass"], vertices=24, bevel_width=2)
        cone(collection, root, f"JungleTemple_RitualFlame_{side_name}", 18, 46,
             (pylon_x, pylon_y, lower_z + lower_h + 178), mats["glow"],
             vertices=18)
        side_x = sign * (lower_w / 2 - 10)
        kit.box(collection, root, f"JungleTemple_SideBalustrade_{side_name}",
                (18, lower_d - 92, 32), (side_x, 24, balustrade_z - 2),
                mats["foundation"], bevel_width=3)

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
    doorway_w, doorway_h = min(132, shrine_w * 0.36), 142
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
    # Deep geometric ribs and glyph panels make the enlarged sanctuary legible
    # at RTS distance; all relief remains attached to the wall.
    for side_name, sign in (("Left", -1), ("Right", 1)):
        relief_x = sign * shrine_w * 0.30
        kit.box(collection, root, f"JungleTemple_SanctuaryReliefFrame_{side_name}",
                (58, 9, 118), (relief_x, shrine_front_y - 5,
                               shrine_base + shrine_h * 0.54),
                mats["foundation"], bevel_width=5)
        for band_index, z in enumerate((shrine_base + 76,
                                        shrine_base + 112,
                                        shrine_base + 148)):
            kit.box(collection, root,
                    f"JungleTemple_SanctuaryGlyph_{side_name}_{band_index:02d}",
                    (36, 13, 12), (relief_x, shrine_front_y - 11, z),
                    mats["brass"], rotation=(0, 0, sign * (28 if band_index % 2 == 0 else -28)),
                    bevel_width=2)

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
        connector_inner = (-1 if x < 0 else 1) * (shrine_w / 2 - 10)
        connector_outer = x - (-1 if x < 0 else 1) * tower_w / 2
        connector_w = abs(connector_outer - connector_inner) + 24
        kit.box(collection, root, f"JungleTemple_{side}TowerGallery",
                (connector_w, 82, 68),
                ((connector_inner + connector_outer) / 2, tower_y,
                 shrine_base + 38), mats["stone"], bevel_width=4)
        kit.box(collection, root, f"JungleTemple_{side}TowerGalleryCornice",
                (connector_w + 24, 98, 14),
                ((connector_inner + connector_outer) / 2, tower_y,
                 shrine_base + 72), mats["plaster"], bevel_width=3)
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
        kit.cylinder(collection, root, f"JungleTemple_{side}TowerBrazier", 17, 13,
                     (x, tower_y, deck_z + 66), mats["brass"],
                     vertices=24, bevel_width=2)
        cone(collection, root, f"JungleTemple_{side}TowerFlame", 13, 34,
             (x, tower_y, deck_z + 88), mats["glow"], vertices=18)

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
    for index, x in enumerate((-78, -39, 0, 39, 78)):
        spike_h = 64 if index == 2 else 46
        cone(collection, root, f"JungleTemple_CrownSunRay_{index:02d}",
             11, spike_h, (x, shrine_y + 8,
                           comb_z + 42 + spike_h / 2),
             mats["brass"], vertices=12)
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
    # Keep the formal temple elevation mirrored around local X. Vegetation is
    # allowed to feel organic, but its architectural attachment points remain
    # paired so the landmark silhouette reads as ceremonial and deliberate.
    for side_name, sign in (("Left", -1), ("Right", 1)):
        kit.box(collection, root, f"JungleTemple_Moss_CrownFront_{side_name}",
                (crown_w * 0.26, 7, 8),
                (sign * crown_w * 0.18,
                 shrine_y - crown_d / 2 - 3,
                 crown_base_z + crown_h - 2),
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
    band_z = base_z + height * 0.70
    kit.box(collection, root, prefix + "_FrontTimberBand", (width + 8, 7, 9),
            (0, front_y, band_z), mats["timber"], bevel_width=1)
    for side_name, sign in (("Left", -1), ("Right", 1)):
        side_x = sign * (width / 2 + 3)
        kit.box(collection, root, prefix + f"_{side_name}TimberBand",
                (7, depth + 8, 9), (side_x, center_y, band_z),
                mats["timber"], bevel_width=1)
    for index, x in enumerate((-(window_count - 1) * 25 + 50 * i
                               for i in range(window_count)), start=1):
        kit.box(collection, root, f"{prefix}_FrontWindow_{index:02d}",
                (22, 7, 31), (x, front_y - 2, base_z + height * 0.45),
                mats["glass"], bevel_width=3)
        kit.box(collection, root, f"{prefix}_FrontWindowFrame_{index:02d}",
                (30, 5, 39), (x, front_y + 1, base_z + height * 0.45),
                mats["timber"], bevel_width=2)
    for side_name, sign in (("Left", -1), ("Right", 1)):
        side_x = sign * (width / 2 + 3)
        for index, y in enumerate((center_y - depth * 0.22,
                                   center_y + depth * 0.22), start=1):
            kit.box(collection, root,
                    f"{prefix}_{side_name}Window_{index:02d}",
                    (7, 22, 30),
                    (side_x + sign * 2, y, base_z + height * 0.45),
                    mats["glass"], bevel_width=3)
            kit.box(collection, root,
                    f"{prefix}_{side_name}WindowFrame_{index:02d}",
                    (5, 30, 38),
                    (side_x - sign, y, base_z + height * 0.45),
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
    for side_name, sign in (("Left", -1), ("Right", 1)):
        kit.box(collection, root, f"SnowCastle_FoundationSnow{side_name}",
                (16, fd - 30, 5),
                (sign * (fw / 2 - 11), 0, fh + 2.5),
                mats["snow"], bevel_width=2)

    # A heavy outer enceinte fills the 4x4 landmark footprint. The central gap
    # remains aligned to the only gate and stair axis.
    rampart_y = -fd * 0.31
    rampart_segment_w = fw * 0.34
    for side_name, sign in (("Left", -1), ("Right", 1)):
        rampart_x = sign * (fw * 0.27)
        kit.box(collection, root, f"SnowCastle_OuterRampart_{side_name}",
                (rampart_segment_w, 78, 92),
                (rampart_x, rampart_y, fh + 46), mats["stone"], bevel_width=6)
        kit.box(collection, root, f"SnowCastle_OuterRampartSnow_{side_name}",
                (rampart_segment_w - 18, 66, 7),
                (rampart_x, rampart_y, fh + 95), mats["snow"], bevel_width=2)
        bastion_x = sign * (fw * 0.40)
        kit.box(collection, root, f"SnowCastle_OuterBastion_{side_name}",
                (126, 136, 118), (bastion_x, rampart_y + 18, fh + 59),
                mats["stone"], bevel_width=7)
        japanese_castle_roof(
            collection, root, f"SnowCastle_OuterBastionRoof_{side_name}",
            166, 176, 42, fh + 112, rampart_y + 18, mats,
            center_x=bastion_x, snow_inset=13)
        kit.box(collection, root, f"SnowCastle_OuterBannerPole_{side_name}",
                (7, 7, 142), (bastion_x, rampart_y - 52, fh + 178),
                mats["iron"], bevel_width=1)
        kit.box(collection, root, f"SnowCastle_OuterBanner_{side_name}",
                (54, 5, 72), (bastion_x + sign * 23, rampart_y - 52,
                              fh + 218), mats["brass"], bevel_width=2)

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
        for side_name, sign in (("Left", -1), ("Right", 1)):
            kit.box(collection, root, name + f"_{side_name}SnowShelf",
                    (13, depth - 20, 5),
                    (sign * (width / 2 - 8), center_y, top_z + 2.5),
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

    # A restrained golden shachi-like ridge pair and central command finial
    # identify the five-storey keep without turning it into a shrine.
    for side_name, x in (("Left", -34), ("Right", 34)):
        kit.cylinder(collection, root, "SnowCastle_CrownFinial_" + side_name,
                     7, 24, (x, keep_y, level_base + 12), mats["brass"],
                     vertices=16, bevel_width=1)
        cone(collection, root, "SnowCastle_CrownPoint_" + side_name,
             9, 26, (x, keep_y, level_base + 37), mats["brass"], vertices=18)
    kit.cylinder(collection, root, "SnowCastle_CommandFinialShaft", 8, 62,
                 (0, keep_y, level_base + 40), mats["brass"],
                 vertices=18, bevel_width=1.5)
    cone(collection, root, "SnowCastle_CommandFinialCrown", 16, 54,
         (0, keep_y, level_base + 98), mats["brass"], vertices=18)

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
            (0, gate_front_y - 4, upper_top + gate_h * 0.48), mats["timber"], bevel_width=3)
    for side_name, sign in (("Left", -1), ("Right", 1)):
        pylon_x = sign * (gate_w / 2 + 28)
        kit.box(collection, root, f"SnowCastle_GatePylon_{side_name}",
                (46, gate_d + 20, gate_h + 42),
                (pylon_x, gate_y, upper_top + (gate_h + 42) / 2),
                mats["stone"], bevel_width=5)
        kit.box(collection, root, f"SnowCastle_GatePylonSnowCap_{side_name}",
                (58, gate_d + 32, 7),
                (pylon_x, gate_y, upper_top + gate_h + 45),
                mats["snow"], bevel_width=2)
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
        # Each academy tower receives a readable crest and a pair of hanging
        # lanterns, all attached to the front facade.
        kit.cylinder(collection, root, prefix + "_AcademyCrest", 22, 9,
                     (x, tower_y - tower_d / 2 - 9,
                      tower_base + lower_h * 0.72), mats["brass"],
                     rotation=(90, 0, 0), vertices=28, bevel_width=2)
        for lantern_index, offset_x in enumerate((-tower_w * 0.30, tower_w * 0.30)):
            kit.lantern(collection, root,
                        prefix + f"_GateLantern_{lantern_index:02d}",
                        (x + offset_x, tower_y - tower_d / 2 - 16,
                         tower_base + lower_h * 0.42), mats["iron"], mats["glow"])
    return root


def build_desert_mansion(spec):
    collection, root, mats = common_context("desert_mansion", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    lower_w, lower_d, lower_h = dims["lowerTier"]
    middle_w, middle_d, middle_h = dims["middleTier"]
    upper_w, upper_d, upper_h = dims["upperTier"]
    crown_tier = dims.get("crownTier")
    wing_w, wing_d, wing_h = dims["wing"]
    main_dome_radius, main_dome_height = dims["mainDome"]
    wing_dome_radius, wing_dome_height = dims["wingDome"]
    tower_radius, tower_height = dims["tower"]
    body_offset_x, body_offset_y = dims.get("bodyOffset", (0, 0))

    # One intact 4x4 residence on one foundation. Four centered levels step back
    # toward the dome while both wings overlap the lowest floor, so the whole
    # silhouette remains one residence instead of a detached palace group.
    kit.box(collection, root, "DesertMansion_Foundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)
    kit.box(collection, root, "DesertMansion_UpperPlinth", (fw - 42, fd - 38, 18),
            (0, 8, fh + 9), mats["stone"], bevel_width=4)
    body_base = fh + 18
    body_y = 28
    tier_specs = [
        ("Lower", lower_w, lower_d, lower_h, 0),
        ("Middle", middle_w, middle_d, middle_h, 16),
        ("Upper", upper_w, upper_d, upper_h, 30),
    ]
    if crown_tier:
        crown_w, crown_d, crown_h = crown_tier
        tier_specs.append(("Crown", crown_w, crown_d, crown_h, 44))
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
        # A repeated parapet rhythm strengthens the palace silhouette without
        # adding readable text or detached ornaments.
        parapet_front_y = body_y + y_offset - tier_d / 2 - 5
        parapet_count = max(3, int(tier_w // 92))
        for parapet_index in range(parapet_count):
            parapet_x = -tier_w * 0.40 + tier_w * 0.80 * (
                parapet_index / max(1, parapet_count - 1))
            kit.box(collection, root,
                    f"DesertMansion_{tier_name}Parapet_{parapet_index:02d}",
                    (26, 16, 28),
                    (parapet_x, parapet_front_y,
                     tier_top_z + 10), mats["stone"], bevel_width=3)
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
        wing_front_y = body_y + 4 - wing_d / 2 - 5
        for bay_index, bay_offset in enumerate((-0.28, 0, 0.28)):
            bay_x = x + wing_w * bay_offset
            kit.box(collection, root,
                    f"DesertMansion_{side}WingArcadeBay_{bay_index:02d}",
                    (42, 13, 92), (bay_x, wing_front_y,
                                   body_base + wing_h * 0.46),
                    mats["iron"], bevel_width=12)
            kit.box(collection, root,
                    f"DesertMansion_{side}WingArcadeGlow_{bay_index:02d}",
                    (26, 6, 68), (bay_x, wing_front_y - 8,
                                  body_base + wing_h * 0.46),
                    mats["glass"], bevel_width=9)
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
        # Paired roof-corner finials make the wing hierarchy visible while
        # preserving exact local-X mirror symmetry across the full residence.
        for corner_index, local_sign in enumerate((-1, 1), start=1):
            kit.cylinder(
                collection, root,
                f"DesertMansion_{side}WingCornerFinial_{corner_index:02d}",
                4, 28,
                (x + local_sign * wing_w * 0.34,
                 body_y + 4 - wing_d * 0.30,
                 body_base + wing_h + 8),
                mats["brass"], vertices=12, bevel_width=1)

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
    doorway_w, doorway_h = 136, 188
    entry_spring_z = body_base + doorway_h - 22
    kit.box(collection, root, "DesertMansion_EntryRecess",
            (doorway_w + 34, 16, doorway_h + 26),
            (0, front_y - 2, body_base + (doorway_h + 26) / 2),
            mats["iron"], bevel_width=10)
    kit.box(collection, root, "DesertMansion_EntryWarmInterior",
            (doorway_w - 28, 7, doorway_h - 24),
            (0, front_y - 10, body_base + (doorway_h - 24) / 2 + 8),
            mats["glow"], bevel_width=8)
    portal_arch_ring(collection, root, "DesertMansion_EntryPointedFrame",
                     doorway_w * 0.60, 74, 28, entry_spring_z, front_y - 8,
                     mats["stone"], segments=28)
    for side, x in (("Left", -doorway_w / 2 - 28),
                    ("Right", doorway_w / 2 + 28)):
        kit.box(collection, root, f"DesertMansion_Entry_{side}Pier",
                (42, 34, doorway_h + 54),
                (x, front_y - 7, body_base + (doorway_h + 54) / 2),
                mats["stone"], bevel_width=4)
    kit.box(collection, root, "DesertMansion_EntryMonumentalCrown",
            (doorway_w + 112, 38, 34),
            (0, front_y - 7, body_base + doorway_h + 50),
            mats["plaster"], bevel_width=5)
    kit.cylinder(collection, root, "DesertMansion_EntrySunSeal", 34, 12,
                 (0, front_y - 30, body_base + doorway_h + 50),
                 mats["brass"], rotation=(90, 0, 0), vertices=40,
                 bevel_width=2)

    # Three broad shallow steps tie the entrance to the visible front edge and
    # echo the stepped vertical hierarchy without adding a second access route.
    for step_index in range(5):
        step_height = 6 * (step_index + 1)
        kit.box(collection, root, f"DesertMansion_EntryStep_{step_index + 1:02d}",
                (232 - step_index * 14, 24, step_height),
                (0, front_y - 54 + step_index * 14,
                 fh + step_height / 2), mats["stone"], bevel_width=2)

    # Paired arched window bays keep the facade palatial without creating
    # additional doors. Matching side bays preserve the strict bilateral read.
    for side, sign in (("Left", -1), ("Right", 1)):
        x = sign * lower_w * 0.28
        kit.box(collection, root, f"DesertMansion_{side}LowerFrontWindow",
                (36, 8, 68), (x, front_y - 2, body_base + 80),
                mats["glass"], bevel_width=12)
        kit.box(collection, root, f"DesertMansion_{side}LowerFrontWindowSill",
                (48, 13, 8), (x, front_y - 5, body_base + 45),
                mats["brass"], bevel_width=2)
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

    # Two monumental integrated torch-shaped towers flank the enlarged palace.
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

    # Attached front colonnades visually bind both palace wings to the iwan.
    colonnade_y = front_y - 18
    for side_name, sign in (("Left", -1), ("Right", 1)):
        start_x = sign * (doorway_w / 2 + 66)
        end_x = sign * (wing_x + wing_w * 0.30)
        span = abs(end_x - start_x)
        center_x = (start_x + end_x) / 2
        kit.box(collection, root, f"DesertMansion_{side_name}RoyalColonnadeCanopy",
                (span + 72, 78, 18), (center_x, colonnade_y,
                                     body_base + 144),
                mats["plaster"], bevel_width=5)
        for column_index in range(4):
            t = column_index / 3
            x = start_x + (end_x - start_x) * t
            kit.cylinder(collection, root,
                         f"DesertMansion_{side_name}RoyalColumn_{column_index:02d}",
                         14, 142, (x, colonnade_y - 2, body_base + 71),
                         mats["stone"], vertices=16, bevel_width=2)
            kit.cylinder(collection, root,
                         f"DesertMansion_{side_name}RoyalColumnCapital_{column_index:02d}",
                         20, 14, (x, colonnade_y - 2, body_base + 137),
                         mats["brass"], vertices=16, bevel_width=2)

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


def energy_vein_footprint_bed(collection, root, name, size, mat):
    """Exact one-cell building footprint rendered as a very shallow rubble bed."""
    width, depth, thickness = (float(value) for value in size)
    half_w, half_d = width / 2.0, depth / 2.0
    # The outer bounds exactly match the authoritative 1x1 natural-structure
    # foundation (238x196 model units). Intermediate points break the long edges
    # into a rubble-like contour without moving any corner beyond the footprint.
    outline = [
        (-half_w, -half_d), (-half_w * 0.34, -half_d),
        (half_w * 0.36, -half_d), (half_w, -half_d),
        (half_w, -half_d * 0.31), (half_w, half_d * 0.38),
        (half_w, half_d), (half_w * 0.32, half_d),
        (-half_w * 0.37, half_d), (-half_w, half_d),
        (-half_w, half_d * 0.35), (-half_w, -half_d * 0.36),
    ]
    count = len(outline)
    vertices = [(x, y, 0.0) for x, y in outline]
    vertices.extend((x, y, thickness) for x, y in outline)
    faces = [tuple(reversed(range(count))), tuple(range(count, count * 2))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    kit.bevel(obj, 0.55, 1)
    return obj


def build_energy_vein(building_id, spec):
    """One-cell diamond exposed mine: rubble footprint with embedded energy plates."""
    collection, root, mats = common_context(building_id, spec)
    dims = spec["dimensions"]
    footprint = dims["footprint"]
    energy_vein_footprint_bed(
        collection, root, "EnergyVein_Footprint_RubbleBed",
        footprint, mats["stone"])
    surface_z = float(footprint[2])

    # Flat overlapping boulders turn the thin footprint surface into a rubble
    # mine bed; the exact outer bounds still come only from the shared 1x1 base.
    for index, values in enumerate(dims["bedPatches"], 1):
        x, y, width, depth, height, rx, ry, rz = values
        kit.rough_boulder(
            collection, root, f"EnergyVein_RubblePatch_{index:02d}",
            (width, depth, height),
            (x, y, surface_z + max(0.8, height * 0.10)),
            mats["stone"], rotation=(rx, ry, rz), subdivisions=2)

    # Secondary rubble overlaps the patches so the final cutout remains a
    # coherent mineral vein rather than isolated pebbles or a circular stone ring.
    for index, values in enumerate(dims["rocks"], 1):
        x, y, width, depth, height, rx, ry, rz = values
        kit.rough_boulder(
            collection, root, f"EnergyVein_Rubble_{index:02d}",
            (width, depth, height),
            (x, y, surface_z + max(1.0, height * 0.16)),
            mats["stone"], rotation=(rx, ry, rz), subdivisions=2)

    # Energy stays as broad fractured plates sunk into the rubble field.  The
    # model enforces width/depth dominance so 12/48-step refinement cannot turn
    # the seam into upright crystals.
    for index, values in enumerate(dims["energyBlocks"], 1):
        x, y, width, depth, height, rx, ry, rz = values
        material = mats["crystalHighlight"] if index % 3 == 1 else mats["crystal"]
        kit.rough_boulder(
            collection, root, f"EnergyVein_Block_{index:02d}",
            (width, depth, height),
            (x, y, surface_z + max(1.5, height * 0.40)),
            material, rotation=(rx, ry, rz), subdivisions=1)
    return root


def build_energy_vein_1(spec):
    return build_energy_vein("energy_vein_1", spec)


def build_energy_vein_2(spec):
    return build_energy_vein("energy_vein_2", spec)


def build_energy_vein_3(spec):
    return build_energy_vein("energy_vein_3", spec)


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


def build_house_lv4(spec):
    """Three-storey manor-house upgrade that keeps the established house family."""
    collection, root, mats = common_context("house_lv4", spec)
    dims = spec["dimensions"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    storeys = [float(value) for value in dims.get("storeyHeights", (92, 92, 92))]
    if len(storeys) != 3 or abs(sum(storeys) - bh) > 0.01:
        raise ValueError("house_lv4 storeyHeights must contain three values summing to body height")
    lower_h = float(dims.get("lowerStoneHeight", 76))
    first_top = storeys[0]
    second_top = first_top + storeys[1]
    roof_base = bh - 3
    front_y = -bd / 2 - 4
    side_x = -bw / 2 - 4

    flower_mats = {
        "leaf": kit.material("MAT_HouseLV4_Leaf", kit.rgba((0.085, 0.22, 0.065, 1.0)), roughness=0.82),
        "red": kit.material("MAT_HouseLV4_Flower_Red", kit.rgba((0.58, 0.035, 0.025, 1.0)), roughness=0.65),
        "purple": kit.material("MAT_HouseLV4_Flower_Purple", kit.rgba((0.30, 0.055, 0.46, 1.0)), roughness=0.62),
        "gold": kit.material("MAT_HouseLV4_Flower_Gold", kit.rgba((0.88, 0.38, 0.03, 1.0)), roughness=0.60),
    }

    # LV4 stays on the same compact 2x2 family footprint, but gains one real,
    # independently named bearing storey.  The aligned shells lock the model as
    # a three-storey town manor instead of allowing refinement to invent a tower.
    kit.box(collection, root, "HouseLV4_Level1_BearingShell", (bw, bd, storeys[0]),
            (0, 0, storeys[0] / 2), mats["plaster"], bevel_width=5)
    kit.box(collection, root, "HouseLV4_Level2_BearingShell", (bw, bd, storeys[1]),
            (0, 0, first_top + storeys[1] / 2), mats["plaster"], bevel_width=4)
    kit.box(collection, root, "HouseLV4_Level3_BearingShell", (bw, bd, storeys[2]),
            (0, 0, second_top + storeys[2] / 2), mats["plaster"], bevel_width=4)
    kit.box(collection, root, "HouseLV4_GroundSill", (bw + 10, bd + 10, 10),
            (0, 0, 5), mats["foundation"], bevel_width=2)
    kit.box(collection, root, "HouseLV4_LowerStoneCladding", (bw + 6, bd + 6, lower_h),
            (0, 0, lower_h / 2), mats["stone"], bevel_width=4)

    for floor_index, (base_z, height) in enumerate(((first_top, storeys[1]),
                                                     (second_top, storeys[2])), 2):
        kit.half_timber_facade(
            collection, root, f"HouseLV4_Level{floor_index}_FrontTimber",
            bw, height, front_y, base_z, mats["timber"], bays=4)
        kit.half_timber_side(
            collection, root, f"HouseLV4_Level{floor_index}_SideTimber",
            bd, height, side_x, base_z, mats["timber"], bays=4)
    for band_index, z in enumerate((first_top, second_top, bh - 7), 1):
        kit.box(collection, root, f"HouseLV4_FrontFloorBand_{band_index}",
                (bw + 12, 10, 12), (0, front_y, z), mats["timber"], bevel_width=1)
        kit.box(collection, root, f"HouseLV4_SideFloorBand_{band_index}",
                (10, bd + 12, 12), (side_x, 0, z), mats["timber"], bevel_width=1)
        kit.box(collection, root, f"HouseLV4_FrontBrassInlay_{band_index}",
                (bw + 15, 5, 4), (0, front_y - 7, z + 1), mats["brass"], bevel_width=0.6)
        kit.box(collection, root, f"HouseLV4_SideBrassInlay_{band_index}",
                (5, bd + 15, 4), (side_x - 7, 0, z + 1), mats["brass"], bevel_width=0.6)
    for index, (x, y) in enumerate(((-bw / 2 - 2, -bd / 2 - 2),
                                     (bw / 2 + 2, -bd / 2 - 2),
                                     (-bw / 2 - 2, bd / 2 + 2))):
        kit.box(collection, root, f"HouseLV4_CornerPost_{index}", (12, 12, bh),
                (x, y, bh / 2), mats["timber"], bevel_width=1.2)
        for cap_index, z in enumerate((first_top, second_top, bh - 8), 1):
            kit.box(collection, root, f"HouseLV4_CornerCap_{index}_{cap_index}",
                    (19, 19, 9), (x, y, z), mats["brass"], bevel_width=1)

    # The entrance retains the earlier house's left-offset doorway, upgraded to
    # a deeper attached porch.  It is elegant but never becomes a detached wing.
    door_x = -76
    kit.double_doors(collection, root, "HouseLV4_MainDoor",
                     (door_x, front_y - 4, 0), 68, 118,
                     mats["timber"], mats["iron"], open_angle=0)
    kit.box(collection, root, "HouseLV4_DoorStoneFrame", (88, 14, 14),
            (door_x, front_y - 3, 123), mats["foundation"], bevel_width=2)
    kit.gabled_prism(collection, root, "HouseLV4_EntranceCanopy",
                     112, 62, 30, (door_x, front_y - 32, 121),
                     mats["timber"], mats["roof"])
    for post_index, post_x in enumerate((door_x - 45, door_x + 45)):
        kit.box(collection, root, f"HouseLV4_PorchPost_{post_index}", (9, 9, 92),
                (post_x, front_y - 54, 46), mats["timber"], bevel_width=1.2)
        kit.box(collection, root, f"HouseLV4_PorchPostFoot_{post_index}", (15, 15, 10),
                (post_x, front_y - 54, 5), mats["stone"], bevel_width=1)

    window_rows = ((58, 0.78), (142, 0.82), (232, 0.82))
    for floor_index, (z, scale) in enumerate(window_rows, 1):
        kit.shutter_window(collection, root, f"HouseLV4_FrontWindow_L{floor_index}",
                           (50, front_y - 3, z), mats["glass"], mats["timber"],
                           mats["iron"], scale=scale)
        for side_index, y in enumerate((-50, 52), 1):
            kit.shutter_window(collection, root,
                               f"HouseLV4_SideWindow_L{floor_index}_{side_index}",
                               (side_x - 2, y, z), mats["glass"], mats["timber"],
                               mats["iron"], orientation="side", scale=scale * 0.88)

    # An inherited ornate side balcony marks continuity with LV3.  The small
    # third-floor front Juliet balcony and dormer make LV4 read as a refined
    # manor house rather than a merely stretched version of the earlier shell.
    house_balcony(collection, root, "HouseLV4_Level2OrnateBalcony", side_x, 32,
                  first_top + 15, mats, length=148, ornate=True)
    juliet_x = 50
    juliet_z = second_top + 12
    kit.box(collection, root, "HouseLV4_Level3Juliet_Platform", (112, 38, 10),
            (juliet_x, front_y - 20, juliet_z), mats["timber"], bevel_width=2)
    kit.box(collection, root, "HouseLV4_Level3Juliet_OuterRail", (116, 8, 9),
            (juliet_x, front_y - 39, juliet_z + 38), mats["brass"], bevel_width=1)
    for rail_index, x in enumerate((juliet_x - 50, juliet_x - 25, juliet_x,
                                    juliet_x + 25, juliet_x + 50)):
        kit.box(collection, root, f"HouseLV4_Level3Juliet_Baluster_{rail_index}",
                (7, 7, 38), (x, front_y - 39, juliet_z + 20),
                mats["brass"], bevel_width=1)
        kit.cylinder(collection, root, f"HouseLV4_Level3Juliet_Cap_{rail_index}",
                     4.5, 5, (x, front_y - 39, juliet_z + 43), mats["brass"],
                     vertices=16, bevel_width=0.5)

    house_flower_box(collection, root, "HouseLV4_FrontFlowerBox_L1",
                     (50, front_y - 16, 35), "front", mats, flower_mats, scale=0.90)
    house_flower_box(collection, root, "HouseLV4_FrontFlowerBox_L2",
                     (50, front_y - 16, 117), "front", mats, flower_mats, scale=0.98)
    for floor_index, z in enumerate((116, 207), 2):
        house_flower_box(collection, root, f"HouseLV4_SideFlowerBox_L{floor_index}",
                         (side_x - 16, 52, z), "side", mats, flower_mats, scale=0.96)

    kit.cylinder(collection, root, "HouseLV4_FamilyCrest_Backplate", 27, 8,
                 (door_x, front_y - 12, 164), mats["brass"],
                 rotation=(90, 0, 0), vertices=24, bevel_width=1)
    kit.cylinder(collection, root, "HouseLV4_FamilyCrest_Emblem", 17, 10,
                 (door_x, front_y - 17, 164), mats["iron"],
                 rotation=(90, 0, 0), vertices=12, bevel_width=1)
    kit.lantern(collection, root, "HouseLV4_PorchLantern",
                (-22, front_y - 18, 79), mats["iron"], mats["glow"])
    kit.lantern(collection, root, "HouseLV4_BalconyLantern",
                (side_x - 49, 102, first_top + 86), mats["iron"], mats["glow"],
                orientation="side")

    kit.gabled_prism(collection, root, "HouseLV4_MainGabledRoof", rw, rd, rh,
                     (0, 0, roof_base), mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "HouseLV4_RoofCourse", rw, rd, rh,
                  roof_base, mats["roof"], rows=15)
    kit.box(collection, root, "HouseLV4_RidgeCap", (rw + 4, 12, 10),
            (0, 0, roof_base + rh + 2), mats["roof"], bevel_width=1)

    dormer_x = -38
    dormer_y = -78
    dormer_base = roof_base + rh * (1 - abs(dormer_y) / (rd / 2)) - 2
    kit.box(collection, root, "HouseLV4_RoofDormer_Body", (66, 58, 42),
            (dormer_x, dormer_y, dormer_base + 21), mats["plaster"], bevel_width=2)
    dormer_roof = kit.gabled_prism(
        collection, root, "HouseLV4_RoofDormer_Gable", 64, 72, 30,
        (dormer_x, dormer_y, dormer_base + 40), mats["timber"], mats["roof"])
    dormer_roof.rotation_euler[2] = math.radians(90)
    kit.shutter_window(collection, root, "HouseLV4_RoofDormer_Window",
                       (dormer_x, dormer_y - 32, dormer_base + 22),
                       mats["glass"], mats["timber"], mats["iron"], scale=0.46)

    kit.chimney(collection, root, "HouseLV4_Chimney",
                (88, 44, roof_base + 36), mats["stone"], mats["iron"], height=104)
    for finial_index, x in enumerate((-rw * 0.42, rw * 0.42)):
        kit.cylinder(collection, root, f"HouseLV4_RidgeFinialBase_{finial_index}",
                     7, 12, (x, 0, roof_base + rh + 9), mats["brass"],
                     vertices=16, bevel_width=0.8)
        cone(collection, root, f"HouseLV4_RidgeFinial_{finial_index}", 8, 24,
             (x, 0, roof_base + rh + 27), mats["brass"], vertices=20)
    return root


def house_front_balcony(collection, root, name, center_x, front_y, base_z,
                        width, mats, *, glass_rail=False):
    """Shallow attached residential balcony for the later house family."""
    platform_y = front_y - 22
    outer_y = front_y - 42
    kit.box(collection, root, name + "_Platform", (width, 44, 10),
            (center_x, platform_y, base_z), mats["stone"], bevel_width=2)
    rail_mat = mats["glass"] if glass_rail else mats["iron"]
    kit.box(collection, root, name + "_OuterRail", (width - 8, 7, 8),
            (center_x, outer_y, base_z + 34), rail_mat, bevel_width=1)
    for index, x in enumerate((center_x - width * 0.42,
                               center_x - width * 0.21,
                               center_x,
                               center_x + width * 0.21,
                               center_x + width * 0.42)):
        kit.box(collection, root, f"{name}_Baluster_{index}", (6, 6, 34),
                (x, outer_y, base_z + 18), mats["iron"], bevel_width=0.8)
    for side in (-1, 1):
        end_x = center_x + side * (width / 2 - 4)
        kit.box(collection, root, f"{name}_EndRail_{side:+d}", (6, 38, 8),
                (end_x, platform_y, base_z + 34), rail_mat, bevel_width=1)
    return platform_y, outer_y


def house_flat_roof(collection, root, name, width, depth, base_z, height,
                    mats, *, parapet_height=22):
    """Connected flat roof slab and low parapet; never counts as a storey."""
    kit.box(collection, root, name + "_RoofSlab", (width, depth, height),
            (0, 0, base_z + height / 2), mats["roof"], bevel_width=3)
    parapet_z = base_z + height + parapet_height / 2
    for side in (-1, 1):
        kit.box(collection, root, f"{name}_ParapetFrontBack_{side:+d}",
                (width, 12, parapet_height),
                (0, side * (depth / 2 - 6), parapet_z),
                mats["iron"], bevel_width=2)
        kit.box(collection, root, f"{name}_ParapetSides_{side:+d}",
                (12, depth - 20, parapet_height),
                (side * (width / 2 - 6), 0, parapet_z),
                mats["iron"], bevel_width=2)
    return base_z + height


def build_house_lv5(spec):
    """Four-storey Victorian steam townhouse on the established 2x2 home."""
    collection, root, mats = common_context("house_lv5", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    storeys = [float(value) for value in dims["storeyHeights"]]
    if len(storeys) != 4 or abs(sum(storeys) - bh) > 0.01:
        raise ValueError("house_lv5 storeyHeights must contain four values summing to body height")

    brick = kit.material(
        "MAT_HouseLV5_VictorianBrick", kit.rgba((0.285, 0.095, 0.055, 1.0)),
        roughness=0.88, noise={"scale": 8, "detail": 4, "bump": 0.18})
    copper = kit.material(
        "MAT_HouseLV5_AgedCopper", kit.rgba((0.075, 0.25, 0.21, 1.0)),
        roughness=0.52, metallic=0.55,
        noise={"scale": 6, "detail": 3, "bump": 0.08})
    dark_interior = kit.material(
        "MAT_HouseLV5_DimInterior", kit.rgba((0.035, 0.025, 0.02, 1.0)),
        roughness=0.94)

    kit.box(collection, root, "HouseLV5_GroundSill", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)
    floor_sizes = [(bw, bd, height) for height in storeys]
    floors = kit.stacked_bearing_shells(
        collection, root, "HouseLV5", floor_sizes,
        (brick, brick, mats["plaster"], mats["plaster"]),
        base_z=fh, band_mat=mats["stone"], band_height=13, bevel_width=5)
    kit.box(collection, root, "HouseLV5_LowerStoneSkirt",
            (bw + 8, bd + 8, 46), (0, 0, fh + 23),
            mats["foundation"], bevel_width=4)

    for floor in floors:
        front_y = floor["front_y"]
        side_x = floor["side_x"]
        for side in (-1, 1):
            kit.box(collection, root,
                    f"HouseLV5_Level{floor['index']}_FrontPilaster_{side:+d}",
                    (18, 16, floor["height"]),
                    (side * (floor["width"] / 2 - 10), front_y - 1,
                     floor["base"] + floor["height"] / 2),
                    mats["stone"], bevel_width=2)
            kit.box(collection, root,
                    f"HouseLV5_Level{floor['index']}_SidePilaster_{side:+d}",
                    (16, 18, floor["height"]),
                    (side_x - 1, side * (floor["depth"] / 2 - 10),
                     floor["base"] + floor["height"] / 2),
                    mats["stone"], bevel_width=2)

    ground = floors[0]
    front_y = ground["front_y"]
    side_x = ground["side_x"]
    door_x = -78
    kit.box(collection, root, "HouseLV5_MainDoor_Recess",
            (78, 12, 108), (door_x, front_y, fh + 54),
            dark_interior, bevel_width=10)
    kit.double_doors(collection, root, "HouseLV5_MainDoor",
                     (door_x, front_y - 8, fh), 64, 102,
                     mats["timber"], mats["iron"], open_angle=0)
    kit.box(collection, root, "HouseLV5_EntranceCanopy",
            (104, 54, 13), (door_x, front_y - 28, fh + 112),
            copper, rotation=(4, 0, 0), bevel_width=3)
    for side in (-1, 1):
        kit.box(collection, root, f"HouseLV5_CanopyBracket_{side:+d}",
                (7, 31, 7), (door_x + side * 42, front_y - 12, fh + 91),
                mats["iron"], rotation=(-28, 0, 0), bevel_width=1)

    # A two-storey attached bay window is the main Victorian silhouette cue.
    bay_x = 72
    bay_h = storeys[0] + storeys[1] - 18
    bay_y = front_y - 17
    kit.box(collection, root, "HouseLV5_BayWindow_ConnectedBody",
            (92, 58, bay_h), (bay_x, bay_y, fh + bay_h / 2),
            mats["plaster"], bevel_width=5)
    for row, z in enumerate((fh + 50, fh + storeys[0] + 42), start=1):
        kit.framed_glass_panel(
            collection, root, f"HouseLV5_BayWindow_Level{row}_Front",
            (bay_x, bay_y - 32, z), 58, 56, mats["glass"],
            mats["stone"], mats["brass"], vertical_divisions=2,
            horizontal_divisions=2, ornaments=True, depth=7)
    kit.box(collection, root, "HouseLV5_BayWindow_CopperCap",
            (104, 68, 14), (bay_x, bay_y, fh + bay_h + 7),
            copper, bevel_width=4)

    for floor in floors[2:]:
        center_z = floor["base"] + floor["height"] * 0.53
        for index, x in enumerate((-78, 0, 78)):
            kit.framed_glass_panel(
                collection, root,
                f"HouseLV5_Level{floor['index']}_FrontWindow_{index}",
                (x, floor["front_y"] - 3, center_z), 42, 56,
                mats["glass"], mats["stone"], mats["brass"],
                vertical_divisions=2, horizontal_divisions=2,
                ornaments=floor["index"] == 4, depth=7)
    for floor in floors:
        center_z = floor["base"] + floor["height"] * 0.53
        for index, y in enumerate((-48, 46)):
            kit.framed_glass_panel(
                collection, root,
                f"HouseLV5_Level{floor['index']}_SideWindow_{index}",
                (floor["side_x"] - 3, y, center_z), 40, 54,
                mats["glass"], mats["stone"], mats["brass"],
                orientation="side", vertical_divisions=2,
                horizontal_divisions=2, depth=7)

    house_front_balcony(collection, root, "HouseLV5_Level3_IronBalcony",
                        0, floors[2]["front_y"], floors[2]["base"] + 9,
                        148, mats, glass_rail=False)

    # Attached domestic steam infrastructure signals the era without turning
    # the residence into a factory or adding a detached boiler house.
    pipe_x = side_x - 12
    kit.cylinder(collection, root, "HouseLV5_SideSteamRiser", 7, 218,
                 (pipe_x, 72, fh + 130), copper, vertices=24, bevel_width=1)
    for index, z in enumerate((fh + 66, fh + 152, fh + 238)):
        kit.cylinder(collection, root, f"HouseLV5_SteamBranch_{index}", 5, 34,
                     (pipe_x + 13, 72, z), copper,
                     rotation=(0, 90, 0), vertices=20, bevel_width=0.8)
    gauge_z = fh + 205
    kit.cylinder(collection, root, "HouseLV5_PressureGauge_Frame", 18, 8,
                 (side_x - 19, 30, gauge_z), mats["brass"],
                 rotation=(0, 90, 0), vertices=32, bevel_width=1)
    kit.cylinder(collection, root, "HouseLV5_PressureGauge_Face", 13, 10,
                 (side_x - 23, 30, gauge_z), mats["plaster"],
                 rotation=(0, 90, 0), vertices=32, bevel_width=0.7)
    kit.box(collection, root, "HouseLV5_PressureGauge_Needle", (3, 14, 3),
            (side_x - 29, 34, gauge_z + 2), mats["iron"],
            rotation=(34, 0, 0), bevel_width=0.3)

    roof_base = fh + bh - 3
    hipped_roof(collection, root, "HouseLV5_ContinuousMansardRoof",
                rw, rd, rh, (0, 0, roof_base), mats["roof"])
    kit.box(collection, root, "HouseLV5_MansardLowerCopperBand",
            (rw + 4, rd + 4, 12), (0, 0, roof_base + 4),
            copper, bevel_width=2)
    kit.box(collection, root, "HouseLV5_MansardTopCap",
            (rw * 0.46, rd * 0.18, 12), (0, 0, roof_base + rh + 3),
            copper, bevel_width=2)
    dormer_y = -84
    dormer_z = roof_base + 36
    kit.box(collection, root, "HouseLV5_RoofDormer_Body", (62, 48, 45),
            (0, dormer_y, dormer_z), mats["plaster"], bevel_width=3)
    dormer_roof = kit.gabled_prism(
        collection, root, "HouseLV5_RoofDormer_GabledCap", 64, 62, 24,
        (0, dormer_y, dormer_z + 20), mats["timber"], mats["roof"])
    dormer_roof.rotation_euler[2] = math.radians(90)
    kit.framed_glass_panel(
        collection, root, "HouseLV5_RoofDormer_Window",
        (0, dormer_y - 27, dormer_z), 34, 32, mats["glass"],
        mats["stone"], mats["brass"], vertical_divisions=2,
        horizontal_divisions=1, depth=6)
    kit.chimney(collection, root, "HouseLV5_BrickChimney",
                (94, 52, roof_base + 26), brick, mats["iron"], height=92)
    kit.lantern(collection, root, "HouseLV5_EntranceLantern",
                (-24, front_y - 17, fh + 72), mats["iron"], mats["glow"])
    return root


def build_house_lv6(spec):
    """Five-storey modern urban apartment evolved from the compact house."""
    collection, root, mats = common_context("house_lv6", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    bw, bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    storeys = [float(value) for value in dims["storeyHeights"]]
    if len(storeys) != 5 or abs(sum(storeys) - bh) > 0.01:
        raise ValueError("house_lv6 storeyHeights must contain five values summing to body height")

    concrete = kit.material(
        "MAT_HouseLV6_ArchitecturalConcrete", kit.rgba((0.46, 0.48, 0.47, 1.0)),
        roughness=0.84, noise={"scale": 10, "detail": 3, "bump": 0.10})
    planter_green = kit.material(
        "MAT_HouseLV6_PlanterGreen", kit.rgba((0.12, 0.25, 0.15, 1.0)),
        roughness=0.88)
    dark_interior = kit.material(
        "MAT_HouseLV6_DimLobby", kit.rgba((0.025, 0.035, 0.04, 1.0)),
        roughness=0.92)

    kit.box(collection, root, "HouseLV6_GroundSill", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=6)
    floor_sizes = [(bw, bd, height) for height in storeys]
    floors = kit.stacked_bearing_shells(
        collection, root, "HouseLV6", floor_sizes,
        (concrete, mats["plaster"], mats["plaster"], mats["plaster"], mats["plaster"]),
        base_z=fh, band_mat=mats["iron"], band_height=14, bevel_width=5)

    ground = floors[0]
    front_y = ground["front_y"]
    lobby_w, lobby_h = 146, 72
    kit.box(collection, root, "HouseLV6_Lobby_DarkRecess",
            (lobby_w + 18, 12, lobby_h + 12),
            (0, front_y, fh + lobby_h / 2), dark_interior, bevel_width=5)
    kit.framed_glass_panel(
        collection, root, "HouseLV6_Lobby_GlassWall",
        (0, front_y - 7, fh + lobby_h / 2), lobby_w, lobby_h,
        mats["glass"], mats["iron"], mats["brass"],
        vertical_divisions=4, horizontal_divisions=1, depth=7)
    kit.box(collection, root, "HouseLV6_Lobby_Canopy", (174, 54, 10),
            (0, front_y - 28, fh + lobby_h + 12), mats["iron"], bevel_width=3)
    for floor in floors[1:]:
        center_z = floor["base"] + floor["height"] * 0.54
        for index, x in enumerate((-82, 34, 105)):
            width = 68 if index < 2 else 42
            kit.framed_glass_panel(
                collection, root,
                f"HouseLV6_Level{floor['index']}_FrontWindow_{index}",
                (x, floor["front_y"] - 3, center_z), width, 52,
                mats["glass"], mats["iron"], mats["brass"],
                vertical_divisions=2 if width > 50 else 1,
                horizontal_divisions=1, depth=7)
        for index, y in enumerate((-58, 32, 88)):
            kit.framed_glass_panel(
                collection, root,
                f"HouseLV6_Level{floor['index']}_SideWindow_{index}",
                (floor["side_x"] - 3, y, center_z), 44, 50,
                mats["glass"], mats["iron"], mats["brass"],
                orientation="side", vertical_divisions=1,
                horizontal_divisions=1, depth=7)

    balcony_specs = ((2, -66, 116), (3, 58, 126), (4, -56, 132), (5, 54, 126))
    for floor_index, center_x, width in balcony_specs:
        floor = floors[floor_index - 1]
        platform_y, outer_y = house_front_balcony(
            collection, root, f"HouseLV6_Level{floor_index}_GlassBalcony",
            center_x, floor["front_y"], floor["base"] + 10,
            width, mats, glass_rail=True)
        kit.box(collection, root,
                f"HouseLV6_Level{floor_index}_BalconyPlanter",
                (width * 0.62, 18, 16),
                (center_x, outer_y + 7, floor["base"] + 18),
                mats["foundation"], bevel_width=3)
        kit.box(collection, root,
                f"HouseLV6_Level{floor_index}_BalconyPlanting",
                (width * 0.54, 12, 8),
                (center_x, outer_y + 7, floor["base"] + 28),
                planter_green, bevel_width=4)

    # Vertical steel piers and a single recessed strip keep the small apartment
    # legible at RTS scale without becoming a generic all-glass office block.
    for side in (-1, 1):
        kit.box(collection, root, f"HouseLV6_FacadePier_{side:+d}",
                (16, 18, bh),
                (side * (bw / 2 - 12), front_y - 2, fh + bh / 2),
                mats["iron"], bevel_width=2)
    kit.box(collection, root, "HouseLV6_VerticalAddressSpine",
            (12, 13, bh - 96), (132, front_y - 7, fh + 96 + (bh - 96) / 2),
            mats["brass"], bevel_width=2)

    roof_top = house_flat_roof(collection, root, "HouseLV6", rw, rd,
                               fh + bh - 2, rh, mats, parapet_height=24)
    kit.box(collection, root, "HouseLV6_RoofMechanicalPenthouse",
            (104, 78, 34), (38, 26, roof_top + 17),
            concrete, bevel_width=5)
    kit.solar_panel_array(
        collection, root, "HouseLV6_RoofSolar", (-14, -58, roof_top),
        1, 2, (82, 46, 7), mats["glass"], mats["iron"],
        column_gap=38, tilt_degrees=12, support_height=19)
    return root


def house_lv7_elliptical_shell(collection, root, name, size, location, mat,
                               rotation_z=0, bevel_width=4):
    """Editable oval floor/core with genuinely curved perimeter walls."""
    width, depth, height = (float(value) for value in size)
    bpy.ops.mesh.primitive_cylinder_add(vertices=64, radius=1, depth=1)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (width, depth, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = root
    obj.location = location
    obj.rotation_euler.z = math.radians(float(rotation_z))
    obj.data.materials.append(mat)
    kit.bevel(obj, bevel_width, 3)
    kit.move_to_collection(obj, collection)
    return obj


def house_lv7_arc_band(collection, root, name, center, outer_size, inner_size,
                       base_z, height, mat, start_angle, end_angle,
                       *, rotation_z=0, segments=32, bevel_width=1.5):
    """Extruded elliptical annular sector for glazing, terraces and planters."""
    center_x, center_y = (float(value) for value in center)
    outer_rx, outer_ry = (float(value) / 2 for value in outer_size)
    inner_rx, inner_ry = (float(value) / 2 for value in inner_size)
    count = max(8, int(segments)) + 1
    rotation = math.radians(float(rotation_z))
    angles = [math.radians(float(start_angle) +
                           (float(end_angle) - float(start_angle)) * index / (count - 1))
              for index in range(count)]

    def point(rx, ry, angle, z):
        local_x = math.cos(angle) * rx
        local_y = math.sin(angle) * ry
        return (
            center_x + local_x * math.cos(rotation) - local_y * math.sin(rotation),
            center_y + local_x * math.sin(rotation) + local_y * math.cos(rotation),
            z,
        )

    vertices = []
    for z in (float(base_z), float(base_z) + float(height)):
        vertices.extend(point(outer_rx, outer_ry, angle, z) for angle in angles)
        vertices.extend(point(inner_rx, inner_ry, angle, z) for angle in angles)
    outer_bottom = 0
    inner_bottom = count
    outer_top = count * 2
    inner_top = count * 3
    faces = []
    for index in range(count - 1):
        nxt = index + 1
        faces.append((outer_top + index, outer_top + nxt,
                      inner_top + nxt, inner_top + index))
        faces.append((outer_bottom + nxt, outer_bottom + index,
                      inner_bottom + index, inner_bottom + nxt))
        faces.append((outer_bottom + index, outer_bottom + nxt,
                      outer_top + nxt, outer_top + index))
        faces.append((inner_bottom + nxt, inner_bottom + index,
                      inner_top + index, inner_top + nxt))
    faces.append((outer_bottom, outer_top, inner_top, inner_bottom))
    last = count - 1
    faces.append((outer_bottom + last, inner_bottom + last,
                  inner_top + last, outer_top + last))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    mesh.validate()
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    kit.bevel(obj, bevel_width, 2)
    return obj


def house_lv7_arc_railing(collection, root, name, center, ellipse_size,
                          base_z, mat, start_angle, end_angle,
                          *, rotation_z=0, segments=12):
    """Chord-segment railing that follows one editable elliptical terrace."""
    center_x, center_y = (float(value) for value in center)
    radius_x, radius_y = (float(value) / 2 for value in ellipse_size)
    rotation = math.radians(float(rotation_z))

    def point(angle_deg):
        angle = math.radians(float(angle_deg))
        local_x = math.cos(angle) * radius_x
        local_y = math.sin(angle) * radius_y
        return (
            center_x + local_x * math.cos(rotation) - local_y * math.sin(rotation),
            center_y + local_x * math.sin(rotation) + local_y * math.cos(rotation),
        )

    angles = [float(start_angle) + (float(end_angle) - float(start_angle)) * index / segments
              for index in range(segments + 1)]
    points = [point(angle) for angle in angles]
    rail_z = float(base_z) + 38
    for index, ((x0, y0), (x1, y1)) in enumerate(zip(points, points[1:])):
        length = math.hypot(x1 - x0, y1 - y0)
        angle = math.degrees(math.atan2(y1 - y0, x1 - x0))
        kit.box(collection, root, f"{name}_TopRail_{index:02d}",
                (length + 2, 6, 7), ((x0 + x1) / 2, (y0 + y1) / 2, rail_z),
                mat, rotation=(0, 0, angle), bevel_width=1)
    for index, (x, y) in enumerate(points[::2]):
        kit.cylinder(collection, root, f"{name}_Post_{index:02d}",
                     3.2, 38, (x, y, float(base_z) + 19), mat,
                     vertices=16, bevel_width=0.6)


def build_house_lv7(spec):
    """Six-storey curved future tower wrapped by ascending sky gardens."""
    collection, root, mats = common_context("house_lv7", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    _bw, _bd, bh = dims["body"]
    rw, rd, rh = dims["roof"]
    storeys = [float(value) for value in dims["storeyHeights"]]
    floor_sizes = [tuple(float(value) for value in size)
                   for size in dims["storeySizes"]]
    offsets = [tuple(float(value) for value in offset)
               for offset in dims["storeyOffsets"]]
    rotations = [float(value) for value in dims["storeyRotations"]]
    if (len(storeys) != 6 or len(floor_sizes) != 6 or len(offsets) != 6 or
            len(rotations) != 6 or abs(sum(storeys) - bh) > 0.01):
        raise ValueError("house_lv7 requires six curved storeys matching body height")

    ceramic = kit.material(
        "MAT_HouseLV7_WarmCeramicComposite", kit.rgba((0.70, 0.71, 0.67, 1.0)),
        roughness=0.72, noise={"scale": 12, "detail": 2, "bump": 0.06})
    garden = kit.material(
        "MAT_HouseLV7_SkyGarden", kit.rgba((0.08, 0.25, 0.16, 1.0)),
        roughness=0.88, noise={"scale": 8, "detail": 3, "bump": 0.10})
    foliage = kit.material(
        "MAT_HouseLV7_Foliage", kit.rgba((0.11, 0.34, 0.20, 1.0)),
        roughness=0.80)
    dark_core = kit.material(
        "MAT_HouseLV7_TowerCore", kit.rgba((0.035, 0.065, 0.078, 1.0)),
        roughness=0.42, metallic=0.40)
    dark_interior = kit.material(
        "MAT_HouseLV7_DimInterior", kit.rgba((0.018, 0.035, 0.043, 1.0)),
        roughness=0.90)

    kit.box(collection, root, "HouseLV7_GroundSill", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=8)

    # One continuous oval tower core ties all offset floors together and rises
    # above the roof. The habitable floors remain six separately named shells.
    core_top = fh + bh + 58
    house_lv7_elliptical_shell(
        collection, root, "HouseLV7_CentralTower_ContinuousCore",
        (112, 98, core_top - fh), (0, 10, fh + (core_top - fh) / 2),
        dark_core, rotation_z=3, bevel_width=7)

    floors = []
    base_z = fh
    for index, (size, offset, rotation_z) in enumerate(
            zip(floor_sizes, offsets, rotations), start=1):
        width, depth, height = size
        center_x, center_y = offset
        shell_height = height - 8
        house_lv7_elliptical_shell(
            collection, root, f"HouseLV7_Level{index}_ArcBearingShell",
            (width, depth, shell_height),
            (center_x, center_y, base_z + 8 + shell_height / 2),
            ceramic, rotation_z=rotation_z, bevel_width=7)
        house_lv7_elliptical_shell(
            collection, root, f"HouseLV7_Level{index}_CurvedFloorSlab",
            (width + 18, depth + 16, 11),
            (center_x, center_y, base_z + 5.5),
            mats["brass"] if index in (2, 4, 6) else mats["stone"],
            rotation_z=rotation_z, bevel_width=3)

        # A continuous curved glass ribbon replaces the old flat rectangular
        # facade. Round mullions follow the ellipse and expose the twist.
        window_base = base_z + 20
        house_lv7_arc_band(
            collection, root, f"HouseLV7_Level{index}_CurvedGlassRibbon",
            (center_x, center_y), (width + 8, depth + 8),
            (width - 10, depth - 10), window_base, 43, mats["glass"],
            155, 385, rotation_z=rotation_z, segments=42, bevel_width=1)
        for mullion_index, angle in enumerate((170, 210, 250, 290, 330, 370)):
            theta = math.radians(angle + rotation_z)
            x = center_x + math.cos(theta) * (width / 2 + 3)
            y = center_y + math.sin(theta) * (depth / 2 + 3)
            kit.cylinder(
                collection, root,
                f"HouseLV7_Level{index}_CurvedGlassMullion_{mullion_index}",
                3.0, 49, (x, y, window_base + 24.5), mats["iron"],
                vertices=16, bevel_width=0.5)

        # Two staggered round columns per level create a restrained helical
        # structural rhythm without reverting to straight vertical corner ribs.
        for column_index, angle in enumerate((195 + index * 10,
                                              335 + index * 8)):
            theta = math.radians(angle + rotation_z)
            x = center_x + math.cos(theta) * (width / 2 - 7)
            y = center_y + math.sin(theta) * (depth / 2 - 7)
            kit.cylinder(
                collection, root,
                f"HouseLV7_Level{index}_HelicalColumn_{column_index}",
                6, height - 8, (x, y, base_z + height / 2 + 4),
                mats["iron"], vertices=24, bevel_width=1)
        floors.append({
            "index": index, "base": base_z, "top": base_z + height,
            "width": width, "depth": depth, "height": height,
            "center": (center_x, center_y), "rotation": rotation_z,
        })
        base_z += height

    # Curved ground entrance and a clearly elevated cantilevered canopy remain
    # attached to level one. The canopy uses a shallow glass plate plus two
    # brass edge beams so its Depth reads above the door rather than as a ramp.
    ground = floors[0]
    gx, gy = ground["center"]
    ground_front = gy - ground["depth"] / 2 - 5
    kit.box(collection, root, "HouseLV7_Entrance_DarkRecess",
            (78, 15, 68), (gx, ground_front, fh + 34),
            dark_interior, rotation=(0, 0, ground["rotation"]), bevel_width=24)
    kit.box(collection, root, "HouseLV7_Entrance_CurvedGlassDoor",
            (62, 8, 62), (gx, ground_front - 9, fh + 33),
            mats["glass"], rotation=(0, 0, ground["rotation"]), bevel_width=22)
    canopy_rotation = (0, 0, ground["rotation"])
    canopy_z = fh + 92
    canopy_y = ground_front - 22
    kit.box(collection, root, "HouseLV7_Entrance_ElevatedGlassCanopy",
            (88, 38, 7), (gx, canopy_y, canopy_z), mats["glass"],
            rotation=canopy_rotation, bevel_width=4)
    kit.box(collection, root, "HouseLV7_Entrance_CanopyWallBeam",
            (92, 7, 11), (gx, ground_front - 5, canopy_z + 1),
            mats["brass"], rotation=canopy_rotation, bevel_width=2)
    kit.box(collection, root, "HouseLV7_Entrance_CanopyFrontBeam",
            (92, 7, 9), (gx, ground_front - 40, canopy_z - 1),
            mats["brass"], rotation=canopy_rotation, bevel_width=2)
    for side in (-1, 1):
        kit.box(collection, root,
                f"HouseLV7_Entrance_CanopyBracket_{side:+d}",
                (7, 30, 7), (gx + side * 33, ground_front - 20, fh + 82),
                mats["brass"], rotation=canopy_rotation, bevel_width=1.5)

    # Three broad crescent gardens spiral up the tower at levels 2, 4 and 6.
    # They are true curved decks with curved beds and railings, not wall boxes.
    garden_specs = (
        (2, 168, 292),
        (4, 220, 348),
        (6, 158, 310),
    )
    for garden_index, (floor_index, start_angle, end_angle) in enumerate(
            garden_specs, start=1):
        floor = floors[floor_index - 1]
        center = floor["center"]
        width, depth = floor["width"], floor["depth"]
        terrace_z = floor["top"] - 5
        deck_outer = (width + 92, depth + 78)
        deck_inner = (width - 10, depth - 8)
        house_lv7_arc_band(
            collection, root, f"HouseLV7_SkyGarden_{garden_index}_CrescentDeck",
            center, deck_outer, deck_inner, terrace_z, 12, mats["brass"],
            start_angle, end_angle, rotation_z=floor["rotation"],
            segments=38, bevel_width=2.5)
        house_lv7_arc_band(
            collection, root, f"HouseLV7_SkyGarden_{garden_index}_CurvedPlantingBed",
            center, (width + 72, depth + 60), (width + 14, depth + 10),
            terrace_z + 10, 13, garden, start_angle + 5, end_angle - 5,
            rotation_z=floor["rotation"], segments=34, bevel_width=3)
        house_lv7_arc_railing(
            collection, root, f"HouseLV7_SkyGarden_{garden_index}_CurvedRailing",
            center, (deck_outer[0] - 7, deck_outer[1] - 7), terrace_z + 12,
            mats["iron"], start_angle, end_angle,
            rotation_z=floor["rotation"], segments=12)

        plant_angles = [start_angle + (end_angle - start_angle) * step / 5
                        for step in range(1, 5)]
        rotation = math.radians(floor["rotation"])
        for plant_index, angle in enumerate(plant_angles):
            theta = math.radians(angle)
            local_x = math.cos(theta) * (width / 2 + 25)
            local_y = math.sin(theta) * (depth / 2 + 21)
            x = center[0] + local_x * math.cos(rotation) - local_y * math.sin(rotation)
            y = center[1] + local_x * math.sin(rotation) + local_y * math.cos(rotation)
            stem_height = 22 + (plant_index % 2) * 7
            kit.cylinder(
                collection, root,
                f"HouseLV7_SkyGarden_{garden_index}_TreeStem_{plant_index}",
                2.8, stem_height,
                (x, y, terrace_z + 22 + stem_height / 2),
                mats["timber"], vertices=12, bevel_width=0.5)
            bpy.ops.mesh.primitive_ico_sphere_add(
                subdivisions=2, radius=10 + (plant_index % 2) * 2,
                location=(x, y, terrace_z + 24 + stem_height))
            crown = bpy.context.object
            crown.name = f"HouseLV7_SkyGarden_{garden_index}_TreeCrown_{plant_index}"
            crown.parent = root
            crown.data.materials.append(foliage)
            kit.move_to_collection(crown, collection)

    # The core becomes a visible glass observation crown above the sixth floor.
    roof_z = fh + bh
    house_lv7_elliptical_shell(
        collection, root, "HouseLV7_CentralTower_GlassCrown",
        (94, 82, 48), (0, 10, roof_z + 24), mats["glass"],
        rotation_z=3, bevel_width=8)
    house_lv7_elliptical_shell(
        collection, root, "HouseLV7_CentralTower_CurvedRoofCap",
        (rw, rd, rh), (0, 10, roof_z + 52), mats["roof"],
        rotation_z=3, bevel_width=7)
    house_lv7_arc_band(
        collection, root, "HouseLV7_CentralTower_EnergyHalo",
        (0, 10), (rw + 34, rd + 28), (rw - 18, rd - 18),
        roof_z + 62, 9, mats["glow"], 155, 385,
        rotation_z=3, segments=40, bevel_width=2)
    for index, angle in enumerate((205, 250, 295, 340)):
        theta = math.radians(angle)
        x = math.cos(theta) * (rw / 2 + 7)
        y = 10 + math.sin(theta) * (rd / 2 + 7)
        kit.box(collection, root, f"HouseLV7_CentralTower_SolarPetal_{index}",
                (36, 9, 54), (x, y, roof_z + 35), mats["glass"],
                rotation=(0, 10, angle + 90), bevel_width=7)
    return root


def camp_training_dummy(collection, root, name, location, mats):
    """One fixed medieval straw dummy with a readable cross-arm silhouette."""
    x, y, z = location
    kit.box(collection, root, name + "_Foot", (54, 34, 10),
            (x, y, z + 5), mats["timber"], bevel_width=2)
    kit.box(collection, root, name + "_Post", (10, 10, 92),
            (x, y, z + 51), mats["timber"], bevel_width=1)
    kit.box(collection, root, name + "_CrossArm", (76, 10, 10),
            (x, y, z + 72), mats["timber"], bevel_width=1)
    kit.cylinder(collection, root, name + "_StrawTorso", 22, 43,
                 (x, y, z + 58), mats["straw"], vertices=20,
                 bevel_width=2)
    kit.cylinder(collection, root, name + "_StrawHead", 14, 22,
                 (x, y, z + 94), mats["straw"], vertices=20,
                 bevel_width=2)


def camp_archery_target(collection, root, name, location, mats):
    """One fixed straw target with timber feet and readable concentric rings."""
    x, y, z = location
    for side, label in ((-1, "Left"), (1, "Right")):
        kit.box(collection, root, f"{name}_{label}Foot", (48, 12, 10),
                (x + side * 18, y, z + 5), mats["timber"],
                rotation=(0, 0, side * 10), bevel_width=2)
        kit.box(collection, root, f"{name}_{label}Brace", (10, 10, 72),
                (x + side * 24, y + 3, z + 38), mats["timber"],
                rotation=(0, side * 8, 0), bevel_width=1)
    kit.cylinder(collection, root, name + "_StrawDisk", 35, 15,
                 (x, y - 3, z + 74), mats["straw"],
                 rotation=(90, 0, 0), vertices=32, bevel_width=2)
    kit.cylinder(collection, root, name + "_OuterRing", 25, 3,
                 (x, y - 12, z + 74), mats["iron"],
                 rotation=(90, 0, 0), vertices=32, bevel_width=1)
    kit.cylinder(collection, root, name + "_Bullseye", 9, 5,
                 (x, y - 15, z + 74), mats["brass"],
                 rotation=(90, 0, 0), vertices=24, bevel_width=1)


def camp_spear_rack(collection, root, name, location, mats):
    """Wall-free fixed spear rack used by the medieval training yard."""
    x, y, z = location
    for side, label in ((-1, "Left"), (1, "Right")):
        kit.box(collection, root, f"{name}_{label}Post", (12, 12, 82),
                (x + side * 39, y, z + 41), mats["timber"], bevel_width=1.5)
    for rail_z in (z + 25, z + 64):
        kit.box(collection, root, f"{name}_Rail_{int(rail_z)}", (92, 12, 10),
                (x, y, rail_z), mats["timber"], bevel_width=1)
    for index, offset in enumerate((-30, -10, 10, 30)):
        lean = -5 if index < 2 else 5
        kit.box(collection, root, f"{name}_Shaft_{index}", (6, 7, 116),
                (x + offset, y - 4, z + 66), mats["timber"],
                rotation=(0, lean, 0), bevel_width=0.7)
        cone(collection, root, f"{name}_Head_{index}", 7, 20,
             (x + offset + (-5 if lean < 0 else 5), y - 4, z + 132),
             mats["iron"], vertices=4)


def chainlink_front_panel(collection, root, name, start_x, end_x, y,
                          base_z, height, wire_mat):
    """One editable chain-link panel in the X/Z plane."""
    width = float(end_x) - float(start_x)
    center_x = (float(start_x) + float(end_x)) / 2
    panel_count = max(1, int(math.ceil(abs(width) / 54)))
    panel_width = width / panel_count
    for index in range(panel_count):
        x0 = start_x + panel_width * index
        x1 = x0 + panel_width
        length = math.hypot(panel_width, height)
        angle = math.degrees(math.atan2(height, abs(panel_width)))
        kit.box(collection, root, f"{name}_MeshRise_{index:02d}",
                (length, 2.4, 2.4), ((x0 + x1) / 2, y, base_z + height / 2),
                wire_mat, rotation=(0, -angle, 0), bevel_width=0.35)
        kit.box(collection, root, f"{name}_MeshFall_{index:02d}",
                (length, 2.4, 2.4), ((x0 + x1) / 2, y, base_z + height / 2),
                wire_mat, rotation=(0, angle, 0), bevel_width=0.35)


def chainlink_side_panel(collection, root, name, x, start_y, end_y,
                         base_z, height, wire_mat):
    """One editable chain-link panel in the Y/Z plane."""
    depth = float(end_y) - float(start_y)
    center_y = (float(start_y) + float(end_y)) / 2
    panel_count = max(1, int(math.ceil(abs(depth) / 54)))
    panel_depth = depth / panel_count
    for index in range(panel_count):
        y0 = start_y + panel_depth * index
        y1 = y0 + panel_depth
        length = math.hypot(panel_depth, height)
        angle = math.degrees(math.atan2(height, abs(panel_depth)))
        kit.box(collection, root, f"{name}_MeshRise_{index:02d}",
                (2.4, length, 2.4), (x, (y0 + y1) / 2, base_z + height / 2),
                wire_mat, rotation=(angle, 0, 0), bevel_width=0.35)
        kit.box(collection, root, f"{name}_MeshFall_{index:02d}",
                (2.4, length, 2.4), (x, (y0 + y1) / 2, base_z + height / 2),
                wire_mat, rotation=(-angle, 0, 0), bevel_width=0.35)


def camp_barbed_wire_run(collection, root, name, start, end, wire_z, mats,
                         barb_count=7):
    """Double perimeter strand with fixed crossed barbs; no loose wire props."""
    x0, y0 = start
    x1, y1 = end
    dx, dy = x1 - x0, y1 - y0
    length = math.hypot(dx, dy)
    angle = math.degrees(math.atan2(dy, dx))
    for strand_index, z_offset in enumerate((0, 10)):
        kit.box(collection, root, f"{name}_Strand_{strand_index}",
                (length, 3.0, 3.0), ((x0 + x1) / 2, (y0 + y1) / 2,
                                     wire_z + z_offset),
                mats["iron"], rotation=(0, 0, angle), bevel_width=0.45)
    for index in range(1, max(2, barb_count)):
        t = index / max(2, barb_count)
        x = x0 + dx * t
        y = y0 + dy * t
        for cross_index, lean in enumerate((-42, 42)):
            kit.box(collection, root, f"{name}_Barb_{index:02d}_{cross_index}",
                    (3.2, 3.2, 22), (x, y, wire_z + 5), mats["iron"],
                    rotation=(lean, 0, angle), bevel_width=0.35)


def build_thatch_hut_lv2(spec):
    """Detailed medieval drill camp centered on one enclosed single-roof hall."""
    collection, root, mats = common_context("thatch_hut_lv2", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    hall_w, hall_d, hall_h = dims["drillHall"]
    roof_w, roof_d, roof_h = dims["drillRoof"]

    kit.box(collection, root, "ThatchHutLV2_DrillYardFoundation", (fw, fd, fh),
            (0, 0, fh / 2), mats["foundation"], bevel_width=5)

    hall_y = 74
    rear_y = hall_y + hall_d / 2
    front_y = hall_y - hall_d / 2

    # One enclosed training house; every facade detail belongs to this volume.
    kit.box(collection, root, "ThatchHutLV2_TrainingHall_PlasterShell",
            (hall_w, hall_d, hall_h), (0, hall_y, fh + hall_h / 2),
            mats["plaster"], bevel_width=4)
    kit.box(collection, root, "ThatchHutLV2_TrainingHall_FieldstoneSkirt",
            (hall_w + 10, hall_d + 10, 38), (0, hall_y, fh + 19),
            mats["stone"], bevel_width=4)
    kit.gabled_prism(collection, root, "ThatchHutLV2_TrainingHall_SingleThatchRoof",
                     roof_w, roof_d, roof_h, (0, hall_y, fh + hall_h - 3),
                     mats["timber"], mats["thatch"])
    # ``kit.roof_rows`` is centered at world Y=0.  This hall sits at ``hall_y``;
    # build its courses locally so they do not read as a second parallel roof.
    roof_base_z = fh + hall_h - 3
    slope_angle = math.degrees(math.atan2(roof_h, roof_d / 2))
    roof_row_count = 10
    for side in (-1, 1):
        for index in range(roof_row_count):
            t = (index + 0.52) / roof_row_count
            row_y = hall_y + side * (roof_d / 2) * (1 - t)
            row_z = roof_base_z + roof_h * t + 2.0
            kit.box(
                collection, root,
                f"ThatchHutLV2_TrainingHall_ThatchCourse_"
                f"S{side:+d}_Row_{index + 1:02d}",
                (roof_w + 5, roof_d / roof_row_count + 4, 4.5),
                (0, row_y, row_z), mats["thatch"],
                rotation=(-side * slope_angle, 0, 0), bevel_width=0.7)

    facade_y = front_y - 3
    kit.box(collection, root, "ThatchHutLV2_TrainingHall_GateRecess",
            (84, 7, 78), (0, facade_y - 1, fh + 39), mats["iron"],
            bevel_width=2)
    for side, label in ((-1, "Left"), (1, "Right")):
        kit.box(collection, root, f"ThatchHutLV2_TrainingHall_{label}GateLeaf",
                (29, 7, 70), (side * 27, facade_y - 5, fh + 35),
                mats["timber"], rotation=(0, 0, side * 7), bevel_width=2)
        kit.box(collection, root, f"ThatchHutLV2_TrainingHall_{label}GateJamb",
                (13, 13, 92), (side * 50, facade_y, fh + 46),
                mats["timber"], bevel_width=2)
    kit.box(collection, root, "ThatchHutLV2_TrainingHall_GateLintel",
            (116, 14, 14), (0, facade_y, fh + 87), mats["timber"],
            bevel_width=2)

    # Half-timber framing keeps the single house readable at game scale.
    for index, x in enumerate((-111, -63, 63, 111)):
        kit.box(collection, root, f"ThatchHutLV2_TrainingHall_FrontStud_{index}",
                (11, 11, hall_h - 12), (x, facade_y, fh + hall_h / 2),
                mats["timber"], bevel_width=1.5)
    for index, z in enumerate((fh + 43, fh + 92)):
        kit.box(collection, root, f"ThatchHutLV2_TrainingHall_FrontBeam_{index}",
                (hall_w - 10, 11, 11), (0, facade_y, z), mats["timber"],
                bevel_width=1.5)
    for side, label in ((-1, "Left"), (1, "Right")):
        wx = side * 86
        kit.box(collection, root, f"ThatchHutLV2_TrainingHall_{label}Window",
                (34, 6, 34), (wx, facade_y - 2, fh + 68), mats["glass"],
                bevel_width=2)
        kit.box(collection, root, f"ThatchHutLV2_TrainingHall_{label}WindowBarV",
                (4, 8, 38), (wx, facade_y - 6, fh + 68), mats["iron"],
                bevel_width=0.7)
        kit.box(collection, root, f"ThatchHutLV2_TrainingHall_{label}WindowBarH",
                (38, 8, 4), (wx, facade_y - 6, fh + 68), mats["iron"],
                bevel_width=0.7)
        kit.box(collection, root, f"ThatchHutLV2_TrainingHall_{label}FacadeBrace",
                (58, 9, 10), (side * 86, facade_y - 1, fh + 108),
                mats["timber"], rotation=(0, 0, side * 32), bevel_width=1)

    # Shield and crossed polearms form a text-free military crest above the gate.
    for index, lean in enumerate((-38, 38)):
        kit.box(collection, root, f"ThatchHutLV2_TrainingHall_CrestSpear_{index}",
                (6, 7, 44), ((-5 if index == 0 else 5), facade_y - 8,
                              fh + 100), mats["timber"],
                rotation=(0, lean, 0), bevel_width=0.8)
    kit.cylinder(collection, root, "ThatchHutLV2_TrainingHall_CrestShield",
                 16, 7, (0, facade_y - 10, fh + 100), mats["iron"],
                 rotation=(90, 0, 0), vertices=24, bevel_width=2)
    kit.cylinder(collection, root, "ThatchHutLV2_TrainingHall_CrestBoss",
                 5, 9, (0, facade_y - 14, fh + 100), mats["brass"],
                 rotation=(90, 0, 0), vertices=20, bevel_width=1)

    # Side framing is attached to the same hall and supports the roof visually.
    for side, label in ((-1, "Left"), (1, "Right")):
        side_x = side * (hall_w / 2 + 2)
        for index, y in enumerate((front_y + 22, hall_y, rear_y - 22)):
            kit.box(collection, root,
                    f"ThatchHutLV2_TrainingHall_{label}SideStud_{index}",
                    (11, 11, hall_h - 16), (side_x, y, fh + hall_h / 2),
                    mats["timber"], bevel_width=1.5)
        kit.box(collection, root, f"ThatchHutLV2_TrainingHall_{label}SideBeam",
                (11, hall_d - 12, 11), (side_x, hall_y, fh + 91),
                mats["timber"], bevel_width=1.5)

    # A permanent shield board is fixed directly to the right facade bay.
    rack_y = facade_y - 8
    kit.box(collection, root, "ThatchHutLV2_ShieldRack_Back",
            (72, 10, 48), (82, rack_y, fh + 55), mats["timber"],
            bevel_width=3)
    for index, x in enumerate((64, 99)):
        kit.cylinder(collection, root, f"ThatchHutLV2_PracticeShield_{index}",
                     18, 8, (x, rack_y - 7, fh + 56), mats["iron"],
                     rotation=(90, 0, 0), vertices=32, bevel_width=2)
        kit.cylinder(collection, root, f"ThatchHutLV2_PracticeShieldBoss_{index}",
                     6, 10, (x, rack_y - 12, fh + 56), mats["brass"],
                     rotation=(90, 0, 0), vertices=24, bevel_width=1)

    yard_front = -154
    yard_back = 154
    kit.box(collection, root, "ThatchHutLV2_DrillCourtInset",
            (250, 116, 3), (-24, -80, fh + 1.5), mats["foundation"],
            bevel_width=12)
    kit.post_and_rail_enclosure(
        collection, root, "ThatchHutLV2_TimberPalisade", fw - 32,
        yard_front, yard_back, fh, mats["timber"], gate_width=92,
        rail_offsets=(34, 72), post_height=94, post_spacing=84,
        include_back=True, gate_leaves=True, gate_open_angle=66)

    # A taller entry frame gives the compound a deliberate military threshold.
    for side, label in ((-1, "Left"), (1, "Right")):
        x = side * 54
        kit.box(collection, root, f"ThatchHutLV2_GateFrame_{label}Post",
                (16, 16, 118), (x, yard_front, fh + 59), mats["timber"],
                bevel_width=2)
        cone(collection, root, f"ThatchHutLV2_GateFrame_{label}Finial",
             11, 24, (x, yard_front, fh + 130), mats["iron"], vertices=4)
    kit.box(collection, root, "ThatchHutLV2_GateFrame_Crossbeam",
            (124, 15, 16), (0, yard_front, fh + 108), mats["timber"],
            bevel_width=2)
    kit.cylinder(collection, root, "ThatchHutLV2_GateFrame_Shield",
                 17, 7, (0, yard_front - 8, fh + 108), mats["iron"],
                 rotation=(90, 0, 0), vertices=24, bevel_width=2)

    camp_training_dummy(collection, root, "ThatchHutLV2_Dummy_Left",
                        (-116, -76, fh + 3), mats)
    camp_training_dummy(collection, root, "ThatchHutLV2_Dummy_Center",
                        (-40, -88, fh + 3), mats)
    camp_archery_target(collection, root, "ThatchHutLV2_ArcheryTarget",
                        (45, -80, fh + 3), mats)
    camp_spear_rack(collection, root, "ThatchHutLV2_SpearRack",
                    (132, -31, fh), mats)
    kit.box(collection, root, "ThatchHutLV2_BalanceLog",
            (118, 22, 22), (-72, -12, fh + 26), mats["timber"],
            rotation=(0, 0, -5), bevel_width=7)
    for side in (-1, 1):
        kit.box(collection, root, f"ThatchHutLV2_BalanceLog_Foot_{side:+d}",
                (18, 40, 20), (-72 + side * 43, -12 + side * -4, fh + 10),
                mats["timber"], bevel_width=4)

    # Organized supply corner: fixed crates, water cask and a simple bench.
    kit.box(collection, root, "ThatchHutLV2_SupplyCrate_Large",
            (48, 42, 38), (153, 86, fh + 19), mats["timber"],
            bevel_width=3)
    kit.box(collection, root, "ThatchHutLV2_SupplyCrate_Small",
            (36, 34, 30), (148, 48, fh + 15), mats["timber"],
            rotation=(0, 0, -7), bevel_width=3)
    for index, z in enumerate((fh + 8, fh + 27)):
        kit.box(collection, root, f"ThatchHutLV2_SupplyCrate_Band_{index}",
                (52, 5, 5), (153, 64, z), mats["iron"], bevel_width=0.6)
    kit.cylinder(collection, root, "ThatchHutLV2_WaterCask",
                 20, 48, (161, 119, fh + 24), mats["timber"],
                 vertices=20, bevel_width=3)
    for index, z in enumerate((fh + 9, fh + 39)):
        kit.cylinder(collection, root, f"ThatchHutLV2_WaterCask_Hoop_{index}",
                     22, 5, (161, 119, z), mats["iron"],
                     vertices=20, bevel_width=1)
    kit.box(collection, root, "ThatchHutLV2_DrillBench_Seat",
            (92, 24, 10), (-142, 73, fh + 34), mats["timber"],
            bevel_width=3)
    for side in (-1, 1):
        kit.box(collection, root, f"ThatchHutLV2_DrillBench_Leg_{side:+d}",
                (12, 18, 32), (-142 + side * 31, 73, fh + 16),
                mats["timber"], bevel_width=2)
    kit.lantern(collection, root, "ThatchHutLV2_GateLantern",
                (-60, yard_front - 12, fh + 88), mats["iron"], mats["glow"])
    return root


def build_thatch_hut_lv3(spec):
    """Modern military training camp with modeled camo net and barbed wire."""
    collection, root, mats = common_context("thatch_hut_lv3", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    hut_w, hut_d, hut_h = dims["commandHut"]

    concrete = kit.material(
        "MAT_LV3_MilitaryConcrete", kit.rgba((0.255, 0.27, 0.24, 1.0)),
        roughness=0.95, noise={"scale": 9, "detail": 3, "bump": 0.12})
    olive = kit.material(
        "MAT_LV3_MilitaryOlive", kit.rgba((0.18, 0.22, 0.13, 1.0)),
        roughness=0.82, metallic=0.12,
        noise={"scale": 8, "detail": 3, "bump": 0.09})
    canvas = kit.material(
        "MAT_LV3_CamoCanvas", kit.rgba((0.205, 0.245, 0.135, 1.0)),
        roughness=0.98, noise={"scale": 13, "detail": 4, "bump": 0.15})
    dark_canvas = kit.material(
        "MAT_LV3_DarkCamoCanvas", kit.rgba((0.09, 0.13, 0.075, 1.0)),
        roughness=0.98, noise={"scale": 12, "detail": 3, "bump": 0.13})

    kit.box(collection, root, "ThatchHutLV3_TrainingGroundFoundation", (fw, fd, fh),
            (0, 0, fh / 2), concrete, bevel_width=5)

    hut_y = 78
    front_y = hut_y - hut_d / 2 - 4
    kit.box(collection, root, "ThatchHutLV3_CommandHut_PrefabShell",
            (hut_w, hut_d, hut_h), (-42, hut_y, fh + hut_h / 2),
            olive, bevel_width=4)
    kit.box(collection, root, "ThatchHutLV3_CommandHut_ConcreteSkirt",
            (hut_w + 8, hut_d + 8, 28), (-42, hut_y, fh + 14),
            concrete, bevel_width=3)
    kit.box(collection, root, "ThatchHutLV3_CommandHut_FlatRoof",
            (hut_w + 24, hut_d + 22, 18), (-42, hut_y, fh + hut_h + 4),
            mats["iron"], bevel_width=5)
    kit.box(collection, root, "ThatchHutLV3_CommandHut_DarkDoorway",
            (70, 8, 76), (-92, front_y - 3, fh + 40),
            mats["iron"], bevel_width=2)
    kit.double_doors(collection, root, "ThatchHutLV3_CommandHut_MetalDoor",
                     (-92, front_y - 8, fh), 68, 78,
                     olive, mats["iron"], open_angle=12)
    for index, x in enumerate((-24, 43)):
        kit.box(collection, root, f"ThatchHutLV3_CommandHut_Window_{index}",
                (42, 7, 28), (x, front_y - 5, fh + 56),
                mats["glass"], bevel_width=4)
        for bar in (-12, 12):
            kit.box(collection, root,
                    f"ThatchHutLV3_CommandHut_WindowBar_{index}_{bar:+d}",
                    (3, 9, 31), (x + bar, front_y - 9, fh + 56),
                    mats["iron"], bevel_width=0.5)
    kit.box(collection, root, "ThatchHutLV3_CommandHut_Vent",
            (68, 12, 30), (62, hut_y + hut_d / 2 + 6, fh + 71),
            mats["iron"], bevel_width=3)

    # Chain-link perimeter: posts/rails, modeled diamond mesh and double barbed wire.
    fence_x = fw / 2 - 18
    fence_front = -fd / 2 + 16
    fence_back = fd / 2 - 16
    fence_h = 86
    for x, label in ((-fence_x, "FarLeft"), (-48, "GateLeft"),
                     (48, "GateRight"), (fence_x, "FarRight")):
        kit.box(collection, root, f"ThatchHutLV3_FrontFencePost_{label}",
                (11, 11, 112), (x, fence_front, fh + 56), mats["iron"],
                bevel_width=1.5)
    for x, label in ((-fence_x, "Left"), (fence_x, "Right")):
        for index, y in enumerate((fence_front, -52, 52, fence_back)):
            kit.box(collection, root, f"ThatchHutLV3_{label}FencePost_{index}",
                    (11, 11, 112), (x, y, fh + 56), mats["iron"],
                    bevel_width=1.5)
    for index, x in enumerate((-fence_x, -72, 72, fence_x)):
        kit.box(collection, root, f"ThatchHutLV3_BackFencePost_{index}",
                (11, 11, 112), (x, fence_back, fh + 56), mats["iron"],
                bevel_width=1.5)

    chainlink_front_panel(collection, root, "ThatchHutLV3_FrontFence_Left",
                          -fence_x, -48, fence_front, fh + 8, fence_h,
                          mats["iron"])
    chainlink_front_panel(collection, root, "ThatchHutLV3_FrontFence_Right",
                          48, fence_x, fence_front, fh + 8, fence_h,
                          mats["iron"])
    chainlink_front_panel(collection, root, "ThatchHutLV3_BackFence",
                          -fence_x, fence_x, fence_back, fh + 8, fence_h,
                          mats["iron"])
    chainlink_side_panel(collection, root, "ThatchHutLV3_LeftFence",
                         -fence_x, fence_front, fence_back, fh + 8,
                         fence_h, mats["iron"])
    chainlink_side_panel(collection, root, "ThatchHutLV3_RightFence",
                         fence_x, fence_front, fence_back, fh + 8,
                         fence_h, mats["iron"])
    for run_name, start, end in (
            ("FrontLeft", (-fence_x, fence_front), (-48, fence_front)),
            ("FrontRight", (48, fence_front), (fence_x, fence_front)),
            ("Back", (-fence_x, fence_back), (fence_x, fence_back)),
            ("Left", (-fence_x, fence_front), (-fence_x, fence_back)),
            ("Right", (fence_x, fence_front), (fence_x, fence_back))):
        camp_barbed_wire_run(collection, root, f"ThatchHutLV3_BarbedWire_{run_name}",
                             start, end, fh + 104, mats,
                             barb_count=8 if run_name in ("Back", "Left", "Right") else 5)

    # Four fixed poles carry a real cord grid plus irregular opaque camouflage patches.
    net_center_x, net_center_y = 78, -34
    net_w, net_d, net_z = 188, 128, fh + 154
    for x_sign, x_label in ((-1, "Left"), (1, "Right")):
        for y_sign, y_label in ((-1, "Front"), (1, "Rear")):
            x = net_center_x + x_sign * net_w / 2
            y = net_center_y + y_sign * net_d / 2
            kit.box(collection, root,
                    f"ThatchHutLV3_CamoNetPole_{x_label}{y_label}",
                    (10, 10, net_z - fh), (x, y, fh + (net_z - fh) / 2),
                    mats["iron"], bevel_width=1.5)
    for index in range(7):
        y = net_center_y - net_d / 2 + net_d * index / 6
        kit.box(collection, root, f"ThatchHutLV3_CamoNet_XCord_{index}",
                (net_w, 3, 3), (net_center_x, y, net_z),
                dark_canvas, rotation=(0, 0, 0), bevel_width=0.4)
    for index in range(9):
        x = net_center_x - net_w / 2 + net_w * index / 8
        kit.box(collection, root, f"ThatchHutLV3_CamoNet_YCord_{index}",
                (3, net_d, 3), (x, net_center_y, net_z + 1),
                dark_canvas, rotation=(0, 0, 0), bevel_width=0.4)
    patch_specs = (
        (-62, -39, 34, 23, -12, canvas), (-18, -44, 28, 30, 8, dark_canvas),
        (24, -34, 42, 22, -7, canvas), (64, -42, 31, 27, 14, dark_canvas),
        (-48, 2, 30, 26, 9, dark_canvas), (-5, 8, 40, 25, -11, canvas),
        (39, 5, 32, 32, 6, dark_canvas), (72, 18, 37, 21, -5, canvas),
        (-70, 42, 28, 22, 13, canvas), (2, 47, 35, 24, -8, dark_canvas),
    )
    for index, (ox, oy, pw, pd, rotation_z, mat) in enumerate(patch_specs):
        kit.box(collection, root, f"ThatchHutLV3_CamoNet_Patch_{index:02d}",
                (pw, pd, 3.5), (net_center_x + ox, net_center_y + oy,
                                net_z + 3), mat,
                rotation=(0, 0, rotation_z), bevel_width=3)

    # Fixed obstacle lane keeps the compound readable as a training site.
    for index, x in enumerate((-118, -58)):
        kit.box(collection, root, f"ThatchHutLV3_VaultWall_{index}",
                (42, 18, 48 + index * 14), (x, -70, fh + 24 + index * 7),
                concrete, bevel_width=4)
    for index, y in enumerate((-105, -76, -47)):
        kit.box(collection, root, f"ThatchHutLV3_CrawlRail_{index}",
                (72, 10, 10), (-92, y, fh + 38), mats["iron"],
                bevel_width=1)
        for side in (-1, 1):
            kit.box(collection, root,
                    f"ThatchHutLV3_CrawlRailLeg_{index}_{side:+d}",
                    (8, 8, 38), (-92 + side * 31, y, fh + 19),
                    mats["iron"], bevel_width=1)
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


def cheese_farm_wheel(collection, root, name, location, radius, depth,
                      cheese_mat, rind_mat, rotation=(90, 0, 0)):
    """One readable cheese wheel with a darker editable rind and center."""
    kit.cylinder(collection, root, name + "_Rind", radius, depth, location,
                 rind_mat, rotation=rotation, vertices=40, bevel_width=1.2)
    x, y, z = location
    axis_offset = depth * 0.54
    if rotation == (90, 0, 0):
        face_location = (x, y - axis_offset, z)
    else:
        face_location = (x - axis_offset, y, z)
    kit.cylinder(collection, root, name + "_Face", radius * 0.82,
                 max(2.5, depth * 0.12), face_location, cheese_mat,
                 rotation=rotation, vertices=40, bevel_width=0.7)


def build_cheese_farm(spec):
    """Broad 4x4 dairy compound with a central hall, cowshed and workshop."""
    collection, root, mats = common_context("cheese_farm", spec)
    dims = spec["dimensions"]
    fw, fd, fh = dims["foundation"]
    main_w, main_d, main_h = dims["mainHall"]
    main_rw, main_rd, main_rh = dims["mainRoof"]
    shed_w, shed_d, shed_h = dims["cowShed"]
    shed_rw, shed_rd, shed_rh = dims["cowShedRoof"]
    work_w, work_d, work_h = dims["workshop"]
    work_rw, work_rd, work_rh = dims["workshopRoof"]

    pasture = kit.material(
        "MAT_CheeseFarm_FlatPasture", kit.rgba((0.225, 0.245, 0.145, 1.0)),
        roughness=0.98, noise={"scale": 14, "detail": 3, "bump": 0.08})
    cheese = kit.material(
        "MAT_CheeseFarm_Cheese", kit.rgba((0.72, 0.47, 0.105, 1.0)),
        roughness=0.76, noise={"scale": 8, "detail": 2, "bump": 0.08})
    rind = kit.material(
        "MAT_CheeseFarm_Rind", kit.rgba((0.44, 0.245, 0.055, 1.0)),
        roughness=0.84, noise={"scale": 7, "detail": 3, "bump": 0.12})
    dark_interior = kit.material(
        "MAT_CheeseFarm_CowshedInterior", kit.rgba((0.055, 0.038, 0.024, 1.0)),
        roughness=0.96)

    # The shallow 4x4 pasture is the compound's complete visual ground. It is
    # intentionally broad and low, not a raised universal stone plinth.
    kit.box(collection, root, "CheeseFarm_PastureFoundation", (fw, fd, fh),
            (0, 0, fh / 2), pasture, bevel_width=6)

    main_y = 126
    main_front = main_y - main_d / 2 - 4
    main_roof_base = fh + main_h - 3
    kit.box(collection, root, "CheeseFarm_MainHall_ConnectedShell",
            (main_w, main_d, main_h), (0, main_y, fh + main_h / 2),
            mats["plaster"], bevel_width=5)
    kit.box(collection, root, "CheeseFarm_MainHall_StoneSkirt",
            (main_w + 10, main_d + 10, 54),
            (0, main_y, fh + 27), mats["stone"], bevel_width=4)
    kit.half_timber_facade(collection, root, "CheeseFarm_MainHall_FrontTimber",
                           main_w, main_h, main_front, fh, mats["timber"], bays=4)
    kit.half_timber_side(collection, root, "CheeseFarm_MainHall_SideTimber",
                         main_d, main_h, -main_w / 2 - 4, fh,
                         mats["timber"], bays=3)
    kit.gabled_prism(collection, root, "CheeseFarm_MainHall_ContinuousRoof",
                     main_rw, main_rd, main_rh, (0, main_y, main_roof_base),
                     mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "CheeseFarm_MainHall_RoofCourse",
                  main_rw, main_rd, main_rh, main_roof_base,
                  mats["roof"], rows=11)
    kit.double_doors(collection, root, "CheeseFarm_MainHall_DoubleDoor",
                     (0, main_front - 5, fh), 92, 112,
                     mats["timber"], mats["iron"], open_angle=12)
    for x in (-102, 102):
        kit.shutter_window(collection, root,
                           f"CheeseFarm_MainHall_Window_{'L' if x < 0 else 'R'}",
                           (x, main_front - 3, fh + 88), mats["glass"],
                           mats["timber"], mats["iron"], scale=0.72)
    # No-text cheese-wheel sign makes the economic function legible at game scale.
    kit.box(collection, root, "CheeseFarm_MainHall_CheeseSignBoard",
            (70, 10, 70), (104, main_front - 14, fh + 136),
            mats["timber"], bevel_width=10)
    cheese_farm_wheel(collection, root, "CheeseFarm_MainHall_CheeseEmblem",
                      (104, main_front - 22, fh + 136), 27, 8, cheese, rind)
    kit.lantern(collection, root, "CheeseFarm_MainHall_Lantern",
                (-62, main_front - 17, fh + 91), mats["iron"], mats["glow"])

    # Left connected open cowshed: a real roofed shelter with visible stalls,
    # feed trough and dark rear wall, but no cow baked into the building asset.
    shed_x, shed_y = -256, 91
    shed_back = shed_y + shed_d / 2
    shed_front = shed_y - shed_d / 2
    kit.box(collection, root, "CheeseFarm_Cowshed_RearDarkInterior",
            (shed_w - 20, 12, shed_h - 26),
            (shed_x, shed_back - 7, fh + (shed_h - 26) / 2),
            dark_interior, bevel_width=2)
    kit.box(collection, root, "CheeseFarm_Cowshed_RearStoneWall",
            (shed_w, 20, 64), (shed_x, shed_back, fh + 32),
            mats["stone"], bevel_width=3)
    for side, label in ((-1, "Left"), (1, "Right")):
        x = shed_x + side * (shed_w / 2 - 10)
        kit.box(collection, root, f"CheeseFarm_Cowshed_{label}LowWall",
                (20, shed_d, 48), (x, shed_y, fh + 24),
                mats["stone"], bevel_width=3)
        for y, position in ((shed_front + 11, "Front"),
                            (shed_back - 11, "Back")):
            kit.box(collection, root,
                    f"CheeseFarm_Cowshed_{label}{position}Post",
                    (18, 18, shed_h), (x, y, fh + shed_h / 2),
                    mats["timber"], bevel_width=2)
    kit.gabled_prism(collection, root, "CheeseFarm_Cowshed_ContinuousRoof",
                     shed_rw, shed_rd, shed_rh,
                     (shed_x, shed_y, fh + shed_h - 3),
                     mats["timber"], mats["thatch"])
    kit.roof_rows(collection, root, "CheeseFarm_Cowshed_ThatchCourse",
                  shed_rw, shed_rd, shed_rh, fh + shed_h - 3,
                  mats["thatch"], rows=8)
    for index, local_x in enumerate((-55, 0, 55)):
        x = shed_x + local_x
        kit.box(collection, root, f"CheeseFarm_Cowshed_StallDivider_{index}",
                (9, 112, 54), (x, shed_y - 12, fh + 27),
                mats["timber"], bevel_width=1.5)
    kit.box(collection, root, "CheeseFarm_Cowshed_FeedTrough",
            (shed_w - 54, 34, 30), (shed_x, shed_front + 34, fh + 15),
            mats["timber"], bevel_width=5)
    kit.box(collection, root, "CheeseFarm_Cowshed_FeedTroughHay",
            (shed_w - 68, 23, 12), (shed_x, shed_front + 34, fh + 34),
            mats["straw"], bevel_width=4)

    # Right connected workshop: enclosed processing room plus fixed cheese press
    # and aging shelf. Every production prop remains attached to the structure.
    work_x, work_y = 260, 94
    work_front = work_y - work_d / 2 - 4
    work_roof_base = fh + work_h - 3
    kit.box(collection, root, "CheeseFarm_Workshop_ConnectedShell",
            (work_w, work_d, work_h),
            (work_x, work_y, fh + work_h / 2), mats["plaster"], bevel_width=4)
    kit.box(collection, root, "CheeseFarm_Workshop_StoneSkirt",
            (work_w + 8, work_d + 8, 48),
            (work_x, work_y, fh + 24), mats["stone"], bevel_width=3)
    kit.half_timber_facade(collection, root, "CheeseFarm_Workshop_FrontTimber",
                           work_w, work_h, work_front, fh, mats["timber"], bays=3)
    kit.gabled_prism(collection, root, "CheeseFarm_Workshop_ContinuousRoof",
                     work_rw, work_rd, work_rh,
                     (work_x, work_y, work_roof_base),
                     mats["timber"], mats["roof"])
    kit.roof_rows(collection, root, "CheeseFarm_Workshop_RoofCourse",
                  work_rw, work_rd, work_rh, work_roof_base,
                  mats["roof"], rows=9)
    kit.double_doors(collection, root, "CheeseFarm_Workshop_Door",
                     (work_x - 47, work_front - 5, fh), 58, 94,
                     mats["timber"], mats["iron"], open_angle=0)
    kit.shutter_window(collection, root, "CheeseFarm_Workshop_Window",
                       (work_x + 48, work_front - 3, fh + 72), mats["glass"],
                       mats["timber"], mats["iron"], scale=0.68)
    press_x, press_y = work_x + 49, work_front - 31
    kit.box(collection, root, "CheeseFarm_Workshop_CheesePress_Base",
            (72, 44, 15), (press_x, press_y, fh + 8),
            mats["timber"], bevel_width=3)
    for side in (-1, 1):
        kit.box(collection, root,
                f"CheeseFarm_Workshop_CheesePress_Post_{side:+d}",
                (11, 11, 82), (press_x + side * 25, press_y,
                               fh + 49), mats["timber"], bevel_width=1.5)
    kit.box(collection, root, "CheeseFarm_Workshop_CheesePress_TopBeam",
            (78, 16, 15), (press_x, press_y, fh + 88),
            mats["timber"], bevel_width=2)
    kit.cylinder(collection, root, "CheeseFarm_Workshop_CheesePress_Screw",
                 6, 54, (press_x, press_y, fh + 64), mats["iron"],
                 vertices=20, bevel_width=1)
    kit.cylinder(collection, root, "CheeseFarm_Workshop_CheesePress_Plate",
                 25, 7, (press_x, press_y, fh + 38), mats["iron"],
                 vertices=32, bevel_width=1)
    shelf_x, shelf_y = work_x + work_w / 2 - 18, work_y + 20
    kit.box(collection, root, "CheeseFarm_Workshop_AgingShelf_Back",
            (15, 112, 92), (shelf_x, shelf_y, fh + 48),
            mats["timber"], bevel_width=2)
    for index, z in enumerate((fh + 24, fh + 55, fh + 86)):
        kit.box(collection, root, f"CheeseFarm_Workshop_AgingShelf_{index}",
                (40, 118, 8), (shelf_x - 10, shelf_y, z),
                mats["timber"], bevel_width=1)
        for wheel_index, y in enumerate((shelf_y - 36, shelf_y, shelf_y + 36)):
            cheese_farm_wheel(
                collection, root,
                f"CheeseFarm_Workshop_AgingWheel_{index}_{wheel_index}",
                (shelf_x - 34, y, z + 10), 12, 8, cheese, rind,
                rotation=(0, 90, 0))

    # Uniformly shrink only the three-building cluster around its ground-level
    # center. The 4x4 pasture, fence, gate and troughs keep their original size.
    structure_scale = float(dims.get("structureScale", 1.0))
    if abs(structure_scale - 1.0) > 1e-6:
        pivot_y = float(dims.get("structurePivotY", 100))
        prefixes = ("CheeseFarm_MainHall_", "CheeseFarm_Cowshed_",
                    "CheeseFarm_Workshop_")
        for obj in list(root.children):
            if not obj.name.startswith(prefixes):
                continue
            obj.location.x *= structure_scale
            obj.location.y = pivot_y + (obj.location.y - pivot_y) * structure_scale
            obj.location.z = fh + (obj.location.z - fh) * structure_scale
            obj.scale = tuple(value * structure_scale for value in obj.scale)

    # Shared perimeter component keeps the 4x4 boundary editable and leaves a
    # clear centered entrance aligned to the central dairy hall.
    fence_inset = float(dims.get("fenceInset", 22))
    kit.post_and_rail_enclosure(
        collection, root, "CheeseFarm_PerimeterFence", fw - fence_inset * 2,
        -fd / 2 + fence_inset, fd / 2 - fence_inset, fh,
        mats["timber"], gate_width=126, rail_offsets=(31, 68),
        post_height=88, post_spacing=118, include_back=True,
        gate_leaves=True, gate_open_angle=62)

    # Sparse fixed troughs preserve the broad pasture instead of filling it
    # with loose props; animated cows and cowherds will be separate runtime art.
    for index, x in enumerate((-142, 144)):
        kit.box(collection, root, f"CheeseFarm_Pasture_WaterTrough_{index}",
                (104, 36, 28), (x, -166, fh + 14),
                mats["foundation"], bevel_width=7)
        kit.box(collection, root, f"CheeseFarm_Pasture_WaterSurface_{index}",
                (88, 23, 5), (x, -166, fh + 29),
                mats["glass"], bevel_width=5)
    return root


BUILDERS = {
    "wheat_windmill": build_windmill,
    "warehouse": build_warehouse,
    "warehouse_lv2": build_warehouse_lv2,
    "warehouse_lv3": build_warehouse_lv3,
    "warehouse_lv4": build_warehouse_lv4,
    "warehouse_lv5": build_warehouse_lv5,
    "main_space_warehouse": build_main_space_warehouse,
    "main_space_warehouse_open": build_main_space_warehouse_open,
    "dungeon_chest_closed": build_dungeon_chest_closed,
    "dungeon_chest_open": build_dungeon_chest_open,
    "research_institute": build_research_institute,
    "research_institute_lv2": build_research_institute_lv2,
    "research_institute_lv3": build_research_institute_lv3,
    "church": build_church,
    "blacksmith": build_blacksmith,
    "armory": build_armory,
    "shooting_range": build_shooting_range,
    "cavalry_school": build_cavalry_school,
    "hamster_barracks": build_hamster_barracks,
    "hamster_barracks_lv2": build_hamster_barracks_lv2,
    "hamster_barracks_lv3": build_hamster_barracks_lv3,
    "explorer_camp": build_explorer_camp,
    "miner_camp": build_miner_camp,
    "mine_cave": build_mine_cave,
    "market": build_market,
    "royal_mint": build_royal_mint,
    "bakery": build_bakery,
    "steam_power_plant": build_steam_power_plant,
    "wind_power_plant": build_wind_power_plant,
    "solar_power_plant": build_solar_power_plant,
    "computing_center": build_computing_center,
    "university": build_university,
    "deep_drill": build_deep_drill,
    "tavern": build_tavern,
    "chain_restaurant": build_chain_restaurant,
    "grand_mall": build_grand_mall,
    "stock_exchange": build_stock_exchange,
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
    "energy_vein_1": build_energy_vein_1,
    "energy_vein_2": build_energy_vein_2,
    "energy_vein_3": build_energy_vein_3,
    "house_lv1": build_house_lv1,
    "house_lv2": build_house_lv2,
    "house_lv3": build_house_lv3,
    "house_lv4": build_house_lv4,
    "house_lv5": build_house_lv5,
    "house_lv6": build_house_lv6,
    "house_lv7": build_house_lv7,
    "thatch_hut": build_thatch_hut,
    "thatch_hut_lv2": build_thatch_hut_lv2,
    "thatch_hut_lv3": build_thatch_hut_lv3,
    "cheese_farm": build_cheese_farm,
}


def body_depth_exclude_names(building_id, spec, exclude_key="bodyDepthExclude"):
    excluded_names = spec.get(exclude_key)
    if excluded_names is None and building_id.startswith("research_institute"):
        level = 3 if building_id.endswith("_lv3") else 2 if building_id.endswith("_lv2") else 1
        excluded_names = [
            f"ResearchLV{level}_Foundation_Base",
            f"ResearchLV{level}_Foundation_Inset",
        ]
    if not excluded_names:
        raise SystemExit(f"depth-only output requires {exclude_key} for {building_id}")
    return excluded_names


def render_saved_body_depth(building_id, spec, blend_path, body_depth_path,
                            exclude_key="bodyDepthExclude"):
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
    for object_name in body_depth_exclude_names(building_id, spec, exclude_key):
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
     body_depth_path, depth_only_mode) = parse_args()
    with open(manifest_path, "r", encoding="utf-8-sig") as handle:
        manifest = json.load(handle)
    if building_id not in BUILDERS:
        raise SystemExit(f"unknown building id: {building_id}")
    spec = manifest["buildings"][building_id]
    camera_config = dict(manifest["camera"])
    camera_config.update(spec.get("cameraOverrides", {}))
    spec["camera"] = camera_config
    spec["palette"] = manifest["palette"]
    if depth_only_mode:
        exclude_key = "cutoutDepthExclude" if depth_only_mode == "--cutout-only" else "bodyDepthExclude"
        render_saved_body_depth(building_id, spec, blend_path, body_depth_path, exclude_key)
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
    approval_preview_path = publish_approval_preview(building_id, preview_path)
    kit.render_depth(bpy.context.scene, root, camera, depth_path, building_id)
    if body_depth_path:
        spawn_saved_body_depth(
            manifest_path, building_id, blend_path, preview_path,
            depth_path, body_depth_path)
    print("building id ->", building_id)
    print("model ->", blend_path)
    print("preview ->", preview_path)
    print("approval preview ->", approval_preview_path)
    print("depth ->", depth_path)
    if body_depth_path:
        print("body depth ->", body_depth_path)


if __name__ == "__main__":
    main()
