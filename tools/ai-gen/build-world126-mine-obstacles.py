"""Build five editable obstacle blockouts for the World-126 mine plane.

This is deliberately a model-first stage.  It creates one Blender master file,
five same-camera approval previews and five Body Depth images.  No generated
bitmap is promoted to runtime assets here.

Camera/ground contract shared with the accepted abandoned-mine prop kit:
orthographic 30-degree elevation, 44.8-degree model-root rotation, fixed 6.4
ortho scale and a 0.875 ground-contact line.
"""

from __future__ import annotations

from array import array
import importlib.util
import json
import math
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


REPO = Path(__file__).resolve().parents[2]
HELPERS = REPO / "tools" / "ai-gen" / "build-world122-street-decor.py"
OUT = REPO / "tools" / "ai-gen" / "_world126_mine_obstacles_20260829"
PREVIEW_OUT = OUT / "approval-previews"
DEPTH_OUT = OUT / "body-depth"
INIT_OUT = OUT / "blockout-init"
BLEND_OUT = OUT / "world126_mine_obstacles.blend"

ROOT_ROTATION_DEG = 44.8
CAMERA_ELEVATION_DEG = 30.0
ORTHO_SCALE = 6.4
BOTTOM_RATIO = 0.875


def load_helpers():
    spec = importlib.util.spec_from_file_location("world122_street_helpers", HELPERS)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


S = load_helpers()
GUIDE_COLLECTIONS: dict[str, bpy.types.Collection] = {}
GUIDE_ROOTS: dict[str, bpy.types.Object] = {}


OBSTACLES = [
    {
        "key": "mine_obstacle_collapsed_support",
        "name": "坍塌木支护",
        "footprint": [2.70, 1.55],
        "obstacleHeightPx": 330,
        "builder": "build_collapsed_support",
    },
    {
        "key": "mine_obstacle_derailed_cart",
        "name": "脱轨满载矿车",
        "footprint": [3.15, 1.55],
        "obstacleHeightPx": 245,
        "builder": "build_derailed_cart",
    },
    {
        "key": "mine_obstacle_stone_pillar",
        "name": "天然岩柱簇",
        "footprint": [1.90, 1.65],
        "obstacleHeightPx": 360,
        "builder": "build_stone_pillar",
    },
    {
        "key": "mine_obstacle_hand_winch",
        "name": "手摇卷扬机",
        "footprint": [2.60, 1.65],
        "obstacleHeightPx": 275,
        "builder": "build_hand_winch",
    },
    {
        "key": "mine_obstacle_sorting_hopper",
        "name": "矿石分选料斗",
        "footprint": [2.35, 1.85],
        "obstacleHeightPx": 315,
        "builder": "build_sorting_hopper",
    },
]


def setup_materials() -> None:
    # Neutral blockout materials make silhouette and component ownership legible.
    S.material("model_wood", (0.47, 0.43, 0.37), 0.86)
    S.material("model_wood_dark", (0.30, 0.28, 0.25), 0.92)
    S.material("model_metal", (0.31, 0.34, 0.36), 0.62, metallic=0.42)
    S.material("model_rock", (0.38, 0.40, 0.42), 0.96)
    S.material("model_ore", (0.22, 0.24, 0.26), 0.82, metallic=0.12)
    S.material("model_guide", (0.10, 0.78, 0.83), 0.48, alpha=0.72)


def link_to_active(obj: bpy.types.Object, name: str) -> bpy.types.Object:
    obj.name = name
    assert S.ACTIVE_COLLECTION is not None
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    S.ACTIVE_COLLECTION.objects.link(obj)
    obj.parent = S.ACTIVE_ROOT
    return obj


def add_beam(name: str, start, end, thickness: float, material="model_wood"):
    start_v, end_v = Vector(start), Vector(end)
    direction = end_v - start_v
    midpoint = (start_v + end_v) * 0.5
    bpy.ops.mesh.primitive_cube_add(location=midpoint)
    obj = link_to_active(bpy.context.object, name)
    obj.dimensions = (direction.length, thickness, thickness)
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("X", "Z")
    S.apply_dimensions(obj)
    S.add_bevel(obj, min(0.055, thickness * 0.18), 2)
    obj.data.materials.append(S.MATERIALS[material])
    return obj


