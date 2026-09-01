"""Horror wall props: native Blender models, fixed shared camera, two wall axes.

Run Blender --background --factory-startup --python this_file.
Source output only; installation is a separate, explicit production step.
"""
import importlib.util
import json
import math
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = Path(__file__).resolve().parent
OUT = HERE / "_horror_wall_decor_20260831"
spec = importlib.util.spec_from_file_location("horror_wall_shared", HERE / "build-mine-wall-decor.py")
W = importlib.util.module_from_spec(spec)
spec.loader.exec_module(W)
M, S, P = W.M, W.S, W.P


def ring(name, x, y, z, radius, thickness=.028, sideways=False):
    return S.torus(name, (x, y, z), radius, thickness, "mine_iron",
                   rotation=(math.pi / 2, 0, math.pi / 2 if sideways else 0))


def shackles():
    S.box("Forged_mount_crossbar", (0, .015, 1.48), (.92, .09, .16), "mine_iron", bevel=.015)
    for side in (-1, 1):
        x = side * .32
        W.hook(x, 1.48)
        for i in range(4):
            ring("Interlocked_chain", x, -.20, 1.32-i*.13, .09, .027, i % 2 == 1)
        ring("Heavy_wrist_cuff", x, -.20, .69, .19, .052)
        S.box("Cuff_hinge", (x-.17, -.20, .69), (.09, .09, .16), "mine_rust", bevel=.012)
        S.box("Cuff_lock", (x+.17, -.20, .69), (.10, .10, .15), "mine_iron", bevel=.015)


def mourning_banner():
    S.cylinder("Iron_banner_rod", (0, -.06, 1.62), .045, 1.30, "mine_iron",
               rotation=(0, math.pi/2, 0))
    for x in (-.49, .49):
        W.hook(x, 1.61)
    # Continuous folded cloth, with a torn hem modeled into its silhouette.
    verts, faces = [], []
    cols, rows = 12, 9
    for j in range(rows):
        for i in range(cols):
            x = -.49 + i / (cols-1) * .98
            y = -.115 - .045 * math.cos(i / (cols-1) * math.pi * 4) - j * .007
            z = 1.59 - j / (rows-1) * 1.26
            if j == rows-1:
                z += [.12,.02,.18,.05,.13,.01,.17,.03,.10,.01,.20,.09][i]
            verts.append((x,y,z))
            if i and j:
                n = j*cols+i
                faces.append((n-cols-1,n-cols,n,n-1))
    cloth = M.mesh("Torn_folded_mourning_cloth", verts, faces, "horror_cloth")
    solid = cloth.modifiers.new("Cloth_thickness", "SOLIDIFY")
    solid.thickness = .014
    # A muted funerary stripe, with no arrows or readable quest text.
    S.curve("Faded_funeral_mark", [(0,-.20,1.40),(0,-.23,1.00),(-.12,-.23,.86),
                                  (0,-.23,.73),(.12,-.23,.86),(0,-.23,1.00)], .018, "horror_ochre")


def bone_reliquary():
    S.box("Dark_recess_back", (0, .025, .97), (1.08, .09, 1.12), "mine_wood_dark", bevel=.025)
    for x in (-.55, .55):
        S.box("Reliquary_side", (x,-.09,.98), (.12,.30,1.21), "mine_wood", bevel=.018)
    for z in (.40,1.55):
        S.box("Reliquary_lintel", (0,-.09,z), (1.20,.30,.12), "mine_wood", bevel=.018)
    for a,b in [((-.34,-.18,.63),(.34,-.18,1.32)),
                ((.34,-.20,.63),(-.34,-.20,1.32))]:
        S.curve("Old_long_bone", [a,b], .057, "horror_bone")
        for x,y,z in (a,b):
            for dx in (-.036,.036):
                S.sphere("Bone_joint", (x+dx,y,z), (.065,.058,.063), "horror_bone")
    for x in (-.40,.40):
        S.box("Protective_iron_strap", (x,-.27,.97), (.055,.055,1.14), "mine_iron", bevel=.008)
        for z in (.45,1.48):
            S.sphere("Strap_rivet", (x,-.304,z), (.026,.017,.026), "mine_rust")
    W.hook(0,1.66)


