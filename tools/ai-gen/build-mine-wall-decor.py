"""Three wall-mounted props, two modeled directions, shared mine PBR materials.

Blender production only. Default writes the source batch, never runtime files.
"""
import importlib.util
import json
import math
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_wall_decor_20260830"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


M = load("mine_wall_prop_models", "build-mine-props-model-review.py")
P = load("mine_wall_prop_materials", "environment-prop-materials.py")
S = M.S


def hook(x, z):
    S.box("Iron_anchor_plate", (x, .015, z), (.16, .075, .27), "mine_iron", bevel=.012)
    for dz in (-.082, .082):
        S.sphere("Anchor_rivet", (x, -.029, z + dz), (.024, .012, .024), "mine_rust")
    S.curve("Forged_hook", [(x, -.02, z), (x, -.12, z-.07),
            (x, -.23, z-.065), (x, -.26, z+.03)], .033, "mine_iron")


def rope():
    # 重力方向的连续绳圈；不把平放圆盘PNG旋转成挂绳。
    points = []
    for i in range(241):
        t = i / 240
        angle = math.pi / 2 + t * math.tau * 3
        radius = .30 + .055 * t
        points.append((radius * math.cos(angle), -.145 - .065*t,
                       .90 + (.54 - .025*t) * math.sin(angle)))
    points.extend([(.16,-.23,1.15),(.33,-.24,.76),(.35,-.25,.39),(.46,-.26,.27)])
    S.curve("Hanging_continuous_rope", points, .041, "mine_rope")
    hook(0, 1.47)


def pick():
    M.pickaxe()
    pivot = bpy.data.objects.new("Upright_pick_mount", None)
    S.ACTIVE_COLLECTION.objects.link(pivot)
    pivot.parent = S.ACTIVE_ROOT
    for obj in list(S.ACTIVE_COLLECTION.objects):
        if obj != pivot and obj.parent == S.ACTIVE_ROOT:
            obj.parent = pivot
    pivot.rotation_euler.x = math.pi / 2
    pivot.location.z = .98
    hook(-.22, 1.55)
    hook(.22, 1.55)


def marker():
    # 无箭头、无可读任务指令，仅保留旧工区的三道浅色刻痕。
    for z, width in ((.79, 1.02), (1.035, .93)):
        points = [(-width/2,-.11), (width/2-.07,-.11), (width/2,.03),
                  (width/2-.10,.105), (-width/2+.035,.12)]
        obj = M.prism("Weathered_marker_plank", points, 0, .085, "mine_wood", .012)
        obj.rotation_euler.x = math.pi/2
        obj.location.z = z
    for x in (-.33,.33):
        S.box("Rear_batten", (x,.04,.91), (.105,.07,.65), "mine_wood_dark", bevel=.01)
        for z in (.78,1.04):
            S.sphere("Old_square_nail", (x,-.09,z), (.025,.016,.025), "mine_rust")
    for x, z in ((-.17,.77), (0,.79), (.17,.765)):
        S.box("Worn_tally", (x,-.091,z), (.018,.007,.135), "mine_slate_light", bevel=.002)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    S.clear_scene()
    S.setup_materials()
    M.OLD.setup_materials()
    P.apply_mine_palette(M)
    scene, camera = M.F.setup_scene()
    bpy.context.preferences.filepaths.save_version = 0
    camera.data.ortho_scale = S.PROP_ORTHO_SCALE
    camera.data.shift_y = S.PROP_BOTTOM_RATIO - .5
    scene.render.resolution_x = scene.render.resolution_y = 512
    specs = [("rope", "挂绳圈", rope, 1.0), ("pick", "矿镐挂架", pick, .75),
             ("marker", "旧工区木牌", marker, .55)]
    for key, label, build, weight in specs:
        S.new_model(key, (0,0,0))
        build()
    P.finish_mine_handles(M)
    assets = []
    for key, label, build, weight in specs:
        asset = {"id": key, "labelZh": label, "weight": weight, "views": {}}
        for axis, degrees in (("down", -S.ROOT_ROTATION_DEG), ("up", S.ROOT_ROTATION_DEG)):
            for name, collection in S.MODEL_COLLECTIONS.items():
                collection.hide_render = name != key
            root = S.MODEL_ROOTS[key]
            root.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            anchor = world_to_camera_view(scene, camera, root.matrix_world @ Vector((0,0,.95)))
            name = f"abandoned_mine_wall_decor_{key}_{axis}"
            scene.render.filepath = str(OUT / f"{name}.png")
            bpy.ops.render.render(write_still=True)
            asset["views"][axis] = {"key": name, "src": f"assets/terrain/abandoned-mine-wall-decor/{name}.png",
                "origin": [round(anchor.x, 7), round(1-anchor.y, 7)],
                "displayWidth": 307.2, "source": f"{name}.png"}
        assets.append(asset)
    for collection in S.MODEL_COLLECTIONS.values():
        collection.hide_render = False
    for i, (key, *_rest) in enumerate(specs):
        S.MODEL_ROOTS[key].location.x = i * 2.4
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "mine_wall_decor.blend"))
    manifest = {"stage": "modeled wall prop set", "runtimeInstalled": False,
        "generator": "tools/ai-gen/build-mine-wall-decor.py", "blend": "mine_wall_decor.blend",
        "materialLibrary": "tools/ai-gen/environment-prop-materials.py", "materialVersion": P.VERSION,
        "reusedGeometry": "build-mine-props-model-review.py:pickaxe; rope remodeled hanging; marker newly modeled",
        "camera": {"elevation": S.CAMERA_ELEVATION_DEG, "rootDirections": [-S.ROOT_ROTATION_DEG,S.ROOT_ROTATION_DEG],
                   "orthoScale": S.PROP_ORTHO_SCALE, "bottomRatio": S.PROP_BOTTOM_RATIO, "resolution": [512,512]},
        "mountAnchorLocal": [0,0,.95], "worldPixelsPerModelUnit": 48,
        "policy": "Two physical orientations rendered under unchanged lighting; no PNG mirror, ground plane, cast shadow, emission, collision or interaction",
        "aiGeneration": False, "assets": assets}
    manifest_path = OUT / "manifest.json"
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    for key in ("stage", "runtimeInstalled", "installationRecord", "installedOn"):
        if key in previous:
            manifest[key] = previous[key]
    manifest["workingOutputStatus"] = "rebuilt source output; last installation record unchanged"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
