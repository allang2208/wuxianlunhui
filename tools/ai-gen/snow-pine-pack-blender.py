#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build five editable World-123 snow-pine obstacle models and transparent previews."""

from __future__ import annotations

import importlib.util
import json
import math
import os
import sys

import bpy
from mathutils import Vector


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def load_kit():
    path = os.path.join(SCRIPT_DIR, "building-component-kit.py")
    spec = importlib.util.spec_from_file_location("world123_snow_pine_kit", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kit = load_kit()


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 4:
        raise SystemExit(
            "usage: blender --background --factory-startup --python snow-pine-pack-blender.py "
            "-- pine_id out.blend preview.png metadata.json"
        )
    return argv[0], *(os.path.abspath(value) for value in argv[1:])


def common_context(pine_id):
    collection = bpy.data.collections.new(pine_id.upper() + "_EDITABLE_COMPONENTS")
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new(pine_id.upper() + "_ROOT_ROT_Z_44_8", None)
    collection.objects.link(root)
    root.rotation_euler.z = math.radians(44.8)
    mats = {
        "bark": kit.material(
            "MAT_SnowPine_WeatheredBark", kit.rgba((0.105, 0.067, 0.043, 1)),
            roughness=0.96,
            noise={"scale": 8, "detail": 5, "bump": 0.32, "dark": (0.045, 0.028, 0.018, 1), "light": (0.22, 0.13, 0.075, 1)},
        ),
        "dead": kit.material(
            "MAT_SnowPine_DeadBranch", kit.rgba((0.16, 0.13, 0.105, 1)),
            roughness=0.98,
            noise={"scale": 11, "detail": 4, "bump": 0.22},
        ),
        "needle": kit.material(
            "MAT_SnowPine_DesaturatedNeedles", kit.rgba((0.055, 0.135, 0.105, 1)),
            roughness=0.88,
            noise={"scale": 10, "detail": 4, "bump": 0.18, "dark": (0.018, 0.055, 0.045, 1), "light": (0.12, 0.245, 0.18, 1)},
        ),
        "young": kit.material(
            "MAT_SnowPine_YoungNeedles", kit.rgba((0.10, 0.21, 0.16, 1)),
            roughness=0.84,
            noise={"scale": 12, "detail": 3, "bump": 0.14},
        ),
        "snow": kit.material(
            "MAT_SnowPine_CoolSnow", kit.rgba((0.82, 0.875, 0.90, 1)),
            roughness=0.82,
            noise={"scale": 14, "detail": 3, "bump": 0.13, "dark": (0.60, 0.69, 0.75, 1), "light": (0.95, 0.98, 1.0, 1)},
        ),
    }
    return collection, root, mats


def smooth(obj):
    if obj.type == "MESH":
        for polygon in obj.data.polygons:
            polygon.use_smooth = True
    return obj


def tapered_between(collection, root, name, start, end, radius1, radius2, material, vertices=16):
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    length = direction.length
    midpoint = (start_v + end_v) * 0.5
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices,
        radius1=radius1,
        radius2=radius2,
        depth=length,
        location=midpoint,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    obj.parent = root
    obj.data.materials.append(material)
    kit.move_to_collection(obj, collection)
    kit.bevel(obj, min(radius1, radius2) * 0.15, 2)
    return smooth(obj)


def ellipsoid(collection, root, name, location, dimensions, material, direction=None, subdivisions=2):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdivisions, radius=1, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    if direction is not None:
        vector = Vector(direction)
        if vector.length > 0.001:
            obj.rotation_mode = "QUATERNION"
            obj.rotation_quaternion = Vector((1, 0, 0)).rotation_difference(vector.normalized())
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = root
    obj.data.materials.append(material)
    kit.move_to_collection(obj, collection)
    return smooth(obj)


def interpolate(points, z):
    if z <= points[0][2]:
        return Vector(points[0])
    for index in range(len(points) - 1):
        a = Vector(points[index])
        b = Vector(points[index + 1])
        if a.z <= z <= b.z:
            t = (z - a.z) / max(0.001, b.z - a.z)
            return a.lerp(b, t)
    return Vector(points[-1])


def add_trunk(collection, root, mats, pine_id, nodes, base_radius=11.0):
    for index in range(len(nodes) - 1):
        z_ratio = nodes[index][2] / max(1.0, nodes[-1][2])
        r1 = max(2.2, base_radius * (1.0 - z_ratio * 0.74))
        next_ratio = nodes[index + 1][2] / max(1.0, nodes[-1][2])
        r2 = max(1.25, base_radius * (1.0 - next_ratio * 0.79))
        tapered_between(
            collection, root, f"{pine_id}_Trunk_{index:02d}",
            nodes[index], nodes[index + 1], r1, r2, mats["bark"], vertices=20,
        )


def add_branch(collection, root, mats, pine_id, tier, branch_index, start, angle, length,
               droop, foliage_scale=1.0, snow_scale=1.0, sparse=False, dead=False):
    direction = Vector((math.cos(angle), math.sin(angle), -droop / max(length, 1)))
    horizontal = Vector((math.cos(angle), math.sin(angle), 0))
    mid = Vector(start) + horizontal * (length * 0.56) + Vector((0, 0, 1.4 - droop * 0.30))
    end = Vector(start) + horizontal * length + Vector((0, 0, -droop))
    branch_mat = mats["dead"] if dead else mats["bark"]
    branch_radius = max(0.65, 2.7 * foliage_scale)
    tapered_between(
        collection, root, f"{pine_id}_Tier{tier:02d}_Branch{branch_index:02d}_A",
        start, mid, branch_radius, max(0.42, branch_radius * 0.55), branch_mat, vertices=12,
    )
    tapered_between(
        collection, root, f"{pine_id}_Tier{tier:02d}_Branch{branch_index:02d}_B",
        mid, end, max(0.42, branch_radius * 0.56), 0.22, branch_mat, vertices=10,
    )
    if dead:
        return
    cluster_count = 2 if sparse else 3
    for cluster in range(cluster_count):
        frac = (0.34, 0.63, 0.86)[cluster]
        center = Vector(start).lerp(end, frac)
        center.z += 1.2 + 0.8 * (1.0 - frac)
        cluster_len = length * (0.26 if cluster < 2 else 0.20)
        width = max(5.0, 10.0 * foliage_scale * (1.05 - frac * 0.25))
        height = max(4.0, 7.5 * foliage_scale)
        ellipsoid(
            collection, root,
            f"{pine_id}_Tier{tier:02d}_Branch{branch_index:02d}_Needles{cluster}",
            center, (cluster_len, width, height),
            mats["young"] if tier >= 9 and cluster == cluster_count - 1 else mats["needle"],
            direction=direction,
        )
        snow_center = center + Vector((0, 0, height * 0.46))
        ellipsoid(
            collection, root,
            f"{pine_id}_Tier{tier:02d}_Branch{branch_index:02d}_Snow{cluster}",
            snow_center, (cluster_len * 0.92, width * 0.82, max(1.5, 2.6 * snow_scale)),
            mats["snow"], direction=horizontal,
        )


def add_crown(collection, root, mats, pine_id, nodes, top_z, lean_direction=0.0):
    center = interpolate(nodes, top_z - 15)
    tip = interpolate(nodes, top_z)
    tapered_between(collection, root, pine_id + "_CrownLeader", center, tip, 2.7, 0.45, mats["bark"], vertices=12)
    for index, frac in enumerate((0.18, 0.42, 0.66, 0.84)):
        z = top_z - 25 + frac * 22
        c = interpolate(nodes, z)
        width = 17 * (1.0 - frac * 0.55)
        ellipsoid(
            collection, root, f"{pine_id}_CrownNeedles_{index}",
            c + Vector((math.cos(lean_direction) * 1.5, math.sin(lean_direction) * 1.5, 0)),
            (width, width * 0.72, 13), mats["young"],
            direction=(math.cos(lean_direction), math.sin(lean_direction), 0.2),
        )
        ellipsoid(
            collection, root, f"{pine_id}_CrownSnow_{index}",
            c + Vector((0, 0, 5.5)), (width * 0.72, width * 0.58, 2.2), mats["snow"],
            direction=(math.cos(lean_direction), math.sin(lean_direction), 0),
        )


VARIANTS = {
    "01": {
        "label": "upright_dense",
        "nodes": [(0, 0, 0), (0, 0, 72), (1, 0, 145), (0, 1, 210), (0, 1, 270)],
        "levels": [34, 51, 69, 88, 108, 129, 151, 174, 197, 219, 239],
        "base_length": 78,
        "branches": 8,
        "angle_offset": 0.12,
        "snow": 1.0,
    },
    "02": {
        "label": "left_lean_snowloaded",
        "nodes": [(0, 0, 0), (-4, 0, 68), (-12, 0, 139), (-24, 1, 208), (-34, 2, 272)],
        "levels": [38, 58, 80, 103, 127, 151, 176, 201, 224, 244],
        "base_length": 82,
        "branches": 7,
        "angle_offset": 0.38,
        "snow": 1.22,
        "bias": -0.15,
    },
    "03": {
        "label": "right_lean_broken_layers",
        "nodes": [(0, 0, 0), (3, 0, 70), (10, -1, 138), (21, -1, 205), (29, 0, 267)],
        "levels": [36, 57, 79, 104, 132, 159, 188, 214, 239],
        "base_length": 84,
        "branches": 7,
        "angle_offset": 0.72,
        "snow": 0.92,
        "skip": {(3, 1), (3, 2), (6, 4)},
    },
    "04": {
        "label": "windswept_flag_crown",
        "nodes": [(0, 0, 0), (2, 0, 66), (8, 0, 132), (18, 0, 196), (31, 1, 258)],
        "levels": [34, 55, 78, 102, 128, 155, 182, 207, 229],
        "base_length": 90,
        "branches": 6,
        "angle_offset": 0.0,
        "snow": 0.84,
        "windswept": True,
    },
    "05": {
        "label": "old_sparse_exposed_trunk",
        "nodes": [(0, 0, 0), (0, 0, 75), (-2, 1, 148), (1, 1, 218), (0, 0, 282)],
        "levels": [43, 70, 99, 131, 165, 200, 232, 254],
        "base_length": 76,
        "branches": 6,
        "angle_offset": 0.45,
        "snow": 0.72,
        "sparse": True,
        "dead": {(0, 1), (1, 4), (3, 0), (5, 3)},
    },
}


def build_pine(pine_id):
    variant = VARIANTS[pine_id]
    collection, root, mats = common_context(pine_id)
    nodes = variant["nodes"]
    top_z = nodes[-1][2]
    add_trunk(collection, root, mats, pine_id, nodes, base_radius=11.5 if pine_id != "05" else 10.5)
    levels = variant["levels"]
    for tier, z in enumerate(levels):
        center = interpolate(nodes, z)
        height_ratio = z / top_z
        tier_length = variant["base_length"] * (1.0 - height_ratio * 0.70)
        tier_length *= 1.0 + 0.055 * math.sin(tier * 2.17)
        branch_count = variant["branches"]
        for branch_index in range(branch_count):
            if (tier, branch_index) in variant.get("skip", set()):
                continue
            angle = variant["angle_offset"] + branch_index * (2 * math.pi / branch_count) + tier * 0.31
            length = tier_length * (0.88 + 0.14 * math.sin(branch_index * 1.9 + tier))
            if variant.get("bias"):
                # Longer branches on the load-bearing side of the leaning trunk.
                side = math.cos(angle)
                length *= 1.0 + variant["bias"] * side
            if variant.get("windswept"):
                # Keep short windward stubs and stretch the leeward crown into a flag silhouette.
                leeward = max(0.0, math.cos(angle))
                windward = max(0.0, -math.cos(angle))
                length *= 0.40 + 0.95 * leeward + 0.10 * (1.0 - windward)
                angle = angle * 0.30
            droop = 5.0 + length * (0.10 if tier > len(levels) * 0.55 else 0.16)
            sparse = bool(variant.get("sparse"))
            dead = (tier, branch_index) in variant.get("dead", set())
            add_branch(
                collection, root, mats, pine_id, tier, branch_index, center, angle, length, droop,
                foliage_scale=max(0.58, 1.08 - height_ratio * 0.34),
                snow_scale=variant["snow"], sparse=sparse, dead=dead,
            )
    lean = math.atan2(nodes[-1][1] - nodes[0][1], nodes[-1][0] - nodes[0][0])
    add_crown(collection, root, mats, pine_id, nodes, top_z, lean_direction=lean)
    return root


def main():
    pine_id, blend_path, preview_path, metadata_path = parse_args()
    if pine_id not in VARIANTS:
        raise SystemExit(f"unknown snow-pine id: {pine_id}")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    root = build_pine(pine_id)
    spec = {
        "camera": {
            "elevation": 30,
            "azimuth": 0,
            "buildingRotationZ": 44.8,
            "resolution": 1024,
            "bottomY": 946,
            "topMargin": 38,
            "widthMargin": 0.80,
        }
    }
    kit.setup_scene(spec, preview_path)
    camera = kit.setup_camera(spec, root)
    bpy.context.scene.camera = camera
    os.makedirs(os.path.dirname(blend_path), exist_ok=True)
    os.makedirs(os.path.dirname(preview_path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.render.render(write_still=True)
    metadata = {
        "id": pine_id,
        "shape": VARIANTS[pine_id]["label"],
        "styleVersion": "world123-obstacle-snow-pine-v2",
        "camera": spec["camera"],
        "model": os.path.relpath(blend_path, os.getcwd()),
        "preview": os.path.relpath(preview_path, os.getcwd()),
        "runtimeTextureKey": "obstacle_snow_pine_" + pine_id,
        "collision": "preserve existing world footprint by resolution-ratio scaling after final alpha crop",
    }
    os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
    with open(metadata_path, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print("snow pine ->", pine_id)
    print("model ->", blend_path)
    print("preview ->", preview_path)
    print("metadata ->", metadata_path)


if __name__ == "__main__":
    main()
