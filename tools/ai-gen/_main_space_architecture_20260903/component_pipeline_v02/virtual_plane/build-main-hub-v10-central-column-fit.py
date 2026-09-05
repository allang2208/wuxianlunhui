#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Close the v09 tribunal column-to-entablature gap and render v10.

The existing orthographic camera, all pre-existing object transforms, and every
light setting are treated as immutable. Seven marble impost blocks are derived
from the measured capital and entablature bounds, then rendered into the same
beauty/semantic contract used by v09.
"""

from __future__ import annotations

import json
import os

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


ROOT = os.path.dirname(os.path.abspath(__file__))
SOURCE_DIR = os.path.join(ROOT, "runtime_delivery_v09")
SOURCE_BLEND = os.path.join(SOURCE_DIR, "main_hub_runtime_master_v09.blend")
OUTPUT_DIR = os.path.join(ROOT, "runtime_delivery_v10")
OUTPUT_BLEND = os.path.join(OUTPUT_DIR, "main_hub_runtime_master_v10.blend")
BEAUTY_RENDER = os.path.join(OUTPUT_DIR, "main_hub_v10_runtime_beauty.png")
ID_RENDER = os.path.join(OUTPUT_DIR, "main_hub_v10_runtime_semantic_id.png")
BLENDER_MANIFEST = os.path.join(OUTPUT_DIR, "main-hub-v10-blender-render.json")
WIDTH = 2048
HEIGHT = 1152
NEW_PREFIX = "MainSpace_Tribunal_Pilaster_"

GROUP_COLORS = {
    "ground": (1.0, 0.0, 0.0, 1.0),
    "rear_architecture": (0.0, 1.0, 0.0, 1.0),
    "terraces_and_stair": (0.0, 0.0, 1.0, 1.0),
    "fixtures": (1.0, 1.0, 0.0, 1.0),
    "service_plinths": (1.0, 0.0, 1.0, 1.0),
}


def rounded(values, digits=6):
    return [round(float(value), digits) for value in values]


def camera_signature():
    camera = bpy.context.scene.camera
    return {
        "name": camera.name,
        "type": camera.data.type,
        "location": rounded(camera.location),
        "rotationEuler": rounded(camera.rotation_euler),
        "orthoScale": round(float(camera.data.ortho_scale), 6),
    }


def light_signature():
    return [
        {
            "name": light.name,
            "type": light.data.type,
            "useShadow": bool(light.data.use_shadow),
            "energy": round(float(light.data.energy), 6),
            "color": rounded(light.data.color),
            "location": rounded(light.location),
            "rotationEuler": rounded(light.rotation_euler),
        }
        for light in sorted(
            (obj for obj in bpy.data.objects if obj.type == "LIGHT"),
            key=lambda obj: obj.name,
        )
    ]


def transform_signature(excluded_names=()):
    excluded = set(excluded_names)
    return [
        (
            obj.name,
            obj.type,
            obj.parent.name if obj.parent else None,
            rounded(obj.location),
            rounded(obj.rotation_euler),
            rounded(obj.scale),
            bool(obj.hide_render),
        )
        for obj in sorted(bpy.data.objects, key=lambda item: item.name)
        if obj.name not in excluded
        and obj.type in {"MESH", "EMPTY", "CAMERA", "LIGHT"}
    ]


def world_bbox(obj):
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        "minX": min(point.x for point in points),
        "maxX": max(point.x for point in points),
        "minY": min(point.y for point in points),
        "maxY": max(point.y for point in points),
        "minZ": min(point.z for point in points),
        "maxZ": max(point.z for point in points),
    }


def origin_pixel(scene):
    ndc = world_to_camera_view(scene, scene.camera, Vector((0.0, 0.0, 0.0)))
    return [round(ndc.x * WIDTH, 6), round((1.0 - ndc.y) * HEIGHT, 6)]


def id_material():
    material = bpy.data.materials.get("MAT_V10_Runtime_SemanticID")
    if material is None:
        material = bpy.data.materials.new("MAT_V10_Runtime_SemanticID")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    object_info = nodes.new("ShaderNodeObjectInfo")
    links.new(object_info.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def semantic_group(obj):
    group = str(obj.get("v09_runtime_semantic_group", ""))
    if group in GROUP_COLORS:
        return group
    component = str(obj.get("v07_component", ""))
    if component in {"central_tribunal", "left_colonnade", "right_colonnade"}:
        return "rear_architecture"
    if component == "fixtures":
        return "fixtures"
    if component == "central_ceremonial_court" or obj.name.startswith((
            "V09_CentralTerrace_", "V09_LeftColonnadeTerrace",
            "V09_RightColonnadeTerrace")) or obj.name == "Cube":
        return "terraces_and_stair"
    if obj.name == "V09_FunctionalCourtyardGround":
        return "ground"
    if obj.name.startswith("V09_ServicePlinth_"):
        return "service_plinths"
    raise RuntimeError(f"visible mesh has no semantic group: {obj.name}")


def add_impost_block(index, center_x, center_y, bottom_z, top_z, material):
    name = f"{NEW_PREFIX}{index}_V10_ImpostBlock"
    if bpy.data.objects.get(name):
        bpy.data.objects.remove(bpy.data.objects[name], do_unlink=True)
    height = top_z - bottom_z
    bpy.ops.mesh.primitive_cube_add(
        location=(center_x, center_y, bottom_z + height * 0.5))
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = (56.0, 56.0, height)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel = obj.modifiers.new(name="V10_ImpostEdgeSoftening", type="BEVEL")
    bevel.width = 1.8
    bevel.segments = 3
    obj.data.materials.append(material)
    obj["v07_component"] = "central_tribunal"
    obj["v07_render_role"] = "stone"
    obj["v09_runtime_semantic_group"] = "rear_architecture"
    obj["v10_fit_role"] = "capital_to_entablature_impost"
    return obj


def configure_render(scene):
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = WIDTH
    scene.render.resolution_y = HEIGHT
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.image_settings.compression = 18
    scene.render.film_transparent = True


def main():
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=SOURCE_BLEND)
    scene = bpy.context.scene
    locked_camera = camera_signature()
    locked_lights = light_signature()
    locked_transforms = transform_signature()
    if any(light["useShadow"] for light in locked_lights):
        raise RuntimeError("source contains a cast-shadow light")

    entablature = bpy.data.objects.get("MainSpace_Tribunal_Entablature_V05_LowerReveal")
    if entablature is None:
        raise RuntimeError("central entablature lower reveal was not found")
    entablature_box = world_bbox(entablature)
    material = bpy.data.materials.get("MAT_V09_Runtime_ArchitectureMarble")
    if material is None:
        raise RuntimeError("v09 architecture marble material was not found")

    capital_records = []
    capital_objects = []
    for index in range(1, 8):
        capital = bpy.data.objects.get(
            f"MainSpace_Tribunal_Pilaster_{index}_CapitalAbacus")
        if capital is None:
            raise RuntimeError(f"capital abacus {index} was not found")
        capital_objects.append(capital)
        box = world_bbox(capital)
        capital_records.append({"index": index, "name": capital.name, "bbox": box})

    capital_tops = [record["bbox"]["maxZ"] for record in capital_records]
    if max(capital_tops) - min(capital_tops) > 0.001:
        raise RuntimeError("central capital tops are not level")
    capital_top = sum(capital_tops) / len(capital_tops)
    entablature_bottom = entablature_box["minZ"]
    gap_before = entablature_bottom - capital_top
    if gap_before <= 0.0:
        raise RuntimeError(f"expected positive column gap, measured {gap_before}")

    overlap = 0.2
    block_bottom = capital_top - overlap
    block_top = entablature_bottom + overlap
    created = []
    for record, capital in zip(capital_records, capital_objects):
        box = record["bbox"]
        created.append(add_impost_block(
            record["index"],
            (box["minX"] + box["maxX"]) * 0.5,
            (box["minY"] + box["maxY"]) * 0.5,
            block_bottom,
            block_top,
            material,
        ))

    created_names = [obj.name for obj in created]
    if camera_signature() != locked_camera:
        raise RuntimeError("camera changed while fitting central columns")
    if light_signature() != locked_lights:
        raise RuntimeError("light direction, energy, color or shadow settings changed")
    if transform_signature(excluded_names=created_names) != locked_transforms:
        raise RuntimeError("a pre-existing transform or visibility state changed")

    centers_x = [round(float(obj.location.x), 6) for obj in created]
    symmetry_errors = [
        abs(centers_x[index] + centers_x[-index - 1])
        for index in range(3)
    ]
    if abs(centers_x[3]) > 0.001 or max(symmetry_errors) > 0.001:
        raise RuntimeError(f"impost blocks are not symmetric: {centers_x}")

    configure_render(scene)
    scene.render.filepath = BEAUTY_RENDER
    bpy.ops.render.render(write_still=True)

    visible = [
        obj for obj in scene.objects
        if obj.type == "MESH" and not obj.hide_render
    ]
    view_layer = bpy.context.view_layer
    old_override = view_layer.material_override
    old_transform = scene.view_settings.view_transform
    old_look = scene.view_settings.look
    old_exposure = scene.view_settings.exposure
    old_colors = {obj.name: tuple(obj.color) for obj in visible}
    for obj in visible:
        group = semantic_group(obj)
        obj["v09_runtime_semantic_group"] = group
        obj.color = GROUP_COLORS[group]
    view_layer.material_override = id_material()
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0.0
    scene.render.filepath = ID_RENDER
    bpy.ops.render.render(write_still=True)
    view_layer.material_override = old_override
    scene.view_settings.view_transform = old_transform
    scene.view_settings.look = old_look
    scene.view_settings.exposure = old_exposure
    for obj in visible:
        obj.color = old_colors[obj.name]

    scene["v10_runtime_delivery"] = "runtime_delivery_v10"
    scene["v10_geometry_correction"] = "seven fitted central marble impost blocks"
    scene["v10_component_render_policy"] = (
        "same orthographic model camera; realistic PBR surfaces; no generated outline changes")
    scene.render.filepath = BEAUTY_RENDER
    bpy.ops.wm.save_as_mainfile(filepath=OUTPUT_BLEND)

    block_records = []
    for obj in created:
        box = world_bbox(obj)
        block_records.append({
            "name": obj.name,
            "center": rounded(obj.location),
            "dimensions": rounded(obj.dimensions),
            "bbox": {key: round(value, 6) for key, value in box.items()},
            "capitalOverlap": round(capital_top - box["minZ"], 6),
            "entablatureOverlap": round(box["maxZ"] - entablature_bottom, 6),
        })

    manifest = {
        "assetId": "main_hub_v10_runtime_blender_render",
        "status": "rendered_for_formal_runtime_integration",
        "sourceBlend": os.path.relpath(SOURCE_BLEND, OUTPUT_DIR).replace("\\", "/"),
        "outputBlend": os.path.basename(OUTPUT_BLEND),
        "beautyRender": os.path.basename(BEAUTY_RENDER),
        "semanticIdRender": os.path.basename(ID_RENDER),
        "geometrySourceOfTruth": "v09 runtime model plus v10 central-column fit correction",
        "geometryCorrection": {
            "centralColumnCount": len(created),
            "gapBefore": round(gap_before, 6),
            "capitalTopZ": round(capital_top, 6),
            "entablatureBottomZ": round(entablature_bottom, 6),
            "designedOverlap": overlap,
            "blocks": block_records,
            "symmetricCenterXs": centers_x,
            "maxPairSymmetryError": round(max(symmetry_errors), 6),
        },
        "camera": locked_camera,
        "originPixel": origin_pixel(scene),
        "renderSize": [WIDTH, HEIGHT],
        "geometryTransformsLockedForPreExistingObjects": True,
        "lightingOrShadowParametersChanged": False,
        "bakedDirectionalCastShadow": False,
        "lights": locked_lights,
        "renderPolicy": (
            "all component images derive from this same orthographic Blender model; "
            "surface treatment targets realistic PBR marble and metal while silhouettes, "
            "placement and perspective remain geometry-locked"
        ),
    }
    with open(BLENDER_MANIFEST, "w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, ensure_ascii=False)
        handle.write("\n")
    print("V10_RUNTIME_BLEND", OUTPUT_BLEND)
    print("V10_RUNTIME_BEAUTY", BEAUTY_RENDER)
    print("V10_RUNTIME_ID", ID_RENDER)
    print("V10_GAP_BEFORE", round(gap_before, 6))
    print("V10_IMPOST_BOUNDS", round(block_bottom, 6), round(block_top, 6))
    print("V10_RUNTIME_MANIFEST", BLENDER_MANIFEST)


if __name__ == "__main__":
    main()