def add_rock(name: str, location, scale, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=2, radius=1.0,
                                         location=location, rotation=rotation)
    obj = link_to_active(bpy.context.object, name)
    obj.scale = scale
    S.apply_dimensions(obj)
    obj.data.materials.append(S.MATERIALS["model_rock"])
    S.add_bevel(obj, 0.035, 1)
    return obj


def add_frustum(name: str, location, bottom, top, height, material="model_metal"):
    bw, bd = bottom
    tw, td = top
    z0 = -height / 2
    z1 = height / 2
    vertices = [
        (-bw / 2, -bd / 2, z0), (bw / 2, -bd / 2, z0),
        (bw / 2, bd / 2, z0), (-bw / 2, bd / 2, z0),
        (-tw / 2, -td / 2, z1), (tw / 2, -td / 2, z1),
        (tw / 2, td / 2, z1), (-tw / 2, td / 2, z1),
    ]
    faces = [
        (0, 1, 2, 3), (4, 7, 6, 5),
        (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0),
    ]
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    assert S.ACTIVE_COLLECTION is not None
    S.ACTIVE_COLLECTION.objects.link(obj)
    obj.parent = S.ACTIVE_ROOT
    obj.location = location
    obj.data.materials.append(S.MATERIALS[material])
    S.add_bevel(obj, 0.045, 2)
    return obj


def begin_model(key: str, arranged_location) -> None:
    S.new_model(key, arranged_location)


def build_collapsed_support() -> None:
    key = "mine_obstacle_collapsed_support"
    begin_model(key, (-5.2, 2.8, 0))
    for side in (-1, 1):
        x = side * 1.02
        S.box(f"{key}_Post_{side:+d}", (x, 0.02, 1.17), (0.34, 0.38, 2.34),
              "model_wood", bevel=0.065)
        for z in (0.34, 1.72):
            S.box(f"{key}_IronBand_{side:+d}_{z:.2f}", (x, 0.02, z),
                  (0.40, 0.44, 0.13), "model_metal", bevel=0.02)
    S.box(f"{key}_CrackedCrossbeam", (0, 0.02, 2.36), (2.48, 0.42, 0.38),
          "model_wood", rotation=(0, math.radians(3), math.radians(-2)), bevel=0.07)
    add_beam(f"{key}_DiagonalBrace", (-0.88, -0.05, 0.34), (0.78, 0.02, 1.92),
             0.24, "model_wood_dark")
    rock_specs = [
        ((-0.52, 0.08, 0.38), (0.62, 0.50, 0.44), (0.1, 0.2, -0.2)),
        ((0.18, -0.03, 0.46), (0.72, 0.55, 0.52), (-0.1, 0.1, 0.3)),
        ((0.72, 0.18, 0.31), (0.48, 0.42, 0.34), (0.2, -0.1, -0.4)),
        ((-0.85, -0.23, 0.22), (0.38, 0.33, 0.26), (-0.2, 0.1, 0.2)),
    ]
    for i, (loc, scale, rot) in enumerate(rock_specs):
        add_rock(f"{key}_Rockfall_{i + 1:02d}", loc, scale, rot)


def build_derailed_cart() -> None:
    key = "mine_obstacle_derailed_cart"
    begin_model(key, (0, 2.8, 0))
    for y in (-0.42, 0.42):
        S.box(f"{key}_Rail_{y:+.2f}", (0, y, 0.12), (3.00, 0.12, 0.18),
              "model_metal", rotation=(0, 0, math.radians(4)), bevel=0.025)
    for i, x in enumerate((-1.12, -0.36, 0.40, 1.16)):
        S.box(f"{key}_Sleeper_{i + 1:02d}", (x, 0, 0.08), (0.30, 1.40, 0.16),
              "model_wood_dark", rotation=(0, 0, math.radians(4)), bevel=0.04)
    cart = add_frustum(f"{key}_CartBody", (0.08, -0.02, 0.91),
                       (1.70, 0.94), (2.25, 1.22), 1.08, "model_metal")
    cart.rotation_euler = (math.radians(2), math.radians(-7), math.radians(-7))
    for side in (-1, 1):
        for x in (-0.68, 0.68):
            S.torus(f"{key}_Wheel_{side:+d}_{x:+.2f}",
                    (x + 0.08, side * 0.62, 0.45), 0.30, 0.075, "model_metal",
                    rotation=(math.radians(90), 0, math.radians(-7)))
            S.cylinder(f"{key}_WheelHub_{side:+d}_{x:+.2f}",
                       (x + 0.08, side * 0.62, 0.45), 0.10, 0.16, "model_metal",
                       rotation=(math.radians(90), 0, math.radians(-7)), vertices=12)
    ore_specs = [
        ((-0.55, -0.18, 1.49), (0.34, 0.28, 0.24)),
        ((-0.10, 0.10, 1.56), (0.38, 0.31, 0.26)),
        ((0.38, -0.06, 1.51), (0.36, 0.30, 0.24)),
        ((0.72, 0.19, 1.46), (0.28, 0.25, 0.22)),
    ]
    for i, (loc, scale) in enumerate(ore_specs):
        add_rock(f"{key}_OreLoad_{i + 1:02d}", loc, scale)
        bpy.context.object.data.materials.clear()
        bpy.context.object.data.materials.append(S.MATERIALS["model_ore"])


