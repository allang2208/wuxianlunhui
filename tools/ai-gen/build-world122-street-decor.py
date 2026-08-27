"""Build the World-122 street dressing master model and transparent renders.

All geometry uses the settlement asset camera contract: orthographic 30-degree
elevation, camera azimuth 0, and a 44.8-degree model root. Road tiles are
rendered at 2:1 without post-warping; props share one fixed camera scale so
their relative size remains meaningful.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "tools" / "ai-gen" / "_world122_street_decor_20260825"
ROAD_OUT = OUT / "road_frames"
PROP_OUT = OUT / "props"
EDGE_OUT = OUT / "edge_frames"
BLEND_OUT = OUT / "world122_street_decor.blend"

ROOT_ROTATION_DEG = 44.8
CAMERA_ELEVATION_DEG = 30.0
PROP_BOTTOM_RATIO = 0.875
PROP_ORTHO_SCALE = 6.4

MODEL_COLLECTIONS: dict[str, bpy.types.Collection] = {}
MODEL_ROOTS: dict[str, bpy.types.Object] = {}
MATERIALS: dict[str, bpy.types.Material] = {}
ACTIVE_COLLECTION: bpy.types.Collection | None = None
ACTIVE_ROOT: bpy.types.Object | None = None


def principled_bsdf(mat: bpy.types.Material):
    named = mat.node_tree.nodes.get("Principled BSDF")
    if named is not None:
        return named
    return next((node for node in mat.node_tree.nodes if node.type == "BSDF_PRINCIPLED"), None)


def clear_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        bpy.data.collections.remove(collection)
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)


def material(name: str, color: tuple[float, float, float], roughness=0.75,
             metallic=0.0, alpha=1.0) -> bpy.types.Material:
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = principled_bsdf(mat)
    if bsdf is None:
        raise RuntimeError(f"No Principled BSDF node in material {name}")
    bsdf.inputs["Base Color"].default_value = (*color, alpha)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    bsdf.inputs["Alpha"].default_value = alpha
    mat.diffuse_color = (*color, alpha)
    if alpha < 1.0:
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "DITHERED"
        elif hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
        if hasattr(mat, "use_transparency_overlap"):
            mat.use_transparency_overlap = False
    MATERIALS[name] = mat
    return mat


def emissive_material(name: str, color: tuple[float, float, float], strength=2.0,
                      roughness=0.3, alpha=1.0) -> bpy.types.Material:
    mat = material(name, color, roughness=roughness, alpha=alpha)
    bsdf = principled_bsdf(mat)
    for input_name in ("Emission Color", "Emission"):
        socket = bsdf.inputs.get(input_name)
        if socket is not None:
            socket.default_value = (*color, alpha)
            break
    socket = bsdf.inputs.get("Emission Strength")
    if socket is not None:
        socket.default_value = strength
    return mat


def setup_materials() -> None:
    material("road_mortar", (0.245, 0.225, 0.195), 0.98)
    material("road_base", (0.47, 0.43, 0.36), 0.96)
    for index, color in enumerate([
        (0.63, 0.59, 0.51), (0.57, 0.54, 0.47), (0.68, 0.64, 0.56),
        (0.52, 0.49, 0.43), (0.61, 0.56, 0.48), (0.71, 0.67, 0.59),
    ]):
        material(f"road_stone_{index}", color, 0.94)
    material("road_repair", (0.38, 0.36, 0.33), 0.97)
    material("road_crack", (0.10, 0.085, 0.07), 1.0)
    material("road_dust", (0.47, 0.36, 0.22), 1.0, alpha=0.34)
    material("road_anchor", (0.0, 0.0, 0.0), 1.0, alpha=0.0)
    material("gutter_dark", (0.17, 0.155, 0.13), 1.0)

    material("wood", (0.30, 0.18, 0.10), 0.9)
    material("wood_light", (0.43, 0.28, 0.15), 0.88)
    material("wood_dark", (0.16, 0.09, 0.05), 0.95)
    material("iron", (0.17, 0.19, 0.19), 0.68, 0.28)
    material("iron_dark", (0.075, 0.085, 0.085), 0.72, 0.35)
    material("brass", (0.47, 0.32, 0.10), 0.56, 0.38)
    material("clay", (0.48, 0.25, 0.14), 0.92)
    material("clay_light", (0.61, 0.36, 0.20), 0.9)
    material("linen", (0.67, 0.61, 0.48), 0.98)
    material("linen_dark", (0.47, 0.40, 0.30), 0.98)
    material("cloth_red", (0.36, 0.10, 0.075), 0.92)
    material("hay", (0.59, 0.43, 0.17), 0.98)
    material("twine", (0.24, 0.16, 0.08), 1.0)
    material("coal", (0.035, 0.04, 0.045), 0.84, 0.12)
    material("produce_red", (0.45, 0.10, 0.06), 0.82)
    material("produce_green", (0.19, 0.31, 0.10), 0.9)
    material("produce_gold", (0.55, 0.34, 0.07), 0.86)
    material("mud_mark", (0.19, 0.145, 0.09), 1.0, alpha=0.78)
    material("water_mark", (0.15, 0.22, 0.24), 0.46, metallic=0.05, alpha=0.62)
    material("oil_mark", (0.045, 0.052, 0.048), 0.58, metallic=0.12, alpha=0.82)
    material("stone_dark", (0.27, 0.28, 0.27), 0.96)
    material("glass_warm", (0.93, 0.58, 0.18), 0.34, metallic=0.0, alpha=0.82)
    emissive_material("glass_lit", (1.0, 0.53, 0.08), strength=4.5,
                      roughness=0.22, alpha=0.92)
    emissive_material("lantern_core", (1.0, 0.72, 0.22), strength=8.0,
                      roughness=0.18, alpha=0.96)
    material("rain_water", (0.12, 0.22, 0.27), 0.20, metallic=0.18, alpha=0.64)
    material("rain_reflection", (0.62, 0.72, 0.70), 0.12, metallic=0.08, alpha=0.28)
    material("shadow", (0.045, 0.038, 0.03), 1.0, alpha=0.18)


def move_to_active(obj: bpy.types.Object) -> bpy.types.Object:
    assert ACTIVE_COLLECTION is not None
    for collection in list(obj.users_collection):
        collection.objects.unlink(obj)
    ACTIVE_COLLECTION.objects.link(obj)
    obj.parent = ACTIVE_ROOT
    return obj


def apply_dimensions(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.select_set(False)


def add_bevel(obj: bpy.types.Object, width=0.04, segments=2) -> None:
    if width <= 0:
        return
    modifier = obj.modifiers.new("Soft worn edges", "BEVEL")
    modifier.width = width
    modifier.segments = segments


def box(name, loc, dims, mat, rotation=(0, 0, 0), bevel=0.04):
    bpy.ops.mesh.primitive_cube_add(location=loc, rotation=rotation)
    obj = move_to_active(bpy.context.object)
    obj.name = name
    obj.dimensions = dims
    apply_dimensions(obj)
    add_bevel(obj, bevel)
    obj.data.materials.append(MATERIALS[mat])
    return obj


def cylinder(name, loc, radius, depth, mat, rotation=(0, 0, 0), vertices=16,
             scale=(1, 1, 1), bevel=0.025):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth,
                                       location=loc, rotation=rotation)
    obj = move_to_active(bpy.context.object)
    obj.name = name
    obj.scale = scale
    apply_dimensions(obj)
    add_bevel(obj, bevel, 1)
    obj.data.materials.append(MATERIALS[mat])
    return obj


def cone(name, loc, radius1, radius2, depth, mat, rotation=(0, 0, 0), vertices=16):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2,
                                   depth=depth, location=loc, rotation=rotation)
    obj = move_to_active(bpy.context.object)
    obj.name = name
    add_bevel(obj, 0.025, 1)
    obj.data.materials.append(MATERIALS[mat])
    return obj


def sphere(name, loc, scale, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=16, ring_count=8, location=loc)
    obj = move_to_active(bpy.context.object)
    obj.name = name
    obj.scale = scale
    apply_dimensions(obj)
    obj.data.materials.append(MATERIALS[mat])
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    return obj


def torus(name, loc, major_radius, minor_radius, mat, rotation=(0, 0, 0)):
    bpy.ops.mesh.primitive_torus_add(major_radius=major_radius, minor_radius=minor_radius,
                                    major_segments=20, minor_segments=6,
                                    location=loc, rotation=rotation)
    obj = move_to_active(bpy.context.object)
    obj.name = name
    obj.data.materials.append(MATERIALS[mat])
    return obj


def curve(name, points, radius, mat, cyclic=False):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 1
    data.bevel_depth = radius
    data.bevel_resolution = 1
    spline = data.splines.new("POLY")
    spline.points.add(len(points) - 1)
    for point, value in zip(spline.points, points):
        point.co = (*value, 1.0)
    spline.use_cyclic_u = cyclic
    obj = bpy.data.objects.new(name, data)
    assert ACTIVE_COLLECTION is not None
    ACTIVE_COLLECTION.objects.link(obj)
    obj.parent = ACTIVE_ROOT
    obj.data.materials.append(MATERIALS[mat])
    return obj


def new_model(name: str, arranged_location: tuple[float, float, float]):
    global ACTIVE_COLLECTION, ACTIVE_ROOT
    collection = bpy.data.collections.new(name)
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new(f"{name}_Root_44_8deg", None)
    collection.objects.link(root)
    root.rotation_euler.z = math.radians(ROOT_ROTATION_DEG)
    root.location = arranged_location
    ACTIVE_COLLECTION = collection
    ACTIVE_ROOT = root
    MODEL_COLLECTIONS[name] = collection
    MODEL_ROOTS[name] = root
    return collection, root


def add_shadow(width=2.1, depth=1.2, z=0.012):
    cylinder("Contact_Shadow", (0, 0, z), 1.0, 0.014, "shadow", vertices=32,
             scale=(width / 2, depth / 2, 1), bevel=0)


def add_crate(name, loc, dims=(1.15, 0.85, 0.85), mat="wood_light"):
    x, y, z = loc
    w, d, h = dims
    box(f"{name}_Body", (x, y, z + h / 2), dims, mat, bevel=0.035)
    slat = 0.075
    for sx in (-w / 2 + slat, w / 2 - slat):
        box(f"{name}_FrontBand", (x + sx, y - d / 2 - 0.012, z + h / 2),
            (slat, 0.055, h * 0.9), "wood_dark", bevel=0.01)
    for sz in (z + slat, z + h - slat):
        box(f"{name}_HorizontalBand", (x, y - d / 2 - 0.015, sz),
            (w * 0.9, 0.06, slat), "wood_dark", bevel=0.01)


def add_sack(name, loc, scale=(0.48, 0.36, 0.62), mat="linen"):
    x, y, z = loc
    sphere(f"{name}_Body", (x, y, z + scale[2] * 0.9), scale, mat)
    cylinder(f"{name}_Neck", (x, y, z + scale[2] * 1.72), scale[0] * 0.20,
             scale[2] * 0.24, mat, vertices=10, bevel=0.015)
    torus(f"{name}_Tie", (x, y, z + scale[2] * 1.66), scale[0] * 0.23,
          scale[0] * 0.035, "twine")


def add_basket(name, loc, scale=1.0, produce=False):
    x, y, z = loc
    cone(f"{name}_Body", (x, y, z + 0.28 * scale), 0.40 * scale,
         0.50 * scale, 0.52 * scale, "wood_light", vertices=18)
    torus(f"{name}_Rim", (x, y, z + 0.55 * scale), 0.47 * scale,
          0.045 * scale, "wood_dark")
    curve(f"{name}_Handle", [
        (x - 0.43 * scale, y, z + 0.52 * scale),
        (x - 0.25 * scale, y, z + 0.88 * scale),
        (x, y, z + 1.02 * scale),
        (x + 0.25 * scale, y, z + 0.88 * scale),
        (x + 0.43 * scale, y, z + 0.52 * scale),
    ], 0.035 * scale, "wood_dark")
    if produce:
        colors = ["produce_red", "produce_green", "produce_gold"]
        for index, (dx, dy) in enumerate([(-0.2, -0.05), (0.05, 0.02), (0.22, -0.02), (-0.02, 0.18)]):
            sphere(f"{name}_Produce_{index}",
                   (x + dx * scale, y + dy * scale, z + 0.62 * scale),
                   (0.13 * scale,) * 3, colors[index % len(colors)])


def add_wheel(name, loc, radius=0.48, width=0.12):
    cylinder(f"{name}_Tire", loc, radius, width, "wood_dark",
             rotation=(math.radians(90), 0, 0), vertices=16, bevel=0.02)
    cylinder(f"{name}_Hub", loc, radius * 0.20, width * 1.35, "iron",
             rotation=(math.radians(90), 0, 0), vertices=12, bevel=0.015)
    x, y, z = loc
    for angle in range(0, 180, 45):
        rad = math.radians(angle)
        box(f"{name}_Spoke", (x, y, z),
            (radius * 1.45, width * 0.35, 0.045), "wood_light",
            rotation=(0, rad, 0), bevel=0.008)


def build_road_variant(index: int):
    name = f"road_variant_{index:02d}"
    new_model(name, ((index % 4) * 6.0, 18.0 + (index // 4) * 6.0, 0))
    box(f"{name}_Base", (0, 0, 0.02), (4.0, 4.0, 0.08), "road_mortar", bevel=0)
    row_height = 0.8
    brick_width = 0.8
    for row in range(5):
        y0 = -2.0 + row * row_height
        shift = brick_width / 2 if row % 2 else 0.0
        col = -4
        while col < 8:
            x0 = col * brick_width + shift
            left = max(-2.0, x0)
            right = min(2.0, x0 + brick_width)
            if right - left > 0.08:
                tone = (index * 5 + row * 3 + col) % 6
                mat = f"road_stone_{tone}"
                if index >= 10 and ((row == 1 and col in (0, 1)) or (row == 3 and col == 2)):
                    mat = "road_repair"
                box(f"{name}_Paver_{row}_{col}",
                    ((left + right) / 2, y0 + row_height / 2, 0.095),
                    (max(0.02, right - left - 0.045), row_height - 0.045, 0.105),
                    mat, bevel=0.025)
            col += 1
    if 4 <= index <= 7:
        patches = [(-0.95, 0.65, 1.15, 0.48), (0.82, -0.78, 0.85, 0.36)]
        for patch_index, (x, y, w, d) in enumerate(patches[:1 + (index % 2)]):
            cylinder(f"{name}_Dust_{patch_index}", (x, y, 0.165), 1, 0.012,
                     "road_dust", vertices=24, scale=(w / 2, d / 2, 1), bevel=0)
    if index in (8, 9):
        crack_sets = [
            [(-1.2, 0.9, 0.18), (-0.55, 0.35, 0.17), (-0.18, -0.28, 0.17), (0.55, -0.75, 0.17)],
            [(0.95, 1.25, 0.18), (0.50, 0.52, 0.17), (0.22, -0.10, 0.17), (-0.42, -0.82, 0.17)],
        ]
        curve(f"{name}_Crack", crack_sets[index - 8], 0.035, "road_crack")


def build_housing_jars():
    new_model("street_housing_jars", (-12, 6, 0)); add_shadow(2.0, 1.2)
    for index, (x, y, s, mat) in enumerate([(-0.55, 0.08, 0.75, "clay"),
                                             (0.10, -0.05, 0.9, "clay_light"),
                                             (0.62, 0.12, 0.62, "clay")]):
        sphere(f"Jar_{index}_Body", (x, y, 0.45 * s), (0.36 * s, 0.36 * s, 0.52 * s), mat)
        cylinder(f"Jar_{index}_Neck", (x, y, 0.94 * s), 0.16 * s, 0.22 * s, mat, vertices=14)
        torus(f"Jar_{index}_Rim", (x, y, 1.07 * s), 0.18 * s, 0.035 * s, "clay")


def build_housing_firewood():
    new_model("street_housing_firewood", (-4, 6, 0)); add_shadow(2.5, 1.25)
    positions = [(-0.58, -0.22, 0.22), (0.05, -0.20, 0.22), (0.66, -0.18, 0.22),
                 (-0.30, 0.12, 0.52), (0.34, 0.13, 0.52)]
    for index, pos in enumerate(positions):
        cylinder(f"Log_{index}", pos, 0.18, 1.1, "wood_light",
                 rotation=(0, math.radians(90), 0), vertices=12)
        cylinder(f"Log_End_{index}", (pos[0] + 0.56, pos[1], pos[2]), 0.145, 0.018,
                 "wood_dark", rotation=(0, math.radians(90), 0), vertices=12, bevel=0)
    cylinder("Chopping_Block", (-0.85, 0.34, 0.28), 0.32, 0.55, "wood", vertices=14)


def build_housing_basket_stool():
    new_model("street_housing_basket_stool", (4, 6, 0)); add_shadow(2.2, 1.3)
    add_basket("House_Basket", (-0.45, -0.05, 0), 0.92)
    cylinder("Stool_Seat", (0.56, 0.12, 0.82), 0.46, 0.16, "wood_light", vertices=14)
    for index, (x, y) in enumerate([(0.30, -0.08), (0.78, -0.05), (0.55, 0.38)]):
        cylinder(f"Stool_Leg_{index}", (x, y, 0.39), 0.07, 0.78, "wood_dark", vertices=10)


def build_housing_wash():
    new_model("street_housing_wash", (12, 6, 0)); add_shadow(2.3, 1.35)
    cone("Wash_Basin", (-0.25, 0, 0.28), 0.68, 0.82, 0.48, "wood_light", vertices=18)
    torus("Wash_Basin_Rim", (-0.25, 0, 0.54), 0.76, 0.06, "iron")
    box("Folded_Linen_A", (0.63, 0.02, 0.20), (0.70, 0.52, 0.18), "linen", bevel=0.035)
    box("Folded_Linen_B", (0.63, 0.02, 0.39), (0.62, 0.46, 0.16), "cloth_red", bevel=0.03)


def build_agri_grain_sacks():
    new_model("street_agri_grain_sacks", (-12, -2, 0)); add_shadow(2.5, 1.5)
    add_sack("Grain_A", (-0.58, 0.02, 0), (0.52, 0.40, 0.70))
    add_sack("Grain_B", (0.16, -0.10, 0), (0.58, 0.43, 0.78), "linen_dark")
    add_sack("Grain_C", (0.68, 0.22, 0), (0.42, 0.34, 0.58))


def build_agri_produce_baskets():
    new_model("street_agri_produce_baskets", (-4, -2, 0)); add_shadow(2.5, 1.5)
    add_basket("Produce_Basket_A", (-0.48, -0.04, 0), 1.0, True)
    add_basket("Produce_Basket_B", (0.55, 0.12, 0), 0.82, True)


def build_agri_hay_bundle():
    new_model("street_agri_hay_bundle", (4, -2, 0)); add_shadow(2.6, 1.45)
    box("Hay_Bale_A", (-0.42, 0, 0.40), (1.45, 0.78, 0.78), "hay", bevel=0.12)
    box("Hay_Bale_B", (0.72, 0.08, 0.32), (0.86, 0.70, 0.62), "hay", bevel=0.10)
    for x in (-0.75, -0.10, 0.50, 0.92):
        curve("Hay_Twine", [(x, -0.43, 0.22), (x, -0.43, 0.78)], 0.025, "twine")


def build_agri_handcart():
    new_model("street_agri_handcart", (12, -2, 0)); add_shadow(3.0, 1.6)
    box("Cart_Bed", (0, 0, 0.72), (1.55, 0.92, 0.20), "wood_light", bevel=0.04)
    box("Cart_Back", (-0.66, 0, 1.10), (0.16, 0.92, 0.72), "wood", bevel=0.04)
    for y in (-0.47, 0.47):
        box("Cart_Side", (0, y, 1.02), (1.42, 0.10, 0.56), "wood", bevel=0.035)
        box("Cart_Handle", (1.38, y * 0.82, 0.73), (1.55, 0.075, 0.075), "wood_dark", bevel=0.018)
    add_wheel("Cart_Wheel", (-0.26, -0.56, 0.52), 0.52, 0.16)


def build_gold_sealed_crates():
    new_model("street_gold_sealed_crates", (-12, -10, 0)); add_shadow(2.6, 1.5)
    add_crate("Gold_Crate_A", (-0.42, 0.02, 0), (1.18, 0.88, 0.88))
    add_crate("Gold_Crate_B", (0.62, 0.12, 0), (0.86, 0.66, 0.68), "wood")
    box("Crate_Seal", (-0.42, -0.47, 0.51), (0.28, 0.035, 0.28), "brass", bevel=0.03)


def build_gold_parcels():
    new_model("street_gold_parcels", (-4, -10, 0)); add_shadow(2.5, 1.4)
    parcels = [(-0.52, 0.02, 0.24, (0.9, 0.62, 0.48)),
               (0.35, -0.05, 0.31, (0.76, 0.72, 0.62)),
               (0.08, 0.15, 0.76, (0.65, 0.48, 0.42))]
    for index, (x, y, z, dims) in enumerate(parcels):
        box(f"Parcel_{index}", (x, y, z), dims, "linen_dark", bevel=0.05)
        box(f"Parcel_{index}_BandX", (x, y - dims[1] / 2 - 0.012, z),
            (0.06, 0.04, dims[2] * 1.02), "twine", bevel=0.008)
        box(f"Parcel_{index}_BandZ", (x, y - dims[1] / 2 - 0.014, z),
            (dims[0] * 0.95, 0.04, 0.06), "twine", bevel=0.008)


def build_gold_notice_board():
    new_model("street_gold_notice_board", (4, -10, 0)); add_shadow(2.2, 1.25)
    for x in (-0.62, 0.62):
        box("Notice_Post", (x, 0, 1.25), (0.16, 0.18, 2.5), "wood_dark", bevel=0.025)
    box("Notice_Board", (0, -0.02, 1.65), (1.65, 0.16, 1.12), "wood_light", bevel=0.055)
    torus("Notice_Emblem", (0, -0.115, 1.72), 0.28, 0.055, "brass",
          rotation=(math.radians(90), 0, 0))
    box("Notice_Roof", (0, 0, 2.32), (1.92, 0.34, 0.16), "wood", bevel=0.04)


def build_gold_scale_crate():
    new_model("street_gold_scale_crate", (12, -10, 0)); add_shadow(2.5, 1.5)
    add_crate("Scale_Crate", (0, 0, 0), (1.35, 0.92, 0.72))
    cylinder("Scale_Stand", (0, -0.02, 1.35), 0.065, 1.25, "brass", vertices=12)
    box("Scale_Beam", (0, -0.02, 1.92), (1.42, 0.07, 0.08), "brass", bevel=0.02)
    for index, x in enumerate((-0.60, 0.60)):
        curve(f"Scale_Chain_{index}", [(x, -0.02, 1.91), (x, -0.02, 1.48)], 0.018, "iron")
        cone(f"Scale_Pan_{index}", (x, -0.02, 1.42), 0.31, 0.18, 0.10, "brass", vertices=16)


def build_energy_coal_sacks():
    new_model("street_energy_coal_sacks", (-12, -18, 0)); add_shadow(2.6, 1.5)
    add_sack("Coal_Sack_A", (-0.48, 0.0, 0), (0.58, 0.43, 0.70), "linen_dark")
    add_sack("Coal_Sack_B", (0.42, 0.10, 0), (0.54, 0.40, 0.64), "linen")
    for index, (x, y, z, s) in enumerate([(-0.72, -0.25, 0.18, 0.18), (-0.16, -0.32, 0.16, 0.14),
                                            (0.58, -0.27, 0.16, 0.16), (0.84, -0.10, 0.12, 0.12)]):
        sphere(f"Coal_Lump_{index}", (x, y, z), (s, s * 0.8, s * 0.72), "coal")


def build_energy_pipe_stack():
    new_model("street_energy_pipe_stack", (-4, -18, 0)); add_shadow(2.9, 1.5)
    positions = [(-0.46, -0.12, 0.26), (0.25, -0.12, 0.26), (-0.10, 0.12, 0.72)]
    for index, (x, y, z) in enumerate(positions):
        cylinder(f"Pipe_{index}", (x, y, z), 0.25, 1.55, "iron",
                 rotation=(0, math.radians(90), 0), vertices=16)
        cylinder(f"Pipe_Open_{index}", (x + 0.79, y, z), 0.19, 0.02, "iron_dark",
                 rotation=(0, math.radians(90), 0), vertices=16, bevel=0)


def build_energy_gear_crate():
    new_model("street_energy_gear_crate", (4, -18, 0)); add_shadow(2.6, 1.5)
    add_crate("Gear_Crate", (-0.35, 0.04, 0), (1.20, 0.86, 0.78))
    torus("Gear_Ring", (0.58, -0.10, 0.72), 0.48, 0.09, "iron",
          rotation=(math.radians(90), 0, 0))
    for index in range(8):
        angle = math.radians(index * 45)
        x = 0.58 + math.cos(angle) * 0.55
        z = 0.72 + math.sin(angle) * 0.55
        box(f"Gear_Tooth_{index}", (x, -0.10, z), (0.22, 0.18, 0.16), "iron",
            rotation=(0, angle, 0), bevel=0.02)
    cylinder("Gear_Hub", (0.58, -0.20, 0.72), 0.14, 0.22, "brass",
             rotation=(math.radians(90), 0, 0), vertices=14)


def build_energy_tool_trolley():
    new_model("street_energy_tool_trolley", (12, -18, 0)); add_shadow(2.9, 1.5)
    box("Trolley_Base", (0, 0, 0.52), (1.55, 0.82, 0.18), "iron", bevel=0.04)
    box("Trolley_Box", (-0.18, 0, 0.94), (1.10, 0.70, 0.64), "wood_dark", bevel=0.05)
    for x in (-0.63, 0.63):
        for y in (-0.43, 0.43):
            cylinder("Trolley_Wheel", (x, y, 0.27), 0.22, 0.11, "iron_dark",
                     rotation=(math.radians(90), 0, 0), vertices=12)
    curve("Trolley_Handle", [(0.55, 0.32, 0.65), (0.95, 0.32, 1.02), (1.10, 0.32, 1.55)],
          0.055, "iron")
    box("Trolley_Hammer_Head", (-0.12, -0.42, 1.42), (0.50, 0.16, 0.18), "iron", bevel=0.03)
    cylinder("Trolley_Hammer_Handle", (-0.12, -0.42, 1.12), 0.045, 0.72, "wood_light", vertices=10)


def build_trace_footprints():
    new_model("street_trace_footprints", (-12, -26, 0))
    steps = [(-0.82, -0.40, -18), (-0.48, -0.08, 12), (-0.16, 0.18, -16),
             (0.22, 0.46, 14), (0.58, 0.68, -12)]
    for index, (x, y, angle) in enumerate(steps):
        cylinder(f"Footprint_{index}_Heel", (x, y, 0.026), 1.0, 0.025, "mud_mark",
                 vertices=16, scale=(0.13, 0.22, 1), bevel=0)
        cylinder(f"Footprint_{index}_Toe", (x + 0.04, y + 0.12, 0.028), 1.0, 0.026,
                 "mud_mark", rotation=(0, 0, math.radians(angle)), vertices=16,
                 scale=(0.17, 0.24, 1), bevel=0)


def build_trace_cart_ruts():
    new_model("street_trace_cart_ruts", (-4, -26, 0))
    for offset in (-0.48, 0.48):
        curve("Cart_Rut", [(-1.48, offset - 0.10, 0.035), (-0.62, offset + 0.03, 0.035),
                           (0.18, offset - 0.04, 0.035), (1.48, offset + 0.08, 0.035)],
              0.055, "mud_mark")


def build_trace_straw_scatter():
    new_model("street_trace_straw_scatter", (4, -26, 0))
    strands = [(-1.1, -0.45, 22), (-0.78, 0.18, -17), (-0.38, -0.08, 38),
               (0.02, 0.42, -28), (0.38, -0.36, 12), (0.72, 0.06, 34),
               (1.02, 0.40, -15), (0.22, 0.02, -42), (-0.66, 0.50, 6)]
    for index, (x, y, angle) in enumerate(strands):
        box(f"Straw_{index}", (x, y, 0.042), (0.58, 0.045, 0.035), "hay",
            rotation=(0, 0, math.radians(angle)), bevel=0.01)


def build_trace_water_spill():
    new_model("street_trace_water_spill", (12, -26, 0))
    for index, (x, y, sx, sy) in enumerate([(-0.35, 0.04, 0.92, 0.48),
                                             (0.42, 0.14, 0.72, 0.38),
                                             (0.10, -0.28, 0.54, 0.27)]):
        cylinder(f"Water_Spill_{index}", (x, y, 0.028 + index * 0.002), 1.0, 0.022,
                 "water_mark", vertices=24, scale=(sx, sy, 1), bevel=0)


def build_trace_coal_smear():
    new_model("street_trace_coal_smear", (-12, -34, 0))
    for index, (x, y, sx, sy) in enumerate([(-0.38, 0.05, 0.92, 0.46),
                                             (0.50, -0.02, 0.62, 0.30)]):
        cylinder(f"Coal_Smear_{index}", (x, y, 0.026), 1.0, 0.022, "oil_mark",
                 vertices=20, scale=(sx, sy, 1), bevel=0)
    for index, (x, y, s) in enumerate([(-0.82, -0.32, 0.13), (-0.18, 0.34, 0.10),
                                        (0.62, 0.28, 0.14), (0.92, -0.20, 0.09)]):
        sphere(f"Coal_Fragment_{index}", (x, y, s * 0.55), (s, s * 0.76, s * 0.48), "coal")


def build_trace_oil_drips():
    new_model("street_trace_oil_drips", (-4, -34, 0))
    drops = [(-0.72, -0.20, 0.26, 0.18), (-0.28, 0.16, 0.18, 0.13),
             (0.12, -0.05, 0.38, 0.24), (0.58, 0.22, 0.17, 0.12),
             (0.82, -0.28, 0.24, 0.15)]
    for index, (x, y, sx, sy) in enumerate(drops):
        cylinder(f"Oil_Drip_{index}", (x, y, 0.028), 1.0, 0.022, "oil_mark",
                 vertices=20, scale=(sx, sy, 1), bevel=0)


def build_trace_wood_chips():
    new_model("street_trace_wood_chips", (4, -34, 0))
    chips = [(-0.84, -0.22, 12, 0.42), (-0.48, 0.26, -34, 0.35),
             (-0.10, -0.04, 28, 0.48), (0.28, 0.34, 7, 0.31),
             (0.56, -0.30, -20, 0.43), (0.88, 0.12, 38, 0.28),
             (0.12, -0.46, -8, 0.30)]
    for index, (x, y, angle, length) in enumerate(chips):
        box(f"Wood_Chip_{index}", (x, y, 0.05), (length, 0.08, 0.055), "wood_light",
            rotation=(0, 0, math.radians(angle)), bevel=0.018)


def build_trace_rope_scraps():
    new_model("street_trace_rope_scraps", (12, -34, 0))
    curve("Rope_Scrap_A", [(-1.0, -0.25, 0.045), (-0.62, 0.10, 0.045),
                           (-0.18, -0.04, 0.045), (0.18, 0.28, 0.045)],
          0.035, "twine")
    curve("Rope_Scrap_B", [(0.26, -0.34, 0.045), (0.58, -0.04, 0.045),
                           (0.96, -0.22, 0.045)], 0.035, "twine")
    torus("Loose_Rope_Coil", (0.72, 0.32, 0.055), 0.30, 0.034, "twine")


def build_fixture_lantern_model(name, arranged_location, lit=False):
    new_model(name, arranged_location); add_shadow(1.3, 1.0)
    cylinder("Lantern_Stone_Base", (0, 0, 0.20), 0.42, 0.40, "stone_dark", vertices=16)
    cylinder("Lantern_Post", (0, 0, 1.65), 0.10, 2.90, "iron_dark", vertices=14)
    box("Lantern_Arm", (0.32, 0, 2.88), (0.72, 0.09, 0.09), "iron", bevel=0.022)
    box("Lantern_Glass", (0.65, -0.015, 2.55), (0.34, 0.31, 0.52),
        "glass_lit" if lit else "glass_warm", bevel=0.025)
    if lit:
        sphere("Lantern_Flame_Core", (0.65, -0.03, 2.53), (0.075, 0.06, 0.15),
               "lantern_core")
    for z in (2.25, 2.85):
        box("Lantern_Frame_Plate", (0.65, 0, z), (0.50, 0.42, 0.08), "brass", bevel=0.018)
    for x in (0.44, 0.86):
        for y in (-0.17, 0.17):
            box("Lantern_Frame_Post", (x, y, 2.55), (0.055, 0.055, 0.60),
                "brass", bevel=0.012)
    cone("Lantern_Cap", (0.65, 0, 2.98), 0.36, 0.10, 0.24, "iron_dark", vertices=8)


def build_fixture_lantern():
    build_fixture_lantern_model("street_fixture_lantern", (-12, -42, 0), lit=False)


def build_fixture_lantern_lit():
    build_fixture_lantern_model("street_fixture_lantern_lit", (-12, -74, 0), lit=True)


def build_weather_puddle(variant, arranged_location):
    name = f"street_weather_puddle_{variant}"
    new_model(name, arranged_location)
    patterns = [
        [(-0.42, -0.02, 1.10, 0.43), (0.52, 0.12, 0.76, 0.31), (0.08, -0.34, 0.52, 0.22)],
        [(-0.62, 0.12, 0.72, 0.33), (0.16, -0.02, 1.04, 0.41), (0.78, -0.20, 0.42, 0.19)],
        [(-0.48, -0.20, 0.58, 0.25), (0.22, 0.16, 0.92, 0.38), (0.83, 0.28, 0.32, 0.15)],
        [(-0.72, -0.05, 0.46, 0.21), (-0.08, 0.18, 0.80, 0.32), (0.68, -0.16, 0.66, 0.27)],
    ][variant]
    for index, (x, y, sx, sy) in enumerate(patterns):
        cylinder(f"Puddle_{index}", (x, y, 0.025 + index * 0.002), 1.0, 0.020,
                 "rain_water", vertices=32, scale=(sx, sy, 1), bevel=0)
    # 短高光薄片与水面同属模型，保证在固定相机下保持正确透视。
    x, y, sx, sy = max(patterns, key=lambda item: item[2])
    box("Puddle_Reflection", (x - sx * 0.15, y - sy * 0.08, 0.045),
        (sx * 0.72, 0.035, 0.015), "rain_reflection",
        rotation=(0, 0, math.radians(8 - variant * 5)), bevel=0.008)


def build_weather_puddles():
    for variant in range(4):
        build_weather_puddle(variant, (-12 + variant * 8, -66, 0))


def build_fixture_water_pump():
    new_model("street_fixture_water_pump", (-4, -42, 0)); add_shadow(2.1, 1.25)
    cylinder("Pump_Stone_Base", (-0.25, 0, 0.18), 0.48, 0.36, "stone_dark", vertices=16)
    cylinder("Pump_Body", (-0.25, 0, 1.15), 0.30, 1.75, "iron", vertices=16)
    cylinder("Pump_Top", (-0.25, 0, 2.06), 0.38, 0.18, "brass", vertices=14)
    curve("Pump_Spout", [(-0.06, -0.04, 1.62), (0.36, -0.04, 1.62),
                         (0.68, -0.04, 1.35)], 0.11, "iron_dark")
    box("Pump_Handle", (-0.50, 0, 2.28), (0.12, 0.12, 1.12), "wood_dark",
        rotation=(0, math.radians(-20), 0), bevel=0.025)
    box("Pump_Trough", (0.72, 0.12, 0.38), (1.15, 0.65, 0.48), "wood_light", bevel=0.08)
    box("Pump_Trough_Interior", (0.72, 0.10, 0.63), (0.88, 0.42, 0.055),
        "iron_dark", bevel=0.025)


def build_fixture_bench():
    new_model("street_fixture_bench", (4, -42, 0)); add_shadow(2.7, 1.3)
    box("Bench_Seat", (0, 0, 0.82), (2.05, 0.56, 0.16), "wood_light", bevel=0.035)
    box("Bench_Back", (0, 0.28, 1.42), (2.05, 0.14, 0.76), "wood", bevel=0.04)
    for x in (-0.76, 0.76):
        box("Bench_Leg", (x, 0, 0.40), (0.16, 0.46, 0.80), "iron_dark", bevel=0.028)
        box("Bench_Back_Brace", (x, 0.22, 1.16), (0.12, 0.14, 0.94), "iron", bevel=0.022)


def build_fixture_fire_bucket_rack():
    new_model("street_fixture_fire_bucket_rack", (12, -42, 0)); add_shadow(2.2, 1.2)
    for x in (-0.72, 0.72):
        box("Fire_Rack_Post", (x, 0, 1.18), (0.14, 0.16, 2.36), "wood_dark", bevel=0.025)
    box("Fire_Rack_Beam", (0, 0, 2.05), (1.70, 0.16, 0.16), "wood", bevel=0.028)
    for index, x in enumerate((-0.42, 0.42)):
        curve(f"Bucket_Hook_{index}", [(x, -0.04, 2.02), (x, -0.04, 1.64)], 0.025, "iron")
        cone(f"Fire_Bucket_{index}", (x, -0.04, 1.28), 0.28, 0.36, 0.56, "cloth_red", vertices=14)
        torus(f"Fire_Bucket_Rim_{index}", (x, -0.04, 1.57), 0.32, 0.035, "iron")


def build_edge_variant(side: str, variant: int, arranged_x: float, arranged_y: float):
    name = f"street_edge_{side}_{variant}"
    new_model(name, (arranged_x, arranged_y, 0))
    # 透明4×4参考体锁定与正式道路完全相同的正交画幅，不参与最终可见像素。
    box(f"{name}_Projection_Anchor", (0, 0, 0.07375), (4.0, 4.0, 0.1475),
        "road_anchor", bevel=0)

    positive = side in ("xp", "yp")
    axis_x = side in ("xp", "xn")
    edge = 1.82 if positive else -1.82
    gutter = 1.52 if positive else -1.52
    tangent_positions = (-1.50, -0.75, 0.0, 0.75, 1.50)
    omitted = {-0.75} if variant == 1 else set()

    if axis_x:
        box(f"{name}_Gutter", (gutter, 0, 0.055), (0.24, 3.74, 0.055),
            "gutter_dark", bevel=0.018)
    else:
        box(f"{name}_Gutter", (0, gutter, 0.055), (3.74, 0.24, 0.055),
            "gutter_dark", bevel=0.018)

    for index, tangent in enumerate(tangent_positions):
        if tangent in omitted:
            continue
        tone = f"road_stone_{(index + variant * 2) % 6}"
        loc = (edge, tangent, 0.14) if axis_x else (tangent, edge, 0.14)
        dims = (0.30, 0.66, 0.18) if axis_x else (0.66, 0.30, 0.18)
        box(f"{name}_Curb_{index}", loc, dims, tone, bevel=0.045)

    if variant == 0:
        tangent = -0.38
        loc = (gutter, tangent, 0.115) if axis_x else (tangent, gutter, 0.115)
        dims = (0.25, 0.58, 0.045) if axis_x else (0.58, 0.25, 0.045)
        box(f"{name}_Drain_Grate", loc, dims, "iron_dark", bevel=0.018)
        for stripe in (-0.16, 0.0, 0.16):
            if axis_x:
                box(f"{name}_Drain_Slot", (gutter - (0.02 if positive else -0.02), tangent + stripe, 0.142),
                    (0.10, 0.035, 0.022), "iron", bevel=0.005)
            else:
                box(f"{name}_Drain_Slot", (tangent + stripe, gutter - (0.02 if positive else -0.02), 0.142),
                    (0.035, 0.10, 0.022), "iron", bevel=0.005)
    else:
        patch_loc = (gutter - (0.08 if positive else -0.08), -0.72, 0.082) if axis_x \
            else (-0.72, gutter - (0.08 if positive else -0.08), 0.082)
        patch_scale = (0.25, 0.48, 1) if axis_x else (0.48, 0.25, 1)
        cylinder(f"{name}_Accumulated_Dirt", patch_loc, 1.0, 0.025, "mud_mark",
                 vertices=20, scale=patch_scale, bevel=0)
        chip_loc = (edge, -0.75, 0.09) if axis_x else (-0.75, edge, 0.09)
        box(f"{name}_Broken_Curb_Chip", chip_loc,
            (0.18, 0.38, 0.10) if axis_x else (0.38, 0.18, 0.10),
            "road_repair", rotation=(0, 0, math.radians(12)), bevel=0.025)


def build_edge_models():
    sides = ("xp", "xn", "yp", "yn")
    for side_index, side in enumerate(sides):
        for variant in range(2):
            build_edge_variant(side, variant, -12 + side_index * 8, -50 - variant * 7)


PROP_BUILDERS = [
    build_housing_jars, build_housing_firewood, build_housing_basket_stool, build_housing_wash,
    build_agri_grain_sacks, build_agri_produce_baskets, build_agri_hay_bundle, build_agri_handcart,
    build_gold_sealed_crates, build_gold_parcels, build_gold_notice_board, build_gold_scale_crate,
    build_energy_coal_sacks, build_energy_pipe_stack, build_energy_gear_crate, build_energy_tool_trolley,
    build_trace_footprints, build_trace_cart_ruts, build_trace_straw_scatter, build_trace_water_spill,
    build_trace_coal_smear, build_trace_oil_drips, build_trace_wood_chips, build_trace_rope_scraps,
    build_fixture_lantern, build_fixture_water_pump, build_fixture_bench, build_fixture_fire_bucket_rack,
    build_fixture_lantern_lit,
]


def setup_scene():
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

    world = bpy.data.worlds.new("World122_Street_Neutral_World")
    world.use_nodes = True
    background = world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.16, 0.17, 0.18, 1)
    background.inputs["Strength"].default_value = 0.72
    scene.world = world

    sun_data = bpy.data.lights.new("Street_Key_Sun", "SUN")
    sun_data.energy = 1.75
    sun_data.angle = math.radians(18)
    sun = bpy.data.objects.new("Street_Key_Sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(42), 0, math.radians(-38))

    fill_data = bpy.data.lights.new("Street_Soft_Fill", "AREA")
    fill_data.energy = 520
    fill_data.shape = "DISK"
    fill_data.size = 7.0
    fill = bpy.data.objects.new("Street_Soft_Fill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (-5.5, -6.5, 10.0)
    fill.rotation_euler = (Vector((0, 0, 1.0)) - fill.location).to_track_quat("-Z", "Y").to_euler()

    camera_data = bpy.data.cameras.new("World122_Street_Ortho_30deg")
    camera_data.type = "ORTHO"
    camera_data.clip_start = 0.01
    camera_data.clip_end = 100.0
    camera = bpy.data.objects.new("World122_Street_Ortho_30deg", camera_data)
    scene.collection.objects.link(camera)
    distance = 18.0
    elevation = math.radians(CAMERA_ELEVATION_DEG)
    camera.location = (0, -distance * math.cos(elevation), distance * math.sin(elevation))
    camera.rotation_euler = (math.radians(90) - elevation, 0, 0)
    scene.camera = camera
    return scene, camera


def collection_camera_bounds(collection, camera):
    bpy.context.view_layer.update()
    inverse = camera.matrix_world.inverted()
    points = []
    for obj in collection.all_objects:
        if obj.type != "MESH" or obj.name == "Contact_Shadow":
            continue
        points.extend(inverse @ (obj.matrix_world @ Vector(corner)) for corner in obj.bound_box)
    return min(p.x for p in points), max(p.x for p in points), min(p.y for p in points), max(p.y for p in points)


def render_model(name, path, kind, scene, camera):
    for collection in MODEL_COLLECTIONS.values():
        collection.hide_render = True
    collection = MODEL_COLLECTIONS[name]
    collection.hide_render = False
    root = MODEL_ROOTS[name]
    arranged = root.location.copy()
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()

    if kind in ("road", "edge"):
        scene.render.resolution_x = 512
        scene.render.resolution_y = 256
        min_x, max_x, min_y, max_y = collection_camera_bounds(collection, camera)
        aspect = scene.render.resolution_x / scene.render.resolution_y
        camera.data.ortho_scale = max((max_y - min_y) / 0.965,
                                     (max_x - min_x) / aspect / 0.965)
        camera.data.shift_x = ((min_x + max_x) / 2) / camera.data.ortho_scale
        camera.data.shift_y = ((min_y + max_y) / 2) / camera.data.ortho_scale
    else:
        scene.render.resolution_x = 256
        scene.render.resolution_y = 256
        camera.data.ortho_scale = PROP_ORTHO_SCALE
        camera.data.shift_x = 0
        target_ground = (0.5 - PROP_BOTTOM_RATIO) * PROP_ORTHO_SCALE
        camera.data.shift_y = -target_ground / PROP_ORTHO_SCALE

    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    root.location = arranged


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    ROAD_OUT.mkdir(parents=True, exist_ok=True)
    PROP_OUT.mkdir(parents=True, exist_ok=True)
    EDGE_OUT.mkdir(parents=True, exist_ok=True)
    clear_scene()
    setup_materials()
    scene, camera = setup_scene()

    for index in range(12):
        build_road_variant(index)
    for builder in PROP_BUILDERS:
        builder()
    build_weather_puddles()
    build_edge_models()

    for collection in MODEL_COLLECTIONS.values():
        collection.hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))

    for index in range(12):
        name = f"road_variant_{index:02d}"
        render_model(name, ROAD_OUT / f"{name}.png", "road", scene, camera)
    edge_names = [name for name in MODEL_COLLECTIONS if name.startswith("street_edge_")]
    prop_names = [name for name in MODEL_COLLECTIONS
                  if name.startswith("street_") and not name.startswith("street_edge_")]
    for name in prop_names:
        render_model(name, PROP_OUT / f"{name}.png", "prop", scene, camera)
    for name in edge_names:
        render_model(name, EDGE_OUT / f"{name}.png", "edge", scene, camera)

    manifest = {
        "version": 4,
        "camera": {
            "projection": "orthographic",
            "elevation": CAMERA_ELEVATION_DEG,
            "azimuth": 0,
            "modelRootRotationZ": ROOT_ROTATION_DEG,
            "roadProjection": "2:1 diamond, no post-warp",
            "propOrthoScale": PROP_ORTHO_SCALE,
            "propBottomRatio": PROP_BOTTOM_RATIO,
        },
        "roads": [f"road_variant_{index:02d}" for index in range(12)],
        "props": prop_names,
        "edges": edge_names,
        "model": str(BLEND_OUT.relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Rendered {len(manifest['roads'])} road frames, {len(prop_names)} props "
          f"and {len(edge_names)} road edges to {OUT}")


if __name__ == "__main__":
    main()
