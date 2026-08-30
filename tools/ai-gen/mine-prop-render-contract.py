"""Mine snapshot of the established prop camera/light/Depth contract.
Only the two consumed helpers are retained; no frozen models or generation.
Parameters and Blender object names match the source used for the accepted renders.
The caller assigns its street helper module to S before use.
"""
import math
import bpy
from mathutils import Vector

S = None

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