def build_stone_pillar() -> None:
    key = "mine_obstacle_stone_pillar"
    begin_model(key, (5.2, 2.8, 0))
    pillars = [
        ((-0.15, 0.02, 1.34), (0.66, 0.58, 1.38), (0.03, -0.10, 0.08)),
        ((0.60, 0.16, 0.83), (0.42, 0.38, 0.86), (-0.04, 0.12, -0.14)),
        ((-0.70, 0.20, 0.63), (0.34, 0.32, 0.66), (0.10, 0.04, 0.18)),
        ((0.18, -0.48, 0.49), (0.50, 0.35, 0.53), (-0.12, 0.06, -0.08)),
    ]
    for i, (loc, scale, rot) in enumerate(pillars):
        add_rock(f"{key}_Pillar_{i + 1:02d}", loc, scale, rot)
    S.cylinder(f"{key}_ConnectedBase", (0, 0, 0.14), 0.88, 0.28,
               "model_rock", vertices=10, scale=(1.0, 0.82, 1.0), bevel=0.05)


def build_hand_winch() -> None:
    key = "mine_obstacle_hand_winch"
    begin_model(key, (-2.65, -2.65, 0))
    for y in (-0.63, 0.63):
        S.box(f"{key}_BaseRunner_{y:+.2f}", (0, y, 0.12), (2.35, 0.22, 0.24),
              "model_wood_dark", bevel=0.045)
    for side in (-1, 1):
        x = side * 0.78
        add_beam(f"{key}_FrameFront_{side:+d}", (x, -0.60, 0.22), (x, -0.17, 1.82),
                 0.25)
        add_beam(f"{key}_FrameRear_{side:+d}", (x, 0.60, 0.22), (x, 0.17, 1.82),
                 0.25)
        S.box(f"{key}_Bearing_{side:+d}", (x, 0, 1.55), (0.22, 0.40, 0.40),
              "model_metal", bevel=0.045)
    S.cylinder(f"{key}_Drum", (0, 0, 1.25), 0.46, 1.30, "model_metal",
               rotation=(0, math.radians(90), 0), vertices=24, bevel=0.035)
    for x in (-0.68, 0.68):
        S.cylinder(f"{key}_DrumFlange_{x:+.2f}", (x, 0, 1.25), 0.56, 0.11,
                   "model_metal", rotation=(0, math.radians(90), 0), vertices=20)
    for ring in range(5):
        x = -0.42 + ring * 0.21
        S.torus(f"{key}_CableRing_{ring + 1:02d}", (x, 0, 1.25), 0.48, 0.032,
                "model_wood_dark", rotation=(0, math.radians(90), 0))
    S.torus(f"{key}_CrankWheel", (0.96, 0, 1.42), 0.55, 0.07,
            "model_metal", rotation=(0, math.radians(90), 0))
    S.cylinder(f"{key}_CrankAxle", (1.04, 0, 1.42), 0.10, 0.42, "model_metal",
               rotation=(0, math.radians(90), 0), vertices=14)
    add_beam(f"{key}_CrankHandle", (1.20, 0, 1.42), (1.20, 0, 0.83),
             0.10, "model_metal")


