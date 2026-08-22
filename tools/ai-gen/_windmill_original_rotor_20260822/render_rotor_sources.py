import importlib.util
import math
import os
import sys

import bpy
from bpy_extras.object_utils import world_to_camera_view


def load_kit():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    path = os.path.join(root, "building-component-kit.py")
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


def render_mask(scene, objects, path, mask_material):
    set_visible(objects)
    configure_rgba(scene, path)
    layer = bpy.context.view_layer
    previous = layer.material_override
    layer.material_override = mask_material
    try:
        bpy.ops.render.render(write_still=True)
    finally:
        layer.material_override = previous


def assign_projected_source_material(scene, camera, sails, source_path):
    image = bpy.data.images.load(source_path, check_existing=True)
    material = bpy.data.materials.new("Windmill_Original_Sail_Projection")
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

    for obj in sails:
        mesh = obj.data
        uv_layer = mesh.uv_layers.get("Original_Camera_Projection") or mesh.uv_layers.new(name="Original_Camera_Projection")
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
    out_dir = os.path.abspath(argv[0])
    os.makedirs(out_dir, exist_ok=True)

    scene = bpy.context.scene
    root = bpy.data.objects["WHEAT_WINDMILL_ROOT_ROT_Z_44_8"]
    camera = bpy.data.objects["World122_Ortho_Camera_30deg"]
    scene.camera = camera
    meshes = [obj for obj in root.children_recursive if obj.type == "MESH"]
    sails = [obj for obj in meshes if obj.name.startswith("Sail_")]
    hubs = [obj for obj in meshes if obj.name.startswith("Windmill_Hub")]
    building = [obj for obj in meshes if obj not in sails]

    mask_material = bpy.data.materials.new("Windmill_Mask_White")
    mask_material.use_nodes = True
    nodes = mask_material.node_tree.nodes
    links = mask_material.node_tree.links
    nodes.clear()
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Color"].default_value = (1, 1, 1, 1)
    emission.inputs["Strength"].default_value = 1
    output = nodes.new("ShaderNodeOutputMaterial")
    links.new(emission.outputs["Emission"], output.inputs["Surface"])

    render_mask(scene, sails, os.path.join(out_dir, "sails_mask.png"), mask_material)
    render_mask(scene, hubs, os.path.join(out_dir, "hub_mask.png"), mask_material)

    source_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sail_projection_texture.png")
    assign_projected_source_material(scene, camera, sails, source_path)

    set_visible(building)
    configure_rgba(scene, os.path.join(out_dir, "no_sails_preview.png"))
    bpy.ops.render.render(write_still=True)

    original = {
        obj.name: (obj.location.copy(), obj.rotation_euler.copy())
        for obj in sails
    }
    hub_z = bpy.data.objects["Windmill_Hub_Cap"].location.z
    set_visible(sails)
    for frame in range(16):
        # Four identical sails repeat visually every quarter turn, so sample
        # one 90-degree loop period instead of repeating four poses four times.
        delta = math.radians(frame * (90.0 / 16.0))
        cos_a = math.cos(delta)
        sin_a = math.sin(delta)
        for obj in sails:
            location, rotation = original[obj.name]
            x = location.x
            z = location.z - hub_z
            obj.location.x = x * cos_a - z * sin_a
            obj.location.z = hub_z + x * sin_a + z * cos_a
            obj.rotation_euler = rotation.copy()
            obj.rotation_euler.y = rotation.y - delta
        configure_rgba(scene, os.path.join(out_dir, f"sails_{frame:02d}.png"))
        bpy.ops.render.render(write_still=True)

    for obj in sails:
        location, rotation = original[obj.name]
        obj.location = location
        obj.rotation_euler = rotation

    set_visible(building)
    kit = load_kit()
    kit.render_depth(
        scene,
        root,
        camera,
        os.path.join(out_dir, "no_sails_depth.png"),
        "WheatWindmillNoSails",
    )


if __name__ == "__main__":
    main()
