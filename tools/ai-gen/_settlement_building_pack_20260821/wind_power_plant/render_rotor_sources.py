"""Render the selected wind-power-plant rotor as an independent animation layer.

Run with Blender after the model has been authored and saved::

    blender --background wind_power_plant_model.blend --python render_rotor_sources.py -- OUT_DIR SOURCE_RAW

The script keeps the model camera unchanged, projects the accepted 48-step
texture back onto the rotor geometry, and renders one full 360-degree cycle.
The body render and depth omit the complete rotor pivot so they can drive the
small masked inpaint needed by the static runtime body.
"""

import importlib.util
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view


FRAME_COUNT = 24
ROOT_NAME = "WIND_POWER_PLANT_ROOT_ROT_Z_44_8"
PIVOT_NAME = "WindPowerPlant_MainRotor_Pivot"
CAMERA_NAME = "World122_Ortho_Camera_30deg"


def load_kit():
    ai_gen_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    path = os.path.join(ai_gen_dir, "building-component-kit.py")
    spec = importlib.util.spec_from_file_location("building_component_kit", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def set_visible(objects):
    visible = set(objects)
    for obj in bpy.data.objects:
        if obj.type == "MESH":
            obj.hide_render = obj not in visible


def configure_rgba(scene, path):
    scene.compositing_node_group = None
    try:
        scene.render.engine = "BLENDER_EEVEE_NEXT"
    except TypeError:
        scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.film_transparent = True
    scene.render.filepath = path
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.25
    scene.view_settings.gamma = 1.0


def white_emission_material():
    material = bpy.data.materials.new("WindPowerPlant_RotorMask_White")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1, 1, 1, 1)
    emission.inputs["Strength"].default_value = 1
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(emission.outputs["Emission"], output.inputs["Surface"])
    return material


def render_mask(scene, objects, path, material):
    set_visible(objects)
    configure_rgba(scene, path)
    layer = bpy.context.view_layer
    previous = layer.material_override
    layer.material_override = material
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        layer.material_override = previous


def assign_projected_material(scene, camera, objects, source_path):
    image = bpy.data.images.load(source_path, check_existing=True)
    material = bpy.data.materials.new("WindPowerPlant_SelectedRotor_Projection")
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    nodes.clear()
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"
    texture.extension = "CLIP"
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(texture.outputs["Color"], emission.inputs["Color"])
    links.new(emission.outputs["Emission"], output.inputs["Surface"])

    for obj in objects:
        mesh = obj.data
        uv_layer = (mesh.uv_layers.get("Selected_Camera_Projection")
                    or mesh.uv_layers.new(name="Selected_Camera_Projection"))
        mesh.uv_layers.active = uv_layer
        for polygon in mesh.polygons:
            for loop_index in polygon.loop_indices:
                vertex_index = mesh.loops[loop_index].vertex_index
                world_position = obj.matrix_world @ mesh.vertices[vertex_index].co
                projected = world_to_camera_view(scene, camera, world_position)
                uv_layer.data[loop_index].uv = (projected.x, projected.y)
        mesh.materials.clear()
        mesh.materials.append(material)


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    if len(argv) != 2:
        raise SystemExit("usage: render_rotor_sources.py -- OUT_DIR SOURCE_RAW")
    out_dir = os.path.abspath(argv[0])
    source_path = os.path.abspath(argv[1])
    os.makedirs(out_dir, exist_ok=True)

    scene = bpy.context.scene
    root = bpy.data.objects[ROOT_NAME]
    pivot = bpy.data.objects[PIVOT_NAME]
    camera = bpy.data.objects[CAMERA_NAME]
    scene.camera = camera

    root_meshes = [obj for obj in root.children_recursive if obj.type == "MESH"]
    rotor_meshes = [obj for obj in pivot.children_recursive if obj.type == "MESH"]
    blade_meshes = [obj for obj in rotor_meshes if "_Blade_" in obj.name]
    blade_skin_meshes = [obj for obj in blade_meshes if obj.name.endswith("_Skin")]
    blade_spine_meshes = [obj for obj in blade_meshes if obj.name.endswith("_Spine")]
    hub_meshes = [obj for obj in rotor_meshes if obj not in blade_meshes]
    body_meshes = [obj for obj in root_meshes if obj not in rotor_meshes]
    if not rotor_meshes:
        raise SystemExit(f"no rotor meshes below {PIVOT_NAME}")

    mask_material = white_emission_material()
    render_mask(scene, rotor_meshes, os.path.join(out_dir, "rotor_mask.png"), mask_material)
    render_mask(scene, blade_meshes, os.path.join(out_dir, "rotor_blades_mask.png"), mask_material)
    render_mask(scene, blade_skin_meshes, os.path.join(out_dir, "rotor_blade_skins_mask.png"), mask_material)
    render_mask(scene, blade_spine_meshes, os.path.join(out_dir, "rotor_blade_spines_mask.png"), mask_material)
    render_mask(scene, hub_meshes, os.path.join(out_dir, "rotor_hub_mask.png"), mask_material)

    set_visible(body_meshes)
    configure_rgba(scene, os.path.join(out_dir, "body_no_rotor_model.png"))
    bpy.ops.render.render(write_still=True)

    kit = load_kit()
    kit.render_depth(
        scene,
        root,
        camera,
        os.path.join(out_dir, "body_no_rotor_depth.png"),
        "WindPowerPlantNoRotor",
    )

    prepared_projection = os.path.join(out_dir, "rotor_projection_texture.png")
    projection_path = prepared_projection if os.path.exists(prepared_projection) else source_path
    # Preserve authored brass/iron on the reinforcing spines and hub.  Only the
    # broad blade skins need the accepted V2 texture projected onto them.
    assign_projected_material(scene, camera, blade_skin_meshes, projection_path)
    set_visible(rotor_meshes)
    original_rotation = pivot.rotation_euler.copy()
    for frame in range(FRAME_COUNT):
        pivot.rotation_euler = original_rotation.copy()
        pivot.rotation_euler.y += math.radians(frame * (360.0 / FRAME_COUNT))
        bpy.context.view_layer.update()
        configure_rgba(scene, os.path.join(out_dir, f"rotor_{frame:02d}.png"))
        bpy.ops.render.render(write_still=True)
    pivot.rotation_euler = original_rotation
    bpy.context.view_layer.update()

    print(f"rotor meshes -> {len(rotor_meshes)}")
    print(f"body meshes -> {len(body_meshes)}")
    print(f"rotor frames -> {FRAME_COUNT}")
    print(f"output -> {out_dir}")


if __name__ == "__main__":
    main()