def build_sorting_hopper() -> None:
    key = "mine_obstacle_sorting_hopper"
    begin_model(key, (2.65, -2.65, 0))
    for x in (-0.78, 0.78):
        for y in (-0.58, 0.58):
            S.box(f"{key}_Leg_{x:+.2f}_{y:+.2f}", (x, y, 0.83),
                  (0.22, 0.22, 1.66), "model_wood", bevel=0.045)
    for y in (-0.58, 0.58):
        add_beam(f"{key}_LongBrace_{y:+.2f}", (-0.78, y, 0.34), (0.78, y, 1.24),
                 0.15, "model_wood_dark")
    hopper = add_frustum(f"{key}_OreHopper", (0, 0, 1.72),
                         (0.76, 0.66), (1.86, 1.36), 1.18, "model_metal")
    hopper.rotation_euler.z = math.radians(-2)
    chute = add_frustum(f"{key}_LowerChute", (0, -0.36, 0.92),
                        (0.46, 0.42), (0.82, 0.66), 0.86, "model_metal")
    chute.rotation_euler.x = math.radians(24)
    for i, (x, y, z, scale) in enumerate((
        (-0.45, -0.18, 2.35, (0.28, 0.22, 0.18)),
        (0.05, 0.08, 2.42, (0.34, 0.26, 0.20)),
        (0.48, -0.05, 2.34, (0.25, 0.21, 0.17)),
    )):
        add_rock(f"{key}_Ore_{i + 1:02d}", (x, y, z), scale)
        bpy.context.object.data.materials.clear()
        bpy.context.object.data.materials.append(S.MATERIALS["model_ore"])
    S.box(f"{key}_ScreenDeck", (0, 0.38, 1.12), (1.70, 0.62, 0.12),
          "model_metal", rotation=(math.radians(-10), 0, 0), bevel=0.025)


def create_footprint_guide(obstacle: dict, arranged_location) -> None:
    key = obstacle["key"]
    width, depth = obstacle["footprint"]
    collection = bpy.data.collections.new(f"{key}_ApprovalGuides")
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new(f"{key}_GuideRoot_44_8deg", None)
    collection.objects.link(root)
    root.location = arranged_location
    root.rotation_euler.z = math.radians(ROOT_ROTATION_DEG)
    GUIDE_COLLECTIONS[key] = collection
    GUIDE_ROOTS[key] = root
    old_collection, old_root = S.ACTIVE_COLLECTION, S.ACTIVE_ROOT
    S.ACTIVE_COLLECTION, S.ACTIVE_ROOT = collection, root
    thickness = 0.035
    z = 0.012
    S.box(f"{key}_GUIDE_Front", (0, -depth / 2, z), (width, thickness, thickness),
          "model_guide", bevel=0)
    S.box(f"{key}_GUIDE_Back", (0, depth / 2, z), (width, thickness, thickness),
          "model_guide", bevel=0)
    S.box(f"{key}_GUIDE_Left", (-width / 2, 0, z), (thickness, depth, thickness),
          "model_guide", bevel=0)
    S.box(f"{key}_GUIDE_Right", (width / 2, 0, z), (thickness, depth, thickness),
          "model_guide", bevel=0)
    S.ACTIVE_COLLECTION, S.ACTIVE_ROOT = old_collection, old_root


def set_visibility(active_key: str | None, guides: bool) -> None:
    for key, collection in S.MODEL_COLLECTIONS.items():
        collection.hide_render = active_key is not None and key != active_key
    for key, collection in GUIDE_COLLECTIONS.items():
        collection.hide_render = (not guides) or (active_key is not None and key != active_key)


def set_individual_root_locations(key: str, at_origin: bool) -> tuple[Vector, Vector]:
    body_root = S.MODEL_ROOTS[key]
    guide_root = GUIDE_ROOTS[key]
    saved_body = body_root.location.copy()
    saved_guide = guide_root.location.copy()
    if at_origin:
        body_root.location = (0, 0, 0)
        guide_root.location = (0, 0, 0)
    return saved_body, saved_guide


