"""Render component masks from the existing v2 model; never save over the blend."""
from pathlib import Path
import json
import bpy

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_wall_dev_final_20260830"
OUT.mkdir(exist_ok=True)
scene = bpy.context.scene
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.image_settings.color_depth = "8"
scene.render.resolution_x = scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.view_settings.view_transform = "Raw"
scene.view_settings.look = "None"
scene.compositing_node_group = None


def emission(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes.clear()
    output = mat.node_tree.nodes.new("ShaderNodeOutputMaterial")
    surface = mat.node_tree.nodes.new("ShaderNodeEmission")
    surface.inputs["Color"].default_value = (*color, 1)
    mat.node_tree.links.new(surface.outputs[0], output.inputs["Surface"])
    return mat


black = emission("Mask stone", (0, 0, 0))
wood = emission("Mask wood", (1, 0, 0))
metal = emission("Mask metal or ore", (0, 1, 0))
groups = {"b": "B_sparse_nonemissive_ore", "c": "C_occasional_oak_support"}
record = {"source": "../_mine_wall_pbr_kit_v2_20260830/mine_wall_and_gate_pbr_v2.blend", "camera": scene.camera.name, "groups": {}}
for key, name in groups.items():
    target = bpy.data.collections[name]
    for collection in list(bpy.data.collections):
        collection.hide_render = False
    for obj in list(scene.objects):
        if obj.type not in {"CAMERA", "LIGHT"}:
            obj.hide_render = True
    names = []
    for obj in list(target.all_objects):
        obj.hide_render = False
        if obj.type != "MESH":
            continue
        obj.data = obj.data.copy()
        is_stone = obj.name.startswith(("Unbroken coverage core", "Continuous cleavage face", "Joined crown"))
        is_wood = any("oak" in slot.material.name.lower() for slot in obj.material_slots if slot.material)
        obj.data.materials.clear()
        obj.data.materials.append(black if is_stone else wood if is_wood else metal)
        if not is_stone:
            names.append(obj.name)
    record["groups"][key] = names
    scene.render.filepath = str(OUT / f"wall_{key}_component_mask.png")
    bpy.ops.render.render(write_still=True)
(OUT / "component-mask-source.json").write_text(json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Component masks rendered:", OUT, flush=True)
