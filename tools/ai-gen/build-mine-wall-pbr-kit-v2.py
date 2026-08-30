"""Mine wall/independent gate material revision, candidates only.

Reuse the accepted geometry dimensions and gate motion. Do not install assets.
The earlier candidate scripts and outputs are left intact.
"""
import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_wall_pbr_kit_v2_20260830"
spec = importlib.util.spec_from_file_location("mine_theme", HERE / "build-mine-wall-pbr-kit.py")
theme = importlib.util.module_from_spec(spec)
spec.loader.exec_module(theme)
base, kit = theme.base, theme.kit


def quiet_relief(u, z):
    """Interrupted shallow cleavage, instead of four continuous wavy bands."""
    phase = 2 * math.pi * (u - .5) * 2.12 / base.PITCH
    collar = base.smooth(z / .18) * base.smooth((base.H - z) / .16)
    value = .040 + .010 * math.sin(phase + z*1.4) + .007 * math.sin(z*5.1 - math.cos(phase))
    for level, bend, offset in ((.57,.045,.7), (1.43,.055,2.8), (2.39,.038,4.6)):
        d = z - level - bend * math.sin(phase + offset)
        # Gaps along the strata remove a strong continuous zigzag motif.
        strength = .16 + .84 * base.smooth((math.sin(phase+offset*.8)+.5)/1.5)
        value += strength * .018 * math.tanh(d/.025) * math.exp(-abs(d)/.12)
    split = math.sin(phase + .58*z)
    value -= .009 * math.exp(-(split/.065)**2) * base.smooth(z/.4) * base.smooth((base.H-z)/.4)
    return .006 + collar * max(.003, value)


def wood_material(axis):
    mat = kit.noisy_material("Shared mine oak " + axis, "#3e3a32", "#736a55", 2.0, .12, .87)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    noise = next(n for n in nodes if n.type == "TEX_NOISE")
    noise.inputs["Detail"].default_value = 2
    noise.inputs["Roughness"].default_value = .55
    ramp = next(n for n in nodes if n.type == "VALTORGB")
    for element, color in zip(ramp.color_ramp.elements, ("#3e3a32", "#736a55")):
        element.color = base.linear_hex(color)
    next(n for n in nodes if n.type == "BUMP").inputs["Distance"].default_value = .025
    coords = nodes.new("ShaderNodeTexCoord")
    stretch = nodes.new("ShaderNodeVectorMath")
    stretch.operation = "MULTIPLY"
    stretch.inputs[1].default_value = tuple(.65 if letter == axis else 20 for letter in "XYZ")
    links.new(coords.outputs["Object"],stretch.inputs[0])
    links.new(stretch.outputs[0],noise.inputs["Vector"])
    return mat


def shared_metals():
    iron = kit.plain_material("Shared matte mine iron", "#44484a", .80, .50)
    iron.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value = base.linear_hex("#44484a")
    rust = kit.noisy_material("Shared sparse iron oxidation", "#3f3730", "#625442", 6.0, .07, .86)
    nodes = rust.node_tree.nodes
    ramp = next(n for n in nodes if n.type == "VALTORGB")
    for element, color in zip(ramp.color_ramp.elements, ("#3f3730", "#625442")):
        element.color = base.linear_hex(color)
    next(n for n in nodes if n.type == "BSDF_PRINCIPLED").inputs["Metallic"].default_value = .3
    next(n for n in nodes if n.type == "BUMP").inputs["Distance"].default_value = .015
    return iron, rust


def visible(collection, enabled):
    kit.set_collection_visible(collection, enabled)
    # The legacy Depth helper checks object visibility, not collection state.
    for obj in collection.all_objects:
        obj.hide_render = not enabled


