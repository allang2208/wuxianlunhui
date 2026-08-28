#!/usr/bin/env python3
"""Model and render the abandoned-mine 1x1 wall kit in Blender.

The kit owns three interchangeable wall-column variants and one independent
six-cell lift-gate leaf.  Every wall variant shares the same 2x2 world-space
base, camera, ground anchor and runtime display size, so all three occupy the
same 128x64 isometric footprint.  Irregularity is confined to relief rocks,
timber braces, ore seams and their deterministic local transforms; the common
core is never deformed.  The gate contains no jamb, side wall, lintel or floor.
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
DEFAULT_OUT = ROOT / "tools" / "ai-gen" / "_abandoned_mine_wall_kit_20260828"
WALL_SIZE = 1024
GATE_SIZE = 640
FRAMES = 16
FOOTPRINT = (128, 64)
DISPLAY = (260, 259)
HALF_THICK = 13
GATE_BASE_A = (32.0, 300.0)
GATE_BASE_B = (608.0, 588.0)
GATE_WORLD_A = (-3.0, 0.0, 0.0)
GATE_WORLD_B = (3.0, 0.0, 0.0)
# The moving leaf sits between the endpoint-wall centres instead of reaching
# through them.  The reserved six-cell collision span remains -3..+3.
GATE_LEAF_WORLD_A = -2.84
GATE_LEAF_WORLD_B = 2.84
GATE_LEAF_HEIGHT = 1.92
WALL_CORE_HEIGHT = 3.04


def args_after_double_dash() -> list[str]:
    return sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []


def rgba(hex_color: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = hex_color.lstrip("#")
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (alpha,)


def plain_material(name: str, color: str, roughness: float = 0.8, metallic: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = rgba(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = rgba(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def noisy_material(name: str, dark: str, light: str, scale: float, bump: float, roughness: float):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    out = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = 5.0
    noise.inputs["Roughness"].default_value = 0.72
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = rgba(dark)
    ramp.color_ramp.elements[1].color = rgba(light)
    bump_node = nodes.new("ShaderNodeBump")
    bump_node.inputs["Strength"].default_value = bump
    bump_node.inputs["Distance"].default_value = 0.16
    bsdf.inputs["Roughness"].default_value = roughness
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump_node.inputs["Height"])
    links.new(bump_node.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])
    return mat


def move_to_collection(obj, collection):
    for owner in list(obj.users_collection):
        owner.objects.unlink(obj)
    collection.objects.link(obj)


def cube(name: str, location, dimensions, mat, bevel: float = 0.04, collection=None, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_cube_add(location=location, rotation=rotation)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel > 0:
        modifier = obj.modifiers.new("Mined chipped edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
    obj.data.materials.append(mat)
    if collection is not None:
        move_to_collection(obj, collection)
    return obj


def beam_between(name: str, start, end, thickness: float, depth: float, mat, collection):
    a, b = Vector(start), Vector(end)
    direction = b - a
    midpoint = (a + b) / 2
    obj = cube(name, midpoint, (direction.length, depth, thickness), mat, 0.035, collection)
    obj.rotation_euler = direction.to_track_quat("X", "Z").to_euler()
    return obj


def crystal(name: str, location, radius: float, depth: float, mat, collection, rotation=0.0):
    bpy.ops.mesh.primitive_cone_add(
        vertices=5,
        radius1=radius,
        radius2=radius * 0.34,
        depth=depth,
        location=location,
        rotation=(math.radians(90), 0, rotation),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    move_to_collection(obj, collection)
    return obj


def rivet(name: str, location, radius: float, mat, collection):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=12, ring_count=6, radius=radius, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = (1.0, 0.56, 1.0)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.data.materials.append(mat)
    move_to_collection(obj, collection)
    return obj


def set_collection_visible(collection, visible: bool):
    collection.hide_render = not visible
    collection.hide_viewport = not visible


def look_at(obj, target):
    obj.rotation_euler = (Vector(target) - obj.location).to_track_quat("-Z", "Y").to_euler()


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
    scene.render.image_settings.compression = 48
    scene.render.resolution_percentage = 100
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.look = "AgX - Medium High Contrast"

    world = scene.world or bpy.data.worlds.new("Abandoned mine world")
    scene.world = world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = rgba("#0b0d10")
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.16

    bpy.ops.object.camera_add(location=(10.0, -10.0, 8.165))
    camera = bpy.context.object
    camera.name = "IsometricCamera_2to1"
    camera.data.type = "ORTHO"
    scene.camera = camera

    bpy.ops.object.light_add(type="AREA", location=(-4.8, -6.0, 9.2))
    key = bpy.context.object
    key.name = "ColdShaftKey"
    key.data.energy = 1120
    key.data.shape = "DISK"
    key.data.size = 5.4
    key.data.color = (0.54, 0.65, 0.76)
    look_at(key, (0, 0, 1.2))

    bpy.ops.object.light_add(type="AREA", location=(5.2, -1.0, 5.8))
    fill = bpy.context.object
    fill.name = "LanternBounce"
    fill.data.energy = 680
    fill.data.size = 4.2
    fill.data.color = (0.74, 0.48, 0.24)
    look_at(fill, (0, 0, 1.1))
    return camera


def build_relief(collection, variant: int, materials):
    rng = random.Random(122082800 + variant)
    rock_mats = materials["rocks"]
    # Front and right relief share fixed coverage bands.  Individual stones may
    # rotate and protrude, but the common core behind them guarantees closure.
    for face in ("front", "right"):
        for row in range(4):
            for col in range(3):
                width = 0.62 + rng.uniform(-0.10, 0.12)
                height = 0.67 + rng.uniform(-0.10, 0.14)
                z = 0.28 + row * 0.70 + height / 2 + rng.uniform(-0.035, 0.035)
                along = -0.72 + col * 0.72 + rng.uniform(-0.07, 0.07)
                protrude = 0.20 + rng.uniform(-0.02, 0.08)
                mat = rock_mats[(variant + row * 2 + col) % len(rock_mats)]
                if face == "front":
                    loc = (along, -1.06 - protrude / 2, z)
                    dims = (width, protrude, height)
                    rot = (rng.uniform(-0.035, 0.035), rng.uniform(-0.055, 0.055), rng.uniform(-0.08, 0.08))
                else:
                    loc = (1.06 + protrude / 2, along, z)
                    dims = (protrude, width, height)
                    rot = (rng.uniform(-0.055, 0.055), rng.uniform(-0.035, 0.035), rng.uniform(-0.08, 0.08))
                cube(f"V{variant}_{face}_rock_{row}_{col}", loc, dims, mat, 0.085, collection, rot)

    for index in range(7):
        x = rng.uniform(-0.82, 0.82)
        y = rng.uniform(-0.82, 0.82)
        z = 3.04 + rng.uniform(0.02, 0.12)
        cube(
            f"V{variant}_crown_rock_{index}",
            (x, y, z),
            (rng.uniform(0.44, 0.76), rng.uniform(0.44, 0.76), rng.uniform(0.22, 0.38)),
            rock_mats[(index + variant) % len(rock_mats)],
            0.10,
            collection,
            (rng.uniform(-0.16, 0.16), rng.uniform(-0.16, 0.16), rng.uniform(-0.30, 0.30)),
        )


def build_wall_variant(variant: int, materials):
    collection = bpy.data.collections.new(f"AbandonedMineWall_{chr(65 + variant)}")
    bpy.context.scene.collection.children.link(collection)
    rock_mats = materials["rocks"]
    timber = materials["timber"]
    timber_dark = materials["timber_dark"]
    iron = materials["iron"]
    ore = materials["ore"]

    # Immutable shared structure: exact 2x2 base and square core for every
    # variant.  This is the model-space source of the 128x64 footprint.
    cube(f"V{variant}_Core", (0, 0, WALL_CORE_HEIGHT / 2), (2.12, 2.12, WALL_CORE_HEIGHT), rock_mats[variant], 0.10, collection)
    cube(f"V{variant}_Foot", (0, 0, 0.10), (2.24, 2.24, 0.20), rock_mats[(variant + 1) % 3], 0.08, collection)
    build_relief(collection, variant, materials)

    if variant == 0:
        # Intact timber crib: regular silhouette with hand-hewn local rotation.
        cube("A_FrontPostL", (-0.78, -1.24, 1.55), (0.20, 0.24, 2.98), timber, 0.045, collection, (0.0, 0.018, -0.025))
        cube("A_FrontPostR", (0.78, -1.24, 1.55), (0.20, 0.24, 2.98), timber_dark, 0.045, collection, (0.0, -0.016, 0.020))
        cube("A_FrontCap", (0, -1.26, 2.91), (1.86, 0.25, 0.23), timber, 0.05, collection, (0.0, 0.0, 0.025))
        cube("A_RightPost", (1.24, 0.72, 1.53), (0.22, 0.22, 2.92), timber_dark, 0.045, collection, (0.015, 0.0, -0.018))
        cube("A_RightCap", (1.26, 0, 2.90), (0.24, 1.86, 0.22), timber, 0.05, collection, (-0.02, 0.0, 0.0))
        beam_between("A_DiagonalBrace", (-0.68, -1.40, 0.46), (0.62, -1.40, 2.38), 0.16, 0.17, timber_dark, collection)
    elif variant == 1:
        # Ore-cut face: one offset support and readable mineral seam.
        cube("B_FrontPost", (-0.72, -1.25, 1.53), (0.23, 0.24, 2.94), timber_dark, 0.05, collection, (0.0, 0.035, -0.042))
        cube("B_FrontCap", (0.08, -1.27, 2.90), (1.92, 0.25, 0.24), timber, 0.05, collection, (0.0, 0.0, -0.035))
        beam_between("B_LongBrace", (-0.62, -1.42, 0.54), (0.78, -1.42, 2.65), 0.17, 0.18, timber, collection)
        cube("B_IronClamp", (-0.71, -1.39, 1.24), (0.34, 0.08, 0.13), iron, 0.025, collection, (0, 0, -0.04))
        for index, loc in enumerate(((-0.18, -1.37, 0.86), (0.12, -1.39, 1.18), (0.38, -1.38, 1.51))):
            crystal(f"B_Ore_{index}", loc, 0.10 + index * 0.012, 0.34 + index * 0.04, ore, collection, 0.12 * index)
    else:
        # Repaired collapse: two skewed braces and iron straps create a third
        # silhouette while keeping the same lower stone core.
        cube("C_FrontPostL", (-0.76, -1.25, 1.51), (0.22, 0.24, 2.86), timber_dark, 0.05, collection, (0.0, 0.028, -0.052))
        cube("C_RightPost", (1.24, 0.66, 1.50), (0.22, 0.23, 2.82), timber, 0.05, collection, (0.022, 0.0, 0.035))
        beam_between("C_FrontBrace", (-0.68, -1.40, 0.44), (0.72, -1.40, 2.60), 0.18, 0.18, timber, collection)
        beam_between("C_RightBrace", (1.40, -0.70, 0.50), (1.40, 0.70, 2.48), 0.17, 0.18, timber_dark, collection)
        for z in (0.74, 2.10):
            cube(f"C_IronBand_{z}", (0.0, -1.39, z), (1.94, 0.07, 0.10), iron, 0.025, collection, (0, 0, 0.018 if z < 1 else -0.022))
        for index, x in enumerate((-0.56, 0.04, 0.58)):
            rivet(f"C_Rivet_{index}", (x, -1.445, 2.10), 0.055, iron, collection)
    return collection


def downward_spike(name: str, location, shoulder_radius: float, depth: float, mat, collection):
    bpy.ops.mesh.primitive_cone_add(
        vertices=4,
        radius1=0.012,
        radius2=shoulder_radius,
        depth=depth,
        location=location,
        rotation=(0, 0, math.radians(45)),
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    move_to_collection(obj, collection)
    return obj


def build_gate(materials):
    gate_collection = bpy.data.collections.new("AbandonedMineLiftGate")
    bpy.context.scene.collection.children.link(gate_collection)
    leaf = bpy.data.collections.new("AnimatedGateLeaf")
    gate_collection.children.link(leaf)
    timber = materials["timber_dark"]
    iron = materials["iron"]
    rust = materials["rust"]

    span = GATE_LEAF_WORLD_B - GATE_LEAF_WORLD_A
    slat_count = 9
    spacing = span / slat_count
    spike_h = 0.34
    for index in range(slat_count):
        x = GATE_LEAF_WORLD_A + spacing * (index + 0.5)
        cube(
            f"GateTimberSlat_{index:02d}",
            (x, 0.02, 1.02),
            (0.40 + (0.03 if index % 3 == 0 else 0), 0.18, 1.76 + (0.08 if index % 2 else -0.04)),
            timber,
            0.045,
            leaf,
            (0.0, 0.0, math.radians((index % 3 - 1) * 0.75)),
        )
        downward_spike(f"GateSpike_{index:02d}", (x, 0.02, spike_h / 2), 0.14, spike_h, iron, leaf)
        cube(f"GateFootCollar_{index:02d}", (x, 0.02, spike_h + 0.015), (0.47, 0.22, 0.12), rust, 0.025, leaf)

    for rail_index, z in enumerate((0.58, 1.08, 1.58)):
        cube(f"GateIronRail_{rail_index}", (0, 0.02, z), (span - 0.08, 0.12, 0.13), iron, 0.025, leaf)
        for index in range(slat_count):
            x = GATE_LEAF_WORLD_A + spacing * (index + 0.5)
            rivet(f"GateRivet_{rail_index}_{index}", (x, 0.0, z), 0.052, rust, leaf)

    beam_between("GateTimberDiagonal", (-2.54, 0.04, 0.48), (2.54, 0.04, 1.70), 0.18, 0.16, timber, leaf)
    for side in (-1, 1):
        cube(f"GateRailEnd_{side:+d}", (side * 2.77, 0.02, 1.08), (0.15, 0.18, 1.26), rust, 0.03, leaf)
    return gate_collection, leaf


def calibrate_gate_camera(camera):
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


def set_resolution(width: int, height: int):
    scene = bpy.context.scene
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100


def render(path: Path, width: int, height: int):
    set_resolution(width, height)
    scene = bpy.context.scene
    scene.render.filepath = str(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.render.render(write_still=True)


def visible_depth_range() -> tuple[float, float]:
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
    return min(depths) - span * 0.01, max(depths) + span * 0.01


def render_depth(path: Path, width: int, height: int):
    scene = bpy.context.scene
    set_resolution(width, height)
    near, far = visible_depth_range()
    bpy.context.view_layer.use_pass_z = True
    tree = bpy.data.node_groups.new("AbandonedMineDepthComp", "CompositorNodeTree")
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
        "rocks": [
            noisy_material("Mine rock charcoal", "#151719", "#363638", 4.0, 0.42, 0.94),
            noisy_material("Mine rock brown grey", "#1b1917", "#443b32", 5.2, 0.36, 0.93),
            noisy_material("Mine rock slate", "#171a1e", "#35404a", 6.0, 0.38, 0.92),
        ],
        "timber": noisy_material("Old pit timber", "#24170f", "#69452a", 5.8, 0.30, 0.88),
        "timber_dark": noisy_material("Tarred pit timber", "#17100c", "#4a2f1e", 7.0, 0.26, 0.90),
        "iron": plain_material("Black mine iron", "#17191b", 0.52, 0.74),
        "rust": noisy_material("Old mine rust", "#321a12", "#8b4a2c", 8.0, 0.22, 0.74),
        "ore": plain_material("Cold ore seam", "#31505c", 0.34, 0.58),
    }
    walls = [build_wall_variant(index, materials) for index in range(3)]
    gate, gate_leaf = build_gate(materials)

    blend_path = out_dir / "abandoned_mine_wall_kit.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))

    wall_geometries = []
    for index, collection in enumerate(walls):
        for item in walls:
            set_collection_visible(item, item is collection)
        set_collection_visible(gate, False)
        camera.data.ortho_scale = 5.25
        camera.location = (10.0, -10.0, 9.645)
        look_at(camera, (0, 0, 1.48))
        set_resolution(WALL_SIZE, WALL_SIZE)
        ground = projected((0, 0, 0), WALL_SIZE, WALL_SIZE)
        top = projected((0, 0, WALL_CORE_HEIGHT), WALL_SIZE, WALL_SIZE)
        suffix = chr(97 + index)
        render(out_dir / f"abandoned_mine_wall_block_{suffix}.png", WALL_SIZE, WALL_SIZE)
        render_depth(out_dir / f"abandoned_mine_wall_block_{suffix}_depth.png", WALL_SIZE, WALL_SIZE)
        wall_geometries.append({
            "key": f"abandoned_mine_block_{suffix}",
            "canvas": [WALL_SIZE, WALL_SIZE],
            "groundCenter": ground,
            "display": list(DISPLAY),
            "wallH": 132,
            "halfThick": HALF_THICK,
            "footprint": list(FOOTPRINT),
            "modelCore": [2.12, 2.12, WALL_CORE_HEIGHT],
            "variantSeed": 122082800 + index,
        })

    for item in walls:
        set_collection_visible(item, False)
    set_collection_visible(gate, True)
    camera.data.ortho_scale = 5.65
    camera.location = (10.0, -10.0, 9.745)
    look_at(camera, (0, 0, 1.58))
    set_resolution(GATE_SIZE, GATE_SIZE)
    calibrate_gate_camera(camera)
    raw_a = projected(GATE_WORLD_A, GATE_SIZE, GATE_SIZE)
    raw_b = projected(GATE_WORLD_B, GATE_SIZE, GATE_SIZE)
    base_a, base_b = sorted((raw_a, raw_b), key=lambda p: p[0])
    initial_locations = {obj.name: obj.location.copy() for obj in gate_leaf.objects}
    render_depth(out_dir / "abandoned_mine_gate_depth.png", 1024, 1024)
    for frame in range(FRAMES):
        t = frame / (FRAMES - 1)
        eased = t * t * (3.0 - 2.0 * t)
        lift = eased * 3.55
        for obj in gate_leaf.objects:
            obj.location = initial_locations[obj.name] + Vector((0, 0, lift))
        render(frames_dir / f"gate_{frame:02d}.png", GATE_SIZE, GATE_SIZE)

    gate_top = projected((0, 0, GATE_LEAF_HEIGHT), GATE_SIZE, GATE_SIZE)
    gate_ground = projected((0, 0, 0), GATE_SIZE, GATE_SIZE)
    geometry = {
        "version": 2,
        "projection": "worldBlock1x1-2to1",
        "footprint": list(FOOTPRINT),
        "walls": wall_geometries,
        "gate": {
            "key": "abandoned_mine_gate",
            "canvas": [GATE_SIZE, GATE_SIZE],
            "frames": FRAMES,
            "base": [base_a, base_b],
            "face": [base_a, base_b],
            "gateX": [round(base_a[0]), round(base_b[0])],
            "wallH": round(abs(gate_top[1] - gate_ground[1]), 4),
            "slope": round((base_b[1] - base_a[1]) / max(1e-6, base_b[0] - base_a[0]), 6),
            "halfThick": HALF_THICK,
            "depthSlices": 6,
            "movingCollection": "AnimatedGateLeaf",
            "containsStaticJambs": False,
            "stateContract": "frame 0 closed; frame 15 open",
        },
    }
    geometry_path = out_dir / "geometry.json"
    geometry_path.write_text(json.dumps(geometry, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"blend": str(blend_path), "geometry": geometry}, ensure_ascii=False))


if __name__ == "__main__":
    main()
