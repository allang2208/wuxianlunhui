"""Read the existing energy-vein blend; never save or render over its sources."""

import importlib.util
import json
import math
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
SOURCE = REPO / "tools/ai-gen/_energy_vein_directional_20260826/energy_vein_directional_master.blend"
bpy.ops.wm.open_mainfile(filepath=str(SOURCE))
spec = importlib.util.spec_from_file_location(
    "energy_vein_builder", REPO / "tools/ai-gen/build-energy-vein-directional-tiles.py"
)
builder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(builder)
scene = bpy.context.scene
camera = scene.camera
report = {
    "scope": "Requested model inspection only; no generation, model save, render or runtime test.",
    "source": SOURCE.relative_to(REPO).as_posix(),
    "cameraType": camera.data.type,
    "cameraElevationDegrees": 90.0 - math.degrees(camera.rotation_euler.x),
    "frameCount": sum(c.name.startswith("energy_vein_mask_") for c in bpy.data.collections),
    "sourceRenderFrame": [1024, 512],
    "runtimeFrame": [128, 64],
    "representatives": [],
}

for mask in (0, 3, 5, 15):
    name = f"energy_vein_mask_{mask:02d}"
    collection = bpy.data.collections[name]
    root = bpy.data.objects[f"{name}_Root_44_8deg"]
    original_location = root.location.copy()
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 512
    low_x, high_x, low_y, high_y = builder.camera_bounds(collection, camera)
    camera.data.ortho_scale = max((high_y - low_y) / 0.975, (high_x - low_x) / 2 / 0.975)
    camera.data.shift_x = ((low_x + high_x) / 2) / camera.data.ortho_scale
    camera.data.shift_y = ((low_y + high_y) / 2) / camera.data.ortho_scale
    bpy.context.view_layer.update()
    item = {
        "mask": mask,
        "rootRotationDegrees": math.degrees(root.rotation_euler.z),
        "energyCurves": [],
        "seamCaps": [],
        "clippedRubble": [],
    }
    for obj in collection.all_objects:
        if "_EnergyBranch_" in obj.name:
            points = [point for spline in obj.data.splines for point in spline.points]
            item["energyCurves"].append({
                "name": obj.name,
                "type": obj.type,
                "crossSectionRadius": obj.data.bevel_depth,
                "pathLocalZ": [round(point.co.z, 6) for point in points],
            })
        elif "_SeamCap_" in obj.name:
            item["seamCaps"].append({
                "name": obj.name,
                "localLocation": list(obj.location),
                "localScale": list(obj.scale),
            })
        elif "_Rubble_" in obj.name and obj.type == "MESH":
            points = [world_to_camera_view(scene, camera, obj.matrix_world @ v.co) for v in obj.data.vertices]
            x0, x1 = min(p.x for p in points), max(p.x for p in points)
            y0, y1 = min(p.y for p in points), max(p.y for p in points)
            intersects = x1 > 0 and x0 < 1 and y1 > 0 and y0 < 1
            if intersects and (x0 < 0 or x1 > 1 or y0 < 0 or y1 > 1):
                item["clippedRubble"].append({
                    "name": obj.name,
                    "normalizedProjectionBounds": [round(v, 5) for v in (x0, y0, x1, y1)],
                })
    report["representatives"].append(item)
    root.location = original_location

path = OUT / "model-inspection.json"
path.write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
print(json.dumps(report, indent=2, ensure_ascii=False))