def broken_bell():
    S.box("Bell_mount_plate", (0,.015,1.44), (.30,.08,.65), "mine_iron", bevel=.022)
    S.curve("Bell_bracket", [(0,-.015,1.72),(0,-.30,1.72),(0,-.53,1.55),
                             (0,-.53,1.42)], .052, "mine_iron")
    ring("Bell_hanging_loop", 0,-.53,1.35,.085,.035)
    # Hollow bronze shell; a missing lower wedge gives a clear broken lip.
    profile = [(1.26,.11),(1.20,.20),(1.03,.23),(.77,.30),(.64,.43),(.59,.44)]
    verts, faces, count = [], [], 32
    for inside in (False,True):
        for z,radius in profile:
            for i in range(count):
                a = i/count*math.tau
                r = radius-(.038 if inside else 0)
                verts.append((r*math.cos(a),-.53+r*math.sin(a),z+(.012 if inside else 0)))
    layer = len(profile)*count
    for side in range(2):
        for j in range(len(profile)-1):
            for i in range(count):
                if j >= 3 and 20 <= i <= 23:
                    continue
                a = side*layer+j*count+i
                b = side*layer+j*count+(i+1)%count
                faces.append((a,b,b+count,a+count))
    for i in range(count):
        if 20 <= i <= 23:
            continue
        a = (len(profile)-1)*count+i
        b = (len(profile)-1)*count+(i+1)%count
        faces.append((a,b,b+layer,a+layer))
    M.mesh("Cracked_hollow_bronze_bell", verts, faces, "horror_bronze", .006)
    S.cylinder("Bell_clapper_stem", (0,-.53,.86), .035,.62,"mine_iron")
    S.sphere("Bell_clapper", (0,-.53,.55), (.085,.085,.105),"mine_iron")


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    S.clear_scene()
    S.setup_materials()
    M.OLD.setup_materials()
    P.apply_mine_palette(M)
    S.material("horror_cloth", (.17,.075,.09), .98)
    S.material("horror_ochre", (.29,.24,.16), .96)
    S.material("horror_bone", (.34,.30,.22), .94)
    S.material("horror_bronze", (.19,.15,.085), .78, metallic=.48)
    scene, camera = M.F.setup_scene()
    bpy.context.preferences.filepaths.save_version = 0
    camera.data.ortho_scale = S.PROP_ORTHO_SCALE
    camera.data.shift_y = S.PROP_BOTTOM_RATIO - .5
    scene.render.resolution_x = scene.render.resolution_y = 512
    specs = [("shackles","锈铁镣铐",shackles,1.0),
             ("mourning_banner","破损丧幡",mourning_banner,.8),
             ("bone_reliquary","封骨匣",bone_reliquary,.65),
             ("broken_bell","残钟挂架",broken_bell,.55)]
    for key, _, build, _ in specs:
        S.new_model(key,(0,0,0))
        build()
    assets = []
    for key,label,_,weight in specs:
        asset = {"id":key,"labelZh":label,"weight":weight,"views":{}}
        for axis,degrees in (("down",-S.ROOT_ROTATION_DEG),("up",S.ROOT_ROTATION_DEG)):
            for name,collection in S.MODEL_COLLECTIONS.items():
                collection.hide_render = name != key
            root = S.MODEL_ROOTS[key]
            root.rotation_euler.z = math.radians(degrees)
            bpy.context.view_layer.update()
            anchor = world_to_camera_view(scene,camera,root.matrix_world @ Vector((0,0,.95)))
            name = f"horror_wall_decor_{key}_{axis}"
            scene.render.filepath = str(OUT/f"{name}.png")
            bpy.ops.render.render(write_still=True)
            asset["views"][axis] = {"key":name,"src":f"assets/terrain/horror-wall-decor/{name}.png",
                "origin":[round(anchor.x,7),round(1-anchor.y,7)],"displayWidth":307.2,"source":f"{name}.png"}
        assets.append(asset)
    for collection in S.MODEL_COLLECTIONS.values():
        collection.hide_render = False
    for i,(key,*_) in enumerate(specs):
        S.MODEL_ROOTS[key].location.x = i*2.4
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"horror_wall_decor.blend"))
    manifest = {"stage":"native modeled wall props","runtimeInstalled":False,
        "generator":"tools/ai-gen/build-horror-wall-decor.py","blend":"horror_wall_decor.blend",
        "materialLibrary":"tools/ai-gen/environment-prop-materials.py","materialVersion":P.VERSION,
        "sharedHelpers":["build-mine-wall-decor.py","build-mine-props-model-review.py",
                         "build-abandoned-mine-terrain.py","build-world122-street-decor.py","mine-prop-render-contract.py"],
        "camera":{"elevation":S.CAMERA_ELEVATION_DEG,"rootDirections":[-S.ROOT_ROTATION_DEG,S.ROOT_ROTATION_DEG],
                  "orthoScale":S.PROP_ORTHO_SCALE,"bottomRatio":S.PROP_BOTTOM_RATIO,"resolution":[512,512]},
        "mountAnchorLocal":[0,0,.95],"worldPixelsPerModelUnit":48,
        "policy":"Native RGBA, fixed camera and lighting, two modeled wall axes; no ground plane, cast shadow, collision, interaction, sound or glow",
        "aiGeneration":False,"assets":assets}
    path = OUT/"manifest.json"
    previous = json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}
    for key in ("runtimeInstalled","installationRecord"):
        if key in previous:
            manifest[key] = previous[key]
    path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")


if __name__ == "__main__":
    main()
