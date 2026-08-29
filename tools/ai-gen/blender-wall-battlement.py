#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Editable high/low 1/4-cell square outer-edge battlement models."""

import importlib.util
import json
import math
import os
import shutil
import sys

import bpy


def load_kit():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "building-component-kit.py")
    spec = importlib.util.spec_from_file_location(
        "world122_building_components", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kit = load_kit()


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 4:
        raise SystemExit(
            "usage: blender --background --factory-startup --python "
            "blender-wall-battlement.py -- manifest.json out.blend preview.png depth.png")
    return tuple(os.path.abspath(value) for value in argv)


def load_spec(manifest_path):
    with open(manifest_path, "r", encoding="utf-8-sig") as handle:
        manifest = json.load(handle)
    spec = dict(manifest["wallBattlement"])
    spec["camera"] = dict(manifest["camera"])
    spec["palette"] = dict(manifest["palette"])
    return spec


def placeholder_materials(spec):
    palette = spec["palette"]
    return {
        "body": kit.material(
            "MAT_Battlement_Stone", kit.rgba(palette["stone"]),
            roughness=0.92,
            noise={"scale": 6.0, "detail": 4, "bump": 0.2}),
        "trim": kit.material(
            "MAT_Battlement_DressedStone", kit.rgba(palette["stoneBand"]),
            roughness=0.88,
            noise={"scale": 7.0, "detail": 3, "bump": 0.14}),
        "groove": kit.material(
            "MAT_Battlement_SeparationGroove", (0.055, 0.05, 0.045, 1.0),
            roughness=0.96),
    }


def add_module(collection, parent, name, variant, dims, mats, location=(0, 0, 0)):
    height = float(dims[f"{variant}Height"])
    side = float(dims["segmentSide"])
    wall_height = float(dims["wallHeight"])
    base_h = min(float(dims["baseCourseHeight"]), height / 3)
    cap_h = min(float(dims["capCourseHeight"]), height / 3)
    body_h = max(2.0, height - base_h - cap_h)
    inset = float(dims["bodyInset"])
    cap_outward = float(dims["capOutwardOverhang"])
    crown_band_h = float(dims["crownBandHeight"])
    crown_band_outward = float(dims["crownBandOutwardOverhang"])
    datum_band_h = float(dims["wallDatumBandHeight"])
    datum_band_outward = float(dims["wallDatumBandOutwardOverhang"])
    groove_h = float(dims["separationGrooveHeight"])
    groove_outward = float(dims["separationGrooveOutwardOverhang"])
    pilaster_w = float(dims["upperPilasterWidth"])
    pilaster_projection = float(dims["upperPilasterProjection"])

    root = bpy.data.objects.new(name, None)
    collection.objects.link(root)
    root.parent = parent
    root.location = location
    root["battlementVariant"] = variant
    root["footprintSide"] = side
    root["logicalFootprintAreaCells"] = (side * side) / float(dims["cell"] ** 2)
    root["totalHeight"] = height
    root["heightAboveWall"] = height - wall_height
    root["standardWallHeight"] = wall_height

    kit.box(collection, root, name + "_BaseCourse",
            (side, side, base_h), (0, 0, base_h / 2), mats["trim"],
            bevel_width=1.6)
    kit.box(collection, root, name + "_Body",
            (side - inset * 2, side - inset * 2, body_h),
            (0, 0, base_h + body_h / 2), mats["body"],
            bevel_width=1.8)
    kit.box(collection, root, name + "_SeparationGroove",
            (side, side + groove_outward * 2, groove_h),
            (0, 0, wall_height - groove_h / 2), mats["groove"],
            bevel_width=0.35)
    kit.box(collection, root, name + "_WallDatumBand",
            (side, side + datum_band_outward * 2, datum_band_h),
            (0, 0, wall_height + datum_band_h / 2), mats["trim"],
            bevel_width=0.9)
    upper_start = wall_height + datum_band_h
    upper_end = height - cap_h - crown_band_h
    pilaster_h = max(4.0, upper_end - upper_start)
    front_y = -side / 2 - pilaster_projection / 2
    for suffix, x in (("Left", -side / 2 + pilaster_w / 2),
                      ("Right", side / 2 - pilaster_w / 2)):
        kit.box(collection, root, name + f"_UpperPilaster{suffix}",
                (pilaster_w, pilaster_projection, pilaster_h),
                (x, front_y, upper_start + pilaster_h / 2), mats["trim"],
                bevel_width=0.65)
    kit.box(collection, root, name + "_CrownBand",
            (side, side + crown_band_outward * 2, crown_band_h),
            (0, 0, height - cap_h - crown_band_h / 2), mats["trim"],
            bevel_width=0.9)
    kit.box(collection, root, name + "_CapCourse",
            (side, side + cap_outward * 2, cap_h),
            (0, 0, height - cap_h / 2), mats["trim"],
            bevel_width=1.8)
    return root


def build_layout(spec, layout="pair", label="MODEL"):
    dims = spec["dimensions"]
    mats = placeholder_materials(spec)
    collection = bpy.data.collections.new(f"WALL_BATTLEMENT_{label}_EDITABLE")
    bpy.context.scene.collection.children.link(collection)
    scene_root = bpy.data.objects.new(f"WALL_BATTLEMENT_{label}_ROT_Z_44_8", None)
    collection.objects.link(scene_root)
    scene_root.rotation_euler.z = math.radians(
        float(spec["camera"]["buildingRotationZ"]))

    side = float(dims["segmentSide"])
    cell = float(dims["cell"])
    modules = []
    if layout == "pair":
        spacing = side * 1.15
        modules.append(add_module(collection, scene_root, "Battlement_High", "high",
                                  dims, mats, (-spacing, 0, 0)))
        modules.append(add_module(collection, scene_root, "Battlement_Low", "low",
                                  dims, mats, (spacing, 0, 0)))
    elif layout == "stacked":
        modules.append(add_module(collection, scene_root, "Battlement_High", "high",
                                  dims, mats))
        modules.append(add_module(collection, scene_root, "Battlement_Low", "low",
                                  dims, mats))
    elif layout == "sequence":
        # Review-only context: continuous walkable wall behind three square
        # battlements attached flush to its outside edge.
        wall_depth = cell
        wall_length = side * 4
        wall_height = float(dims["wallHeight"])
        outer_y = -(wall_depth + side) / 2
        kit.box(collection, scene_root, "ReviewOnly_StandardWall",
                (wall_length, wall_depth, wall_height),
                (0, 0, wall_height / 2), mats["body"], bevel_width=2.0)
        modules.append(add_module(collection, scene_root, "Sequence_HighLeft", "high",
                                  dims, mats, (-side, outer_y, 0)))
        modules.append(add_module(collection, scene_root, "Sequence_Low", "low",
                                  dims, mats, (0, outer_y, 0)))
        modules.append(add_module(collection, scene_root, "Sequence_HighRight", "high",
                                  dims, mats, (side, outer_y, 0)))
    elif layout == "two_per_wall":
        wall_depth = cell
        wall_height = float(dims["wallHeight"])
        outer_y = -(wall_depth + side) / 2
        kit.box(collection, scene_root, "ReviewOnly_OneStandardWall",
                (cell, wall_depth, wall_height),
                (0, 0, wall_height / 2), mats["body"], bevel_width=2.0)
        modules.append(add_module(collection, scene_root, "Fit_High", "high",
                                  dims, mats, (-side / 2, outer_y, 0)))
        modules.append(add_module(collection, scene_root, "Fit_Low", "low",
                                  dims, mats, (side / 2, outer_y, 0)))
    else:
        raise ValueError(f"unknown battlement layout: {layout}")
    return scene_root, modules


def set_module_hidden(module, hidden):
    for obj in module.children_recursive:
        obj.hide_render = bool(hidden)


def publish_approval_preview(preview_path):
    stem, extension = os.path.splitext(preview_path)
    approval = stem + "_approval" + extension
    shutil.copy2(preview_path, approval)
    print("codex markdown -> ![wall battlement model approval preview]"
          f"(<{approval.replace(chr(92), '/')}>)")
    return approval


def main():
    manifest_path, blend_path, preview_path, depth_path = parse_args()
    spec = load_spec(manifest_path)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    root, _ = build_layout(spec, "pair")
    os.makedirs(os.path.dirname(blend_path), exist_ok=True)
    kit.setup_scene(spec, preview_path)
    camera = kit.setup_camera(spec, root)
    bpy.context.scene.camera = camera
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.render.render(write_still=True)
    approval = publish_approval_preview(preview_path)
    kit.render_depth(bpy.context.scene, root, camera, depth_path, "WallBattlement")
    print("model ->", blend_path)
    print("preview ->", preview_path)
    print("approval ->", approval)
    print("depth ->", depth_path)


if __name__ == "__main__":
    main()
