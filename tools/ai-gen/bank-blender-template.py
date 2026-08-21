#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Build the editable World-122 bank reference model in Blender 5.1.

The source PNG is used only as a design reference. Geometry is rebuilt with the
project camera contract: orthographic, elevation 30 degrees, model rot.z 44.8.

Usage:
    "E:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
      --background --factory-startup --python bank-blender-template.py -- \
      _bank_model/bank_model.json \
      _bank_model/bank_model.blend \
      _bank_model/bank_model_preview.png \
      _bank_model/bank_model_depth.png
"""

import json
import math
import os
import sys

import bpy
import mathutils


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) not in (3, 4):
        raise SystemExit("usage: blender --background --python bank-blender-template.py -- spec.json out.blend preview.png [depth.png]")
    return tuple(os.path.abspath(path) for path in argv)


def rgba(values):
    return tuple(float(v) for v in values)


def set_principled(bsdf, *, color, roughness=0.75, metallic=0.0, emission=None):
    bsdf.inputs["Base Color"].default_value = color
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emission is not None:
        bsdf.inputs["Emission Color"].default_value = emission[0]
        bsdf.inputs["Emission Strength"].default_value = emission[1]


def make_material(name, color, roughness=0.75, metallic=0.0, noise=None, emission=None):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    set_principled(bsdf, color=color, roughness=roughness, metallic=metallic, emission=emission)
    if noise:
        tex = nodes.new("ShaderNodeTexNoise")
        tex.inputs["Scale"].default_value = noise.get("scale", 5.0)
        tex.inputs["Detail"].default_value = noise.get("detail", 3.0)
        tex.inputs["Roughness"].default_value = noise.get("roughness", 0.65)
        ramp = nodes.new("ShaderNodeValToRGB")
        c0 = noise.get("dark", tuple(max(0.0, c * 0.72) for c in color[:3]) + (1.0,))
        c1 = noise.get("light", tuple(min(1.0, c * 1.16) for c in color[:3]) + (1.0,))
        ramp.color_ramp.elements[0].color = c0
        ramp.color_ramp.elements[1].color = c1
        bump = nodes.new("ShaderNodeBump")
        bump.inputs["Strength"].default_value = noise.get("bump", 0.18)
        bump.inputs["Distance"].default_value = noise.get("distance", 0.18)
        links.new(tex.outputs["Fac"], ramp.inputs["Fac"])
        links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
        links.new(tex.outputs["Fac"], bump.inputs["Height"])
        links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def assign_material(obj, material):
    obj.data.materials.append(material)
    return obj


def add_bevel(obj, width=2.0, segments=2):
    if width <= 0:
        return
    modifier = obj.modifiers.new(name="Edge_Soften", type="BEVEL")
    modifier.width = width
    modifier.segments = segments


def add_box(collection, root, name, size, location, material, rotation=(0.0, 0.0, 0.0), bevel=1.5):
    bpy.ops.mesh.primitive_cube_add(size=1)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = tuple(float(v) for v in size)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.parent = root
    obj.location = location
    obj.rotation_euler = tuple(math.radians(v) for v in rotation)
    assign_material(obj, material)
    add_bevel(obj, bevel, 3 if bevel >= 2 else 2)
    move_to_collection(obj, collection)
    return obj


def add_cylinder(collection, root, name, radius, depth, location, material, rotation=(0.0, 0.0, 0.0), vertices=48, bevel=0.8):
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth)
    obj = bpy.context.object
    obj.name = name
    obj.parent = root
    obj.location = location
    obj.rotation_euler = tuple(math.radians(v) for v in rotation)
    assign_material(obj, material)
    add_bevel(obj, bevel, 2)
    move_to_collection(obj, collection)
    return obj


def add_sphere(collection, root, name, radius, location, material):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=32, ring_count=16, radius=radius)
    obj = bpy.context.object
    obj.name = name
    obj.parent = root
    obj.location = location
    assign_material(obj, material)
    move_to_collection(obj, collection)
    return obj


def add_cone(collection, root, name, radius1, radius2, depth, location, material, vertices=32):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius1, radius2=radius2, depth=depth)
    obj = bpy.context.object
    obj.name = name
    obj.parent = root
    obj.location = location
    assign_material(obj, material)
    add_bevel(obj, 0.7, 2)
    move_to_collection(obj, collection)
    return obj


def move_to_collection(obj, collection):
    for old in list(obj.users_collection):
        old.objects.unlink(obj)
    collection.objects.link(obj)


def add_prism(collection, root, name, length, width, height, location, wall_material, roof_material, rotation=(0.0, 0.0, 0.0)):
    l2 = length / 2.0
    w2 = width / 2.0
    verts = [
        (-l2, -w2, 0), (-l2, w2, 0), (-l2, 0, height),
        (l2, -w2, 0), (l2, w2, 0), (l2, 0, height),
    ]
    faces = [
        (0, 2, 1), (3, 4, 5), (0, 1, 4, 3),
        (1, 2, 5, 4), (0, 3, 5, 2),
    ]
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    mesh.materials.append(wall_material)
    mesh.materials.append(roof_material)
    for index, poly in enumerate(mesh.polygons):
        poly.material_index = 1 if index >= 3 else 0
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    obj.location = location
    obj.rotation_euler = tuple(math.radians(v) for v in rotation)
    add_bevel(obj, 1.8, 2)
    return obj


def add_arch(collection, root, name, width, height, depth, location, material, segments=18, bevel=1.2):
    radius = width / 2.0
    spring = height - radius
    outline = [(-radius, 0.0), (radius, 0.0), (radius, spring)]
    for i in range(1, segments):
        theta = math.pi * i / segments
        outline.append((radius * math.cos(theta), spring + radius * math.sin(theta)))
    outline.append((-radius, spring))
    front_y, back_y = -depth / 2.0, depth / 2.0
    verts = [(x, front_y, z) for x, z in outline] + [(x, back_y, z) for x, z in outline]
    count = len(outline)
    faces = [tuple(range(count)), tuple(range(count, count * 2))[::-1]]
    for i in range(count):
        j = (i + 1) % count
        faces.append((i, j, count + j, count + i))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(verts, [], faces)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = root
    obj.location = location
    assign_material(obj, material)
    add_bevel(obj, bevel, 2)
    return obj


def add_front_window(collection, root, name, x, y, z, glass, stone, timber, scale=1.0):
    add_arch(collection, root, name + "_Frame", 54 * scale, 76 * scale, 7, (x, y, z), stone, bevel=1.5)
    add_arch(collection, root, name + "_Glass", 42 * scale, 65 * scale, 4, (x, y - 4.5, z + 4), glass, bevel=0.5)
    add_box(collection, root, name + "_MullionV", (3.5, 4, 57 * scale), (x, y - 7, z + 31 * scale), timber, bevel=0.4)
    add_box(collection, root, name + "_MullionH", (38 * scale, 4, 3.5), (x, y - 7, z + 34 * scale), timber, bevel=0.4)


def add_side_window(collection, root, name, x, y, z, glass, stone, timber, scale=1.0):
    # The arch helper extrudes on local Y; rotate the whole window group geometry by
    # building it on the X wall with box silhouettes for a clean editable profile.
    add_box(collection, root, name + "_Frame", (7, 58 * scale, 78 * scale), (x, y, z + 36 * scale), stone, bevel=3)
    add_box(collection, root, name + "_Glass", (4, 46 * scale, 64 * scale), (x - 4.5, y, z + 36 * scale), glass, bevel=2)
    add_box(collection, root, name + "_MullionV", (3, 3.5, 60 * scale), (x - 7, y, z + 36 * scale), timber, bevel=0.3)
    add_box(collection, root, name + "_MullionH", (3, 42 * scale, 3.5), (x - 7, y, z + 36 * scale), timber, bevel=0.3)


def add_roof_ribs(collection, root, roof_dims, roof_z, bronze):
    length, width, height = roof_dims
    slope = math.sqrt((width / 2.0) ** 2 + height ** 2)
    angle = math.degrees(math.atan2(height, width / 2.0))
    # Thin metal edge caps only; never cover the slate slopes with a broad slab.
    for side in (-1, 1):
        add_box(collection, root, f"Roof_Eave_Cap_{side:+d}", (length + 12, 7, 7), (0, side * width / 2.0, roof_z + 3), bronze, bevel=0.7)
        for end in (-1, 1):
            y = side * width * 0.25
            z = roof_z + height * 0.5 + 2
            rot_x = -side * angle
            add_box(collection, root, f"Roof_Gable_Trim_{end:+d}_{side:+d}", (6, slope + 5, 6), (end * length / 2.0, y, z), bronze, rotation=(rot_x, 0, 0), bevel=0.7)
    add_box(collection, root, "Roof_Ridge_Cap", (length + 18, 7, 8), (0, 0, roof_z + height + 2), bronze, bevel=1.2)


def add_timbers(collection, root, lower, upper, z0, timber):
    body_w, body_d, body_h = upper
    front_y = -body_d / 2.0 - 2.0
    side_x = -body_w / 2.0 - 2.0
    add_box(collection, root, "Timber_Floor_Band_Front", (body_w + 8, 7, 9), (0, front_y, z0), timber, bevel=1)
    add_box(collection, root, "Timber_Floor_Band_Side", (7, body_d + 8, 9), (side_x, 0, z0), timber, bevel=1)
    add_box(collection, root, "Timber_Top_Band_Front", (body_w + 8, 7, 8), (0, front_y, z0 + body_h - 5), timber, bevel=1)
    add_box(collection, root, "Timber_Top_Band_Side", (7, body_d + 8, 8), (side_x, 0, z0 + body_h - 5), timber, bevel=1)
    for x in (-body_w / 2 + 8, -82, 0, 82, body_w / 2 - 8):
        add_box(collection, root, f"Timber_Front_V_{int(x)}", (8, 7, body_h - 10), (x, front_y, z0 + body_h / 2), timber, bevel=0.8)
    for y in (-body_d / 2 + 8, -58, 0, 58, body_d / 2 - 8):
        add_box(collection, root, f"Timber_Side_V_{int(y)}", (7, 8, body_h - 10), (side_x, y, z0 + body_h / 2), timber, bevel=0.8)
    brace_z = z0 + 32
    for x, angle in ((-122, -34), (-42, 34), (42, -34), (122, 34)):
        add_box(collection, root, f"Timber_Front_Brace_{x}", (66, 6, 7), (x, front_y - 1, brace_z), timber, rotation=(0, angle, 0), bevel=0.6)
    for y, angle in ((-90, 34), (-28, -34), (38, 34), (100, -34)):
        add_box(collection, root, f"Timber_Side_Brace_{y}", (6, 66, 7), (side_x - 1, y, brace_z), timber, rotation=(angle, 0, 0), bevel=0.6)


def add_chimney(collection, root, name, x, y, base_z, stone, dark, bronze):
    add_box(collection, root, name + "_Shaft", (34, 34, 128), (x, y, base_z + 64), stone, bevel=2.5)
    add_box(collection, root, name + "_Band", (42, 42, 9), (x, y, base_z + 121), dark, bevel=1.5)
    add_box(collection, root, name + "_Cap", (47, 47, 10), (x, y, base_z + 132), stone, bevel=2)
    add_box(collection, root, name + "_Opening", (24, 24, 12), (x, y, base_z + 141), dark, bevel=1)
    add_sphere(collection, root, name + "_FinialBall", 5.5, (x, y, base_z + 155), bronze)
    add_cone(collection, root, name + "_Finial", 5, 0, 15, (x, y, base_z + 166), bronze)


def add_dormer(collection, root, name, x, y, z, plaster, timber, roof, glass, bronze):
    add_box(collection, root, name + "_Body", (66, 48, 54), (x, y, z + 25), plaster, bevel=2)
    add_prism(collection, root, name + "_Roof", 76, 62, 35, (x, y, z + 50), timber, roof, rotation=(0, 0, 0))
    add_box(collection, root, name + "_Window", (30, 5, 34), (x, y - 26, z + 28), glass, bevel=2)
    add_box(collection, root, name + "_WindowV", (4, 4, 32), (x, y - 29, z + 28), timber, bevel=0.3)
    add_box(collection, root, name + "_WindowH", (28, 4, 4), (x, y - 29, z + 28), timber, bevel=0.3)
    add_box(collection, root, name + "_Ridge", (80, 5, 5), (x, y, z + 86), bronze, bevel=0.5)


def add_vault_emblem(collection, root, radius, y, z, bronze, iron):
    add_cylinder(collection, root, "Vault_Backplate", radius + 8, 6, (0, y, z), iron, rotation=(90, 0, 0), vertices=64, bevel=1.2)
    add_cylinder(collection, root, "Vault_Outer_Ring", radius, 8, (0, y - 5, z), bronze, rotation=(90, 0, 0), vertices=64, bevel=1.3)
    add_cylinder(collection, root, "Vault_Inner_Plate", radius - 8, 10, (0, y - 10, z), iron, rotation=(90, 0, 0), vertices=64, bevel=1.0)
    for index in range(8):
        angle = index * 45.0
        rad = math.radians(angle)
        x = math.cos(rad) * (radius - 11) * 0.55
        zz = z + math.sin(rad) * (radius - 11) * 0.55
        add_box(collection, root, f"Vault_Spoke_{index}", (radius - 9, 5, 4), (x, y - 17, zz), bronze, rotation=(0, angle, 0), bevel=0.5)
    add_cylinder(collection, root, "Vault_Hub", 10, 12, (0, y - 19, z), bronze, rotation=(90, 0, 0), vertices=48, bevel=1)
    for index in range(12):
        angle = 2 * math.pi * index / 12
        add_sphere(collection, root, f"Vault_Rivet_{index}", 1.8, (math.cos(angle) * (radius - 3), y - 20, z + math.sin(angle) * (radius - 3)), bronze)


def add_steps_and_paving(collection, root, foundation, stone, light_stone, dark):
    fw, fd, fh = foundation
    add_box(collection, root, "Paved_Foundation", foundation, (0, 0, fh / 2), stone, bevel=4)
    for i in range(-4, 5):
        add_box(collection, root, f"Paving_Seam_X_{i:+d}", (2, fd - 12, 1.2), (i * 48, 0, fh + 0.8), dark, bevel=0)
    for i in range(-3, 4):
        add_box(collection, root, f"Paving_Seam_Y_{i:+d}", (fw - 12, 2, 1.2), (0, i * 48, fh + 0.8), dark, bevel=0)
    for index in range(4):
        width = 150 - index * 14
        depth = 34
        z = fh + 5 + index * 8
        y = -fd / 2 - 20 + index * 14
        add_box(collection, root, f"Front_Step_{index + 1}", (width, depth, 10), (0, y, z), light_stone, bevel=2)


def build_model(spec):
    palette = {key: rgba(value) for key, value in spec["palette"].items()}
    dims = spec["dimensions"]
    collection = bpy.data.collections.new("BANK_MODEL_EDITABLE")
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new("BANK_ROOT_ROT_Z_44_8", None)
    collection.objects.link(root)
    root.rotation_euler.z = math.radians(float(spec["camera"]["buildingRotationZ"]))

    mats = {
        "stone": make_material("MAT_Stone", palette["stone"], noise={"scale": 4.2, "detail": 4.0, "bump": 0.24}),
        "light_stone": make_material("MAT_Light_Stone", palette["lightStone"], noise={"scale": 5.0, "detail": 3.0, "bump": 0.16}),
        "plaster": make_material("MAT_Plaster", palette["plaster"], noise={"scale": 7.0, "detail": 2.0, "bump": 0.08}),
        "timber": make_material("MAT_Dark_Timber", palette["timber"], roughness=0.78, noise={"scale": 3.0, "detail": 5.0, "bump": 0.2}),
        "roof": make_material("MAT_Blue_Slate_Roof", palette["roofSlate"], roughness=0.72, noise={"scale": 10.0, "detail": 5.0, "bump": 0.28}),
        "bronze": make_material("MAT_Aged_Bronze", palette["bronze"], roughness=0.38, metallic=0.78, noise={"scale": 6.0, "detail": 3.0, "bump": 0.1}),
        "iron": make_material("MAT_Dark_Iron", palette["darkIron"], roughness=0.5, metallic=0.72, noise={"scale": 8.0, "detail": 3.0, "bump": 0.13}),
        "glass": make_material("MAT_Stained_Glass", palette["glassBlue"], roughness=0.25, metallic=0.05, emission=(palette["glassBlue"], 0.45)),
        "moss": make_material("MAT_Moss", palette["moss"], roughness=0.95, noise={"scale": 5.0, "detail": 4.0, "bump": 0.3}),
    }

    foundation = dims["foundation"]
    lower = dims["lowerBody"]
    upper = dims["upperBody"]
    roof = dims["mainRoof"]
    fh = foundation[2]
    lower_z = fh + lower[2] / 2
    upper_base = fh + lower[2]
    upper_z = upper_base + upper[2] / 2
    roof_z = upper_base + upper[2] - 2

    add_steps_and_paving(collection, root, foundation, mats["stone"], mats["light_stone"], mats["iron"])
    add_box(collection, root, "Lower_Stone_Body", lower, (0, 0, lower_z), mats["stone"], bevel=7)
    add_box(collection, root, "Upper_Plaster_Body", upper, (0, 0, upper_z), mats["plaster"], bevel=5)
    add_prism(collection, root, "Main_Gable_Roof", roof[0], roof[1], roof[2], (0, 0, roof_z), mats["timber"], mats["roof"])
    add_roof_ribs(collection, root, roof, roof_z, mats["bronze"])
    add_timbers(collection, root, lower, upper, upper_base, mats["timber"])

    # Front gable and entry block.
    fg = dims["frontGable"]
    add_box(collection, root, "Front_Entry_Block", (fg[0] - 28, 54, 118), (0, -lower[1] / 2 - 17, fh + 60), mats["light_stone"], bevel=4)
    front_gable_y = -lower[1] / 2 - 23
    front_gable_z = fh + 116
    add_prism(collection, root, "Front_Gable_Roof", fg[1], fg[0], fg[2], (0, front_gable_y, front_gable_z), mats["timber"], mats["roof"], rotation=(0, 0, 90))
    add_box(collection, root, "Front_Gable_Ridge", (7, fg[1] + 10, 7), (0, front_gable_y, front_gable_z + fg[2] + 2), mats["bronze"], bevel=1)

    door_w, door_d, door_h = dims["door"]
    front_y = -lower[1] / 2 - 48
    add_arch(collection, root, "Door_Stone_Arch", door_w + 24, door_h + 20, door_d + 7, (0, front_y + 5, fh + 31), mats["light_stone"], bevel=2.2)
    add_arch(collection, root, "Vault_Door", door_w, door_h, door_d, (0, front_y - 5, fh + 33), mats["iron"], bevel=2.0)
    add_box(collection, root, "Door_Center_Band", (7, 7, door_h - 22), (0, front_y - 12, fh + 77), mats["bronze"], bevel=0.8)
    add_box(collection, root, "Door_Cross_Band", (door_w - 12, 7, 7), (0, front_y - 12, fh + 79), mats["bronze"], bevel=0.8)
    add_cylinder(collection, root, "Door_Lock_Wheel", 14, 8, (0, front_y - 17, fh + 79), mats["bronze"], rotation=(90, 0, 0), vertices=48, bevel=1)

    add_front_window(collection, root, "Front_Window_Left", -116, -lower[1] / 2 - 5, fh + 13, mats["glass"], mats["light_stone"], mats["timber"], 1.0)
    add_front_window(collection, root, "Front_Window_Right", 116, -lower[1] / 2 - 5, fh + 13, mats["glass"], mats["light_stone"], mats["timber"], 1.0)
    add_side_window(collection, root, "Side_Window_Front", -lower[0] / 2 - 4, -72, fh + 12, mats["glass"], mats["light_stone"], mats["timber"], 1.0)
    add_side_window(collection, root, "Side_Window_Back", -lower[0] / 2 - 4, 72, fh + 12, mats["glass"], mats["light_stone"], mats["timber"], 1.0)

    emblem_y = front_gable_y - fg[1] / 2 - 6
    emblem_z = front_gable_z + fg[2] * 0.38
    add_vault_emblem(collection, root, min(dims["vaultEmblemRadius"], 27), emblem_y, emblem_z, mats["bronze"], mats["iron"])

    # Dormers and four integrated chimneys; back pieces remain useful when the
    # building is rotated in Blender, while the standard render shows two clearly.
    add_dormer(collection, root, "Dormer_Left", -104, -88, roof_z + 26, mats["plaster"], mats["timber"], mats["roof"], mats["glass"], mats["bronze"])
    add_dormer(collection, root, "Dormer_Right", 104, -88, roof_z + 26, mats["plaster"], mats["timber"], mats["roof"], mats["glass"], mats["bronze"])
    if spec.get("chimneysEnabled", True):
        for name, x, y, z in (
            ("Chimney_FL", -138, -96, roof_z + 58),
            ("Chimney_FR", 138, -96, roof_z + 58),
            ("Chimney_BL", -138, 96, roof_z + 58),
            ("Chimney_BR", 138, 96, roof_z + 58),
        ):
            add_chimney(collection, root, name, x, y, z, mats["stone"], mats["iron"], mats["bronze"])

    # Ridge finials and restrained greenery integrated into the foundation.
    for x in (-roof[0] / 2 + 14, 0, roof[0] / 2 - 14):
        add_sphere(collection, root, f"Ridge_Finial_Ball_{int(x)}", 7, (x, 0, roof_z + roof[2] + 13), mats["bronze"])
        add_cone(collection, root, f"Ridge_Finial_Spire_{int(x)}", 6, 0, 24, (x, 0, roof_z + roof[2] + 28), mats["bronze"])
    for x in (-86, 86):
        add_box(collection, root, f"Planter_{x}", (30, 30, 30), (x, -foundation[1] / 2 - 4, fh + 15), mats["light_stone"], bevel=3)
        add_sphere(collection, root, f"Shrub_{x}", 20, (x, -foundation[1] / 2 - 4, fh + 42), mats["moss"])

    return root, collection


def setup_camera(spec, root):
    camera_cfg = spec["camera"]
    elevation = math.radians(float(camera_cfg["elevation"]))
    azimuth = math.radians(float(camera_cfg.get("azimuth", 0)))
    cam_data = bpy.data.cameras.new("World122_Ortho_Camera_30deg")
    cam_data.type = "ORTHO"
    cam_data.lens = 70
    cam_data.clip_start = 0.1
    cam_data.clip_end = 5000.0
    cam = bpy.data.objects.new("World122_Ortho_Camera_30deg", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    distance = 1800.0
    cam.location = (
        distance * math.cos(elevation) * math.sin(azimuth),
        -distance * math.cos(elevation) * math.cos(azimuth),
        distance * math.sin(elevation),
    )
    cam.rotation_euler = (math.radians(90) - elevation, 0, azimuth)
    bpy.context.view_layer.update()

    corners = []
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        corners.extend(obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box)
    inv = cam.matrix_world.inverted()
    points = [inv @ corner for corner in corners]
    min_x, max_x = min(p.x for p in points), max(p.x for p in points)
    min_y, max_y = min(p.y for p in points), max(p.y for p in points)
    resolution = int(camera_cfg["resolution"])
    width_margin = float(camera_cfg.get("widthMargin", 0.88))
    top_margin = float(camera_cfg.get("topMargin", 52)) / resolution
    bottom_y = float(camera_cfg.get("bottomY", 900)) / resolution
    scale_w = (max_x - min_x) / width_margin
    scale_h = (max_y - min_y) / max(0.1, bottom_y - top_margin)
    scale = max(scale_w, scale_h) * 1.025
    cam_data.ortho_scale = scale
    cam_data.shift_x = ((min_x + max_x) / 2) / scale
    target_bottom = (0.5 - bottom_y) * scale
    cam_data.shift_y = (min_y - target_bottom) / scale
    return cam


def setup_scene(spec, preview_path):
    scene = bpy.context.scene
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    resolution = int(spec["camera"]["resolution"])
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = True
    scene.render.filepath = preview_path
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.15

    world = bpy.data.worlds.new("World122_Neutral_World")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0.20, 0.22, 0.25, 1)
    world.node_tree.nodes["Background"].inputs[1].default_value = 0.8
    scene.world = world

    sun_data = bpy.data.lights.new("Key_Sun", "SUN")
    sun_data.energy = 2.0
    sun_data.angle = math.radians(18)
    sun = bpy.data.objects.new("Key_Sun", sun_data)
    scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(42), 0, math.radians(-38))

    fill_data = bpy.data.lights.new("Soft_Fill", "AREA")
    fill_data.energy = 750
    fill_data.shape = "DISK"
    fill_data.size = 650
    fill = bpy.data.objects.new("Soft_Fill", fill_data)
    scene.collection.objects.link(fill)
    fill.location = (-480, -620, 720)
    direction = mathutils.Vector((0, 0, 150)) - fill.location
    fill.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def render_depth(scene, root, camera, depth_path):
    corners = []
    for obj in root.children_recursive:
        if obj.type == "MESH":
            corners.extend(obj.matrix_world @ mathutils.Vector(corner) for corner in obj.bound_box)
    inv = camera.matrix_world.inverted()
    depths = [-(inv @ corner).z for corner in corners]
    zmin, zmax = min(depths), max(depths)
    span = max(zmax - zmin, 1e-6)
    zmin -= span * 0.01
    zmax += span * 0.01

    bpy.context.view_layer.use_pass_z = True
    node_group = bpy.data.node_groups.new("Bank_Depth_Compositor", "CompositorNodeTree")
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
    links.new(map_range.outputs["Result"], multiply.inputs[0])
    links.new(render_layers.outputs["Alpha"], multiply.inputs[1])
    links.new(multiply.outputs[0], output.inputs["Image"])

    scene.render.film_transparent = False
    scene.render.image_settings.color_mode = "BW"
    scene.render.image_settings.color_depth = "8"
    scene.render.dither_intensity = 0.0
    scene.view_settings.view_transform = "Raw"
    try:
        scene.view_settings.look = "None"
    except TypeError:
        pass
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    scene.render.filepath = depth_path
    bpy.ops.render.render(write_still=True)


def main():
    paths = parse_args()
    spec_path, blend_path, preview_path = paths[:3]
    depth_path = paths[3] if len(paths) == 4 else None
    with open(spec_path, "r", encoding="utf-8-sig") as handle:
        spec = json.load(handle)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for collection in list(bpy.data.collections):
        if collection.users == 0:
            bpy.data.collections.remove(collection)
    root, _ = build_model(spec)
    setup_scene(spec, preview_path)
    camera = setup_camera(spec, root)
    bpy.context.scene.camera = camera
    os.makedirs(os.path.dirname(blend_path), exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.render.render(write_still=True)
    if depth_path:
        render_depth(bpy.context.scene, root, camera, depth_path)
    print("bank model ->", blend_path)
    print("bank preview ->", preview_path)
    if depth_path:
        print("bank depth ->", depth_path)


if __name__ == "__main__":
    main()
