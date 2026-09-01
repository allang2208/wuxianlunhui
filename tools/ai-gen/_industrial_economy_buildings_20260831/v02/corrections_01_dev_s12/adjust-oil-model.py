"""Keep the selected oil-plant model, turn only its ladder onto solid stack wall."""
import importlib.util
import json
from pathlib import Path

import bpy
from mathutils import Vector

OUT = Path(__file__).resolve().parent
V02 = OUT.parent
REPO = OUT.parents[4]
module_spec = importlib.util.spec_from_file_location("economy_v02", V02 / "build-models.py")
base = importlib.util.module_from_spec(module_spec)
module_spec.loader.exec_module(base)
kit, pack = base.kit, base.pack

asset_id = "oil_power_plant"
source = V02 / asset_id / f"{asset_id}_model.blend"
target = OUT / "model" / asset_id
target.mkdir(parents=True, exist_ok=True)
bpy.ops.wm.open_mainfile(filepath=str(source))
bpy.context.preferences.filepaths.save_version = 0
root = bpy.data.objects["OIL_POWER_PLANT_ROOT_ROT_Z_44_8"]
scene = bpy.context.scene
collection = root.users_collection[0]
spec = json.loads((V02 / "manifest.json").read_text(encoding="utf-8"))["buildings"][asset_id]
d = spec["dimensions"]
g = d["foundation"][2]
sx, sy = d["chimneyCenter"]
rb, rt, height = d["chimneyBottomRadius"], d["chimneyTopRadius"], d["chimneyHeight"]
mouth_z = g + 14 + height

# Camera-facing horizontal direction in model coordinates. A tangent ladder
# centered here projects entirely against the opaque stack, not the green edge.
normal = root.matrix_world.inverted().to_3x3() @ (
    scene.camera.matrix_world.to_3x3() @ Vector((0, 0, 1)))
normal.z = 0
normal.normalize()
tangent = Vector((-normal.y, normal.x, 0))
for obj in list(root.children_recursive):
    if obj.name.startswith(asset_id + "_Smokestack_Ladder"):
        bpy.data.objects.remove(obj, do_unlink=True)

def ladder_point(z, side):
    radius = rb + (rt - rb) * (z - g - 14) / height
    return Vector((sx, sy, z)) + normal * (radius + 8) + tangent * side

mat = bpy.data.materials[asset_id + "_MAT_iron"]
for side in (-19, 19):
    kit.industrial_pipe_path(collection, root, f"{asset_id}_Smokestack_LadderRail_{side}",
                             [ladder_point(g + 36, side), ladder_point(mouth_z - 38, side)], 3.2, mat)
for index in range(17):
    z = g + 48 + index * 32
    kit.industrial_pipe_path(collection, root, f"{asset_id}_Smokestack_LadderRung_{index}",
                             [ladder_point(z, -19), ladder_point(z, 19)], 2.5, mat)
root["ladder_backing"] = "Solid camera-facing chimney wall; no change to hall or foundation"
bpy.context.view_layer.update()
blend = target / f"{asset_id}_model.blend"
preview = target / f"{asset_id}_model_preview.png"
depth = target / f"{asset_id}_body_depth.png"
scene.render.filepath = str(preview)
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
bpy.ops.render.render(write_still=True)
approval = pack.publish_approval_preview(asset_id, str(preview))
kit.render_depth(scene, root, scene.camera, str(depth), asset_id + "_LadderCorrection")
metadata = json.loads((V02 / asset_id / "model-metadata.json").read_text(encoding="utf-8"))
metadata.update({
    "revision": "v02-ladder-front",
    "status": "user_directed_ladder_relocation_for_12_step_correction",
    "priorModel": source.relative_to(REPO).as_posix(),
    "builder": Path(__file__).relative_to(REPO).as_posix(),
    "revisionReason": "Turn chimney ladder onto solid camera-facing wall to avoid green through rungs",
    "ladderRadialLocal": list(normal),
    "model": blend.name, "bodyDepth": depth.name,
    "preview": Path(approval).name,
    "cameraAndFoundationUnchanged": True,
    "userDirectedChange": "按你建议继续，但是考虑到抠图，尽量不要把楼梯跟绿幕重叠，记住这个",
    "userApproved": False,
    "aiGenerationStarted": False,
    "runtimeInstalled": False,
})
(target / "model-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("Saved ladder correction source, preview and full Depth:", target)
