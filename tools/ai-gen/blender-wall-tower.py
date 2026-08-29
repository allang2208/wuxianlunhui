#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""World-122 2x2 wall-tower editable whitebox and approval render.

The tower deliberately remains a defense-wall structure rather than a normal
producer building: four independently editable 1x1 wall masses form the 2x2
body, while the true arched openings and battlements remain separate authored
components.  Logical footprint, collision and wall-walk integration are not
part of this modeling-only step.
"""

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
    if len(argv) not in (5, 6):
        raise SystemExit(
            "usage: blender --background --factory-startup "
            "--python blender-wall-tower.py -- manifest.json wall_tower "
            "out.blend preview.png depth.png [body-depth.png]")
    manifest, building_id, blend, preview, depth = argv[:5]
    body_depth = argv[5] if len(argv) == 6 else None
    return tuple(os.path.abspath(value) if index != 1 else value
                 for index, value in enumerate(
                     (manifest, building_id, blend, preview, depth, body_depth)))


def arch_prism_mesh(name, half_width, bottom_z, spring_z, radius, y_min, y_max,
                    segments=32):
    """Closed extruded round-arch volume used as a real Boolean cutter."""
    if abs(radius - half_width) > 1e-6:
        raise ValueError("round arch radius must equal half width")
    outline = [(-half_width, bottom_z), (half_width, bottom_z),
               (half_width, spring_z)]
    outline.extend((radius * math.cos(angle), spring_z + radius * math.sin(angle))
                   for angle in (math.pi * index / segments
                                 for index in range(1, segments + 1)))
    count = len(outline)
    vertices = [(x, y_min, z) for x, z in outline]
    vertices.extend((x, y_max, z) for x, z in outline)
    faces = [tuple(reversed(range(count))),
             tuple(range(count, count * 2))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def side_arch_prism_mesh(name, half_width, bottom_z, spring_z, radius,
                         x_min, x_max, segments=32):
    """Closed extruded round-arch volume running along local X."""
    if abs(radius - half_width) > 1e-6:
        raise ValueError("round arch radius must equal half width")
    outline = [(-half_width, bottom_z), (half_width, bottom_z),
               (half_width, spring_z)]
    outline.extend((radius * math.cos(angle), spring_z + radius * math.sin(angle))
                   for angle in (math.pi * index / segments
                                 for index in range(1, segments + 1)))
    count = len(outline)
    vertices = [(x_min, y, z) for y, z in outline]
    vertices.extend((x_max, y, z) for y, z in outline)
    faces = [tuple(reversed(range(count))),
             tuple(range(count, count * 2))]
    for index in range(count):
        nxt = (index + 1) % count
        faces.append((index, nxt, count + nxt, count + index))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def apply_arch_cut(block, cutter):
    modifier = block.modifiers.new(name="True_Arched_Doorway", type="BOOLEAN")
    modifier.operation = "DIFFERENCE"
    modifier.solver = "EXACT"
    modifier.object = cutter
    bpy.context.view_layer.objects.active = block
    block.select_set(True)
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    block.select_set(False)


def portal_arch_ring(collection, parent, name, outer_radius, inner_radius,
                     depth, spring_z, y, mat, segments=32):
    """Editable semicircular voussoir ring in the local X/Z facade plane."""
    angles = [math.pi * index / segments for index in range(segments + 1)]
    outer = [(outer_radius * math.cos(angle),
              spring_z + outer_radius * math.sin(angle)) for angle in angles]
    inner = [(inner_radius * math.cos(angle),
              spring_z + inner_radius * math.sin(angle)) for angle in angles]
    count = len(angles)
    vertices = []
    for plane_y in (y - depth / 2, y + depth / 2):
        vertices.extend((x, plane_y, z) for x, z in outer)
        vertices.extend((x, plane_y, z) for x, z in inner)
    front_outer, front_inner = 0, count
    back_outer, back_inner = count * 2, count * 3
    faces = []
    for index in range(count - 1):
        nxt = index + 1
        faces.append((front_outer + index, front_outer + nxt,
                      front_inner + nxt, front_inner + index))
        faces.append((back_outer + nxt, back_outer + index,
                      back_inner + index, back_inner + nxt))
        faces.append((front_outer + index, back_outer + index,
                      back_outer + nxt, front_outer + nxt))
        faces.append((front_inner + nxt, back_inner + nxt,
                      back_inner + index, front_inner + index))
    faces.append((front_outer, front_inner, back_inner, back_outer))
    faces.append((front_outer + count - 1, back_outer + count - 1,
                  back_inner + count - 1, front_inner + count - 1))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    kit.bevel(obj, 1.8, 3)
    return obj


def side_arch_ring(collection, parent, name, outer_radius, inner_radius,
                   depth, spring_z, x, mat, segments=32):
    """Editable semicircular ring in the local Y/Z plane for wall-walk mouths."""
    angles = [math.pi * index / segments for index in range(segments + 1)]
    outer = [(outer_radius * math.cos(angle),
              spring_z + outer_radius * math.sin(angle)) for angle in angles]
    inner = [(inner_radius * math.cos(angle),
              spring_z + inner_radius * math.sin(angle)) for angle in angles]
    count = len(angles)
    vertices = []
    for plane_x in (x - depth / 2, x + depth / 2):
        vertices.extend((plane_x, y, z) for y, z in outer)
        vertices.extend((plane_x, y, z) for y, z in inner)
    near_outer, near_inner = 0, count
    far_outer, far_inner = count * 2, count * 3
    faces = []
    for index in range(count - 1):
        nxt = index + 1
        faces.append((near_outer + index, near_outer + nxt,
                      near_inner + nxt, near_inner + index))
        faces.append((far_outer + nxt, far_outer + index,
                      far_inner + index, far_inner + nxt))
        faces.append((near_outer + index, far_outer + index,
                      far_outer + nxt, near_outer + nxt))
        faces.append((near_inner + nxt, far_inner + nxt,
                      far_inner + index, near_inner + index))
    faces.append((near_outer, near_inner, far_inner, far_outer))
    faces.append((near_outer + count - 1, far_outer + count - 1,
                  far_inner + count - 1, near_inner + count - 1))
    mesh = bpy.data.meshes.new(name + "_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.materials.append(mat)
    obj = bpy.data.objects.new(name, mesh)
    collection.objects.link(obj)
    obj.parent = parent
    kit.bevel(obj, 1.8, 3)
    return obj


def add_battlements(collection, root, dims, mats, tower_size, tower_height):
    parapet_h = float(dims["parapetHeight"])
    parapet_t = float(dims["parapetThickness"])
    merlon_h = float(dims["merlonHeight"])
    half = tower_size / 2
    parapet_z = tower_height + parapet_h / 2
    # Four continuous low parapets establish a usable roof walk without a roof.
    kit.box(collection, root, "WallTower_Parapet_Front",
            (tower_size, parapet_t, parapet_h),
            (0, -half + parapet_t / 2, parapet_z), mats["stoneBand"],
            bevel_width=2.5)
    kit.box(collection, root, "WallTower_Parapet_Back",
            (tower_size, parapet_t, parapet_h),
            (0, half - parapet_t / 2, parapet_z), mats["stoneBand"],
            bevel_width=2.5)
    kit.box(collection, root, "WallTower_Parapet_Left",
            (parapet_t, tower_size - parapet_t * 2, parapet_h),
            (-half + parapet_t / 2, 0, parapet_z), mats["stoneBand"],
            bevel_width=2.5)
    kit.box(collection, root, "WallTower_Parapet_Right",
            (parapet_t, tower_size - parapet_t * 2, parapet_h),
            (half - parapet_t / 2, 0, parapet_z), mats["stoneBand"],
            bevel_width=2.5)

    merlon_z = tower_height + parapet_h + merlon_h / 2
    merlon_w = 34
    inset = 8
    edge = half - parapet_t / 2
    positions = (-tower_size * 0.34, -tower_size * 0.11,
                 tower_size * 0.11, tower_size * 0.34)
    for edge_name, y in (("Front", -edge), ("Back", edge)):
        for index, x in enumerate(positions):
            kit.box(collection, root,
                    f"WallTower_{edge_name}Merlon_{index}",
                    (merlon_w, parapet_t + inset, merlon_h),
                    (x, y, merlon_z), mats["stone"], bevel_width=2.5)
    for edge_name, x in (("Left", -edge), ("Right", edge)):
        for index, y in enumerate(positions):
            kit.box(collection, root,
                    f"WallTower_{edge_name}Merlon_{index}",
                    (parapet_t + inset, merlon_w, merlon_h),
                    (x, y, merlon_z), mats["stone"], bevel_width=2.5)


def build_wall_tower(spec):
    dims = spec["dimensions"]
    palette = spec["palette"]
    collection = bpy.data.collections.new("WALL_TOWER_EDITABLE_COMPONENTS")
    bpy.context.scene.collection.children.link(collection)
    root = bpy.data.objects.new("WALL_TOWER_ROOT_ROT_Z_44_8", None)
    collection.objects.link(root)
    root.rotation_euler.z = math.radians(float(spec["camera"]["buildingRotationZ"]))

    mats = {
        "stone": kit.material(
            "MAT_WallTower_WeatheredStone", kit.rgba(palette["stone"]),
            roughness=0.92,
            noise={"scale": 5.5, "detail": 4, "bump": 0.23}),
        "stoneBand": kit.material(
            "MAT_WallTower_DressedStone", kit.rgba(palette["stoneBand"]),
            roughness=0.88,
            noise={"scale": 6.5, "detail": 3, "bump": 0.16}),
    }

    cell = float(dims["cell"])
    joint = float(dims["cellJoint"])
    tower_height = float(dims["towerHeight"])
    tower_size = cell * 2
    block_size = cell - joint
    half_offset = cell / 2
    blocks = []
    for y_sign, row in ((-1, "Front"), (1, "Rear")):
        for x_sign, side in ((-1, "Left"), (1, "Right")):
            block = kit.box(
                collection, root, f"WallTower_Block_{row}{side}",
                (block_size, block_size, tower_height),
                (x_sign * half_offset, y_sign * half_offset,
                 tower_height / 2), mats["stone"], bevel_width=0)
            blocks.append(block)

    radius = float(dims["doorArchRadius"])
    spring_z = float(dims["doorSpringZ"])
    ground_cutter = arch_prism_mesh(
        "WallTower_GroundPassage_Cutter", radius, -4, spring_z, radius,
        -tower_size / 2 - 20, tower_size / 2 + 20)
    ground_cutter.parent = root
    kit.move_to_collection(ground_cutter, collection)

    upper_radius = float(dims["upperPassageArchRadius"])
    upper_floor = float(dims["upperPassageFloorZ"])
    upper_spring = float(dims["upperPassageSpringZ"])
    upper_cutter = side_arch_prism_mesh(
        "WallTower_UpperWallWalkPassage_Cutter", upper_radius, upper_floor - 4,
        upper_spring, upper_radius, -tower_size / 2 - 20, tower_size / 2 + 20)
    upper_cutter.parent = root
    kit.move_to_collection(upper_cutter, collection)

    for block in blocks:
        apply_arch_cut(block, ground_cutter)
        apply_arch_cut(block, upper_cutter)
    bpy.data.objects.remove(ground_cutter, do_unlink=True)
    bpy.data.objects.remove(upper_cutter, do_unlink=True)
    # Cut the true opening first, then soften the final outer and arch edges.
    # This keeps the Boolean deterministic and avoids modifier-order ambiguity.
    for block in blocks:
        kit.bevel(block, 3.5, 3)

    ring_thickness = float(dims["archRingThickness"])
    # Ground passage remains a true Boolean opening in the four tower masses.
    # Do not add an exterior arch ring, jambs or keystone: the lower doorway
    # must read as a clean opening cut directly through the wall body.
    for facade, x, outward in (("Left", -tower_size / 2 - 4, -1),
                               ("Right", tower_size / 2 + 4, 1)):
        side_arch_ring(
            collection, root, f"WallTower_Upper{facade}Arch",
            upper_radius + ring_thickness, upper_radius, 14,
            upper_spring, x, mats["stoneBand"])
        jamb_height = upper_spring - upper_floor
        for side, label in ((-1, "Near"), (1, "Far")):
            kit.box(collection, root,
                    f"WallTower_Upper{facade}ArchJamb_{label}",
                    (14, ring_thickness, jamb_height),
                    (x, side * (upper_radius + ring_thickness / 2),
                     upper_floor + jamb_height / 2),
                    mats["stoneBand"], bevel_width=2.5)
        kit.box(collection, root, f"WallTower_Upper{facade}ArchKeystone",
                (19, 18, 24),
                (x + outward * 4, 0, upper_spring + upper_radius + 4),
                mats["stoneBand"], bevel_width=2.5)

    add_battlements(collection, root, dims, mats, tower_size, tower_height)
    return root


def publish_approval_preview(preview_path):
    stem, extension = os.path.splitext(preview_path)
    if stem.endswith("_model_preview"):
        approval = stem[:-len("_model_preview")] + "_model_approval_preview" + extension
    else:
        approval = stem + "_approval_preview" + extension
    shutil.copy2(preview_path, approval)
    print("codex markdown -> ![wall tower model approval preview]"
          f"(<{approval.replace(chr(92), '/')}>)")
    return approval


def main():
    manifest_path, building_id, blend_path, preview_path, depth_path, body_depth_path = parse_args()
    with open(manifest_path, "r", encoding="utf-8-sig") as handle:
        manifest = json.load(handle)
    if building_id not in manifest["buildings"]:
        raise SystemExit(f"unknown building id: {building_id}")
    spec = dict(manifest["buildings"][building_id])
    spec["camera"] = dict(manifest["camera"])
    spec["palette"] = dict(manifest["palette"])

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    root = build_wall_tower(spec)
    os.makedirs(os.path.dirname(blend_path), exist_ok=True)
    kit.setup_scene(spec, preview_path)
    camera = kit.setup_camera(spec, root)
    bpy.context.scene.camera = camera
    bpy.ops.wm.save_as_mainfile(filepath=blend_path)
    bpy.ops.render.render(write_still=True)
    approval = publish_approval_preview(preview_path)
    kit.render_depth(bpy.context.scene, root, camera, depth_path, "WallTower")
    if body_depth_path:
        shutil.copy2(depth_path, body_depth_path)

    print("building id ->", building_id)
    print("model ->", blend_path)
    print("preview ->", preview_path)
    print("approval preview ->", approval)
    print("depth ->", depth_path)
    if body_depth_path:
        print("body depth ->", body_depth_path)


if __name__ == "__main__":
    main()
