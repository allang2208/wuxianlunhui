"""Local v3 production: geological relief, continuous crown, exposed gate iron.

Uses the previously accepted Dev stone variation, never regenerates geometry
from AI. Writes only this candidate batch. Fixed cameras/anchors are inherited.
"""
import importlib.util
import json
import math
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_visual_finish_v3_20260830"
spec = importlib.util.spec_from_file_location("mine_v2", HERE / "build-mine-wall-pbr-kit-v2.py")
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)
theme, base, kit = v2.theme, v2.base, v2.kit


def tri(t):
    return 2 / math.pi * math.asin(math.sin(t))


def relief(u, z):
    p = 2 * math.pi * (u - .5) * 2.12 / base.PITCH
    collar = base.smooth(z / .18) * base.smooth((base.H-z) / .22)
    # Oblique broad cleavage planes, no horizontal courses or stacked blocks.
    value = .062 + .034*tri(p+.62*z) + .021*tri(2*p-1.13*z+.8)
    value += .009*math.sin(z*4.3+1.1*math.sin(p))
    value -= .012*math.exp(-(math.sin(p+.8*z)/.07)**2)
    return .006 + collar*max(.006, value)


def crown_height(x, y):
    p, q = 2*math.pi*x/base.PITCH, 2*math.pi*y/base.PITCH
    # Shared analytic surface repeats at runtime pitch, including overlap.
    # Entire crown stays above the solid coverage core.
    return base.H+.079+.038*tri(p+.5*math.sin(q))+.022*tri(q-.4*math.sin(p))+.012*tri(p+q+.7)


def stone(key, top=False):
    mat = base.rock_material()
    mat.name = f"Accepted Dev geological slate {key} {'crown' if top else 'face'}"
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    uv = nodes.new("ShaderNodeUVMap")
    uv.uv_map = "RockPeriod"
    tex = nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(OUT / f"stone_{key}_{'crown' if top else 'face'}.png"), check_existing=True)
    tex.image.pack()
    tex.extension = "REPEAT"
    links.new(uv.outputs["UV"], tex.inputs["Vector"])
    links.new(tex.outputs["Color"], nodes.get("Principled BSDF").inputs["Base Color"])
    # Small-scale normal detail is subordinate to actual broad rock relief.
    bump = next(n for n in nodes if n.type == "BUMP")
    bump.inputs["Strength"].default_value = .12
    bump.inputs["Distance"].default_value = .012
    return mat


def wood(axis):
    mat = v2.wood_material(axis)
    mat.name = "V3 seasoned mine oak " + axis
    nodes = mat.node_tree.nodes
    ramp = next(n for n in nodes if n.type == "VALTORGB")
    for element, color in zip(ramp.color_ramp.elements, ("#494034", "#807159")):
        element.color = base.linear_hex(color)
        element.position = .27 if element == ramp.color_ramp.elements[0] else .73
    stretch = next(n for n in nodes if n.type == "VECT_MATH")
    stretch.inputs[1].default_value = tuple(.55 if letter == axis else 9 for letter in "XYZ")
    next(n for n in nodes if n.type == "BUMP").inputs["Distance"].default_value = .012
    return mat


def mask(collection, path, size):
    saved = []
    mats = []
    for label, color in (("stone", (0,0,0,1)), ("wood", (1,0,0,1)), ("metal", (0,1,0,1))):
        mat = bpy.data.materials.new("Component " + label)
        mat.use_nodes = True
        nodes, links = mat.node_tree.nodes, mat.node_tree.links
        nodes.clear()
        surface = nodes.new("ShaderNodeEmission")
        surface.inputs["Color"].default_value = color
        output = nodes.new("ShaderNodeOutputMaterial")
        links.new(surface.outputs[0], output.inputs["Surface"])
        mats.append(mat)
    for obj in list(collection.all_objects):
        if obj.type != "MESH":
            continue
        saved.append((obj, list(obj.data.materials)))
        is_stone = obj.name.startswith(("Unbroken", "Continuous", "Joined"))
        is_wood = any("oak" in m.name.lower() for m in obj.data.materials if m)
        obj.data.materials.clear()
        obj.data.materials.append(mats[0 if is_stone else 1 if is_wood else 2])
    scene = bpy.context.scene
    scene.compositing_node_group = None
    scene.view_settings.view_transform = "Raw"
    scene.view_settings.look = "None"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    kit.render(path, size, size)
    for obj, materials in saved:
        obj.data.materials.clear()
        for material in materials:
            obj.data.materials.append(material)


