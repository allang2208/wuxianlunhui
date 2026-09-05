#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render high/low battlement models and a high-low-high review for five wall tiers."""

import importlib.util
import os
import sys

import bpy
import mathutils


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


def set_root_hidden(root, hidden):
    for obj in root.children_recursive:
        obj.hide_render = bool(hidden)


def lock_camera_pixel_scale(camera, root, camera_cfg):
    """Preserve the accepted battlement width while allowing a taller render canvas."""
    pixels_per_world = float(camera_cfg.get("fixedPixelsPerWorld", 0))
    if pixels_per_world <= 0:
        return
    corners = []
    for obj in root.children_recursive:
        if obj.type == "MESH":
            corners.extend(obj.matrix_world @ mathutils.Vector(corner)
                           for corner in obj.bound_box)
    inverse = camera.matrix_world.inverted()
    points = [inverse @ corner for corner in corners]
    min_x, max_x = min(point.x for point in points), max(point.x for point in points)
    min_y = min(point.y for point in points)
    resolution = int(camera_cfg["resolution"])
    scale = resolution / pixels_per_world
    camera.data.ortho_scale = scale
    camera.data.shift_x = ((min_x + max_x) / 2) / scale
    bottom_y = float(camera_cfg.get("bottomY", resolution * 0.9)) / resolution
    target_bottom = (0.5 - bottom_y) * scale
    camera.data.shift_y = (min_y - target_bottom) / scale


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
        if "SeparationGroove" in obj.name:
            replace_material(obj, groove)
        elif any(token in obj.name for token in
                 ("BaseCourse", "WallDatumBand", "UpperPilaster",
                  "CrownBand", "CapCourse")):
            replace_material(obj, trim)
        else:
            replace_material(obj, body)
        tower_renderer.planar_world_uv(obj, tile_size=72.0)


def main():
    manifest_path, output_dir, selected_tier = parse_args()
    spec = builder.load_spec(manifest_path)
    os.makedirs(output_dir, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    isolated_root, isolated_modules = builder.build_layout(spec, "stacked", "ISOLATED")
    sequence_root, sequence_modules = builder.build_layout(spec, "sequence", "ASSEMBLY")
    fit_root, fit_modules = builder.build_layout(spec, "two_per_wall", "TWO_PER_WALL")
    builder.kit.setup_scene(spec, os.path.join(output_dir, "wall_battlement_high_sand_raw.png"))
    isolated_camera = builder.kit.setup_camera(spec, isolated_modules[0])
    lock_camera_pixel_scale(isolated_camera, isolated_modules[0], spec["camera"])
    sequence_camera = builder.kit.setup_camera(spec, sequence_root)
    fit_camera = builder.kit.setup_camera(spec, fit_root)
    project_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    tiers = [tier for tier in spec["materialTiers"]
             if not selected_tier or tier["id"] == selected_tier]
    if not tiers:
        raise SystemExit(f"unknown wall battlement tier: {selected_tier}")

    for tier_spec in tiers:
        tier = tier_spec["id"]
        source = os.path.join(project_dir, tier_spec["source"])
        apply_tier(isolated_root, tier, source)
        apply_tier(sequence_root, tier, source)
        apply_tier(fit_root, tier, source)
        set_root_hidden(sequence_root, True)
        set_root_hidden(fit_root, True)
        bpy.context.scene.camera = isolated_camera
        for index, variant in enumerate(("high", "low")):
            for module_index, module in enumerate(isolated_modules):
                builder.set_module_hidden(module, module_index != index)
            bpy.context.scene.render.filepath = os.path.join(
                output_dir, f"wall_battlement_{variant}_{tier}_raw.png")
            bpy.ops.render.render(write_still=True)
        for module in isolated_modules:
            builder.set_module_hidden(module, True)

        set_root_hidden(sequence_root, False)
        bpy.context.scene.camera = sequence_camera
        bpy.context.scene.render.filepath = os.path.join(
            output_dir, f"wall_battlement_{tier}_assembly_raw.png")
        bpy.ops.render.render(write_still=True)
        set_root_hidden(sequence_root, True)

        set_root_hidden(fit_root, False)
        bpy.context.scene.camera = fit_camera
        bpy.context.scene.render.filepath = os.path.join(
            output_dir, f"wall_battlement_{tier}_two_per_wall_raw.png")
        bpy.ops.render.render(write_still=True)
        print(f"wall battlement tier {tier} rendered")

    bpy.ops.wm.save_as_mainfile(
        filepath=os.path.join(output_dir, "wall_battlement_textured_tiers.blend"))


if __name__ == "__main__":
    main()
