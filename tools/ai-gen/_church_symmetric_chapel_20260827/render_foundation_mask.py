import os

import bpy


ROOT = os.path.dirname(os.path.abspath(__file__))
OUTPUT = os.path.join(ROOT, "model", "church_symmetric_chapel_foundation_mask.png")

foundation = bpy.data.objects.get("Church_Foundation")
if foundation is None:
    raise SystemExit("Church_Foundation is missing from the chapel model")

for obj in bpy.context.scene.objects:
    if obj.type == "MESH":
        obj.hide_render = obj != foundation

scene = bpy.context.scene
scene.render.film_transparent = True
scene.render.image_settings.file_format = "PNG"
scene.render.image_settings.color_mode = "RGBA"
scene.render.filepath = OUTPUT
bpy.ops.render.render(write_still=True)
print("foundation mask ->", OUTPUT)