def main():
    OUT.mkdir(exist_ok=True)
    base.relief = relief
    camera = kit.setup_scene()
    scene = bpy.context.scene
    for obj in list(scene.objects):
        if obj.type == "LIGHT":
            obj.data.type = "SUN"
            obj.data.color = (1,1,1)
            obj.data.energy = 1.8 if obj.name == "ColdShaftKey" else 1.2
            obj.data.angle = .30 if obj.name == "ColdShaftKey" else .60
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.16,.16,.16,1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .35
    camera.data.ortho_scale = 5.25
    camera.location = (10,-10,9.645)
    kit.look_at(camera, (0,0,1.48))
    base.build_rock(base.rock_material())
    a = bpy.data.collections["A_continuous_bedrock_SHARED_FOR_FUTURE_B_C"]
    a.name = "A_geological_slate"
    theme.close_rock_corners(a)
    for obj in list(a.objects):
        if obj.name.startswith("Continuous"):
            for vertex in obj.data.vertices:
                x,y,z = vertex.co
                vertex.co.z += (crown_height(x,y)-base.H)*base.smooth((z-(base.H-.38))/.38)
            theme.set_uv(obj, int(obj.name.rsplit(" ",1)[-1]))
        elif obj.name.startswith("Joined"):
            for vertex in obj.data.vertices:
                vertex.co.z = crown_height(vertex.co.x, vertex.co.y)
            theme.set_uv(obj)
    b = theme.duplicate_base(a, "B_geological_ore")
    c = theme.duplicate_base(a, "C_geological_support")
    walls = [a,b,c]
    # Independent material slots, shared vertex positions/UV and edge shape.
    for key, group in zip("abc", walls):
        face, cap = stone(key), stone(key, True)
        for obj in list(group.objects):
            obj.data = obj.data.copy()
            obj.data.materials[0] = cap if obj.name.startswith("Joined") else face
    bpy.ops.object.select_all(action="DESELECT")
    theme.ore_variant(b)
    for obj in list(b.objects):
        if obj.name.startswith(("Sparse iron seam", "Short mineral branch")):
            mat = obj.data.materials[0]
            bsdf = mat.node_tree.nodes.get("Principled BSDF")
            bsdf.inputs["Base Color"].default_value = base.linear_hex("#636b6c")
            bsdf.inputs["Metallic"].default_value = .10
            bsdf.inputs["Roughness"].default_value = .90
    theme.wood_variant(c)
    woods = {axis: wood(axis) for axis in "XYZ"}
    iron, rust = v2.shared_metals()
    iron.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value = .66
    for obj in list(c.objects):
        for slot in obj.material_slots:
            if slot.material.name.startswith("Shared aged oak"):
                extents = [max(v[i] for v in obj.bound_box)-min(v[i] for v in obj.bound_box) for i in range(3)]
                slot.material = woods["XYZ"[extents.index(max(extents))]]
            elif slot.material.name.startswith("Shared oxidized iron"):
                slot.material = iron
    gate, leaf = kit.build_gate({"timber_dark": woods["Z"], "iron": iron, "rust": rust})
    for obj in list(leaf.objects):
        # v2 rails/rivets were embedded inside the timber. Expose their front
        # faces; keep slat centers, tips, gaps and camera registration unchanged.
        if obj.name.startswith("GateIronRail"):
            obj.location.y = -.115
        elif obj.name.startswith("GateRivet"):
            obj.location.y = -.186
            obj.data.materials[0] = iron
        elif obj.name == "GateTimberDiagonal":
            obj.data.materials[0] = woods["X"]
            obj.location.y = .16  # rear brace, not interpenetrating front rails
    v2.visible(gate, False)
    for key, group in zip("abc", walls):
        for other in walls:
            v2.visible(other, other == group)
        v2.beauty_and_depth(OUT/f"wall_{key}_native.png", OUT/f"wall_{key}_depth.png", 1024)
        if key in "bc":
            mask(group, OUT/f"wall_{key}_component_mask.png", 1024)
    for group in walls:
        v2.visible(group, False)
    v2.visible(gate, True)
    gate_camera = camera.copy()
    gate_camera.data = camera.data.copy()
    gate_camera.name = "GateCamera_original_640px_contract"
    scene.collection.objects.link(gate_camera)
    scene.camera = gate_camera
    gate_camera.data.ortho_scale = 5.65
    gate_camera.location = (10,-10,9.745)
    kit.look_at(gate_camera,(0,0,1.58))
    kit.set_resolution(640,640)
    kit.calibrate_gate_camera(gate_camera)
    v2.beauty_and_depth(OUT/"gate_native.png", OUT/"gate_depth.png", 640)
    mask(gate, OUT/"gate_component_mask.png", 640)
    v2.visible(gate, False)
    v2.visible(a, True)
    scene.camera = camera
    scene.compositing_node_group = None
    scene.view_settings.view_transform = "AgX"
    scene.view_settings.look = "AgX - Medium High Contrast"
    kit.set_resolution(1024,1024)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"mine_visual_v3.blend"))
    geometry = json.loads((HERE/"_mine_wall_dev_final_20260830/geometry.json").read_text(encoding="utf-8"))
    geometry.update(version=3, runtimeInstalled=False)
    geometry["wall"]["runtimeInstalled"] = False
    geometry["wall"]["seamContract"].pop("crownEdgeHeight", None)
    geometry["wall"]["seamContract"]["crown"] = "continuous analytic two-axis periodic surface above untouched core; shared by ABC"
    geometry["wall"]["materialMapping"] = "accepted Dev material variation on authored UV; no baked source lighting"
    geometry["changes"] = ["oblique relief without horizontal courses", "continuous uneven crown", "exposed gate rails and fasteners", "shared seasoned oak"]
    (OUT/"geometry.json").write_text(json.dumps(geometry,ensure_ascii=False,indent=2), encoding="utf-8")
    print("V3_CANDIDATE_ONLY", OUT, flush=True)


if __name__ == "__main__":
    main()
