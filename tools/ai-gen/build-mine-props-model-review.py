"""Mine prop model revision. Candidate-only; never writes runtime PNGs/config.

Run with Blender 5.1 --background --factory-startup --python this_file.
Reuses the street model root/camera constants and snow's compatible scene setup.
Beauty and Body Depth are exported at 1024 with identical projection/anchors.
"""
from __future__ import annotations

import importlib.util
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector

REPO = Path(__file__).resolve().parents[2]
OUT = REPO / "tools/ai-gen/_mine_props_model_review_20260830"
PREFIX = "abandoned_mine_prop_"
RESOLUTION = 1024


def load(filename, module_name):
    spec = importlib.util.spec_from_file_location(module_name, Path(__file__).with_name(filename))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


OLD = load("build-abandoned-mine-terrain.py", "mine_original")
S = OLD.S
F = load("mine-prop-render-contract.py", "mine_shared_scene")
F.S = S

SPECS = [
    ("slate_rubble", "片岩碎块", "优化", "由均匀小方块改为少量有层理的大薄片，减少与底材重复的碎屑噪声。", 42),
    ("coal_chunks", "煤块", "重建", "圆滑卵石改为棱角断口和黑色块面；减少散点。", 44),
    ("ore_fragments", "矿石碎块", "重建", "圆珠改为带局部矿脉的破碎岩块；不做发光宝石。", 40),
    ("broken_sleepers", "破损枕木", "重建", "两根普通木条改为带缺口、垫板、道钉的轨枕组合。", 60),
    ("broken_rail", "断轨", "优化", "保留轨头、轨腰、底板截面，补断口、接头板与螺栓。", 74),
    ("rope_coil", "绳圈", "优化", "三个分离同心圆改为连续绳线，保留松脱尾端。", 44),
    ("pickaxe", "矿镐", "重建", "重做横向弯曲镐头、中央柄眼与木柄连接，形成明确T形轮廓。", 64),
    ("shovel", "矿铲", "重建", "矩形小铁片改为铲肩、收尖铲面、套筒及D形握柄。", 64),
    ("floor_lantern", "废矿灯", "重建", "补底座、顶盖、保护笼和连接提环；默认熄灭，避免假动态光源。", 44),
    ("helmet", "矿工帽", "优化", "球体方檐改为半球帽壳、圆檐和固定前灯；控制年代感。", 38),
    ("minecart_wheel", "矿车轮", "重建", "轮圈、轮缘、轮毂、六辐条统一在同一轮平面，平放接地。", 56),
    ("ore_sack", "矿石袋", "重建", "封口袋顶悬浮矿石改为低矮开口袋，矿石嵌入口沿内。", 46),
]
EXCLUDED = [
    ("rail_spikes", "道钉", "合并", "独立散布辨识度低；建入破损枕木的垫板中。"),
    ("rotten_planks", "烂木板", "退出新版通用组", "与枕木轮廓重复，主题信息弱。"),
    ("timber_offcuts", "木料边角", "退出新版通用组", "第三组小木条重复；不再单独建模。"),
    ("broken_chain", "断铁链", "退出新版通用组", "细环在正常缩放下较难辨认，矿洞专属性弱，旧环链连接也不成立。"),
    ("dynamite", "炸药", "场景专用保留", "退出通用组；红色道具可能被误认作可拾取或可爆炸物，留给爆破场景。"),
    ("fuse_spool", "引线卷", "场景专用保留", "与炸药成套使用更有意义，退出通用随机散布候选。"),
]


