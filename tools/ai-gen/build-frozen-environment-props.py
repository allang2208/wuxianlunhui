"""Build the shared 18-piece frozen-plane / frozen-dungeon prop kit.

The kit follows the accepted World-122 road and dungeon-deco contract:
30-degree orthographic camera, 44.8-degree model-root rotation, one fixed prop
camera scale, transparent sprites, and visual-only floor placement.  It emits
editable Blender geometry, 256px model renders, and matching Body Depth images
for the project's FLUX.2 Dev + Depth material-refinement pass.
"""

from __future__ import annotations

import importlib.util
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[2]
SOURCE_SCRIPT = REPO / "tools" / "ai-gen" / "build-world122-street-decor.py"
OUT = REPO / "tools" / "ai-gen" / "_frozen_environment_props_20260829"
MODEL_OUT = OUT / "model-renders"
DEPTH_OUT = OUT / "body-depth"
BLEND_OUT = OUT / "frozen_environment_props.blend"


def load_street_helpers():
    spec = importlib.util.spec_from_file_location("world122_street_helpers", SOURCE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


S = load_street_helpers()


PROP_SPECS = [
    ("frozen_prop_snow_clods", "积雪团", 1.30, 0.82),
    ("frozen_prop_ice_pebbles", "冰砾散落", 1.25, 0.90),
    ("frozen_prop_frost_stones", "霜覆石簇", 1.20, 1.00),
    ("frozen_prop_broken_ice_slab", "破裂冰板", 1.10, 1.05),
    ("frozen_prop_wind_snow_ridge", "风蚀雪脊", 1.10, 0.78),
    ("frozen_prop_refrozen_shards", "再冻冰片", 1.00, 1.10),
    ("frozen_prop_frozen_grass", "冻枯草丛", 1.05, 0.62),
    ("frozen_prop_frost_heather", "霜封矮灌木", 0.92, 0.58),
    ("frozen_prop_twig_bundle", "冻枝束", 0.92, 0.92),
    ("frozen_prop_dead_root", "冻裂枯根", 0.82, 0.86),
    ("frozen_prop_bark_pinecones", "树皮与松果", 0.78, 0.52),
    ("frozen_prop_animal_bones", "小兽遗骨", 0.62, 0.86),
    ("frozen_prop_antler_fragment", "断角残片", 0.55, 0.82),
    ("frozen_prop_frozen_tracks", "冻结足迹", 0.86, 0.50),
    ("frozen_prop_broken_chain", "断裂铁链", 0.38, 1.18),
    ("frozen_prop_rope_coil", "冻硬绳圈", 0.40, 1.05),
    ("frozen_prop_torn_cloth", "冻结破布", 0.42, 0.98),
    ("frozen_prop_broken_lantern", "破损提灯", 0.32, 1.12),
]


def setup_materials():
    # Low-saturation, physically plausible palette sampled from the current
    # snow floor, ice abyss, road props, and dungeon clutter libraries.
    S.material("frozen_snow", (0.69, 0.75, 0.77), 0.98)
    S.material("frozen_snow_shadow", (0.43, 0.52, 0.57), 1.0)
    S.material("frozen_ice", (0.38, 0.53, 0.60), 0.54)
    S.material("frozen_ice_dark", (0.22, 0.34, 0.40), 0.72)
    S.material("frozen_stone", (0.26, 0.30, 0.31), 0.97)
    S.material("frozen_stone_dark", (0.15, 0.18, 0.19), 1.0)
    S.material("frozen_wood", (0.21, 0.17, 0.13), 1.0)
    S.material("frozen_wood_light", (0.32, 0.25, 0.18), 0.98)
    S.material("frozen_grass", (0.35, 0.34, 0.27), 1.0)
    S.material("frozen_heather", (0.25, 0.28, 0.25), 1.0)
    S.material("frozen_bone", (0.56, 0.55, 0.48), 1.0)
    S.material("frozen_bone_dark", (0.34, 0.34, 0.30), 1.0)
    S.material("frozen_iron", (0.16, 0.18, 0.19), 0.80, metallic=0.58)
    S.material("frozen_rust", (0.28, 0.14, 0.09), 0.94, metallic=0.32)
    S.material("frozen_rope", (0.33, 0.27, 0.19), 1.0)
    S.material("frozen_cloth", (0.22, 0.28, 0.31), 1.0)
    S.material("frozen_cloth_dark", (0.13, 0.17, 0.19), 1.0)
    S.material("frozen_glass", (0.25, 0.40, 0.44), 0.38, metallic=0.08)


def setup_scene():
    """Blender 5.1-safe equivalent of the accepted street render setup."""
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = True
    scene.render.resolution_percentage = 100
    scene.render.image_settings.compression = 20
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.18

    world = bpy.data.worlds.new("Frozen_Prop_Neutral_World")
    world.use_nodes = True
    nodes = world.node_tree.nodes
    links = world.node_tree.links
    background = nodes.get("Background") or nodes.new("ShaderNodeBackground")
    output = nodes.get("World Output") or nodes.new("ShaderNodeOutputWorld")
    if not background.outputs["Background"].is_linked:
        links.new(background.outputs["Background"], output.inputs["Surface"])
    background.inputs["Color"].default_value = (0.16, 0.17, 0.18, 1)
    background.inputs["Strength"].default_value = 0.72
    scene.world = world

    sun_data = bpy.data.lights.new("Frozen_Prop_Key_Sun", "SUN")
    sun_data.energy = 1.75
    sun_data.angle = math.radians(18)
    sun = bpy.data.objects.new("Frozen_Prop_Key_Sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(42), 0, math.radians(-38))

    fill_data = bpy.data.lights.new("Frozen_Prop_Soft_Fill", "AREA")
    fill_data.energy = 520
    fill_data.shape = "DISK"
    fill_data.size = 7.0
    fill = bpy.data.objects.new("Frozen_Prop_Soft_Fill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (-5.5, -6.5, 10.0)
    fill.rotation_euler = (Vector((0, 0, 1.0)) - fill.location).to_track_quat("-Z", "Y").to_euler()

    camera_data = bpy.data.cameras.new("Frozen_Prop_Ortho_30deg")
    camera_data.type = "ORTHO"
    camera_data.clip_start = 0.01
    camera_data.clip_end = 100.0
    camera = bpy.data.objects.new("Frozen_Prop_Ortho_30deg", camera_data)
    scene.collection.objects.link(camera)
    distance = 18.0
    elevation = math.radians(S.CAMERA_ELEVATION_DEG)
    camera.location = (0, -distance * math.cos(elevation), distance * math.sin(elevation))
    camera.rotation_euler = (math.radians(90) - elevation, 0, 0)
    scene.camera = camera
    return scene, camera


def start(name: str, x: float, y: float, shadow=(2.2, 1.25)):
    S.new_model(name, (x, y, 0))
    if shadow:
        S.add_shadow(shadow[0], shadow[1], 0.006)
    return name


def add_frost_caps(name: str, points, material="frozen_snow"):
    for i, (x, y, z, sx, sy) in enumerate(points):
        S.sphere(f"{name}_Frost_{i}", (x, y, z), (sx, sy, max(0.035, sx * 0.22)), material)


def snow_clods():
    name = start("frozen_prop_snow_clods", 0, -6)
    rng = random.Random(91201)
    for i in range(10):
        s = rng.uniform(0.12, 0.30)
        S.sphere(f"{name}_Clod_{i}", (rng.uniform(-0.82, 0.82), rng.uniform(-0.38, 0.38), s * 0.35),
                 (s * rng.uniform(0.95, 1.45), s, s * 0.48),
                 "frozen_snow" if i % 3 else "frozen_snow_shadow")
    return name


def ice_pebbles():
    name = start("frozen_prop_ice_pebbles", 5, -6)
    rng = random.Random(91202)
    for i in range(12):
        s = rng.uniform(0.08, 0.21)
        S.sphere(f"{name}_Pebble_{i}", (rng.uniform(-0.86, 0.86), rng.uniform(-0.40, 0.40), s * 0.36),
                 (s * rng.uniform(0.8, 1.5), s, s * 0.42),
                 "frozen_ice" if i % 3 else "frozen_ice_dark")
    return name


def frost_stones():
    name = start("frozen_prop_frost_stones", 10, -6)
    stones = [(-0.54, -0.10, .46, .38, .30), (0.02, .12, .62, .46, .42),
              (.55, -.08, .42, .34, .27), (.76, .24, .25, .21, .18)]
    caps = []
    for i, (x, y, w, d, h) in enumerate(stones):
        S.sphere(f"{name}_Stone_{i}", (x, y, h * .48), (w, d, h),
                 "frozen_stone" if i % 2 else "frozen_stone_dark")
        caps.append((x - .04, y - .01, h * .86, w * .72, d * .62))
    add_frost_caps(name, caps)
    return name


def broken_ice_slab():
    name = start("frozen_prop_broken_ice_slab", 15, -6)
    pieces = [(-.34, .02, 1.02, .62, .12, 10), (.38, .16, .72, .44, .17, -19),
              (-.55, -.27, .48, .30, .10, 31), (.67, -.18, .34, .24, .08, 17)]
    for i, (x, y, w, d, h, a) in enumerate(pieces):
        S.box(f"{name}_Slab_{i}", (x, y, h / 2), (w, d, h),
              "frozen_ice" if i % 2 == 0 else "frozen_ice_dark",
              rotation=(0, math.radians((i - 1) * 3), math.radians(a)), bevel=.045)
    return name


def wind_snow_ridge():
    name = start("frozen_prop_wind_snow_ridge", 20, -6, shadow=(2.5, 1.15))
    ridge = [(-1.0, -.20, .06), (-.55, -.05, .18), (-.08, .06, .28),
             (.42, .11, .20), (1.02, .26, .07)]
    S.curve(f"{name}_Core", ridge, .17, "frozen_snow")
    S.curve(f"{name}_BlueEdge", [(-.82, -.31, .035), (-.12, -.14, .08), (.68, .02, .045)],
            .055, "frozen_snow_shadow")
    return name


def refrozen_shards():
    name = start("frozen_prop_refrozen_shards", 25, -6)
    shards = [(-.68, -.15, .34, .16, .20, 18), (-.27, .18, .48, .19, .27, -14),
              (.20, -.03, .62, .22, .34, 29), (.66, .16, .38, .16, .22, -25),
              (.72, -.25, .24, .13, .16, 8)]
    for i, (x, y, w, d, h, a) in enumerate(shards):
        S.cone(f"{name}_Shard_{i}", (x, y, h / 2), max(w, d) * .55, .025, h,
               "frozen_ice" if i % 2 else "frozen_ice_dark",
               rotation=(math.radians(5), math.radians(-8), math.radians(a)), vertices=5)
    return name


def frozen_grass():
    name = start("frozen_prop_frozen_grass", 0, -11, shadow=(1.8, 1.05))
    rng = random.Random(91207)
    for i in range(18):
        x, y = rng.uniform(-.27, .27), rng.uniform(-.18, .18)
        lx, ly, h = rng.uniform(-.46, .46), rng.uniform(-.24, .24), rng.uniform(.42, .86)
        S.curve(f"{name}_Blade_{i}", [(x, y, .025), (x + lx * .45, y + ly * .45, h * .64),
                                       (x + lx, y + ly, h)], .016 + (i % 3) * .003,
                "frozen_grass")
        if i % 4 == 0:
            S.sphere(f"{name}_IceTip_{i}", (x + lx, y + ly, h), (.035, .035, .05), "frozen_snow")
    return name


def frost_heather():
    name = start("frozen_prop_frost_heather", 5, -11, shadow=(1.95, 1.10))
    rng = random.Random(91208)
    for i in range(13):
        a = rng.uniform(0, math.tau)
        r = rng.uniform(.04, .30)
        x, y, h = math.cos(a) * r, math.sin(a) * r, rng.uniform(.34, .70)
        S.curve(f"{name}_Stem_{i}", [(0, 0, .04), (x * .6, y * .6, h * .58), (x, y, h)],
                .022, "frozen_heather")
        for j in range(2):
            z = h * (.52 + j * .20)
            S.sphere(f"{name}_Bud_{i}_{j}", (x * (z / h), y * (z / h), z),
                     (.045, .035, .045), "frozen_snow_shadow" if j else "frozen_snow")
    return name


def twig_bundle():
    name = start("frozen_prop_twig_bundle", 10, -11)
    twigs = [(-.82, -.18, 1.48, 15), (-.55, .12, 1.52, -12), (-.20, -.02, 1.62, 7),
             (.12, .20, 1.38, -20), (.43, -.15, 1.28, 24)]
    for i, (x, y, length, a) in enumerate(twigs):
        ang = math.radians(a)
        S.curve(f"{name}_Twig_{i}", [(x, y, .07), (x + math.cos(ang) * length * .5,
                  y + math.sin(ang) * length * .5, .11),
                 (x + math.cos(ang) * length, y + math.sin(ang) * length, .055)],
                .035 if i % 2 else .045, "frozen_wood")
    S.curve(f"{name}_Binding", [(-.12, -.24, .13), (0, 0, .17), (.14, .23, .13)], .035, "frozen_rope")
    add_frost_caps(name, [(-.60, -.13, .14, .18, .08), (.22, .10, .16, .20, .08)])
    return name


def dead_root():
    name = start("frozen_prop_dead_root", 15, -11, shadow=(2.45, 1.30))
    S.curve(f"{name}_Core", [(-.76, 0, .12), (-.18, .03, .23), (.46, -.04, .15)], .105, "frozen_wood")
    roots = [(-.32, .10, -.92, .58), (-.05, .12, .10, .78), (.20, .08, .92, .44), (.18, -.02, .58, -.68)]
    for i, (x, y, ex, ey) in enumerate(roots):
        S.curve(f"{name}_Root_{i}", [(x, y, .14), ((x + ex) * .5, (y + ey) * .5, .10),
                                      (ex, ey, .045)], .040, "frozen_wood_light" if i % 2 else "frozen_wood")
    add_frost_caps(name, [(-.18, .01, .29, .42, .12), (.52, -.02, .19, .22, .09)])
    return name


def bark_pinecones():
    name = start("frozen_prop_bark_pinecones", 20, -11)
    for i, (x, y, w, d, a) in enumerate(((-.58, -.10, .72, .24, 18), (.12, .15, .64, .22, -22),
                                          (.48, -.22, .48, .18, 31))):
        S.box(f"{name}_Bark_{i}", (x, y, .06), (w, d, .085), "frozen_wood_light" if i == 1 else "frozen_wood",
              rotation=(0, 0, math.radians(a)), bevel=.035)
    for i, (x, y, a) in enumerate(((-.08, -.18, 12), (.67, .12, -18))):
        S.cone(f"{name}_Cone_{i}", (x, y, .16), .20, .13, .36, "frozen_wood",
               rotation=(0, math.radians(68), math.radians(a)), vertices=10)
    add_frost_caps(name, [(-.12, -.17, .29, .10, .07), (.62, .13, .28, .10, .07)])
    return name


def animal_bones():
    name = start("frozen_prop_animal_bones", 25, -11)
    bones = [(-.62, -.12, .60, 14), (.06, .18, .72, -20), (.62, -.16, .48, 32)]
    for i, (x, y, length, a) in enumerate(bones):
        S.cylinder(f"{name}_Bone_{i}", (x, y, .09), .055, length, "frozen_bone",
                   rotation=(0, math.radians(90), math.radians(a)), vertices=10, bevel=.018)
    S.sphere(f"{name}_Skull", (.18, -.18, .13), (.23, .18, .16), "frozen_bone_dark")
    add_frost_caps(name, [(.18, -.19, .24, .16, .12), (-.58, -.10, .14, .14, .07)])
    return name


def antler_fragment():
    name = start("frozen_prop_antler_fragment", 0, -16, shadow=(2.35, 1.20))
    S.curve(f"{name}_Beam", [(-.95, -.24, .07), (-.42, -.06, .12), (.12, .12, .17), (.90, .28, .10)],
            .065, "frozen_bone_dark")
    branches = [(-.52, -.04, -.44, .48), (-.14, .06, .02, .62), (.26, .15, .46, .68), (.56, .21, .80, .54)]
    for i, (x, y, ex, ey) in enumerate(branches):
        S.curve(f"{name}_Tine_{i}", [(x, y, .12), ((x + ex) * .5, (y + ey) * .5, .20), (ex, ey, .13)],
                .045, "frozen_bone")
    add_frost_caps(name, [(-.24, .04, .22, .22, .08), (.47, .18, .22, .18, .07)])
    return name


def frozen_tracks():
    name = start("frozen_prop_frozen_tracks", 5, -16, shadow=None)
    steps = [(-.82, -.42, -16), (-.48, -.12, 11), (-.12, .16, -14), (.25, .43, 12), (.62, .68, -11)]
    for i, (x, y, a) in enumerate(steps):
        S.cylinder(f"{name}_Heel_{i}", (x, y, .024), 1.0, .022, "frozen_ice_dark", vertices=18,
                   scale=(.13, .21, 1), rotation=(0, 0, math.radians(a)), bevel=0)
        S.cylinder(f"{name}_Toe_{i}", (x + .03, y + .12, .027), 1.0, .023, "frozen_snow_shadow", vertices=18,
                   scale=(.17, .22, 1), rotation=(0, 0, math.radians(a)), bevel=0)
    return name


def broken_chain():
    name = start("frozen_prop_broken_chain", 10, -16)
    for i, (x, y, a) in enumerate(((-.66, -.12, 12), (-.27, .04, -18), (.15, -.01, 20), (.56, .17, -10))):
        S.torus(f"{name}_Link_{i}", (x, y, .105), .19, .04,
                "frozen_iron" if i % 2 else "frozen_rust",
                rotation=(math.radians(72), 0, math.radians(a)))
    add_frost_caps(name, [(-.48, -.06, .20, .16, .07), (.38, .10, .20, .15, .07)])
    return name


def rope_coil():
    name = start("frozen_prop_rope_coil", 15, -16)
    for i, radius in enumerate((.27, .41, .55)):
        S.torus(f"{name}_Loop_{i}", (0, 0, .07 + i * .018), radius, .045, "frozen_rope")
    S.curve(f"{name}_Tail", [(.50, -.08, .09), (.76, -.30, .07), (.96, -.12, .055)], .04, "frozen_rope")
    add_frost_caps(name, [(-.18, -.02, .15, .32, .10), (.47, .02, .15, .16, .07)])
    return name


def torn_cloth():
    name = start("frozen_prop_torn_cloth", 20, -16)
    strips = [(-.34, -.08, .94, .32, -12), (.25, .12, .78, .28, 18), (.58, -.18, .44, .21, -30)]
    for i, (x, y, w, d, a) in enumerate(strips):
        S.box(f"{name}_Strip_{i}", (x, y, .045 + i * .012), (w, d, .05),
              "frozen_cloth" if i % 2 == 0 else "frozen_cloth_dark",
              rotation=(0, 0, math.radians(a)), bevel=.07)
    add_frost_caps(name, [(-.38, -.08, .105, .28, .09), (.30, .10, .11, .22, .07)])
    return name


def broken_lantern():
    name = start("frozen_prop_broken_lantern", 25, -16, shadow=(1.9, 1.15))
    S.box(f"{name}_Body", (-.12, 0, .28), (.52, .46, .52), "frozen_iron",
          rotation=(math.radians(5), math.radians(72), math.radians(-18)), bevel=.045)
    S.box(f"{name}_Glass", (.04, -.04, .30), (.32, .34, .30), "frozen_glass",
          rotation=(math.radians(5), math.radians(72), math.radians(-18)), bevel=.025)
    S.torus(f"{name}_Handle", (-.30, .03, .42), .34, .035, "frozen_rust",
            rotation=(math.radians(78), 0, math.radians(-18)))
    for i, (x, y, a) in enumerate(((.48, -.20, 18), (.62, .12, -24), (.32, .30, 34))):
        S.box(f"{name}_Shard_{i}", (x, y, .045), (.26, .16, .055), "frozen_glass",
              rotation=(0, 0, math.radians(a)), bevel=.018)
    add_frost_caps(name, [(-.18, -.01, .52, .24, .16)])
    return name


def camera_depth_range(collection, camera):
    bpy.context.view_layer.update()
    inverse = camera.matrix_world.inverted()
    depths = []
    for obj in collection.all_objects:
        if obj.type not in {"MESH", "CURVE"} or obj.name.startswith("Contact_Shadow"):
            continue
        for corner in obj.bound_box:
            depths.append(-(inverse @ (obj.matrix_world @ Vector(corner))).z)
    zmin, zmax = min(depths), max(depths)
    span = max(zmax - zmin, 1e-4)
    return zmin - span * .02, zmax + span * .02


def render_depth(name: str, path: Path, scene, camera):
    for collection in S.MODEL_COLLECTIONS.values():
        collection.hide_render = True
    collection = S.MODEL_COLLECTIONS[name]
    collection.hide_render = False
    root = S.MODEL_ROOTS[name]
    arranged = root.location.copy()
    root.location = (0, 0, 0)
    shadow_states = {}
    for obj in collection.all_objects:
        if obj.name.startswith("Contact_Shadow"):
            shadow_states[obj.name] = obj.hide_render
            obj.hide_render = True
    bpy.context.view_layer.update()

    zmin, zmax = camera_depth_range(collection, camera)
    bpy.context.view_layer.use_pass_z = True
    group = bpy.data.node_groups.new(f"{name}_Depth", "CompositorNodeTree")
    scene.compositing_node_group = group
    nodes, links = group.nodes, group.links
    layers = nodes.new("CompositorNodeRLayers")
    mapper = nodes.new("ShaderNodeMapRange")
    mapper.clamp = True
    mapper.inputs["From Min"].default_value = zmin
    mapper.inputs["From Max"].default_value = zmax
    mapper.inputs["To Min"].default_value = 1.0
    mapper.inputs["To Max"].default_value = 0.0
    multiply = nodes.new("ShaderNodeMath")
    multiply.operation = "MULTIPLY"
    output = nodes.new("NodeGroupOutput")
    group.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")
    links.new(layers.outputs["Depth"], mapper.inputs["Value"])
    links.new(layers.outputs["Alpha"], multiply.inputs[1])
    links.new(mapper.outputs["Result"], multiply.inputs[0])
    links.new(multiply.outputs[0], output.inputs["Image"])

    scene.render.resolution_x = 256
    scene.render.resolution_y = 256
    camera.data.ortho_scale = S.PROP_ORTHO_SCALE
    camera.data.shift_x = 0
    target_ground = (0.5 - S.PROP_BOTTOM_RATIO) * S.PROP_ORTHO_SCALE
    camera.data.shift_y = -target_ground / S.PROP_ORTHO_SCALE
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "BW"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = False
    scene.view_settings.view_transform = "Raw"
    try:
        scene.view_settings.look = "None"
    except TypeError:
        pass
    scene.view_settings.exposure = 0
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    scene.compositing_node_group = None
    bpy.data.node_groups.remove(group)
    for obj in collection.all_objects:
        if obj.name in shadow_states:
            obj.hide_render = shadow_states[obj.name]
    root.location = arranged


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    MODEL_OUT.mkdir(parents=True, exist_ok=True)
    DEPTH_OUT.mkdir(parents=True, exist_ok=True)
    S.clear_scene()
    S.setup_materials()
    setup_materials()
    scene, camera = setup_scene()
    builders = [snow_clods, ice_pebbles, frost_stones, broken_ice_slab, wind_snow_ridge,
                refrozen_shards, frozen_grass, frost_heather, twig_bundle, dead_root,
                bark_pinecones, animal_bones, antler_fragment, frozen_tracks, broken_chain,
                rope_coil, torn_cloth, broken_lantern]
    names = [builder() for builder in builders]
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))

    # Render all beauty sprites first because depth rendering switches the scene
    # to Raw/BW.  Every prop retains the same camera and apparent scale.
    for name in names:
        S.render_model(name, MODEL_OUT / f"{name}.png", "prop", scene, camera)
    for name in names:
        render_depth(name, DEPTH_OUT / f"{name}_depth.png", scene, camera)

    manifest = {
        "version": 1,
        "stage": "model and Dev-Depth control candidates; not installed into runtime",
        "camera": {
            "projection": "orthographic",
            "elevationDegrees": S.CAMERA_ELEVATION_DEG,
            "modelRootRotationZDegrees": S.ROOT_ROTATION_DEG,
            "propOrthoScale": S.PROP_ORTHO_SCALE,
            "propBottomRatio": S.PROP_BOTTOM_RATIO,
            "resolution": [256, 256],
        },
        "sharedUse": {
            "scene9FrozenPlane": "natural props use higher weights; human remnants remain rare",
            "frozenDungeons": "human remnants and broken equipment use higher weights",
            "collision": "none; visual-only floor-baked decoration",
            "runtimeGate": "requires explicit visual approval before assets/config integration",
        },
        "props": [
            {
                "key": key,
                "labelZh": label,
                "planeWeight": plane_weight,
                "dungeonWeight": dungeon_weight,
                "modelRender": f"model-renders/{key}.png",
                "bodyDepth": f"body-depth/{key}_depth.png",
            }
            for key, label, plane_weight, dungeon_weight in PROP_SPECS
        ],
        "blend": str(BLEND_OUT.relative_to(REPO)).replace("\\", "/"),
        "generator": str(Path(__file__).relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Saved editable model: {BLEND_OUT}")
    print(f"Rendered {len(names)} model sprites and Body Depth images to {OUT}")


if __name__ == "__main__":
    main()
