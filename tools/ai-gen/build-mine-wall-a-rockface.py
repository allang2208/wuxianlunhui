"""Candidate only: continuous cut slate, using the existing mine wall camera.

Run with Blender --background --factory-startup --python this-file.py.
The untouched solid core owns coverage; shallow surface relief cannot open it.
No formal asset/config writes. Matching B/C must reuse this exact base model.
"""
import importlib.util
import json
import math
from pathlib import Path

import bpy

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_wall_a_rockface_20260830"
spec = importlib.util.spec_from_file_location("mine_wall_source", HERE / "abandoned-mine-wall-kit-blender.py")
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)
H = kit.WALL_CORE_HEIGHT
# 64 runtime X pixels / (260 / ortho_scale / sqrt(2)) pixels per model unit.
# The old core is deliberately wider than this placement period for coverage.
PITCH = 64 * 5.25 * math.sqrt(2) / 260


def linear_hex(value):
    values = kit.rgba(value)[:3]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in values) + (1,)


def rock_material():
    mat = bpy.data.materials.new("Shared neutral cut slate / broad mineral fields")
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = .87
    bsdf.inputs["Specular IOR Level"].default_value = .24
    coord = nodes.new("ShaderNodeTexCoord")
    split = nodes.new("ShaderNodeSeparateXYZ")
    links.new(coord.outputs["Object"],split.inputs["Vector"])
    periodic = []
    for axis in ("X","Y"):
        phase = nodes.new("ShaderNodeMath")
        phase.operation="MULTIPLY"
        phase.inputs[1].default_value=2*math.pi/PITCH
        links.new(split.outputs[axis],phase.inputs[0])
        sin = nodes.new("ShaderNodeMath")
        sin.operation="SINE"
        links.new(phase.outputs[0],sin.inputs[0])
        periodic.append(sin)
    texture_pos = nodes.new("ShaderNodeCombineXYZ")
    links.new(periodic[0].outputs[0],texture_pos.inputs["X"])
    links.new(periodic[1].outputs[0],texture_pos.inputs["Y"])
    links.new(split.outputs["Z"],texture_pos.inputs["Z"])
    broad = nodes.new("ShaderNodeTexNoise")
    broad.inputs["Scale"].default_value = 1.65
    broad.inputs["Detail"].default_value = 2.2
    broad.inputs["Roughness"].default_value = .58
    links.new(texture_pos.outputs["Vector"], broad.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = .12
    ramp.color_ramp.elements[0].color = linear_hex("#41484c")
    ramp.color_ramp.elements[1].position = .88
    ramp.color_ramp.elements[1].color = linear_hex("#737772")
    links.new(broad.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    grain = nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 31
    grain.inputs["Detail"].default_value = 2
    links.new(texture_pos.outputs["Vector"], grain.inputs["Vector"])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .19
    bump.inputs["Distance"].default_value = .022
    links.new(grain.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def smooth(value):
    value = max(0, min(1, value))
    return value * value * (3 - 2 * value)


def relief(u, z):
    # Repeat at the actual placement pitch, NOT the wider overlapping core.
    # A flat collar at every side edge creates a visible stripe after tiling.
    u = (u-.5)*2.12/PITCH
    collar = smooth(z / .18) * smooth((H-z) / .16)
    broad = .050 + .025 * math.sin(2*math.pi*u + z*1.4) + .018 * math.sin(z*6.1 - math.cos(2*math.pi*u))
    for level, bend, phase in ((.48,.08,.6), (1.17,.14,2.4), (1.92,.095,4.3), (2.53,.07,1.2)):
        meander = (2/math.pi)*math.asin(math.sin(2*math.pi*u+phase))
        d = z - level - bend*meander
        broad += .035 * math.tanh(d/.016) * math.exp(-abs(d)/.18)
    # Broad oblique splits; no floating stones, holes or black painted gaps.
    split = math.sin(2*math.pi*u + .86*z)
    broad -= .021*math.exp(-(split/.08)**2)*smooth(z/.4)*smooth((H-z)/.4)
    return .006 + collar * max(.003, broad)


def mesh(name, verts, faces, mat, collection):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.materials.append(mat)
    data.update()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    for polygon in data.polygons:
        polygon.use_smooth = True
    return obj


def build_rock(mat):
    col = bpy.data.collections.new("A_continuous_bedrock_SHARED_FOR_FUTURE_B_C")
    bpy.context.scene.collection.children.link(col)
    kit.cube("Unbroken coverage core 2.12 x 2.12 x 3.04", (0,0,H/2), (2.12,2.12,H), mat, .018, col)
    nx, nz = 80, 112
    for side in range(4):
        angle = side * math.pi/2
        c, s = math.cos(angle), math.sin(angle)
        verts, faces = [], []
        for iz in range(nz+1):
            z = H*iz/nz
            for ix in range(nx+1):
                u = ix/nx
                # Merge the 2.24-wide foot into the rock face, without the
                # old detached-looking rectangular foundation lip.
                toe = .06*(1-smooth(z/.25))
                x, y = (u-.5)*(2.12+2*toe), -1.06-toe-relief(u,z)
                verts.append((x*c-y*s, x*s+y*c, z))
        for iz in range(nz):
            for ix in range(nx):
                i = iz*(nx+1)+ix
                faces.append((i,i+1,i+nx+2,i+nx+1))
        mesh(f"Continuous cleavage face {side}", verts, faces, mat, col)
    # Connected crown, with a flat outer collar. Avoid the old periodic piles
    # of separate crown stones that read as a row of individual pillars.
    n = 64
    verts, faces = [], []
    for j in range(n+1):
        y = -1.068 + 2.136*j/n
        for i in range(n+1):
            x = -1.068 + 2.136*i/n
            fade = smooth((1.068-max(abs(x),abs(y)))/.26)
            z = H + .003 + fade*.004*(1+math.sin(2*math.pi*x/PITCH)*math.cos(2*math.pi*y/PITCH))
            verts.append((x,y,z))
    for j in range(n):
        for i in range(n):
            k = j*(n+1)+i
            faces.append((k,k+1,k+n+2,k+n+1))
    mesh("Joined crown with common edge height", verts, faces, mat, col)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    camera = kit.setup_scene()
    scene = bpy.context.scene
    # Neutral studio lighting shared across all later wall variants. Existing
    # fixed camera gives the runtime 2:1 ground axes; never rotate sprites.
    for obj in scene.objects:
        if obj.type == "LIGHT":
            obj.data.color = (1,1,1)
            obj.data.type = "SUN"
            obj.data.energy = 1.8 if obj.name == "ColdShaftKey" else 1.2
            obj.data.angle = .30 if obj.name == "ColdShaftKey" else .60
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value = (.16,.16,.16,1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value = .35
    scene.view_settings.look = "AgX - Medium High Contrast"
    camera.data.ortho_scale = 5.25
    camera.location = (10,-10,9.645)
    kit.look_at(camera, (0,0,1.48))
    kit.set_resolution(1024,1024)
    build_rock(rock_material())
    # Save the calibrated beauty scene (not the temporary depth compositor).
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / "mine_wall_a_rockface.blend"))
    kit.render(OUT / "wall_a_native.png",1024,1024)
    scene.view_settings.view_transform = "Raw"
    scene.view_settings.look = "None"
    scene.render.image_settings.color_mode = "BW"
    scene.render.image_settings.color_depth = "16"
    kit.render_depth(OUT / "wall_a_body_depth.png",1024,1024)
    geo = {
        "key":"abandoned_mine_block_a", "canvas":[1024,1024],
        "groundCenter":kit.projected((0,0,0),1024,1024), "display":[260,259],
        "wallH":132, "halfThick":13, "footprint":[128,64], "modelCore":[2.12,2.12,H],
        "camera":{"position":list(camera.location),"target":[0,0,1.48],"orthoScale":5.25},
        "allowFlipX":False, "runtimeInstalled":False,
        "seamContract":{"solidCore":True,"textureAndReliefPeriodWorld":PITCH,"crownEdgeHeight":H+.003,
                        "runtimeSteps":[[64,32],[-64,32]],"futureVariantsReuseBase":True},
    }
    (OUT / "geometry.json").write_text(json.dumps(geo,ensure_ascii=False,indent=2),encoding="utf-8")
    print("CANDIDATE_ONLY",OUT,flush=True)


if __name__ == "__main__":
    main()
