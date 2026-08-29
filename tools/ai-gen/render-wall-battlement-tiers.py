#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render the adopted high/low battlement models for five wall tiers."""

import importlib.util
import os
import sys

import bpy


def load_module(filename, module_name):
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)), filename)
    spec = importlib.util.spec_from_file_location(module_name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


builder = load_module("blender-wall-battlement.py", "world122_wall_battlement")
tower_renderer = load_module("render-wall-tower-tiers.py", "world122_wall_tier_renderer")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) not in (2, 3):
        raise SystemExit(
            "usage: blender --background --factory-startup --python "
            "render-wall-battlement-tiers.py -- manifest.json output-directory [tier]")
    manifest_path, output_dir = (os.path.abspath(value) for value in argv[:2])
    return manifest_path, output_dir, (argv[2] if len(argv) == 3 else None)


def replace_material(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)


def mesh_objects(root):
    return [obj for obj in root.children_recursive if obj.type == "MESH"]


def apply_tier(root, tier, image_path):
    body = tower_renderer.textured_material(
        f"MAT_Battlement_{tier}_Body", image_path,
        value=1.0 if tier != "black_brick" else 1.08,
        saturation=0.92, roughness=0.92, bump_strength=0.22)
    trim = tower_renderer.textured_material(
        f"MAT_Battlement_{tier}_Trim", image_path,
        value=1.06 if tier != "black_brick" else 1.13,
        saturation=0.86, roughness=0.88, bump_strength=0.15)
    groove = tower_renderer.textured_material(
        f"MAT_Battlement_{tier}_Groove", image_path,
        value=0.52 if tier != "black_brick" else 0.62,
        saturation=0.65, roughness=0.96, bump_strength=0.08)
    for obj in mesh_objects(root):
        if "Rune" in obj.name:
            continue
        if "SeparationGroove" in obj.name:
            replace_material(obj, groove)
        elif any(token in obj.name for token in
                 ("BaseCourse", "WallDatumBand", "UpperPilaster",
                  "CrownBand", "CapCourse")):
            replace_material(obj, trim)
        else:
            replace_material(obj, body)
        tower_renderer.planar_world_uv(obj, tile_size=72.0)


def add_rune_channel(module, variant):
    collection = module.users_collection[0]
    height = float(module["totalHeight"])
    side = float(module["footprintSide"])
    backing = builder.kit.material(
        f"MAT_{module.name}_RuneRecess", (0.008, 0.018, 0.024, 1),
        roughness=0.92)
    glow = builder.kit.material(
        f"MAT_{module.name}_RuneCore", (0.015, 0.27, 0.34, 1),
        roughness=0.78, emission=((0.008, 0.24, 0.32, 1), 0.34))
    channel_h = 24 if variant == "high" else 18
    channel_z = height * 0.56
    front_y = -(side - 8) / 2 - 0.7
    builder.kit.box(collection, module, module.name + "_RuneFrontRecess",
                    (5.0, 1.8, channel_h + 5), (0, front_y, channel_z),
                    backing, bevel_width=0.5)
    builder.kit.box(collection, module, module.name + "_RuneFrontCore",
                    (1.6, 0.8, channel_h), (0, front_y - 1.0, channel_z),
                    glow, bevel_width=0.35)
    # One matching short channel on the left face; no scattered dots or noise.
    left_x = -(side - 8) / 2 - 0.7
    builder.kit.box(collection, module, module.name + "_RuneLeftRecess",
                    (1.8, 5.0, channel_h + 1), (left_x, 0, channel_z),
                    backing, bevel_width=0.5)
    builder.kit.box(collection, module, module.name + "_RuneLeftCore",
                    (0.8, 1.6, max(4, channel_h - 3)),
                    (left_x - 1.0, 0, channel_z), glow, bevel_width=0.35)


def add_runes_once(modules):
    for module in modules:
        if any("Rune" in child.name for child in module.children_recursive):
            continue
        add_rune_channel(module, str(module["battlementVariant"]))


def main():
    manifest_path, output_dir, selected_tier = parse_args()
    spec = builder.load_spec(manifest_path)
    os.makedirs(output_dir, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    isolated_root, isolated_modules = builder.build_layout(spec, "stacked", "ISOLATED")
    builder.kit.setup_scene(spec, os.path.join(output_dir, "wall_battlement_high_sand_raw.png"))
    isolated_camera = builder.kit.setup_camera(spec, isolated_modules[0])
    project_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    tiers = [tier for tier in spec["materialTiers"]
             if not selected_tier or tier["id"] == selected_tier]
    if not tiers:
        raise SystemExit(f"unknown wall battlement tier: {selected_tier}")

    for tier_spec in tiers:
        tier = tier_spec["id"]
        source = os.path.join(project_dir, tier_spec["source"])
        apply_tier(isolated_root, tier, source)
        if tier == "rune":
            add_runes_once(isolated_modules)

        bpy.context.scene.camera = isolated_camera
        for index, variant in enumerate(("high", "low")):
            for module_index, module in enumerate(isolated_modules):
                builder.set_module_hidden(module, module_index != index)
            bpy.context.scene.render.filepath = os.path.join(
                output_dir, f"wall_battlement_{variant}_{tier}_raw.png")
            bpy.ops.render.render(write_still=True)
        for module in isolated_modules:
            builder.set_module_hidden(module, True)
        print(f"wall battlement tier {tier} rendered")

    bpy.ops.wm.save_as_mainfile(
        filepath=os.path.join(output_dir, "wall_battlement_textured_tiers.blend"))


if __name__ == "__main__":
    main()
