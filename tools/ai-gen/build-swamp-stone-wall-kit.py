"""Author swamp 1x1 stone columns and a bilateral growing-vine gate.

Blender 5.1, native PBR rendering. The mine kit supplies camera/render helpers
only; all swamp meshes and materials are authored here. No runtime writes.
"""
from __future__ import annotations

import importlib.util
import argparse
import json
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector

HERE = Path(__file__).resolve().parent
OUT = HERE / "_swamp_stone_wall_kit_20260830"
spec = importlib.util.spec_from_file_location("wall_camera", HERE / "abandoned-mine-wall-kit-blender.py")
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)
H = 3.04
HALF = 1.06
PITCH = 64 * 5.25 * math.sqrt(2) / 260
NAMES = ["Wet weathered stone", "Moss patches", "Eroded fissures", "Embedded roots"]


def linear(value):
    rgb = kit.rgba(value)[:3]
    return tuple(v / 12.92 if v <= .04045 else ((v + .055) / 1.055) ** 2.4 for v in rgb) + (1,)


def smooth(value):
    t = max(0, min(1, value))
    return t * t * (3 - 2 * t)


def math_node(nodes, links, op, a, b=0):
    node = nodes.new("ShaderNodeMath")
    node.operation = op
    for i, value in enumerate((a, b)):
        if isinstance(value, (int, float)):
            node.inputs[i].default_value = value
        else:
            links.new(value, node.inputs[i])
    return node.outputs[0]