def mesh(name, verts, faces, mat, bevel=0):
    data = bpy.data.meshes.new(name)
    data.from_pydata(verts, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    S.ACTIVE_COLLECTION.objects.link(obj)
    obj.parent = S.ACTIVE_ROOT
    obj.data.materials.append(S.MATERIALS[mat])
    S.add_bevel(obj, bevel, 1)
    return obj


def prism(name, points, z0, z1, mat, bevel=.01):
    n = len(points)
    verts = [(x, y, z) for z in (z0, z1) for x, y in points]
    faces = [tuple(reversed(range(n))), tuple(range(n, 2*n))]
    faces += [(i, (i+1) % n, (i+1) % n+n, i+n) for i in range(n)]
    return mesh(name, verts, faces, mat, bevel)


def segment(name, a, b, radius, mat):
    a, b = Vector(a), Vector(b)
    obj = S.cylinder(name, (a+b)/2, radius, (b-a).length, mat, vertices=12, bevel=.007)
    obj.rotation_euler = (b-a).to_track_quat("Z", "Y").to_euler()
    return obj


def rock(name, loc, scale, mat, seed):
    rng = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=1, radius=1, location=loc)
    obj = S.move_to_active(bpy.context.object)
    obj.name = name
    for v in obj.data.vertices:
        v.co *= rng.uniform(.78, 1.15)
    obj.scale = scale
    S.apply_dimensions(obj)
    obj.data.materials.append(S.MATERIALS[mat])
    S.add_bevel(obj, .009, 1)
    return obj


def slate_rubble():
    rng=random.Random(610)
    for i, (x,y,l,w,z) in enumerate([(-.48,-.16,.74,.51,.09),(.12,.06,.87,.65,.14),(.62,.25,.43,.31,.07),(-.28,.40,.32,.28,.045)]):
        pts=[]
        for j in range(7):
            a=j*math.tau/7+.24*i
            radius=rng.uniform(.37,.59)
            pts.append((x+l*radius*math.cos(a),y+w*radius*math.sin(a)))
        verts=[(px,py,0) for px,py in pts]
        verts += [(px+rng.uniform(-.035,.035),py+rng.uniform(-.025,.025),z*rng.uniform(.70,1.15)) for px,py in pts]
        verts.append((x+.06,y-.035,z*1.06))
        faces=[tuple(reversed(range(7)))]
        faces += [(j,(j+1)%7,(j+1)%7+7,j+7) for j in range(7)]
        faces += [(14,j+7,(j+1)%7+7) for j in range(7)]
        obj=mesh(f"Fractured_slate_{i}",verts,faces,"mine_slate",.003)
        obj.data.materials.append(S.MATERIALS["mine_slate_light"])
        for p in obj.data.polygons:
            if p.index in (8,9,12):
                p.material_index=1
        # Short exposed cleavage, not a complete inset plate around every stone.
        if i<2:
            a,b=pts[3],pts[4]
            S.curve(f"Slate_cleavage_{i}",[(a[0],a[1],z*.44),((a[0]+b[0])/2,(a[1]+b[1])/2,z*.50),(b[0],b[1],z*.56)],.006,"mine_slate_light")


def coal_chunks():
    for i,(x,y,s) in enumerate([(-.45,-.08,.30),(.08,.04,.36),(.46,.14,.25),(.34,-.30,.16),(-.12,.33,.15)]):
        rock(f"Coal_{i}",(x,y,s*.52),(s,s*.80,s*.60),"mine_coal",340+i)


def ore_fragments():
    for i,(x,y,s) in enumerate([(-.42,-.12,.28),(.08,.08,.40),(.49,.13,.23),(.32,-.25,.15)]):
        rock(f"Ore_{i}",(x,y,s*.49),(s,s*.74,s*.59),"mine_ore",440+i)
        if i<3:
            # Raised thin mineral seams follow the block's upper face, not floating gems.
            S.curve(f"Ore_vein_{i}",[(x-s*.44,y-.07,s*.76),(x,y,s*.96),(x+s*.37,y+.05,s*.72)],.020,"mine_ore_glint")


