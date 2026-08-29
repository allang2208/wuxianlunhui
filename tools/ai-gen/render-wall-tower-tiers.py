#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render the approved wall-tower mesh with the five existing wall materials.

The tower geometry stays identical for every tier.  Rectilinear parts use one
continuous world-scale planar UV phase, while each arch ring is unwrapped by
arc length.  This prevents the generated wall material from stretching across
the crown or restarting at the four authored 1x1 body seams.
"""

import importlib.util
import json
import math
import os
import sys

import bpy


def load_wall_tower_builder():
    path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                        "blender-wall-tower.py")
    spec = importlib.util.spec_from_file_location("world122_wall_tower", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) not in (2, 3):
        raise SystemExit(
            "usage: blender --background --factory-startup --python "
            "render-wall-tower-tiers.py -- manifest.json output-directory [tier]")
    manifest_path, output_dir = (os.path.abspath(value) for value in argv[:2])
    return manifest_path, output_dir, (argv[2] if len(argv) == 3 else None)


def textured_material(name, image_path, *, value=1.0, saturation=1.0,
                      roughness=0.9, bump_strength=0.2):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()

    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Specular IOR Level"].default_value = 0.18
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = bpy.data.images.load(image_path, check_existing=True)
    texture.extension = "REPEAT"
    texture.interpolation = "Linear"
    uv = nodes.new("ShaderNodeTexCoord")
    adjust = nodes.new("ShaderNodeHueSaturation")
    adjust.inputs["Saturation"].default_value = saturation
    adjust.inputs["Value"].default_value = value
    gray = nodes.new("ShaderNodeRGBToBW")
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = 0.16

    links.new(uv.outputs["UV"], texture.inputs["Vector"])
    links.new(texture.outputs["Color"], adjust.inputs["Color"])
    links.new(adjust.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(texture.outputs["Color"], gray.inputs["Color"])
    links.new(gray.outputs["Val"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])

    return material


def _vertex_with_object_offset(obj, loop_index):
    mesh = obj.data
    vertex = mesh.vertices[mesh.loops[loop_index].vertex_index].co
    return vertex + obj.location


def planar_world_uv(obj, tile_size=96.0):
    """Axis-project faces at a shared world scale without per-object restarts."""
    mesh = obj.data
    uv_layer = mesh.uv_layers[0] if mesh.uv_layers else mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        normal = polygon.normal
        axis = max(range(3), key=lambda index: abs(normal[index]))
        for loop_index in polygon.loop_indices:
            co = _vertex_with_object_offset(obj, loop_index)
            if axis == 0:
                u, v = co.y / tile_size, co.z / tile_size
            elif axis == 1:
                u, v = co.x / tile_size, co.z / tile_size
            else:
                u, v = co.x / tile_size, co.y / tile_size
            uv_layer.data[loop_index].uv = (u, v)
    mesh.update()


def front_arch_uv(obj, spring_z, tile_size=96.0):
    """Round arch in X/Z: U follows true arc length; V follows ring/depth."""
    mesh = obj.data
    uv_layer = mesh.uv_layers[0] if mesh.uv_layers else mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        normal = polygon.normal
        facade = abs(normal.y) >= max(abs(normal.x), abs(normal.z))
        for loop_index in polygon.loop_indices:
            co = _vertex_with_object_offset(obj, loop_index)
            theta = math.atan2(max(0.0, co.z - spring_z), co.x)
            arc_u = theta * math.hypot(co.x, co.z - spring_z) / tile_size
            if facade:
                v = math.hypot(co.x, co.z - spring_z) / tile_size
            else:
                v = co.y / tile_size
            uv_layer.data[loop_index].uv = (arc_u, v)
    mesh.update()


def side_arch_uv(obj, spring_z, tile_size=96.0):
    """Round arch in Y/Z: U follows true arc length; V follows ring/depth."""
    mesh = obj.data
    uv_layer = mesh.uv_layers[0] if mesh.uv_layers else mesh.uv_layers.new(name="UVMap")
    for polygon in mesh.polygons:
        normal = polygon.normal
        facade = abs(normal.x) >= max(abs(normal.y), abs(normal.z))
        for loop_index in polygon.loop_indices:
            co = _vertex_with_object_offset(obj, loop_index)
            theta = math.atan2(max(0.0, co.z - spring_z), co.y)
            arc_u = theta * math.hypot(co.y, co.z - spring_z) / tile_size
            if facade:
                v = math.hypot(co.y, co.z - spring_z) / tile_size
            else:
                v = co.x / tile_size
            uv_layer.data[loop_index].uv = (arc_u, v)
    mesh.update()


def replace_material(obj, material):
    obj.data.materials.clear()
    obj.data.materials.append(material)


def line_material(name, base_color, emission_color=None, emission_strength=0.0):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    bsdf = material.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = base_color
    bsdf.inputs["Roughness"].default_value = 0.88
    if emission_color:
        bsdf.inputs["Emission Color"].default_value = emission_color
        bsdf.inputs["Emission Strength"].default_value = emission_strength
    return material


def curve_line(collection, root, name, points, radius, material, cyclic=False):
    data = bpy.data.curves.new(name + "_Curve", type="CURVE")
    data.dimensions = "3D"
    data.resolution_u = 1
    data.bevel_depth = radius
    data.bevel_resolution = 3
    data.use_fill_caps = True
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, coordinates in zip(spline.points, points):
        point.co = (*coordinates, 1.0)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    obj.parent = root
    obj.data.materials.append(material)
    return obj


def layered_rune(collection, root, name, backing_points, glow_points,
                 backing, glow, cyclic=False):
    curve_line(collection, root, name + "_Recess", backing_points, 2.25, backing, cyclic)
    curve_line(collection, root, name + "_Core", glow_points, 1.35, glow, cyclic)


def add_rune_ornaments(root, dims):
    """Sparse facade-authored runes: two crests and restrained corner channels."""
    collection = root.users_collection[0]
    tower_half = float(dims["cell"])
    backing = line_material(
        "MAT_WallTower_Rune_Recess", (0.012, 0.026, 0.032, 1.0))
    glow = line_material(
        "MAT_WallTower_Rune_Core", (0.015, 0.40, 0.54, 1.0),
        (0.01, 0.34, 0.50, 1.0), 0.55)

    front_back_y = -tower_half - 5.0
    front_glow_y = front_back_y - 1.45
    front_center_z = 236.0
    front_diamond_back = [
        (0, front_back_y, front_center_z + 24),
        (20, front_back_y, front_center_z),
        (0, front_back_y, front_center_z - 24),
        (-20, front_back_y, front_center_z),
    ]
    front_diamond_glow = [
        (0, front_glow_y, front_center_z + 24),
        (20, front_glow_y, front_center_z),
        (0, front_glow_y, front_center_z - 24),
        (-20, front_glow_y, front_center_z),
    ]
    layered_rune(collection, root, "WallTower_Rune_FrontCrest",
                 front_diamond_back, front_diamond_glow, backing, glow, cyclic=True)
    layered_rune(
        collection, root, "WallTower_Rune_FrontSigil",
        [(0, front_back_y, 251), (0, front_back_y, 239),
         (8, front_back_y, 231), (0, front_back_y, 222)],
        [(0, front_glow_y, 251), (0, front_glow_y, 239),
         (8, front_glow_y, 231), (0, front_glow_y, 222)],
        backing, glow)

    left_back_x = -tower_half - 5.0
    left_glow_x = left_back_x - 1.45
    left_center_z = 298.0
    left_diamond_back = [
        (left_back_x, 0, left_center_z + 16),
        (left_back_x, 14, left_center_z),
        (left_back_x, 0, left_center_z - 16),
        (left_back_x, -14, left_center_z),
    ]
    left_diamond_glow = [
        (left_glow_x, 0, left_center_z + 16),
        (left_glow_x, 14, left_center_z),
        (left_glow_x, 0, left_center_z - 16),
        (left_glow_x, -14, left_center_z),
    ]
    layered_rune(collection, root, "WallTower_Rune_UpperCrest",
                 left_diamond_back, left_diamond_glow, backing, glow, cyclic=True)

    for label, x, z0, z1 in (
            ("Left", -106.0, 72.0, 132.0),):
        back = [(x, front_back_y, z0), (x, front_back_y, z0 + 16),
                (x + (-7 if x < 0 else 7), front_back_y, z0 + 24),
                (x, front_back_y, z0 + 32), (x, front_back_y, z1)]
        lit = [(px, front_glow_y, pz) for px, _, pz in back]
        layered_rune(collection, root, f"WallTower_Rune_FrontChannel_{label}",
                     back, lit, backing, glow)

    side_back = [
        (left_back_x, -96, 122), (left_back_x, -96, 160),
        (left_back_x, -88, 170), (left_back_x, -96, 180),
        (left_back_x, -96, 214),
    ]
    side_lit = [(left_glow_x, py, pz) for _, py, pz in side_back]
    layered_rune(collection, root, "WallTower_Rune_LeftChannel",
                 side_back, side_lit, backing, glow)


def apply_tier(root, tier, image_path, dims):
    body = textured_material(
        f"MAT_WallTower_{tier}_Body", image_path,
        roughness=0.92, bump_strength=0.24)
    trim = textured_material(
        f"MAT_WallTower_{tier}_Trim", image_path,
        value=1.06 if tier != "black_brick" else 1.12,
        saturation=0.86, roughness=0.88, bump_strength=0.16)
    arch = textured_material(
        f"MAT_WallTower_{tier}_Arch", image_path,
        value=1.04, saturation=0.9, roughness=0.9,
        bump_strength=0.18)

    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        name = obj.name
        if "Ground" in name and name.endswith("Arch"):
            replace_material(obj, arch)
            front_arch_uv(obj, float(dims["doorSpringZ"]))
        elif "Upper" in name and name.endswith("Arch"):
            replace_material(obj, arch)
            side_arch_uv(obj, float(dims["upperPassageSpringZ"]))
        elif any(token in name for token in ("ArchJamb", "ArchKeystone", "Parapet", "Merlon")):
            replace_material(obj, trim)
            planar_world_uv(obj)
        else:
            replace_material(obj, body)
            planar_world_uv(obj)


def render_foreground_mask(root, output):
    """Render the two camera-near parapet edges on the unchanged tower canvas.

    The finalizer consumes only this render's alpha and copies RGB from the full
    beauty render.  Keeping the original materials here preserves the exact
    multisample silhouette while avoiding a second, differently lit beauty pass.
    """
    foreground_names = (
        "WallTower_Parapet_Front",
        "WallTower_Parapet_Left",
    )
    foreground_prefixes = (
        "WallTower_FrontMerlon_",
        "WallTower_LeftMerlon_",
    )
    states = []
    for obj in root.children_recursive:
        states.append((obj, obj.hide_render))
        obj.hide_render = not (
            obj.name in foreground_names
            or obj.name.startswith(foreground_prefixes)
        )
    try:
        bpy.context.scene.render.filepath = output
        bpy.ops.render.render(write_still=True)
    finally:
        for obj, hidden in states:
            obj.hide_render = hidden


def main():
    manifest_path, output_dir, selected_tier = parse_args()
    with open(manifest_path, "r", encoding="utf-8-sig") as handle:
        manifest = json.load(handle)
    spec = dict(manifest["buildings"]["wall_tower"])
    spec["camera"] = dict(manifest["camera"])
    spec["palette"] = dict(manifest["palette"])
    builder = load_wall_tower_builder()

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    root = builder.build_wall_tower(spec)
    os.makedirs(output_dir, exist_ok=True)
    first_path = os.path.join(output_dir, "wall_tower_sand_raw.png")
    builder.kit.setup_scene(spec, first_path)
    camera = builder.kit.setup_camera(spec, root)
    bpy.context.scene.camera = camera
    project_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))

    tier_specs = [tier for tier in spec["materialTiers"]
                  if not selected_tier or tier["id"] == selected_tier]
    if not tier_specs:
        raise SystemExit(f"unknown wall tower tier: {selected_tier}")
    for tier_spec in tier_specs:
        tier = tier_spec["id"]
        image_path = os.path.join(project_dir, tier_spec["source"])
        apply_tier(root, tier, image_path, spec["dimensions"])
        if tier == "rune":
            add_rune_ornaments(root, spec["dimensions"])
        output = os.path.join(output_dir, f"wall_tower_{tier}_raw.png")
        bpy.context.scene.render.filepath = output
        bpy.ops.render.render(write_still=True)
        foreground_mask = os.path.join(
            output_dir, f"wall_tower_{tier}_foreground_mask_raw.png")
        render_foreground_mask(root, foreground_mask)
        print(f"wall tower tier {tier} -> {output}")
        print(f"wall tower tier {tier} foreground mask -> {foreground_mask}")

    blend_path = os.path.join(output_dir, "wall_tower_textured_tiers.blend")
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    print("textured tier model ->", blend_path)


if __name__ == "__main__":
    main()