def material(variant=0, wood=False, clip=False):
    mat = bpy.data.materials.new(("Gate waterlogged wood" if wood else NAMES[variant]) + (" clipped" if clip else ""))
    mat.use_nodes = True
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = .84 if wood else .80
    bsdf.inputs["Specular IOR Level"].default_value = .23
    geo = nodes.new("ShaderNodeNewGeometry")
    split = nodes.new("ShaderNodeSeparateXYZ")
    coords = nodes.new("ShaderNodeTexCoord")
    links.new(coords.outputs["Object"] if wood else geo.outputs["Position"], split.inputs[0])
    coord = nodes.new("ShaderNodeCombineXYZ")
    for axis in "XY":
        phase = math_node(nodes, links, "MULTIPLY", split.outputs[axis], 2 * math.pi / PITCH)
        links.new(math_node(nodes, links, "SINE", phase), coord.inputs[axis])
    links.new(split.outputs["Z"], coord.inputs["Z"])
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 2.8 if wood else 2.1
    noise.inputs["Detail"].default_value = 3
    links.new(coord.outputs[0], noise.inputs["Vector"])
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = .15
    ramp.color_ramp.elements[1].position = .85
    for element, color in zip(ramp.color_ramp.elements, ("#424034", "#71644c") if wood else ("#4c5350", "#818378")):
        element.color = linear(color)
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])

    # Quiet green patina shared by every variant; denser moss remains local to
    # the face centre, so variant changes cannot introduce edge stripes.
    minxy = math_node(nodes, links, "MINIMUM", math_node(nodes, links, "ABSOLUTE", split.outputs["X"]),
                      math_node(nodes, links, "ABSOLUTE", split.outputs["Y"]))
    fade = math_node(nodes, links, "MAXIMUM", math_node(nodes, links, "SUBTRACT", .83, minxy), 0)
    moss_noise = nodes.new("ShaderNodeTexNoise")
    moss_noise.inputs["Scale"].default_value = 5.5
    moss_noise.inputs["Detail"].default_value = 2
    links.new(coord.outputs[0], moss_noise.inputs[0])
    threshold = math_node(nodes, links, "MAXIMUM", math_node(nodes, links, "SUBTRACT", moss_noise.outputs["Fac"], .47), 0)
    density = .6 if wood else [1.05, 4.0, 1.12, 1.6][variant]
    patch = math_node(nodes, links, "MULTIPLY", threshold, density)
    patch = math_node(nodes, links, "MULTIPLY", patch, fade)
    mix = nodes.new("ShaderNodeMixRGB")
    links.new(patch, mix.inputs[0])
    links.new(ramp.outputs[0], mix.inputs[1])
    mix.inputs[2].default_value = linear("#64715a")
    # Shared low waterline darkening, continuous around all four sides.
    wet = math_node(nodes, links, "MAXIMUM", math_node(nodes, links, "SUBTRACT", .42, split.outputs["Z"]), 0)
    wet_mix = nodes.new("ShaderNodeMixRGB")
    links.new(wet, wet_mix.inputs[0])
    links.new(mix.outputs[0], wet_mix.inputs[1])
    wet_mix.inputs[2].default_value = linear("#363f38")
    links.new(wet_mix.outputs[0], bsdf.inputs["Base Color"])
    grain = nodes.new("ShaderNodeTexNoise")
    grain.inputs["Scale"].default_value = 34
    grain.inputs["Detail"].default_value = 2
    links.new(coord.outputs[0], grain.inputs[0])
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = .21
    bump.inputs["Distance"].default_value = .035 if wood else .025
    links.new(grain.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs[0], bsdf.inputs["Normal"])
    if not wood:
        fractures = nodes.new("ShaderNodeTexVoronoi")
        fractures.feature = "DISTANCE_TO_EDGE"
        fractures.inputs["Scale"].default_value = 3.8
        links.new(coord.outputs[0], fractures.inputs["Vector"])
        fissure = nodes.new("ShaderNodeValToRGB")
        fissure.color_ramp.elements[0].position = .008
        fissure.color_ramp.elements[0].color = (.48,.48,.48,1)
        fissure.color_ramp.elements[1].position = .038
        fissure.color_ramp.elements[1].color = (1,1,1,1)
        links.new(fractures.outputs["Distance"],fissure.inputs[0])
        fissure_mix = nodes.new("ShaderNodeMixRGB")
        fissure_mix.blend_type="MULTIPLY"
        fissure_mix.inputs[0].default_value=.42
        links.new(wet_mix.outputs[0],fissure_mix.inputs[1])
        links.new(fissure.outputs[0],fissure_mix.inputs[2])
        links.new(fissure_mix.outputs[0],bsdf.inputs["Base Color"])
        cracks = nodes.new("ShaderNodeBump")
        cracks.inputs["Strength"].default_value=.24
        cracks.inputs["Distance"].default_value=.048
        links.new(fissure.outputs[0],cracks.inputs["Height"])
        links.new(bump.outputs[0],cracks.inputs["Normal"])
        links.new(cracks.outputs[0],bsdf.inputs["Normal"])
    if clip:
        world_z = nodes.new("ShaderNodeSeparateXYZ")
        links.new(geo.outputs["Position"], world_z.inputs[0])
        transparent = nodes.new("ShaderNodeBsdfTransparent")
        shader_mix = nodes.new("ShaderNodeMixShader")
        links.new(math_node(nodes, links, "LESS_THAN", world_z.outputs["Z"], .001), shader_mix.inputs[0])
        links.new(bsdf.outputs[0], shader_mix.inputs[1])
        links.new(transparent.outputs[0], shader_mix.inputs[2])
        links.new(shader_mix.outputs[0], nodes.get("Material Output").inputs[0])
    return mat


def mesh(name, vertices, faces, mat, collection):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.materials.append(mat)
    data.update()
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    for polygon in data.polygons:
        polygon.use_smooth = True
    return obj


def relief(along, z, variant):
    phase = 2 * math.pi * along / PITCH
    collar = smooth(z / .14) * smooth((H-z) / .18)
    tri=lambda x: 2/math.pi*math.asin(math.sin(x))
    common = .038 + .022 * tri(phase + .7*z) + .014 * tri(2*phase - 1.5*z)
    # A continuous solid core remains behind the shallow real surface cuts.
    local = smooth((.79-abs(along))/.24) * smooth(z/.4) * smooth((H-z)/.4)
    if variant == 2:
        crack = math.exp(-((along - .16*math.sin(z*2.2) + .12)/.028)**2)
        common -= local * .029 * crack
    return .004 + collar * max(.002, common)


