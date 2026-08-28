import math
from pathlib import Path

import bpy
import mathutils


ROOT = Path(__file__).resolve().parent
BLEND = ROOT / "model" / "church_lv2_model.blend"
OUTPUT = ROOT / "model" / "church_lv2_front_symmetry.png"


def look_at(camera, target):
    direction = mathutils.Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


bpy.ops.wm.open_mainfile(filepath=str(BLEND))
root = bpy.data.objects.get("CHURCH_LV2_ROOT_ROT_Z_44_8")
if root is None:
    raise SystemExit("church LV2 root missing")

# Directly face the authored bilateral plane without changing the saved blend.
root.rotation_euler[2] = 0

camera_data = bpy.data.cameras.new("ChurchLV2_FrontSymmetry_Camera_Data")
camera = bpy.data.objects.new("ChurchLV2_FrontSymmetry_Camera", camera_data)
bpy.context.collection.objects.link(camera)
camera.location = (0, -1120, 320)
camera_data.type = "ORTHO"
camera_data.ortho_scale = 620
camera_data.lens = 50
look_at(camera, (0, -18, 135))

scene = bpy.context.scene
scene.camera = camera
scene.render.engine = "BLENDER_EEVEE"
scene.render.resolution_x = 1024
scene.render.resolution_y = 1024
scene.render.resolution_percentage = 100
scene.render.image_settings.file_format = "PNG"
scene.render.film_transparent = False
scene.render.filepath = str(OUTPUT)
scene.world.color = (0.008, 0.008, 0.008)
bpy.ops.render.render(write_still=True)
print(f"front symmetry -> {OUTPUT}")