def beauty_and_depth(beauty, depth, size):
    scene = bpy.context.scene
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    kit.render(beauty,size,size)
    scene.view_settings.view_transform = "Raw"
    scene.view_settings.look = "None"
    scene.render.image_settings.color_mode = "BW"
    scene.render.image_settings.color_depth = "16"
    kit.render_depth(depth,size,size)


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    # Isolated Blender process: configure imported helpers without editing v1.
    theme.OUT = OUT
    base.relief = quiet_relief
    wall_camera = kit.setup_scene()
    scene = bpy.context.scene
    for obj in scene.objects:
        if obj.type == "LIGHT":
            obj.data.type = "SUN"
            obj.data.color = (1,1,1)
            obj.data.energy = 1.8 if obj.name == "ColdShaftKey" else 1.2
            obj.data.angle = .30 if obj.name == "ColdShaftKey" else .60
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.16,.16,.16,1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .35
    wall_camera.data.ortho_scale = 5.25
    wall_camera.location = (10,-10,9.645)
    kit.look_at(wall_camera,(0,0,1.48))
    kit.set_resolution(1024,1024)
    base.build_rock(base.rock_material())
    a = bpy.data.collections["A_continuous_bedrock_SHARED_FOR_FUTURE_B_C"]
    a.name = "A_quiet_cut_slate"
    theme.close_rock_corners(a)
    face, crown = theme.mapped_stone(), theme.mapped_stone(True)
    for obj in a.objects:
        if obj.name.startswith("Continuous cleavage face"):
            theme.set_uv(obj,int(obj.name.rsplit(" ",1)[-1]))
            obj.data.materials[0] = face
        elif obj.name.startswith("Joined crown"):
            theme.set_uv(obj)
            obj.data.materials[0] = crown
    b = theme.duplicate_base(a,"B_sparse_nonemissive_ore")
    c = theme.duplicate_base(a,"C_occasional_oak_support")
    bpy.ops.object.select_all(action="DESELECT")
    theme.ore_variant(b)
    theme.wood_variant(c)
    woods = {axis: wood_material(axis) for axis in "XYZ"}
    iron, rust = shared_metals()
    for obj in c.objects:
        for slot in obj.material_slots:
            if slot.material.name.startswith("Shared aged oak"):
                # Bounds in mesh-local coordinates preserve the long axis of
                # rotated diagonal braces; world dimensions would select Z.
                extents = [max(v[i] for v in obj.bound_box)-min(v[i] for v in obj.bound_box) for i in range(3)]
                slot.material = woods["XYZ"[extents.index(max(extents))]]
            elif slot.material.name.startswith("Shared oxidized iron"):
                slot.material = iron
    gate, leaf = kit.build_gate({"timber_dark":woods["Z"],"iron":iron,"rust":rust})
    for obj in leaf.objects:
        if obj.name == "GateTimberDiagonal":
            obj.data.materials[0] = woods["X"]
    walls = [a,b,c]
    visible(gate,False)
    for index, collection in enumerate(walls):
        for other in walls:
            visible(other,other == collection)
        key = "abc"[index]
        beauty_and_depth(OUT/f"wall_{key}.png",OUT/f"wall_{key}_body_depth.png",1024)
    for collection in walls:
        visible(collection,False)
    visible(gate,True)
    gate_camera = wall_camera.copy()
    gate_camera.data = wall_camera.data.copy()
    gate_camera.name = "GateCamera_original_640px_contract"
    scene.collection.objects.link(gate_camera)
    scene.camera = gate_camera
    gate_camera.data.ortho_scale = 5.65
    gate_camera.location = (10,-10,9.745)
    kit.look_at(gate_camera,(0,0,1.58))
    kit.set_resolution(640,640)
    kit.calibrate_gate_camera(gate_camera)
    p0,p1 = sorted((kit.projected(kit.GATE_WORLD_A,640,640),kit.projected(kit.GATE_WORLD_B,640,640)),key=lambda p:p[0])
    original = {obj.name:obj.location.copy() for obj in leaf.objects}
    motion = []
    for frame in range(16):
        t = frame/15
        lift = 3.55*t*t*(3-2*t)
        for obj in leaf.objects:
            obj.location = original[obj.name] + Vector((0,0,lift))
            obj.keyframe_insert(data_path="location",frame=frame+1)
        scene.frame_set(frame+1)
        beauty_and_depth(OUT/f"gate_frames/gate_{frame:02d}.png",OUT/f"gate_depth/gate_{frame:02d}.png",640)
        motion.append({"frame":frame,"liftWorld":lift,"liftPixels":kit.projected((0,0,0),640,640)[1]-kit.projected((0,0,lift),640,640)[1]})
    scene.frame_start,scene.frame_end = 1,16
    scene.frame_set(1)
    visible(gate,False)
    visible(a,True)
    scene.camera = wall_camera
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    kit.set_resolution(1024,1024)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"mine_wall_and_gate_pbr_v2.blend"))
    wall_geo = json.loads((HERE/"_mine_wall_pbr_kit_20260830/geometry.json").read_text(encoding="utf-8"))
    wall_geo["materialMapping"] = "shared v1 flat albedo; v2 shallow interrupted cleavage; shared oak and iron"
    gate_geo = json.loads((HERE/"_abandoned_mine_wall_kit_20260828/geometry.json").read_text(encoding="utf-8"))["gate"]
    gate_geo.update({"base":[p0,p1],"face":[p0,p1],"gateX":[round(p0[0]),round(p1[0])],"hideWhenOpen":True,"tuckEndSlices":True})
    geometry = {"version":2,"runtimeInstalled":False,"wall":wall_geo,"gate":gate_geo,"gateMotion":motion,
                "gateSource":"../abandoned-mine-wall-kit-blender.py build_gate; original 3.55-world-unit smoothstep lift",
                "cameraContract":"Original separate wall/gate calibration, identical neutral SUN lighting"}
    (OUT/"geometry.json").write_text(json.dumps(geometry,ensure_ascii=False,indent=2),encoding="utf-8")
    print("CANDIDATE_ONLY",OUT,flush=True)


if __name__ == "__main__":
    main()