def broken_sleepers():
    for i,(x,y,l,a) in enumerate([(-.12,-.25,1.62,-.06),(.17,.30,1.28,.14)]):
        pts=[(-l/2,-.16),(l/2-.09,-.16),(l/2,.0),(l/2-.18,.045),(l/2-.05,.15),(-l/2+.10,.15),(-l/2-.04,.04)]
        pts=[(x+px*math.cos(a)-py*math.sin(a), y+px*math.sin(a)+py*math.cos(a)) for px,py in pts]
        prism(f"Sleeper_{i}",pts,.015,.20,"mine_wood",.015)
        for xx in (-.40,.38):
            sx=x+xx*math.cos(a); sy=y+xx*math.sin(a)
            S.box(f"Tie_plate_{i}_{xx}",(sx,sy,.22),(.23,.30,.035),"mine_rust",rotation=(0,0,a),bevel=.007)
            for dy in (-.09,.09):
                S.box(f"Spike_head_{i}_{xx}_{dy}",(sx,sy+dy,.255),(.065,.07,.04),"mine_iron",bevel=.005)
        S.curve(f"Wood_split_{i}",[(x-.60,y-.035,.204),(x-.27,y-.02,.204),(x+.14,y-.01,.204)],.009,"mine_wood_dark")


def broken_rail():
    # Uneven end vertices are shared by the complete rail cross section.
    yz=[(-.16,0),(.16,0),(.16,.065),(.047,.065),(.047,.25),(.09,.25),(.09,.335),(-.09,.335),(-.09,.25),(-.047,.25),(-.047,.065),(-.16,.065)]
    n=len(yz)
    verts=[(-1.00,y,z+.012) for y,z in yz]+[(.99+[.02,-.06,.04,-.07,.03,-.02][i%6],y,z+.012) for i,(y,z) in enumerate(yz)]
    faces=[tuple(reversed(range(n))),tuple(range(n,2*n))]+[(i,(i+1)%n,(i+1)%n+n,i+n) for i in range(n)]
    obj=mesh("Broken_rail_section",verts,faces,"mine_rust",.008)
    obj.data.materials.append(S.MATERIALS["mine_iron"])
    for poly in obj.data.polygons:
        if poly.center.z>.26:
            poly.material_index=1
    S.box("Fishplate",(-.48,-.07,.16),(.62,.035,.145),"mine_iron",bevel=.013)
    for x in (-.68,-.29):
        S.cylinder(f"Joint_bolt_{x}",(x,-.105,.16),.042,.028,"mine_rust",rotation=(math.pi/2,0,0),vertices=6,bevel=.004)


def rope_coil():
    points=[]
    for i in range(170):
        t=i/169; a=t*math.pi*5.4; r=.14+.43*t
        points.append((r*math.cos(a),r*math.sin(a)*.84,.055+.015*math.sin(a*.7)))
    points += [(-.14,-.59,.05),(.20,-.67,.045),(.66,-.50,.045),(.81,-.33,.045)]
    S.curve("Continuous_coiled_rope",points,.046,"mine_rope")


def pickaxe():
    segment("Pick_wood_handle",(0,-.86,.085),(0,.52,.16),.070,"mine_wood")
    # Forged tapered head: rectangular sections bend away from the socket.
    sections=[(-.77,.30,.020,.025),(-.54,.46,.052,.05),(-.20,.53,.09,.075),(.16,.53,.085,.075),(.48,.44,.047,.05),(.74,.29,.013,.02)]
    verts=[]
    for x,y,w,h in sections:
        verts += [(x,y-w,.20-h),(x,y+w,.20-h),(x,y+w,.20+h),(x,y-w,.20+h)]
    faces=[(3,2,1,0),(20,21,22,23)]
    for j in range(5):
        for k in range(4):
            faces.append((j*4+k,j*4+(k+1)%4,(j+1)*4+(k+1)%4,(j+1)*4+k))
    mesh("Forged_tapered_pick_head",verts,faces,"mine_iron",.009)
    S.box("Pick_socket",(0,.50,.20),(.24,.23,.20),"mine_rust",bevel=.022)


