import math
from pathlib import Path

import bpy
import mathutils


ROOT = Path(__file__).resolve().parent
BLEND = ROOT / "model" / "church_symmetric_chapel_model.blend"
OUTPUT = ROOT / "model" / "church_symmetric_chapel_front_symmetry.png"


def look_at(camera, target):
    direction = mathutils.Vector(target) - camera.location
    camera.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


bpy.ops.wm.open_mainfile(filepath=str(BLEND))
root = bpy.data.objects.get("CHURCH_ROOT_ROT_Z_44_8")
if root is None:
    raise SystemExit("church root missing")

# Temporarily remove the game-view root turn so this proof render looks
# directly at the authored front symmetry plane.  The saved .blend is untouched.
root.rotation_euler[2] = 0

camera_data = bpy.data.cameras.new("Church_FrontSymmetry_Camera_Data")
camera = bpy.data.objects.new("Church_FrontSymmetry_Camera", camera_data)
bpy.context.collection.objects.link(camera)
camera.location = (0, -1050, 285)
camera_data.type = "ORTHO"
camera_data.ortho_scale = 560
camera_data.lens = 50
look_at(camera, (0, -18, 115))

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
