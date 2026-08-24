#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Model candidate ground-contact overlays for existing World-122 buildings.

The saved .blend keeps the original procedural building as an alignment
reference and places every new contact component in a separate editable
collection.  The transparent overlay render uses the original building camera,
so it can be cropped with the existing runtime metadata without hand-tuning.
"""

import importlib.util
import json
import math
import os
import sys

import bpy


SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))


def load_module(name, filename):
    path = os.path.join(SCRIPT_DIR, filename)
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


kit = load_module("world122_ground_contact_kit", "building-component-kit.py")
pack = load_module("world122_ground_contact_pack", "settlement-building-pack-blender.py")


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(argv) != 3:
        raise SystemExit(
            "usage: blender --background --factory-startup --python "
            "build-building-ground-contact-overlays.py -- manifest.json "
            "building_id output_dir")
    return tuple(os.path.abspath(value) if index != 1 else value
                 for index, value in enumerate(argv))


def add_box(objects, collection, root, name, size, location, material,
            rotation=(0, 0, 0), bevel_width=1.2):
    obj = kit.box(collection, root, name, size, location, material,
                  rotation=rotation, bevel_width=bevel_width)
    objects.append(obj)
    return obj


def add_rubble(objects, collection, root, name, size, location, material,
               rotation=(0, 0, 0)):
    obj = kit.rough_boulder(collection, root, name, size, location, material,
                            rotation=rotation, subdivisions=1)
    objects.append(obj)
    return obj


def build_research_contact(collection, root, materials):
    """Four attached wall courses, column shoes and a shallow entry threshold."""
    objects = []
    stone = materials["stone"]
    foundation = materials["foundation"]

    # Short courses remain attached to the four outer wing ends.  They do not
    # join into a platform and leave the road fill visible between the wings.
    for label, size, location in (
            ("South", (198, 28, 20), (0, -258, 10)),
            ("North", (198, 28, 20), (0, 258, 10)),
            ("East", (28, 198, 20), (258, 0, 10)),
            ("West", (28, 198, 20), (-258, 0, 10))):
        add_box(objects, collection, root,
                f"ResearchContact_{label}Wing_WallFootCourse",
                size, location, stone, bevel_width=3)

    # A two-course threshold extends only from the main south entrance.
    add_box(objects, collection, root, "ResearchContact_MainDoor_LowerThreshold",
            (100, 32, 7), (0, -278, 3.5), foundation, bevel_width=2)
    add_box(objects, collection, root, "ResearchContact_MainDoor_UpperThreshold",
            (82, 24, 8), (0, -264, 8), stone, bevel_width=2)

    # Each perimeter diamond column receives a low shoe that continues below
    # the body-only cutout, visually pinning the isolated column to the road.
    for x_sign, y_sign, label in (
            (-1, -1, "SouthWest"), (1, -1, "SouthEast"),
            (-1, 1, "NorthWest"), (1, 1, "NorthEast")):
        x, y = x_sign * 188, y_sign * 188
        add_box(objects, collection, root,
                f"ResearchContact_DiamondColumn_{label}_GroundShoe",
                (62, 62, 18), (x, y, 9), foundation,
                rotation=(0, 0, 45), bevel_width=3)

    # Sparse cool-gray rubble breaks the perfectly straight contact edge.  All
    # pieces hug a wall or column and stay below knee height.
    for index, (size, location, rotation) in enumerate((
            ((20, 15, 9), (-72, -274, 4.5), (0, 0, 14)),
            ((15, 12, 7), (69, -270, 3.5), (0, 0, -21)),
            ((18, 14, 8), (-272, -55, 4), (0, 0, 31)),
            ((14, 11, 7), (271, 62, 3.5), (0, 0, -17)),
            ((16, 13, 8), (-209, 205, 4), (0, 0, 8)),
            ((13, 10, 6), (210, 207, 3), (0, 0, 25)))):
        add_rubble(objects, collection, root,
                   f"ResearchContact_WallHuggingRubble_{index}",
                   size, location, stone, rotation=rotation)
    return objects


def build_church_contact(collection, root, materials):
    """Warm discontinuous masonry trim for doors, buttresses and wall feet."""
    objects = []
    stone = materials["stone"]
    foundation = materials["foundation"]

    # The doorway gets the only pronounced step; it is deliberately shallow so
    # the chapel still reads as standing on the shared road surface.
    add_box(objects, collection, root, "ChurchContact_MainDoor_LowerThreshold",
            (104, 34, 7), (10, -216, 3.5), foundation, bevel_width=2.5)
    add_box(objects, collection, root, "ChurchContact_MainDoor_UpperThreshold",
            (84, 24, 9), (10, -201, 8), stone, bevel_width=2)

    # Low blocks continue the existing buttress rhythm into the terrain.  These
    # are individual toes, not a perimeter foundation.
    front_y = -134
    for index, x in enumerate((-92, 76, 122)):
        add_box(objects, collection, root,
                f"ChurchContact_FrontButtressToe_{index}",
                (30, 40, 14), (x, front_y - 8, 7), foundation,
                bevel_width=3)
    side_x = -153
    for index, y in enumerate((-58, 28, 92)):
        add_box(objects, collection, root,
                f"ChurchContact_SideButtressToe_{index}",
                (40, 30, 14), (side_x - 8, y, 7), foundation,
                bevel_width=3)

    # Broken wall-foot courses fill only the most abrupt gaps between supports.
    for index, (size, location) in enumerate((
            ((58, 18, 11), (-45, -132, 5.5)),
            ((43, 18, 11), (25, -132, 5.5)),
            ((18, 52, 11), (-151, -15, 5.5)),
            ((18, 42, 11), (-151, 63, 5.5)),
            ((78, 18, 10), (20, 149, 5)))):
        add_box(objects, collection, root,
                f"ChurchContact_DiscontinuousWallCourse_{index}",
                size, location, stone, bevel_width=2.5)

    for index, (size, location, rotation) in enumerate((
            ((19, 14, 9), (-48, -148, 4.5), (0, 0, 18)),
            ((15, 11, 7), (48, -143, 3.5), (0, 0, -12)),
            ((18, 13, 8), (-174, -88, 4), (0, 0, 29)),
            ((14, 10, 7), (-169, 118, 3.5), (0, 0, -24)))):
        add_rubble(objects, collection, root,
                   f"ChurchContact_WallHuggingRubble_{index}",
                   size, location, foundation, rotation=rotation)
    return objects


BUILDERS = {
    "research_institute": build_research_contact,
    "church": build_church_contact,
}


def material_map():
    return {
        "foundation": bpy.data.materials["MAT_Fieldstone_Foundation"],
        "stone": bpy.data.materials["MAT_Weathered_Stone"],
    }


def main():
    manifest_path, building_id, output_dir = parse_args()
    if building_id not in BUILDERS:
        raise SystemExit(f"unsupported ground-contact building: {building_id}")
    with open(manifest_path, "r", encoding="utf-8-sig") as handle:
        manifest = json.load(handle)
    spec = dict(manifest["buildings"][building_id])
    camera = dict(manifest["camera"])
    camera.update(spec.get("cameraOverrides", {}))
    spec["camera"] = camera
    spec["palette"] = manifest["palette"]

    os.makedirs(output_dir, exist_ok=True)
    model_path = os.path.join(output_dir, f"{building_id}_ground_contact_model.blend")
    model_preview = os.path.join(output_dir, f"{building_id}_ground_contact_model_preview.png")
    overlay_preview = os.path.join(output_dir, f"{building_id}_ground_contact_overlay_1024.png")
    metadata_path = os.path.join(output_dir, f"{building_id}_ground_contact_metadata.json")

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    reference_root = pack.BUILDERS[building_id](spec)
    reference_meshes = [obj for obj in reference_root.children_recursive
                        if obj.type == "MESH"]
    reference_collection = reference_root.users_collection[0]
    reference_collection.name = building_id.upper() + "_ALIGNMENT_REFERENCE"

    kit.setup_scene(spec, model_preview)
    camera_obj = kit.setup_camera(spec, reference_root)
    bpy.context.scene.camera = camera_obj

    overlay_collection = bpy.data.collections.new(
        building_id.upper() + "_GROUND_CONTACT_EDITABLE_COMPONENTS")
    bpy.context.scene.collection.children.link(overlay_collection)
    overlay_objects = BUILDERS[building_id](
        overlay_collection, reference_root, material_map())

    # The institute's large procedural foundation informed framing/depth only;
    # the accepted body sprite excludes it, so the alignment preview does too.
    reference_preview_exclusions = []
    if building_id == "research_institute":
        reference_preview_exclusions = [
            bpy.data.objects.get("ResearchLV1_Foundation_Base"),
            bpy.data.objects.get("ResearchLV1_Foundation_Inset"),
        ]
        for obj in reference_preview_exclusions:
            if obj is not None:
                obj.hide_render = True

    scene = bpy.context.scene
    scene.render.filepath = model_preview
    bpy.context.view_layer.update()
    bpy.ops.render.render(write_still=True)

    for obj in reference_meshes:
        obj.hide_render = True
    for obj in reference_preview_exclusions:
        if obj is not None:
            obj.hide_render = True
    scene.render.filepath = overlay_preview
    bpy.context.view_layer.update()
    bpy.ops.render.render(write_still=True)

    for obj in reference_meshes:
        obj.hide_render = False
    for obj in reference_preview_exclusions:
        if obj is not None:
            obj.hide_render = False
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=model_path)

    metadata = {
        "buildingId": building_id,
        "candidateOnly": True,
        "runtimeIntegrated": False,
        "cameraContract": camera,
        "referenceCollection": reference_collection.name,
        "overlayCollection": overlay_collection.name,
        "overlayObjectCount": len(overlay_objects),
        "model": os.path.relpath(model_path, os.getcwd()),
        "modelPreview": os.path.relpath(model_preview, os.getcwd()),
        "overlay1024": os.path.relpath(overlay_preview, os.getcwd()),
        "notes": [
            "No collision, occupancy, pathfinding or visualFootprint changes.",
            "Overlay remains a candidate and is not loaded by runtime.",
            "Reference building is retained only for editable alignment."
        ],
    }
    with open(metadata_path, "w", encoding="utf-8") as handle:
        json.dump(metadata, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

    print("building id ->", building_id)
    print("model ->", model_path)
    print("model preview ->", model_preview)
    print("overlay 1024 ->", overlay_preview)
    print("metadata ->", metadata_path)


if __name__ == "__main__":
    main()
