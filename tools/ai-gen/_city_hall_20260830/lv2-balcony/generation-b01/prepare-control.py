"""Carry the previously accepted cap/clock styling into the approved balcony Depth."""
import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Matrix, Vector

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
module_spec = importlib.util.spec_from_file_location(
    "city_hall_balcony_generation", REPO / "tools/ai-gen/city-hall-building-blender.py")
city = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(city)
source = HERE.parent / "city_hall_lv2_model.blend"
bpy.ops.wm.open_mainfile(filepath=str(source))
scene = bpy.context.scene
root = bpy.data.objects["CITY_HALL_LV2_ROOT_ROT_Z_44_8"]
collection = root.users_collection[0]
tower = bpy.data.objects["CityHallLV2_ClockTower_BearingShell"]
cap = bpy.data.objects["CityHallLV2_ClockTowerCap"]
old_cap_location = tuple(cap.location)
roof_mat = bpy.data.materials["CityHallLV2_MAT_roof"]
bpy.data.objects.remove(cap, do_unlink=True)
city.pack.research_pyramid_roof(collection, root, "CityHallLV2_ClockTowerCap",
                               93, 98, 44, old_cap_location, roof_mat)

# Reuse the existing clock assembly; the second disk is attached to the visible side.
front_clock = [obj for obj in root.children if obj.name.startswith("CityHallLV2_Clock_")]
clock_center = Vector(bpy.data.objects["CityHallLV2_Clock_Face"].location)
side_center = Vector((-42, tower.location.y - 79 * 0.22, clock_center.z))
transform = (Matrix.Translation(side_center)
             @ Matrix.Rotation(math.radians(-90), 4, "Z")
             @ Matrix.Scale(0.82, 4)
             @ Matrix.Translation(-clock_center))
for obj in front_clock:
    copy = obj.copy()
    copy.data = obj.data.copy()
    copy.name = obj.name.replace("CityHallLV2_Clock_", "CityHallLV2_SideClock_")
    collection.objects.link(copy)
    copy.parent = root
    copy.matrix_parent_inverse = Matrix.Identity(4)
    copy.matrix_basis = transform @ obj.matrix_local

root["asset_status"] = "balcony_model_approved_for_structure_generation"
root["generation_detail_sync"] = "Previously accepted pyramidal cap and front/side clock disks; balcony and setback retained."
bpy.context.view_layer.update()
scene.render.filepath = str(HERE / "control-model-preview.png")
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(HERE / "control-model.blend"))
bpy.ops.render.render(write_still=True)
city.pack.publish_approval_preview("city_hall_lv2", scene.render.filepath)
city.kit.render_depth(scene, root, scene.camera, str(HERE / "control-depth.png"), "CityHallLV2_Balcony_Generation")
(HERE / "control-provenance.json").write_text(json.dumps({
    "sourceModel": str(source.relative_to(REPO)).replace("\\", "/"),
    "userAuthorization": "同意继续生图",
    "retained": "Approved balcony doorway, full-width balcony, three-sided railing, civic crest, tower setback, main hall, main roof, window/banner layout, foundation and exact camera",
    "detailSynchronization": {
        "cap": "Previously accepted pyramidal cap, same 93x98 footprint, height 44 and base position",
        "visibleSideClock": "Attached copy of the front clock, scaled to fit the exposed side wall without roof intersection",
        "sideClockCenter": list(side_center),
        "sideClockScale": 0.82
    },
    "runtimeIntegrationActive": False
}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Prepared complete balcony Depth with previously accepted cap/clock identity.")