def configure_preview(scene, camera, path: Path, width=1024, height=1024,
                      ortho_scale=ORTHO_SCALE, shift_x=0.0, shift_y=None,
                      transparent=True) -> None:
    scene.compositing_node_group = None
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = transparent
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.18
    scene.view_settings.gamma = 1.0
    camera.data.ortho_scale = ortho_scale
    camera.data.shift_x = shift_x
    if shift_y is None:
        target_ground = (0.5 - BOTTOM_RATIO) * ortho_scale
        shift_y = -target_ground / ortho_scale
    camera.data.shift_y = shift_y
    background = scene.world.node_tree.nodes.get("Background") if scene.world else None
    saved_color = background.inputs["Color"].default_value[:] if background else None
    saved_strength = background.inputs["Strength"].default_value if background else None
    if not transparent and background:
        background.inputs["Color"].default_value = (0.0, 1.0, 0.0, 1.0)
        background.inputs["Strength"].default_value = 1.0
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        scene.render.filepath = str(path)
        bpy.ops.render.render(write_still=True)
    finally:
        if background and saved_color is not None and saved_strength is not None:
            background.inputs["Color"].default_value = saved_color
            background.inputs["Strength"].default_value = saved_strength


def body_bottom_shift(scene, camera, collection) -> float:
    """Return the camera shift that puts the visible body bottom at BOTTOM_RATIO."""
    camera.data.shift_y = 0.0
    bpy.context.view_layer.update()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bottom_ndc = 1.0
    found = False
    for obj in collection.all_objects:
        if obj.type != "MESH":
            continue
        evaluated = obj.evaluated_get(depsgraph)
        mesh = evaluated.to_mesh()
        try:
            for vertex in mesh.vertices:
                world = evaluated.matrix_world @ vertex.co
                ndc = world_to_camera_view(scene, camera, world)
                bottom_ndc = min(bottom_ndc, ndc.y)
                found = True
        finally:
            evaluated.to_mesh_clear()
    if not found:
        raise RuntimeError(f"No mesh vertices found in {collection.name}")
    return bottom_ndc - (1.0 - BOTTOM_RATIO)


def rendered_alpha_bottom_ndc(path: Path) -> float:
    """Read the visible bottom row from a saved transparent calibration PNG."""
    image = bpy.data.images.load(str(path), check_existing=False)
    try:
        width, height = (int(value) for value in image.size)
        pixels = array("f", [0.0]) * (width * height * 4)
        image.pixels.foreach_get(pixels)
        for y in range(height):
            alpha_start = y * width * 4 + 3
            if max(pixels[alpha_start:alpha_start + width * 4:4]) > 0.01:
                return y / max(height - 1, 1)
    finally:
        bpy.data.images.remove(image)
    raise RuntimeError("Rendered body contains no visible alpha")


def camera_depth_range(collection, camera) -> tuple[float, float]:
    bpy.context.view_layer.update()
    inverse = camera.matrix_world.inverted()
    depths = []
    for obj in collection.all_objects:
        if obj.type != "MESH":
            continue
        for corner in obj.bound_box:
            point = inverse @ (obj.matrix_world @ Vector(corner))
            depths.append(-point.z)
    zmin, zmax = min(depths), max(depths)
    span = max(zmax - zmin, 1e-6)
    return zmin - span * 0.01, zmax + span * 0.01


def configure_depth(scene, zmin: float, zmax: float, path: Path) -> None:
    bpy.context.view_layer.use_pass_z = True
    node_group = bpy.data.node_groups.new("World126MineDepth", "CompositorNodeTree")
    scene.compositing_node_group = node_group
    nodes, links = node_group.nodes, node_group.links
    render_layers = nodes.new("CompositorNodeRLayers")
    map_range = nodes.new("ShaderNodeMapRange")
    map_range.clamp = True
    map_range.inputs["From Min"].default_value = zmin
    map_range.inputs["From Max"].default_value = zmax
    map_range.inputs["To Min"].default_value = 1.0
    map_range.inputs["To Max"].default_value = 0.0
    multiply = nodes.new("ShaderNodeMath")
    multiply.operation = "MULTIPLY"
    output = nodes.new("NodeGroupOutput")
    node_group.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    links.new(render_layers.outputs["Depth"], map_range.inputs["Value"])
    links.new(render_layers.outputs["Alpha"], multiply.inputs[1])
    links.new(map_range.outputs["Result"], multiply.inputs[0])
    links.new(multiply.outputs[0], output.inputs["Image"])
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "BW"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Raw"
    try:
        scene.view_settings.look = "None"
    except TypeError:
        pass
    scene.view_settings.exposure = 0.0
    scene.render.dither_intensity = 0.0
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    scene.compositing_node_group = None