def curve(name, points, width, mat, collection):
    data = bpy.data.curves.new(name, "CURVE")
    data.dimensions = "3D"
    data.resolution_u = 12
    data.bevel_depth = width
    data.bevel_resolution = 2
    spline = data.splines.new("BEZIER")
    spline.bezier_points.add(len(points)-1)
    for i, (p, co) in enumerate(zip(spline.bezier_points, points)):
        p.co = co
        p.handle_left_type = p.handle_right_type = "AUTO"
        p.radius = .35 + .65 * math.sin(math.pi * (i+.25)/(len(points)-.5))
    obj = bpy.data.objects.new(name, data)
    collection.objects.link(obj)
    data.materials.append(mat)
    return obj


def build_wall(index):
    col = bpy.data.collections.new(f"SwampWall_{chr(97+index)}_{NAMES[index]}")
    bpy.context.scene.collection.children.link(col)
    mat = material(index)
    kit.cube("Solid seam coverage core", (0, 0, H/2), (2.12, 2.12, H), mat, .014, col)
    nx, nz = 56, 92
    side_vertices=[]
    for side in range(4):
        angle = side * math.pi/2
        c, s = math.cos(angle), math.sin(angle)
        verts, faces = [], []
        for iz in range(nz+1):
            z = H*iz/nz
            for ix in range(nx+1):
                along = -HALF + 2*HALF*ix/nx
                toe = .035 * (1-smooth(z/.18))
                x, y = along, -HALF-toe-relief(along, z, index)
                verts.append((x*c-y*s, x*s+y*c, z))
        for iz in range(nz):
            for ix in range(nx):
                i = iz*(nx+1)+ix
                faces.append((i, i+1, i+nx+2, i+nx+1))
        mesh(f"Water eroded monolith face {side}", verts, faces, mat, col)
        side_vertices.append(verts)
    for side in range(4):
        verts=[]
        for iz in range(nz+1):
            verts.extend([side_vertices[side][iz*(nx+1)+nx],side_vertices[(side+1)%4][iz*(nx+1)]])
        mesh(f"Connected chamfer corner {side}",verts,[(i*2,i*2+1,i*2+3,i*2+2) for i in range(nz)],mat,col)
    n = 44
    verts, faces = [], []
    for j in range(n+1):
        y = -1.065+2.13*j/n
        for i in range(n+1):
            x = -1.065+2.13*i/n
            z = H + .006 + .004*math.sin(2*math.pi*x/PITCH)*math.cos(2*math.pi*y/PITCH)
            verts.append((x,y,z))
    for j in range(n):
        for i in range(n):
            k = j*(n+1)+i
            faces.append((k,k+1,k+n+2,k+n+1))
    mesh("Shared continuous crown", verts, faces, mat, col)
    if index == 1:
        moss=kit.noisy_material("Raised olive moss", "#455237", "#788558", 32, .32, .97)
        nodes,links=moss.node_tree.nodes,moss.node_tree.links
        tex=next(n for n in nodes if n.type=="TEX_NOISE")
        ramp=next(n for n in nodes if n.type=="VALTORGB")
        for element,color in zip(ramp.color_ramp.elements,("#455237","#788558")):
            element.color=linear(color)
        coord=nodes.new("ShaderNodeTexCoord")
        links.new(coord.outputs["Object"],tex.inputs["Vector"])
        radius=nodes.new("ShaderNodeVectorMath")
        radius.operation="DISTANCE"
        links.new(coord.outputs["UV"],radius.inputs[0])
        radius.inputs[1].default_value=(.5,.5,0)
        threshold=math_node(nodes,links,"ADD",.34,math_node(nodes,links,"MULTIPLY",math_node(nodes,links,"MAXIMUM",math_node(nodes,links,"SUBTRACT",radius.outputs["Value"],.18),0),1.7))
        patch_mix=nodes.new("ShaderNodeMixShader")
        clear=nodes.new("ShaderNodeBsdfTransparent")
        links.new(math_node(nodes,links,"LESS_THAN",tex.outputs["Fac"],threshold),patch_mix.inputs[0])
        links.new(next(n for n in nodes if n.type=="BSDF_PRINCIPLED").outputs[0],patch_mix.inputs[1])
        links.new(clear.outputs[0],patch_mix.inputs[2])
        links.new(patch_mix.outputs[0],next(n for n in nodes if n.type=="OUTPUT_MATERIAL").inputs[0])
        # Sparse real lichen islands sit on the stone, away from shared edges.
        for side in (0,1):
            for patch,(cx,cz,rx,rz) in enumerate(((-.48,2.45,.22,.29),(.30,2.18,.30,.22),(-.15,.68,.33,.28),(.48,1.23,.20,.28))):
                vertices=[]
                for k in range(24):
                    angle=2*math.pi*k/24
                    r=1+.16*math.sin(3*angle+patch)+.11*math.sin(7*angle+side)
                    x=cx+rx*r*math.cos(angle)
                    z=cz+rz*r*math.sin(angle)
                    y=-HALF-relief(x,z,index)-.008
                    vertices.append((x,y,z) if side==0 else (-y,x,z))
                obj=mesh(f"Moss island {side}-{patch}",vertices,[tuple(range(24))],moss,col)
                uv=obj.data.uv_layers.new(name="Moss soft boundary")
                for loop in obj.data.loops:
                    point=vertices[loop.vertex_index]
                    along=point[0] if side==0 else point[1]
                    uv.data[loop.index].uv=(.5+(along-cx)/(rx*2.4),.5+(point[2]-cz)/(rz*2.4))
    if index == 2:
        fissure=kit.plain_material("Recessed split interior", "#383e35", .96)
        fissure.node_tree.nodes.get("Principled BSDF").inputs["Base Color"].default_value=linear("#383e35")
        points=[]
        for k in range(9):
            z=.42+k*.28
            x=.16*math.sin(z*2.2)-.12
            points.append((x,-HALF-relief(x,z,index)-.005,z))
        curve("Narrow eroded fissure",points,.012,fissure,col)
        curve("Fissure fork",[(.04,-1.098,1.6),(.23,-1.10,1.88),(.27,-1.10,2.06),(.48,-1.11,2.32)],.009,fissure,col)
    if index == 3:
        roots = material(wood=True)
        for j in range(3):
            points=[]
            for k in range(7):
                z=.34+k*.36
                x=-.48+j*.36+.10*math.sin(k*.85+j)
                points.append((x,-1.115,z))
            curve(f"Inset old root {j}", points, .018+j*.004, roots, col)
        curve("Root side branch", [(.10,-1.115,1.9),(.32,-1.13,1.65),(.52,-1.12,1.25),(.59,-1.12,.9)], .014, roots, col)
    return col