def shovel():
    segment("Shovel_handle",(0,-.65,.075),(0,.52,.13),.053,"mine_wood")
    segment("Shovel_socket",(0,.35,.115),(0,.61,.12),.075,"mine_iron")
    prism("Shovel_blade",[(-.12,.50),(-.26,.64),(-.25,.89),(-.12,1.07),(0,1.12),(.12,1.07),(.25,.89),(.26,.64),(.12,.50)],.035,.105,"mine_iron",.022)
    S.curve("Blade_spine",[(0,.56,.115),(0,.79,.135),(0,1.00,.108)],.026,"mine_rust")
    S.curve("D_grip",[(-.02,-.61,.075),(-.15,-.76,.075),(-.15,-.92,.075),(.15,-.92,.075),(.15,-.76,.075),(.02,-.61,.075)],.037,"mine_iron")


def floor_lantern():
    S.cylinder("Lantern_fuel_base",(0,0,.095),.27,.19,"mine_rust",vertices=24)
    S.cylinder("Lantern_lower_ring",(0,0,.205),.225,.045,"mine_iron",vertices=24)
    S.cylinder("Lantern_sooted_glass",(0,0,.415),.169,.37,"mine_glass",vertices=24,bevel=.015)
    for i in range(6):
        a=i*math.tau/6
        segment(f"Cage_bar_{i}",(.20*math.cos(a),.20*math.sin(a),.20),(.20*math.cos(a),.20*math.sin(a),.64),.021,"mine_iron")
    S.cylinder("Lantern_top_ring",(0,0,.64),.232,.062,"mine_iron",vertices=24)
    S.cone("Lantern_cap",(0,0,.72),.23,.12,.14,"mine_rust",vertices=24)
    S.cylinder("Lantern_vent",(0,0,.81),.105,.07,"mine_iron",vertices=16)
    pts=[(.27*math.cos(a),0,.69+.34*math.sin(a)) for a in [i*math.pi/24 for i in range(25)]]
    S.curve("Lantern_attached_handle",pts,.024,"mine_iron")


def helmet():
    verts=[(0,0,.43)]
    for j in range(1,7):
        t=j*math.pi/12
        for i in range(24):
            a=i*math.tau/24
            verts.append((.46*math.sin(t)*math.cos(a),.37*math.sin(t)*math.sin(a),.12+.31*math.cos(t)))
    faces=[(0,1+i,1+(i+1)%24) for i in range(24)]
    for j in range(5):
        for i in range(24):
            a=1+j*24+i; b=1+j*24+(i+1)%24
            faces.append((a,a+24,b+24,b))
    obj=mesh("Helmet_half_shell",verts,faces,"mine_helmet")
    for p in obj.data.polygons:
        p.use_smooth=True
    S.cylinder("Helmet_oval_brim",(0,-.035,.105),1,.045,"mine_helmet",vertices=32,scale=(.54,.46,1),bevel=.02)
    S.box("Headlamp_mount",(0,-.35,.25),(.22,.09,.18),"mine_iron",bevel=.024)
    S.cylinder("Headlamp_rim",(0,-.413,.27),.103,.08,"mine_rust",rotation=(math.pi/2,0,0),vertices=24)
    S.cylinder("Headlamp_unlit_lens",(0,-.46,.27),.077,.013,"mine_glass",rotation=(math.pi/2,0,0),vertices=24,bevel=.006)


def annulus(name, inner, outer, z0, z1, mat):
    n=48
    verts=[(r*math.cos(i*math.tau/n),r*math.sin(i*math.tau/n),z) for z in (z0,z1) for r in (inner,outer) for i in range(n)]
    faces=[]
    for i in range(n):
        k=(i+1)%n
        faces.extend([(i,k,n+k,n+i),(2*n+i,3*n+i,3*n+k,2*n+k),(i,2*n+i,2*n+k,k),(n+i,n+k,3*n+k,3*n+i)])
    return mesh(name,verts,faces,mat,.009)


