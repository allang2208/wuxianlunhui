#!/usr/bin/env python3
"""Model and render the World-122 zombie dungeon wall kit in Blender.

Outputs an editable .blend, one transparent 1024px wall module, sixteen
transparent 640px portcullis frames, and projection geometry consumed by the
runtime registration step.  The six-cell gate contains only the moving iron
leaf: the regular wall modules at both opening endpoints are the authored
matching jambs, exactly like the frozen-dungeon gate.  Geometry is built first;
no raster source is used to fake the wall silhouette or gate motion.
"""

from __future__ import annotations

import json
import math
import random
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_OUT = ROOT / "tools" / "ai-gen" / "_zombie_dungeon_walls_20260826"
WALL_SIZE = 1024
GATE_SIZE = 640
FRAMES = 16
GATE_BASE_A = (32.0, 300.0)
GATE_BASE_B = (608.0, 588.0)
GATE_WORLD_A = (-3.0, 0.0, 0.0)
GATE_WORLD_B = (3.0, 0.0, 0.0)
GATE_BAR_HEIGHT = 1.92


def args_after_double_dash() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = hex_color.lstrip("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (alpha,)


def material(name: str, color: str, roughness: float = 0.8, metallic: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def cube(name: str, location, dimensions, mat, bevel: float = 0.04, collection=None):
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        mod = obj.modifiers.new("Soft chipped edges", "BEVEL")
        mod.width = bevel
        mod.segments = 2
    obj.data.materials.append(mat)
    if collection is not None:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        collection.objects.link(obj)
    return obj


def downward_spike(name: str, location, shoulder_radius: float, depth: float, mat, collection=None):
    """Four-sided forged spearhead: broad shoulder on top, point on the floor."""
    bpy.ops.mesh.primitive_cone_add(
        vertices=4,
        radius1=0.012,
        radius2=shoulder_radius,
        depth=depth,
        location=location,
    )
    obj = bpy.context.object
    obj.name = name
    obj.rotation_euler[2] = math.radians(45)
    obj.data.materials.append(mat)
    if collection is not None:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        collection.objects.link(obj)
    return obj


def rivet(name: str, location, radius: float, mat, collection=None):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (1.0, 0.58, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    if collection is not None:
        for owner in list(obj.users_collection):
            owner.objects.unlink(obj)
        collection.objects.link(obj)
    return obj


def set_collection_visible(collection, visible: bool):
    collection.hide_render = not visible
    collection.hide_viewport = not visible


def look_at(camera, target):
    camera.rotation_euler = (Vector(target) - camera.location).to_track_quat("-Z", "Y").to_euler()


def projected(point, width: int, height: int) -> list[float]:
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    ndc = world_to_camera_view(scene, scene.camera, Vector(point))
    return [round(ndc.x * width, 4), round((1.0 - ndc.y) * height, 4)]


def setup_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.name != "Collection":
            bpy.data.collections.remove(collection)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 55
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = scene.world or bpy.data.worlds.new("Zombie dungeon world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = rgba("#10131a")
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.18

    bpy.ops.object.camera_add(location=(10.0, -10.0, 8.165))
    camera = bpy.context.object
    camera.name = "IsometricCamera30deg"
    camera.data.type = "ORTHO"
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(-4.5, -5.5, 9.0))
    key = bpy.context.object
    key.name = "ColdMoonKey"
    key.data.energy = 1050
    key.data.shape = "DISK"
    key.data.size = 5.0
    key.data.color = (0.58, 0.70, 0.84)
    look_at(key, (0, 0, 1.4))

    bpy.ops.object.light_add(type="AREA", location=(5.0, 1.0, 5.0))
    fill = bpy.context.object
    fill.name = "SicklyWarmFill"
    fill.data.energy = 720
    fill.data.size = 4.0
    fill.data.color = (0.56, 0.42, 0.27)
    look_at(fill, (0, 0, 1.2))
    return camera


def build_wall(materials):
    collection = bpy.data.collections.new("ZombieWallModule")
    bpy.context.scene.collection.children.link(collection)
    mortar, stones, iron = materials["mortar"], materials["stones"], materials["iron"]
    cube("WallCore", (0, 0, 1.52), (2.0, 2.0, 3.04), mortar, 0.03, collection)
    cube("WallFoot", (0, 0, 0.10), (2.18, 2.18, 0.20), stones[0], 0.05, collection)

    rng = random.Random(1220260826)
    rows = 7
    row_h = 2.72 / rows
    for row in range(rows):
        z = 0.30 + row * row_h + row_h / 2
        count = 3 if row % 2 == 0 else 4
        cell = 1.92 / count
        for index in range(count):
            x = -0.96 + cell * (index + 0.5)
            width = cell - 0.045
            stone = stones[(row * 3 + index) % len(stones)]
            obj = cube(
                f"FrontBrick_{row:02d}_{index:02d}",
                (x, -1.035, z + rng.uniform(-0.018, 0.018)),
                (width, 0.16 + rng.uniform(-0.018, 0.025), row_h - 0.055),
                stone, 0.045, collection,
            )
            obj.rotation_euler[1] = rng.uniform(-0.012, 0.012)

        count_side = 4 if row % 2 == 0 else 3
        cell_side = 1.92 / count_side
        for index in range(count_side):
            y = -0.96 + cell_side * (index + 0.5)
            stone = stones[(row * 5 + index + 1) % len(stones)]
            obj = cube(
                f"RightBrick_{row:02d}_{index:02d}",
                (1.035, y, z + rng.uniform(-0.018, 0.018)),
                (0.16 + rng.uniform(-0.018, 0.025), cell_side - 0.045, row_h - 0.055),
                stone, 0.045, collection,
            )
            obj.rotation_euler[0] = rng.uniform(-0.012, 0.012)

    # The top is modeled as a compact 4x4 slab course so adjacent modules read as
    # one black-square-brick rampart when repeated around a diamond.
    top_cell = 0.49
    for ix in range(4):
        for iy in range(4):
            cube(
                f"TopSlab_{ix}_{iy}",
                (-0.735 + ix * top_cell, -0.735 + iy * top_cell, 3.075),
                (0.455, 0.455, 0.15),
                stones[(ix + iy * 2) % len(stones)], 0.045, collection,
            )

    # Sparse iron braces make the zombie wall distinct without breaking the
    # square masonry silhouette used for shared corners.
    cube("IronCornerBrace", (1.115, -1.115, 1.50), (0.11, 0.11, 2.62), iron, 0.025, collection)
    for z in (0.58, 2.42):
        cube(f"IronBandFront_{z}", (0, -1.135, z), (2.04, 0.07, 0.09), iron, 0.018, collection)
        cube(f"IronBandRight_{z}", (1.135, 0, z), (0.07, 2.04, 0.09), iron, 0.018, collection)
    return collection


def build_gate(materials):
    collection = bpy.data.collections.new("ZombiePortcullis")
    bpy.context.scene.collection.children.link(collection)
    bars_collection = bpy.data.collections.new("AnimatedBars")
    collection.children.link(bars_collection)
    iron, rust = materials["iron"], materials["rust"]

    # The opening is exactly six grid steps from endpoint-wall centre to centre.
    # Keep all iron inside that span: the two endpoint zombie wall blocks are the
    # visible masonry posts, so no unrelated lintel/jamb model may overlap them.
    bar_count = 13
    gate_span = GATE_WORLD_B[0] - GATE_WORLD_A[0]
    bar_spacing = gate_span / bar_count
    spike_height = 0.48
    spike_shoulder_z = spike_height
    bar_bottom = 0.40
    for index in range(bar_count):
        x = GATE_WORLD_A[0] + bar_spacing * (index + 0.5)
        cube(
            f"PortcullisBar_{index:02d}",
            (x, -0.48, (bar_bottom + GATE_BAR_HEIGHT) / 2),
            (0.11, 0.13, GATE_BAR_HEIGHT - bar_bottom),
            iron, 0.018, bars_collection,
        )
        downward_spike(
            f"PortcullisSpike_{index:02d}",
            (x, -0.48, spike_height / 2),
            0.145, spike_height, iron, bars_collection,
        )
        cube(
            f"PortcullisSpikeCollar_{index:02d}",
            (x, -0.49, spike_shoulder_z - 0.025),
            (0.18, 0.17, 0.12),
            rust, 0.018, bars_collection,
        )
    rail_heights = (0.58, 1.10, 1.62)
    for rail_index, z in enumerate(rail_heights):
        cube(
            f"PortcullisRail_{rail_index:02d}",
            (0, -0.50, z),
            (gate_span - 0.08, 0.14, 0.13),
            rust, 0.02, bars_collection,
        )
        for side in (-1, 1):
            cube(
                f"PortcullisRailEnd_{rail_index:02d}_{side:+d}",
                (side * (gate_span / 2 - 0.07), -0.50, z),
                (0.14, 0.18, 0.19),
                iron, 0.025, bars_collection,
            )
        for index in range(bar_count):
            x = GATE_WORLD_A[0] + bar_spacing * (index + 0.5)
            rivet(
                f"PortcullisRivet_{rail_index:02d}_{index:02d}",
                (x, -0.592, z),
                0.052,
                iron if (index + rail_index) % 3 else rust,
                bars_collection,
            )
    return collection, bars_collection


def calibrate_gate_camera(camera):
    """Match the frozen gate's exact 640px six-cell baseline without rotating."""
    scene = bpy.context.scene
    bpy.context.view_layer.update()
    current_a = projected(GATE_WORLD_A, GATE_SIZE, GATE_SIZE)
    current_b = projected(GATE_WORLD_B, GATE_SIZE, GATE_SIZE)
    current_dx = abs(current_b[0] - current_a[0])
    target_dx = GATE_BASE_B[0] - GATE_BASE_A[0]
    camera.data.ortho_scale *= current_dx / target_dx
    bpy.context.view_layer.update()

    current_a = projected(GATE_WORLD_A, GATE_SIZE, GATE_SIZE)
    current_b = projected(GATE_WORLD_B, GATE_SIZE, GATE_SIZE)
    current_mid_y = (current_a[1] + current_b[1]) / 2
    target_mid_y = (GATE_BASE_A[1] + GATE_BASE_B[1]) / 2
    pixels_per_world = GATE_SIZE / camera.data.ortho_scale
    camera_local_y = camera.matrix_world.to_quaternion() @ Vector((0, 1, 0))
    camera.location += camera_local_y * ((target_mid_y - current_mid_y) / pixels_per_world)
    bpy.context.view_layer.update()


def render(path: Path, width: int, height: int):
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.filepath = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def set_resolution(width: int, height: int):
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100


def visible_depth_range() -> tuple[float, float]:
    """Return a tight camera-space depth range for render-visible meshes."""
    camera_inverse = bpy.context.scene.camera.matrix_world.inverted()
    depths: list[float] = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH" or obj.hide_render:
            continue
        for corner in obj.bound_box:
            camera_point = camera_inverse @ (obj.matrix_world @ Vector(corner))
            depth = -camera_point.z
            if depth > 0:
                depths.append(depth)
    if not depths:
        raise RuntimeError("No render-visible mesh bounds found for depth output")
    span = max(max(depths) - min(depths), 0.001)
    padding = span * 0.01
    return min(depths) - padding, max(depths) + padding


def render_depth(path: Path, width: int, height: int):
    """Render camera-space depth as white-near/black-far Klein control."""
    scene = bpy.context.scene
    set_resolution(width, height)
    near, far = visible_depth_range()
    bpy.context.view_layer.use_pass_z = True
    tree = bpy.data.node_groups.new("ZombieWallDepthComp", "CompositorNodeTree")
    scene.compositing_node_group = tree
    layers = tree.nodes.new("CompositorNodeRLayers")
    mapping = tree.nodes.new("ShaderNodeMapRange")
    mapping.inputs["From Min"].default_value = near
    mapping.inputs["From Max"].default_value = far
    mapping.inputs["To Min"].default_value = 1.0
    mapping.inputs["To Max"].default_value = 0.0
    mapping.clamp = True
    multiply = tree.nodes.new("ShaderNodeMath")
    multiply.operation = "MULTIPLY"
    output = tree.nodes.new("NodeGroupOutput")
    tree.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    tree.links.new(layers.outputs["Depth"], mapping.inputs["Value"])
    tree.links.new(mapping.outputs["Result"], multiply.inputs[0])
    tree.links.new(layers.outputs["Alpha"], multiply.inputs[1])
    tree.links.new(multiply.outputs[0], output.inputs["Image"])
    scene.render.filepath = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)
    scene.compositing_node_group = None
    bpy.data.node_groups.remove(tree)


def main():
    argv = args_after_double_dash()
    out_dir = Path(argv[0]).resolve() if argv else DEFAULT_OUT
    frames_dir = out_dir / "gate_frames"
    out_dir.mkdir(parents=True, exist_ok=True)
    frames_dir.mkdir(parents=True, exist_ok=True)

    camera = setup_scene()
    materials = {
        "mortar": material("Mortar black", "#090b0f", 0.96),
        "stones": [
            material("Basalt charcoal", "#171a20", 0.93),
            material("Basalt blue black", "#202630", 0.90),
            material("Basalt ash", "#2c3037", 0.92),
            material("Basalt bruise", "#242129", 0.94),
        ],
        "iron": material("Old iron", "#15171b", 0.56, 0.72),
        "rust": material("Rust edge", "#4b2c21", 0.70, 0.48),
    }
    wall_collection = build_wall(materials)
    gate_collection, bars_collection = build_gate(materials)

    # Save the completed model before any render-specific visibility changes.
    blend_path = out_dir / "zombie_dungeon_wall_kit.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    # Wall module render.
    set_collection_visible(wall_collection, True)
    set_collection_visible(gate_collection, False)
    camera.data.ortho_scale = 5.25
    camera.location = (10.0, -10.0, 9.645)
    look_at(camera, (0, 0, 1.48))
    set_resolution(WALL_SIZE, WALL_SIZE)
    wall_ground = projected((0, 0, 0), WALL_SIZE, WALL_SIZE)
    render(out_dir / "zombie_wall_block.png", WALL_SIZE, WALL_SIZE)
    render_depth(out_dir / "zombie_wall_block_depth.png", WALL_SIZE, WALL_SIZE)

    # Gate frames. Frame 0 is closed, frame 15 open, matching WallGate.
    set_collection_visible(wall_collection, False)
    set_collection_visible(gate_collection, True)
    camera.data.ortho_scale = 5.65
    camera.location = (10.0, -10.0, 9.745)
    look_at(camera, (0, 0, 1.58))
    set_resolution(GATE_SIZE, GATE_SIZE)
    calibrate_gate_camera(camera)
    base_a = projected(GATE_WORLD_A, GATE_SIZE, GATE_SIZE)
    base_b = projected(GATE_WORLD_B, GATE_SIZE, GATE_SIZE)
    if base_a[1] > base_b[1]:
        base_a, base_b = base_b, base_a
    initial_locations = {obj.name: obj.location.copy() for obj in bars_collection.objects}
    # Klein uses a full 1024 control image even though the runtime sheet cells are 640px.
    render_depth(out_dir / "zombie_gate_depth.png", 1024, 1024)
    for obj in bars_collection.objects:
        obj.hide_render = True
    render(out_dir / "zombie_gate_frame_mask_source.png", 1024, 1024)
    for obj in bars_collection.objects:
        obj.hide_render = False
    gate_frame_objects = list(gate_collection.objects)
    for obj in gate_frame_objects:
        obj.hide_render = True
    render(out_dir / "zombie_gate_bars_mask_source.png", 1024, 1024)
    for obj in gate_frame_objects:
        obj.hide_render = False
    for frame in range(FRAMES):
        t = frame / (FRAMES - 1)
        eased = t * t * (3.0 - 2.0 * t)
        lift = eased * 3.55
        for obj in bars_collection.objects:
            obj.location = initial_locations[obj.name] + Vector((0, 0, lift))
        render(frames_dir / f"gate_{frame:02d}.png", GATE_SIZE, GATE_SIZE)

    geometry = {
        "wall": {
            "canvas": [WALL_SIZE, WALL_SIZE],
            "groundCenter": wall_ground,
            "display": [260, 259],
            "wallH": 132,
            "halfThick": 13,
        },
        "gate": {
            "canvas": [GATE_SIZE, GATE_SIZE],
            "frames": FRAMES,
            "base": [base_a, base_b],
            "gateX": [round(base_a[0]), round(base_b[0])],
            "wallH": round(abs(projected((0, 0, GATE_BAR_HEIGHT), GATE_SIZE, GATE_SIZE)[1] - projected((0, 0, 0), GATE_SIZE, GATE_SIZE)[1]), 4),
            "slope": round((base_b[1] - base_a[1]) / max(1e-6, base_b[0] - base_a[0]), 6),
            "halfThick": 13,
            "depthSlices": 3,
        },
    }
    (out_dir / "geometry.json").write_text(json.dumps(geometry, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"blend": str(blend_path), "geometry": geometry}, ensure_ascii=False))


if __name__ == "__main__":
    main()