def build_gate():
    col=bpy.data.collections.new("SwampGate_IndependentLeaf_NoJambs")
    bpy.context.scene.collection.children.link(col)
    # Reference: the legacy swamp gate is a tangled living vine screen with
    # sparse leaves, not timber stakes. All vines belong to the moving leaf.
    vine=material(wood=True,clip=True)
    vine.name="Living olive-brown vine bark"
    ramp=next(n for n in vine.node_tree.nodes if n.type=="VALTORGB")
    for element,color in zip(ramp.color_ramp.elements,("#53543a","#999468")):
        element.color=linear(color)
    leaf=material(wood=True,clip=True)
    leaf.name="Muted green vine leaves"
    ramp=next(n for n in leaf.node_tree.nodes if n.type=="VALTORGB")
    for element,color in zip(ramp.color_ramp.elements,("#435630","#829650")):
        element.color=linear(color)
    leaf.node_tree.nodes.get("Principled BSDF").inputs["Roughness"].default_value=.7

    def leaf_blade(name,angle,length):
        # A folded, tapered blade with a real raised midrib, kept near the
        # gate plane so the existing six depth slices remain appropriate.
        base=Vector((0,0,0))
        axis=Vector((math.cos(angle),0,math.sin(angle)))
        side=Vector((-math.sin(angle),0,math.cos(angle)))
        vertices=[base,base+axis*length*.46+Vector((0,-.032,0)),base+axis*length]
        for sign in (-1,1):
            for t,width in ((.22,.12),(.50,.23),(.76,.16)):
                vertices.append(base+axis*(length*t)+side*(sign*length*width))
        faces=[(0,3,1),(3,4,1),(4,5,1),(5,2,1),(0,1,6),(6,1,7),(7,1,8),(8,1,2)]
        return mesh(name,vertices,faces,leaf,col)

    def path(spec,u):
        phase=spec["phase"]
        # Both ends stay at the fixed gate plane. Only the length sampled
        # along each root-to-tip path changes; there is no whole-leaf slide.
        x=spec["side"]*(2.84-spec["length"]*u)
        wave=math.sin(math.pi*u)
        z=spec["rootZ"]+.26*wave*math.sin(u*math.pi*3.2+phase)
        y=.05*math.sin(u*11+phase)
        return Vector((x,y,z))

    strands=[]
    for side in (-1,1):
        for i in range(16):
            fine=i>=10
            row=(i-10)*1.65+.25 if fine else i
            phase=i*1.73+side*.82
            spec={"side":side,"phase":phase,"rootZ":.20+row*.157,
                  "length":3.10+.14*math.sin(phase),"delay":.07+.055*math.sin(phase),"leaves":[]}
            obj=curve(f"{'Left' if side<0 else 'Right'} growing {'tendril' if fine else 'vine'} {i:02d}",
                      [path(spec,k/24) for k in range(25)],
                      .022 if fine else .052+.013*(.5+.5*math.sin(phase)),vine,col)
            obj["growthSide"]=side
            obj["rootToTipLength"]=spec["length"]
            spec["object"]=obj
            if not fine:
                for j,u in enumerate((.30+.045*math.sin(phase),.66+.055*math.cos(phase))):
                    angle=(.65 if (i+j)%2 else 2.5)+.20*math.sin(phase)
                    blade=leaf_blade(f"{'L' if side<0 else 'R'} unfolding leaf {i:02d}-{j}",angle,.26+.04*math.sin(phase+j))
                    spec["leaves"].append((blade,u))
            strands.append(spec)

    def pose(growth,frame=None):
        growths=[]
        for spec in strands:
            extent=smooth((growth-spec["delay"])/(1-spec["delay"]))
            growths.append(extent)
            obj=spec["object"]
            obj.hide_render=extent<=0
            for k,point in enumerate(obj.data.splines[0].bezier_points):
                s=k/24
                pos=path(spec,extent*s)
                # The growing front curls while unfurling; the established
                # section and root keep their path. Leaves unfold behind it.
                curl=smooth((s-.66)/.34)*(1-extent)*smooth(extent/.12)
                pos.z+=.17*curl*math.sin((s-.66)*math.pi*4+spec["phase"])
                pos.x+=spec["side"]*.07*curl
                point.co=pos
                point.radius=(1-.92*smooth((s-.74)/.26))*smooth(extent/.09)
                if frame is not None:
                    point.keyframe_insert(data_path="co",frame=frame)
                    point.keyframe_insert(data_path="radius",frame=frame)
            if frame is not None:obj.keyframe_insert(data_path="hide_render",frame=frame)
            for blade,u in spec["leaves"]:
                unfold=smooth((extent-u)/.14)
                blade.location=path(spec,u)+Vector((0,-.08,0))
                blade.scale=(unfold,unfold,unfold)
                blade.hide_render=unfold<=0
                if frame is not None:
                    blade.keyframe_insert(data_path="scale",frame=frame)
                    blade.keyframe_insert(data_path="hide_render",frame=frame)
        bpy.context.view_layer.update()
        return {"growthMin":round(min(growths),6),"growthMax":round(max(growths),6)}

    pose(1)
    return col,pose