def render_individuals(scene, camera) -> None:
    for obstacle in OBSTACLES:
        key = obstacle["key"]
        saved_body, saved_guide = set_individual_root_locations(key, True)
        set_visibility(key, guides=False)
        shift_y = body_bottom_shift(scene, camera, S.MODEL_COLLECTIONS[key])
        calibration = OUT / f"_{key}_bottom_calibration.png"
        configure_preview(
            scene, camera, calibration, shift_y=shift_y, transparent=True,
        )
        shift_y += rendered_alpha_bottom_ndc(calibration) - (1.0 - BOTTOM_RATIO)
        calibration.unlink(missing_ok=True)
        configure_preview(
            scene, camera, INIT_OUT / f"{key}_blockout_init.png",
            shift_y=shift_y, transparent=True,
        )
        set_visibility(key, guides=True)
        configure_preview(
            scene, camera, PREVIEW_OUT / f"{key}_approval_preview.png",
            shift_y=shift_y,
        )
        set_visibility(key, guides=False)
        zmin, zmax = camera_depth_range(S.MODEL_COLLECTIONS[key], camera)
        configure_depth(scene, zmin, zmax, DEPTH_OUT / f"{key}_body_depth.png")
        S.MODEL_ROOTS[key].location = saved_body
        GUIDE_ROOTS[key].location = saved_guide


def render_contact_sheet(scene, camera) -> Path:
    set_visibility(None, guides=True)
    path = OUT / "world126-mine-obstacles-model-approval-preview.png"
    # The arranged roots form a 3+2 layout.  A single same-camera render makes
    # scale differences visible without resizing individual models.
    configure_preview(scene, camera, path, width=1536, height=1024,
                      ortho_scale=13.6, shift_x=0.0, shift_y=0.02)
    return path


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    PREVIEW_OUT.mkdir(parents=True, exist_ok=True)
    DEPTH_OUT.mkdir(parents=True, exist_ok=True)
    INIT_OUT.mkdir(parents=True, exist_ok=True)
    S.clear_scene()
    S.setup_materials()
    setup_materials()
    scene, camera = S.setup_scene()
    builders = {
        "build_collapsed_support": build_collapsed_support,
        "build_derailed_cart": build_derailed_cart,
        "build_stone_pillar": build_stone_pillar,
        "build_hand_winch": build_hand_winch,
        "build_sorting_hopper": build_sorting_hopper,
    }
    arranged = [(-5.2, 2.8, 0), (0, 2.8, 0), (5.2, 2.8, 0),
                (-2.65, -2.65, 0), (2.65, -2.65, 0)]
    for obstacle, location in zip(OBSTACLES, arranged):
        builders[obstacle["builder"]]()
        create_footprint_guide(obstacle, location)
    set_visibility(None, guides=False)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))
    render_individuals(scene, camera)
    contact = render_contact_sheet(scene, camera)
    manifest = {
        "version": 1,
        "stage": "model-first approval; no AI material image and no runtime promotion",
        "camera": {
            "projection": "orthographic",
            "elevationDegrees": CAMERA_ELEVATION_DEG,
            "modelRootRotationZDegrees": ROOT_ROTATION_DEG,
            "orthoScale": ORTHO_SCALE,
            "groundContactBottomRatio": BOTTOM_RATIO,
            "resolution": [1024, 1024],
        },
        "groundContract": {
            "modelBottomZ": 0.0,
            "guideRole": "approval-only footprint outline; excluded from Body Depth",
            "runtimeDepthRule": "front edge of true footprint, not sprite AABB bottom",
        },
        "obstacles": [
            {
                **{k: v for k, v in obstacle.items() if k != "builder"},
                "preview": f"approval-previews/{obstacle['key']}_approval_preview.png",
                "bodyDepth": f"body-depth/{obstacle['key']}_body_depth.png",
                "collision": "one rectangular obstacle footprint",
            }
            for obstacle in OBSTACLES
        ],
        "blend": str(BLEND_OUT.relative_to(REPO)).replace("\\", "/"),
        "approvalPreview": str(contact.relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "model-contract.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved editable model: {BLEND_OUT}")
    print(f"Approval preview: {contact}")
    print(f"Rendered {len(OBSTACLES)} same-camera previews and Body Depth images")


if __name__ == "__main__":
    main()
