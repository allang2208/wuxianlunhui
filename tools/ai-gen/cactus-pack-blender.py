#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build four editable World-122 cactus obstacle models and transparent previews."""

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
    spec = importlib.util.spec_from_file_location("world122_cactus_kit", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kit = load_kit()


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 4:
        raise SystemExit(
            "usage: blender --background --factory-startup --python cactus-pack-blender.py "
            "-- cactus_id out.blend preview.png metadata.json"
        )
    return argv[0], *(os.path.abspath(value) for value in argv[1:])


def common_context(cactus_id):
    collection = bpy.data.collections.new(cactus_id.upper() + "_EDITABLE_COMPONENTS")
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new(cactus_id.upper() + "_ROOT_ROT_Z_44_8", None)
    collection.objects.link(root)
    root.rotation_euler.z = math.radians(44.8)
    mats = {
        "skin": kit.material(
            "MAT_Cactus_MutedWaxGreen", kit.rgba((0.17, 0.29, 0.105, 1)),
            roughness=0.72, noise={"scale": 7, "detail": 4, "bump": 0.18},
        ),
        "young": kit.material(
            "MAT_Cactus_YoungRidgeGreen", kit.rgba((0.25, 0.39, 0.14, 1)),
            roughness=0.68, noise={"scale": 9, "detail": 3, "bump": 0.12},
        ),
        "areole": kit.material(
            "MAT_Cactus_AgedAreole", kit.rgba((0.62, 0.56, 0.38, 1)),
            roughness=0.94, noise={"scale": 12, "detail": 3, "bump": 0.2},
        ),
        "scar": kit.material(
            "MAT_Cactus_CorkScar", kit.rgba((0.20, 0.145, 0.07, 1)),
            roughness=0.96, noise={"scale": 8, "detail": 4, "bump": 0.24},
        ),
    }
    return collection, root, mats


def mesh_object(collection, root, name, vertices, faces, material):
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    obj.data.materials.append(material)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    kit.bevel(obj, 0.7, 2)
    return obj


def ribbed_column(collection, root, name, radius, height, location, material,
                  ribs=12, segments=48, rings=22, taper=0.10, squat=1.0):
    vertices = []
    faces = []
    for ring in range(rings + 1):
        t = ring / rings
        z = height * t
        base_round = min(1.0, 0.72 + 0.28 * min(1.0, t / 0.08))
        if t > 0.80:
            crown_t = (t - 0.80) / 0.20
            crown = max(0.025, math.cos(crown_t * math.pi / 2) ** 0.62)
        else:
            crown = 1.0
        body = radius * (1.0 - taper * t) * base_round * crown
        for segment in range(segments):
            theta = 2 * math.pi * segment / segments
            rib = 1.0 + 0.075 * math.cos(ribs * theta)
            vertices.append((
                location[0] + body * rib * math.cos(theta),
                location[1] + body * rib * math.sin(theta),
                location[2] + z * squat,
            ))
    for ring in range(rings):
        for segment in range(segments):
            nxt = (segment + 1) % segments
            a = ring * segments + segment
            b = ring * segments + nxt
            c = (ring + 1) * segments + nxt
            d = (ring + 1) * segments + segment
            faces.append((a, b, c, d))
    return mesh_object(collection, root, name, vertices, faces, material)


def tube_path(collection, root, name, points, radius, material, resolution=3):
    curve = bpy.data.curves.new(name + "_Curve", type="CURVE")
    curve.dimensions = "3D"
    curve.resolution_u = 18
    curve.bevel_resolution = resolution
    curve.bevel_depth = radius
    curve.resolution_u = 20
    curve.use_fill_caps = True
    spline = curve.splines.new("BEZIER")
    spline.bezier_points.add(len(points) - 1)
    for point, coord in zip(spline.bezier_points, points):
        point.co = coord
        point.handle_left_type = "AUTO"
        point.handle_right_type = "AUTO"
    obj = bpy.data.objects.new(name, curve)
    collection.objects.link(obj)
    obj.parent = root
    obj.data.materials.append(material)
    return obj


def sphere(collection, root, name, radius, location, material, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    obj.parent = root
    obj.data.materials.append(material)
    kit.move_to_collection(obj, collection)
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def capsule_between(collection, root, name, start, end, radius, material):
    start_v = Vector(start)
    end_v = Vector(end)
    direction = end_v - start_v
    length = direction.length
    midpoint = (start_v + end_v) * 0.5
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=20, radius=radius, depth=length, location=midpoint
    )
    body = bpy.context.object
    body.name = name + "_Body"
    body.rotation_mode = "QUATERNION"
    body.rotation_quaternion = Vector((0, 0, 1)).rotation_difference(direction.normalized())
    body.parent = root
    body.data.materials.append(material)
    kit.move_to_collection(body, collection)
    kit.bevel(body, radius * 0.16, 3)
    for polygon in body.data.polygons:
        polygon.use_smooth = True
    sphere(collection, root, name + "_StartCap", radius * 1.01, start, material)
    sphere(collection, root, name + "_EndCap", radius * 1.01, end, material)
    return body


def add_areoles(collection, root, prefix, center, radius, z_values, ribs, material,
                 angle_offset=0.0, size=1.45):
    for z_index, z in enumerate(z_values):
        for rib in range(ribs):
            theta = angle_offset + 2 * math.pi * rib / ribs
            r = radius * 1.075
            sphere(
                collection, root, f"{prefix}_Areole_{z_index:02d}_{rib:02d}", size,
                (center[0] + r * math.cos(theta), center[1] + r * math.sin(theta), z),
                material, scale=(1.0, 0.65, 0.75),
            )


def add_arm(collection, root, mats, name, side, base_z, out_x, top_z, radius):
    points = [
        (side * 12, 0, base_z),
        (side * out_x * 0.72, 0, base_z),
        (side * out_x, 0, base_z + 18),
        (side * out_x, 0, top_z),
    ]
    tube_path(collection, root, name + "_Body", points, radius, mats["skin"], resolution=4)
    sphere(collection, root, name + "_Tip", radius * 1.02,
           (side * out_x, 0, top_z), mats["young"], scale=(1, 1, 1.25))
    sphere(collection, root, name + "_Elbow", radius * 1.03,
           (side * out_x * 0.93, 0, base_z + 13), mats["skin"])
    for index, z in enumerate(range(int(base_z + 28), int(top_z), 18)):
        for angle_index, theta in enumerate((0, math.pi / 2, math.pi, math.pi * 1.5)):
            sphere(collection, root, f"{name}_Areole_{index}_{angle_index}", 1.35,
                   (side * out_x + math.cos(theta) * radius, math.sin(theta) * radius, z),
                   mats["areole"], scale=(1, 0.7, 0.7))


def saguaro_two_arm(cactus_id):
    collection, root, mats = common_context(cactus_id)
    ribbed_column(collection, root, "Cactus_Saguaro2_MainTrunk", 20, 218, (0, 0, 0), mats["skin"])
    add_areoles(collection, root, "Cactus_Saguaro2_Trunk", (0, 0), 20,
                range(18, 205, 18), 12, mats["areole"], size=1.25)
    add_arm(collection, root, mats, "Cactus_Saguaro2_LeftArm", -1, 72, 55, 151, 13)
    add_arm(collection, root, mats, "Cactus_Saguaro2_RightArm", 1, 108, 49, 180, 12)
    sphere(collection, root, "Cactus_Saguaro2_BaseScar", 11, (2, 1, 5), mats["scar"], scale=(1.25, 1, 0.32))
    return root


def saguaro_one_arm(cactus_id):
    collection, root, mats = common_context(cactus_id)
    ribbed_column(collection, root, "Cactus_Saguaro1_MainTrunk", 19, 224, (0, 0, 0), mats["skin"])
    add_areoles(collection, root, "Cactus_Saguaro1_Trunk", (0, 0), 19,
                range(18, 211, 18), 12, mats["areole"], size=1.2)
    add_arm(collection, root, mats, "Cactus_Saguaro1_Arm", -1, 86, 54, 157, 13)
    sphere(collection, root, "Cactus_Saguaro1_BaseScar", 10, (-1, 2, 5), mats["scar"], scale=(1.2, 1, 0.3))
    return root


def barrel_cactus(cactus_id):
    collection, root, mats = common_context(cactus_id)
    ribbed_column(collection, root, "Cactus_Barrel_RibbedBody", 58, 92, (0, 0, 0),
                  mats["skin"], ribs=16, segments=64, rings=24, taper=-0.04)
    add_areoles(collection, root, "Cactus_Barrel", (0, 0), 58,
                range(14, 82, 11), 16, mats["areole"], angle_offset=math.pi / 16, size=1.7)
    sphere(collection, root, "Cactus_Barrel_CrownWool", 12, (0, 0, 89), mats["areole"], scale=(1, 1, 0.22))
    for angle_index in range(8):
        theta = 2 * math.pi * angle_index / 8
        sphere(collection, root, f"Cactus_Barrel_CrownBud_{angle_index}", 2.1,
               (8 * math.cos(theta), 8 * math.sin(theta), 91), mats["young"], scale=(1, 1, 0.7))
    return root


def cholla_cactus(cactus_id):
    collection, root, mats = common_context(cactus_id)
    # The trunk itself is a chain of short capsules with narrow joints, not a ribbed saguaro column.
    trunk_nodes = ((0, 0, 4), (0, 0, 39), (2, 0, 73), (-1, 2, 108), (3, 3, 139))
    for index in range(len(trunk_nodes) - 1):
        capsule_between(collection, root, f"Cactus_Cholla_TrunkSegment_{index}",
                        trunk_nodes[index], trunk_nodes[index + 1], 10.5, mats["skin"])
        if index:
            sphere(collection, root, f"Cactus_Cholla_TrunkJoint_{index}", 7.7,
                   trunk_nodes[index], mats["scar"], scale=(1, 1, 0.72))

    branches = (
        ("LeftLow", ((0, 0, 42), (-27, -2, 49), (-47, -3, 70)), 8.6),
        ("RightLow", ((1, 0, 63), (28, -4, 70), (49, -6, 91)), 8.4),
        ("LeftHigh", ((0, 1, 83), (-24, 12, 94), (-40, 15, 119)), 8.0),
        ("RightHigh", ((0, 2, 105), (23, 13, 115), (35, 15, 139)), 7.8),
        ("RearFork", ((2, 3, 72), (15, 29, 84), (22, 38, 108)), 7.6),
    )
    areole_index = 0
    for name, nodes, radius in branches:
        for segment_index in range(len(nodes) - 1):
            capsule_between(collection, root, f"Cactus_Cholla_{name}_Segment_{segment_index}",
                            nodes[segment_index], nodes[segment_index + 1], radius,
                            mats["young"] if segment_index else mats["skin"])
            if segment_index:
                sphere(collection, root, f"Cactus_Cholla_{name}_Joint_{segment_index}",
                       radius * 0.74, nodes[segment_index], mats["scar"], scale=(1, 1, 0.72))
        for point in nodes[1:]:
            for theta in (0, math.pi / 2, math.pi, math.pi * 1.5):
                sphere(collection, root, f"Cactus_Cholla_BranchAreole_{areole_index}", 1.65,
                       (point[0] + math.cos(theta) * radius,
                        point[1] + math.sin(theta) * radius,
                        point[2]), mats["areole"], scale=(1, 0.65, 0.8))
                areole_index += 1
    # Dense pale areoles communicate the fuzzy spine coat without hair-thin geometry.
    for z_index, z in enumerate(range(15, 132, 13)):
        for angle_index, theta in enumerate((0, math.pi / 2, math.pi, math.pi * 1.5)):
            sphere(collection, root, f"Cactus_Cholla_TrunkAreole_{z_index}_{angle_index}", 1.7,
                   (math.cos(theta) * 10.8, math.sin(theta) * 10.8, z), mats["areole"],
                   scale=(1, 0.65, 0.8))
    sphere(collection, root, "Cactus_Cholla_CorkedBase", 10, (0, 0, 5), mats["scar"], scale=(1.15, 1, 0.35))
    return root


BUILDERS = {
    "saguaro2arm": saguaro_two_arm,
    "saguaro1arm": saguaro_one_arm,
    "barrel": barrel_cactus,
    "cholla": cholla_cactus,
}


def main():
    cactus_id, blend_path, preview_path, metadata_path = parse_args()
    if cactus_id not in BUILDERS:
        raise SystemExit(f"unknown cactus id: {cactus_id}")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    root = BUILDERS[cactus_id](cactus_id)
    spec = {
        "camera": {
            "elevation": 30,
            "azimuth": 0,
            "buildingRotationZ": 44.8,
            "resolution": 1024,
            "bottomY": 940,
            "topMargin": 48,
            "widthMargin": 0.78,
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
        "id": cactus_id,
        "styleVersion": "world122-obstacle-cactus-v2",
        "sharedRenderContract": "world122-building-v2 material and lighting subset",
        "camera": spec["camera"],
        "model": os.path.relpath(blend_path, os.getcwd()),
        "preview": os.path.relpath(preview_path, os.getcwd()),
        "runtimeTextureKey": "obstacle_cactus_" + cactus_id,
        "collision": "preserve existing obstacle footprint contract until final alpha measurement",
    }
    os.makedirs(os.path.dirname(metadata_path), exist_ok=True)
    with open(metadata_path, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print("cactus ->", cactus_id)
    print("model ->", blend_path)
    print("preview ->", preview_path)
    print("metadata ->", metadata_path)


if __name__ == "__main__":
    main()