def depth(path, size):
    scene=bpy.context.scene
    old=(scene.view_settings.view_transform,scene.view_settings.look)
    scene.view_settings.view_transform="Raw"
    scene.view_settings.look="None"
    scene.render.image_settings.color_mode="BW"
    scene.render.image_settings.color_depth="16"
    kit.render_depth(path,size,size)
    scene.view_settings.view_transform,scene.view_settings.look=old
    scene.render.image_settings.color_mode="RGBA"
    scene.render.image_settings.color_depth="8"


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--gate-only",action="store_true",help="Compatibility flag; retired stone wall renders are no longer generated")
    args=parser.parse_args(sys.argv[sys.argv.index("--")+1:] if "--" in sys.argv else [])
    OUT.mkdir(parents=True,exist_ok=True)
    bpy.context.preferences.filepaths.save_version=0
    camera=kit.setup_scene()
    scene=bpy.context.scene
    for light in [o for o in scene.objects if o.type=="LIGHT"]:
        light.data.type="SUN"
        light.data.color=(1,1,1)
        light.data.energy=1.7 if light.name=="ColdShaftKey" else 1.1
        light.data.angle=.35 if light.name=="ColdShaftKey" else .6
    scene.world.node_tree.nodes["Background"].inputs["Color"].default_value=(.16,.16,.16,1)
    scene.world.node_tree.nodes["Background"].inputs["Strength"].default_value=.35
    walls=[build_wall(i) for i in range(4)]
    gate,pose_gate=build_gate()
    camera.data.ortho_scale=5.25
    camera.location=(10,-10,9.645)
    kit.look_at(camera,(0,0,1.48))
    kit.set_resolution(1024,1024)
    ground=kit.projected((0,0,0),1024,1024)
    geos=[]
    for i,col in enumerate(walls):
        for item in walls: kit.set_collection_visible(item,item is col)
        kit.set_collection_visible(gate,False)
        key="swamp_stone_block_"+chr(97+i)
        geos.append({"key":key,"canvas":[1024,1024],"groundCenter":ground,"display":[260,259],
                     "footprint":[128,64],"wallH":132,"halfThick":13,"modelCore":[2.12,2.12,H]})
    # Keep a calibrated editable wall camera as well as the independent gate camera.
    wall_camera=camera.copy()
    wall_camera.data=camera.data.copy()
    wall_camera.name="WallCamera_2to1"
    scene.collection.objects.link(wall_camera)
    for item in walls: kit.set_collection_visible(item,False)
    kit.set_collection_visible(gate,True)
    camera.data.ortho_scale=5.65
    camera.location=(10,-10,9.745)
    kit.look_at(camera,(0,0,1.58))
    kit.set_resolution(640,640)
    kit.calibrate_gate_camera(camera)
    base=sorted([kit.projected(p,640,640) for p in (kit.GATE_WORLD_A,kit.GATE_WORLD_B)],key=lambda p:p[0])
    gate_height=max((obj.matrix_world@Vector(corner)).z for obj in gate.all_objects for corner in obj.bound_box)
    gate_height_px=round(abs(kit.projected((0,0,gate_height),640,640)[1]-kit.projected((0,0,0),640,640)[1]),4)
    depth(OUT/"swamp_stone_gate_depth.png",640)
    frames=[]
    for i in range(16):
        scene.frame_set(i+1)
        growth=1-i/15
        extent=pose_gate(growth,i+1)
        kit.render(OUT/"gate_frames"/f"gate_{i:02d}.png",640,640)
        frames.append({"frame":i,"growth":round(growth,6),**extent})
    scene.frame_start=1
    scene.frame_end=16
    scene.frame_set(1)
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"swamp_stone_wall_kit.blend"))
    geometry={"version":1,"walls":geos,"gate":{"key":"swamp_stone_gate","canvas":[640,640],"frames":16,
              "base":base,"face":base,"gateX":[32,608],"wallH":gate_height_px,"slope":.5,"halfThick":13,
              "depthSlices":6,"tuckEndSlices":True,"hideWhenOpen":True,"motion":frames,"containsStaticJambs":False,
              "animation":{"type":"bilateral-vine-growth","rootsWorldX":[-2.84,2.84],
                           "closedFrame":0,"openFrame":15,"wholeLeafTranslation":False,
                           "closing":"vines extend from both sides, tips unfurl, leaves follow",
                           "opening":"tips retract into both stone jambs, leaves fold"},
              "appearance":"interwoven living vines and sparse leaves; no timber stakes or crossrails",
              "visualReference":"assets/terrain/swamp_gate.png (reference only; not copied into new frames)"},
              "projection":"worldBlock1x1-2to1","camera":{"wallOrthoScale":5.25,"wallPosition":[10,-10,9.645],"wallTarget":[0,0,1.48]},
              "seams":{"pitchModel":PITCH,"runtimeSteps":[[64,32],[-64,32]],"sharedCore":True,"allowFlipX":False,"blockVariantHashShift":8},
              "source":"Native Blender PBR; new swamp meshes; shared mine camera/render helpers","runtimeInstalled":False}
    (OUT/"geometry.json").write_text(json.dumps(geometry,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("SWAMP_STONE_KIT_RENDERED",OUT,flush=True)


if __name__=="__main__":
    main()