def minecart_wheel():
    annulus("Wheel_tread",.43,.58,.025,.155,"mine_rust")
    annulus("Wheel_flange",.50,.64,.02,.057,"mine_iron")
    S.cylinder("Wheel_hub",(0,0,.13),.15,.22,"mine_iron",vertices=24)
    for i in range(6):
        a=i*math.tau/6
        S.box(f"Radial_spoke_{i}",(.285*math.cos(a),.285*math.sin(a),.103),(.39,.067,.075),"mine_iron",rotation=(0,0,a),bevel=.014)
    annulus("Axle_socket",.056,.105,.24,.28,"mine_rust")


def ore_sack():
    n=24
    rings=[(.32,.25,.01),(.48,.36,.20),(.49,.36,.43),(.40,.29,.58),(.32,.23,.57),(.31,.22,.38)]
    verts=[]
    for j,(rx,ry,z) in enumerate(rings):
        for i in range(n):
            a=i*math.tau/n; wrinkle=1+.037*math.sin(a*7+j*.6)
            verts.append((rx*math.cos(a)*wrinkle,ry*math.sin(a)*wrinkle,z+.012*math.sin(a*3)))
    faces=[tuple(reversed(range(n)))]
    for j in range(len(rings)-1):
        for i in range(n):
            faces.append((j*n+i,j*n+(i+1)%n,(j+1)*n+(i+1)%n,(j+1)*n+i))
    obj=mesh("Open_canvas_sack",verts,faces,"mine_canvas")
    for p in obj.data.polygons:
        p.use_smooth=True
    S.curve("Folded_sack_rim",[(.40*math.cos(i*math.tau/48),.29*math.sin(i*math.tau/48),.58+.012*math.sin(i*math.tau/16)) for i in range(48)],.025,"mine_wood_dark",cyclic=True)
    for i,(x,y,s) in enumerate([(-.17,-.03,.17),(.08,.05,.20),(.23,-.04,.12),(-.05,-.15,.13)]):
        rock(f"Contained_ore_{i}",(x,y,.51),(s,s*.8,s*.72),"mine_ore",550+i)


def focus(name, scene, camera):
    for key,col in S.MODEL_COLLECTIONS.items():
        col.hide_render=key!=name
    root=S.MODEL_ROOTS[name]
    arranged=root.location.copy()
    root.location=(0,0,0)
    scene.render.resolution_x=scene.render.resolution_y=RESOLUTION
    camera.data.ortho_scale=S.PROP_ORTHO_SCALE
    camera.data.shift_x=0
    camera.data.shift_y=S.PROP_BOTTOM_RATIO-.5
    bpy.context.view_layer.update()
    return root,arranged


def depth_render(name, scene, camera, path):
    root,arranged=focus(name,scene,camera)
    zmin,zmax=F.camera_depth_range(S.MODEL_COLLECTIONS[name],camera)
    bpy.context.view_layer.use_pass_z=True
    group=bpy.data.node_groups.new("Mine_Body_Depth","CompositorNodeTree")
    scene.compositing_node_group=group
    nodes,links=group.nodes,group.links
    layers=nodes.new("CompositorNodeRLayers")
    mapper=nodes.new("ShaderNodeMapRange")
    mapper.clamp=True
    for key,value in [("From Min",zmin),("From Max",zmax),("To Min",1),("To Max",0)]:
        mapper.inputs[key].default_value=value
    multiply=nodes.new("ShaderNodeMath"); multiply.operation="MULTIPLY"
    output=nodes.new("NodeGroupOutput")
    group.interface.new_socket(name="Image",in_out="OUTPUT",socket_type="NodeSocketColor")
    links.new(layers.outputs["Depth"],mapper.inputs["Value"])
    links.new(mapper.outputs["Result"],multiply.inputs[0])
    links.new(layers.outputs["Alpha"],multiply.inputs[1])
    links.new(multiply.outputs[0],output.inputs["Image"])
    scene.view_settings.view_transform="Raw"
    scene.view_settings.look="None"
    scene.view_settings.exposure=0
    scene.render.image_settings.color_mode="BW"
    scene.render.image_settings.color_depth="16"
    scene.render.film_transparent=False
    scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
    scene.compositing_node_group=None
    bpy.data.node_groups.remove(group)
    root.location=arranged
    return [zmin,zmax]


