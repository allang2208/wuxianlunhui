"""Set back the LV2 tower in its editable source model; preserve camera and hall."""
import importlib.util
import json
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
revision_path = HERE / "revision.json"
revision = json.loads(revision_path.read_text(encoding="utf-8"))
module_spec = importlib.util.spec_from_file_location(
    "city_hall_setback_source", REPO / "tools/ai-gen/city-hall-building-blender.py")
city = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(city)

bpy.ops.wm.open_mainfile(filepath=str(REPO / revision["sourceModel"]))
scene = bpy.context.scene
root = bpy.data.objects["CITY_HALL_LV2_ROOT_ROT_Z_44_8"]
tower = bpy.data.objects["CityHallLV2_ClockTower_BearingShell"]
old_y = float(tower.location.y)
new_y = float(revision["towerCenterY"])
delta_y = new_y - old_y
prefixes = tuple("CityHallLV2_" + part for part in (
    "ClockTower_", "ClockTowerCap", "Clock_", "BellTower_", "CivicSeal_",
    "Door_Recess", "CouncilDoors", "EntryLantern_"))
parts = [obj for obj in root.children_recursive if obj.name.startswith(prefixes)]
part_names = {obj.name for obj in parts}
for obj in parts:
    # Keep parented subparts in place relative to their moved parent.
    ancestor = obj.parent
    while ancestor and ancestor.name not in part_names:
        ancestor = ancestor.parent
    if ancestor is None:
        obj.location.y += delta_y

root["revision_scope"] = "Clock tower and attached details set back; symmetric upper facade retained."
root["tower_center_y"] = new_y
root["asset_status"] = "model_revision_awaiting_user_review"
bpy.context.view_layer.update()
scene.render.filepath = str(REPO / revision["modelPreview"])
bpy.context.preferences.filepaths.save_version = 0
bpy.ops.wm.save_as_mainfile(filepath=str(REPO / revision["model"]))
bpy.ops.render.render(write_still=True)
city.pack.publish_approval_preview(revision["assetId"], scene.render.filepath)
city.kit.render_depth(scene, root, scene.camera,
                      str(REPO / revision["depth"]), "CityHallLV2_Setback")

source_manifest = json.loads((REPO / revision["sourceManifest"]).read_text(encoding="utf-8-sig"))
dims = source_manifest["buildings"][revision["assetId"]]["dimensions"]
wall_front = dims["bodyCenterY"] - dims["body"][1] / 2
tower_depth = dims["tower"][1]
revision["status"] = "model_revision_ready_for_user_review"
revision["applied"] = {
    "oldTowerCenterY": old_y,
    "newTowerCenterY": new_y,
    "setback": delta_y,
    "oldTowerProjectionBeyondFacade": wall_front - (old_y - tower_depth / 2),
    "newTowerProjectionBeyondFacade": wall_front - (new_y - tower_depth / 2),
    "movedObjects": sorted(part_names),
    "camera": {
        "type": scene.camera.data.type,
        "orthoScale": scene.camera.data.ortho_scale,
        "shiftX": scene.camera.data.shift_x,
        "shiftY": scene.camera.data.shift_y,
        "source": "Unmodified camera loaded from sourceModel"
    }
}
revision_path.write_text(json.dumps(revision, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print(f"Tower setback {delta_y:g}; projection {revision['applied']['oldTowerProjectionBeyondFacade']:g} -> {revision['applied']['newTowerProjectionBeyondFacade']:g}")
print(f"Moved {len(parts)} named tower/attachment objects; hall and camera retained.")