def main(material_setup=None, assembly_finish=None, stage="model-review-only"):
    for sub in ("model-renders","body-depth"):
        (OUT/sub).mkdir(parents=True,exist_ok=True)
    S.clear_scene(); S.setup_materials(); OLD.setup_materials()
    # Shared understated material study only. No generated materials or light effects.
    S.material("mine_glass",(.16,.18,.16),.43,metallic=.12)
    S.material("mine_helmet",(.25,.19,.095),.88,metallic=.05)
    S.material("mine_canvas",(.30,.26,.20),1)
    material_style=material_setup() if material_setup else None
    scene,camera=F.setup_scene()
    bpy.context.preferences.filepaths.save_version=0
    props=[]
    for i,(key,label,decision,reason,target) in enumerate(SPECS):
        name=PREFIX+key
        S.new_model(name,((i%4)*5,-(i//4)*5,0))
        globals()[key]()
        # Lift the complete rigid assembly to its actual lowest point, never individual parts.
        bpy.context.view_layer.update()
        root=S.MODEL_ROOTS[name]
        inv=root.matrix_world.inverted()
        zmin=min((inv@obj.matrix_world@Vector(c)).z for obj in S.MODEL_COLLECTIONS[name].all_objects if obj.type in {"MESH","CURVE"} for c in obj.bound_box)
        for obj in S.MODEL_COLLECTIONS[name].objects:
            if obj.parent==root:
                obj.location.z-=zmin
        props.append({"key":name,"labelZh":label,"decision":decision,"reason":reason,"targetVisibleWorldPx":target,"modelRender":f"model-renders/{name}.png","bodyDepth":f"body-depth/{name}_depth.png","groundLift":-zmin})
    if assembly_finish:
        assembly_finish()
    # Save the editable source with every retained model visible and the shared camera set.
    camera.data.ortho_scale=S.PROP_ORTHO_SCALE
    camera.data.shift_y=S.PROP_BOTTOM_RATIO-.5
    scene.render.resolution_x=scene.render.resolution_y=RESOLUTION
    blend=OUT/"mine_props_curated.blend"
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    for p in props:
        root,arranged=focus(p["key"],scene,camera)
        scene.render.filepath=str(OUT/p["modelRender"])
        bpy.ops.render.render(write_still=True)
        root.location=arranged
    for p in props:
        p["cameraDepthRange"]=depth_render(p["key"],scene,camera,OUT/p["bodyDepth"])
    manifest={"version":1,"stage":"model-review-only","runtimeInstalled":False,"camera":{"projection":"orthographic","elevationDegrees":S.CAMERA_ELEVATION_DEG,"modelRootRotationZDegrees":S.ROOT_ROTATION_DEG,"propOrthoScale":S.PROP_ORTHO_SCALE,"propBottomRatio":S.PROP_BOTTOM_RATIO,"resolution":[RESOLUTION,RESOLUTION]},"shadowPolicy":"no ground plane, no authored cast-shadow geometry, no runtime shadow or emission","sourceGenerator":"tools/ai-gen/build-abandoned-mine-terrain.py","generator":str(Path(__file__).relative_to(REPO)).replace("\\","/"),"blend":str(blend.relative_to(REPO)).replace("\\","/"),"props":props,"excluded":[{"key":PREFIX+k,"labelZh":label,"decision":decision,"reason":reason,"originalFilesPreserved":True} for k,label,decision,reason in EXCLUDED],"runtimePolicy":"No runtime deletion or replacement in this model-first stage. New geometry requires fresh size calibration after later material approval."}
    manifest["stage"]=stage
    if material_style:
        manifest["materialStyle"]=material_style
    (OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    print(f"Saved 12 editable model candidates and paired Body Depth: {OUT}",flush=True)


if __name__=="__main__":
    main()
