"""Five native wall-growing luminous plants, two physical orientations each.

Source output only; never rebuilds or writes the accepted swamp walls/gate.
"""
import importlib.util
import json
import math
import random
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = Path(__file__).resolve().parent
OUT = HERE / "_swamp_wall_plants_20260830"


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


S = load("swamp_plant_helpers", "build-world122-street-decor.py")
F = load("swamp_plant_render", "mine-prop-render-contract.py")
F.S = S
P = load("swamp_plant_materials", "environment-prop-materials.py")
MOUNT = (0, 0, .95)
SPECS = [
    ("shelf_fungus", "青荧壁菌", (0, -.32, 1.04), 0x79DCB2, 82, .15),
    ("lantern_vine", "灯笼果藤", (0, -.25, .70), 0xDBDD86, 88, .14),
    ("star_fern", "星芒蕨", (0, -.24, 1.13), 0xA1D981, 80, .14),
    ("dew_bells", "垂露花", (0, -.30, .76), 0x8EDBE0, 84, .15),
    ("firefly_moss", "萤芽苔", (0, -.24, 1.03), 0x9DDBAA, 76, .14),
]


def mesh(name, vertices, faces, material):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.materials.append(S.MATERIALS[material])
    data.update()
    obj = bpy.data.objects.new(name, data)
    S.ACTIVE_COLLECTION.objects.link(obj)
    obj.parent = S.ACTIVE_ROOT
    for face in data.polygons:
        face.use_smooth = True
    return obj


def leaf(base, tip, width, material="swamp_leaf"):
    base, tip = Vector(base), Vector(tip)
    direction = (tip - base).normalized()
    side = direction.cross(Vector((0, -1, .04))).normalized()
    vertices, faces = [], []
    for j in range(9):
        t = j / 8
        center = base.lerp(tip, t) + Vector((0, -.085 * math.sin(math.pi * t), 0))
        span = width * math.sin(math.pi * t) ** .8
        vertices.extend((center - side * span, center + Vector((0, -.025, 0)), center + side * span))
        if j:
            a = (j - 1) * 3
            faces.extend(((a, a+3, a+4, a+1), (a+1, a+4, a+5, a+2)))
    mesh("Folded living leaf", vertices, faces, material)


def stem(points, radius=.025, material="swamp_stem"):
    return S.curve("Clinging plant stem", points, radius, material)


def attachment():
    # Fine tendrils rooted in the existing twig wall; no metal hook or new pillar.
    for j in range(5):
        x = (j - 2) * .10
        stem([(0, 0, .95), (x * .6, -.025, 1.00), (x, .025, .80 + .06*j)], .021, "swamp_root")


def cap(center, radius):
    center = Vector(center)
    vertices, faces = [], []
    for j in range(7):
        r = radius * j / 6
        z = .18 * (1 - (j / 6) ** 1.7)
        for i in range(28):
            a = i * math.tau / 28
            vertices.append(center + Vector((r*math.cos(a), r*math.sin(a), z)))
        if j:
            for i in range(28):
                a = (j-1)*28+i
                b = (j-1)*28+(i+1)%28
                faces.append((a,b,b+28,a+28))
    mesh("Curved fungus cap", vertices, faces, "swamp_leaf")
    S.sphere("Luminous fungus underside", center + Vector((0,0,-.028)), (radius*.96,radius*.96,.043), "glow_shelf_fungus")
    for j in range(14):
        a = j * math.tau / 14
        stem([center + Vector((.045*math.cos(a),.045*math.sin(a),-.04)),
              center + Vector((radius*.90*math.cos(a),radius*.90*math.sin(a),-.035))], .013, "glow_shelf_fungus")


def shelf_fungus():
    for x,y,z,r in ((-.27,-.26,1.20,.34),(.25,-.28,.96,.30),(-.09,-.42,.69,.25)):
        stem([(x*.4,0,.95),(x,-.12,z-.18),(x,y,z-.03)], .042)
        cap((x,y,z),r)
    leaf((.07,-.03,1.04),(.35,-.1,1.57),.13)


def lantern_vine():
    stem([(-.43,-.05,1.20),(-.18,-.08,1.44),(.13,-.06,1.40),(.44,-.08,1.14)], .03)
    for j,(x,z) in enumerate(((-.40,.68),(-.13,.35),(.16,.78),(.43,.48))):
        stem([(x*.6,-.03,1.33),(x,-.18,1.00),(x,-.28,z+.16)], .022)
        S.sphere("Luminous lantern fruit",(x,-.28,z),(.135,.125,.205),"glow_lantern_vine")
        for k in range(5):
            a=k*math.tau/5
            stem([(x,-.28,z+.20),(x+.13*math.cos(a),-.28+.12*math.sin(a),z),
                  (x,-.28,z-.20)],.010,"swamp_leaf")
        leaf((x*.5,-.08,1.29),(x+(.22 if j%2 else -.22),-.13,1.61),.13)


def star_fern():
    root=Vector((0,-.05,.59))
    for j in range(7):
        spread=(j-3)/3
        points=[]
        for k in range(13):
            t=k/12
            points.append(root+Vector((spread*.74*t,-.20*t,(.94-.23*abs(spread))*math.sin(t*1.5))))
        stem(points,.018)
        for k in range(2,12):
            t=k/12
            width=.20*math.sin(math.pi*t)+.025
            for sign in (-1,1):
                base=points[k]
                tip=base+Vector((sign*width,-.04,.10))
                leaf(base,tip,.047,"glow_star_fern" if k>7 else "swamp_leaf")


def bell(center, radius):
    center=Vector(center)
    vertices,faces=[],[]
    for j,(r,z) in enumerate(((.065,.19),(.09,.13),(.10,.05),(radius,-.055))):
        for k in range(30):
            a=k*math.tau/30
            scallop=.025*math.cos(5*a) if j==3 else 0
            vertices.append(center+Vector((r*math.cos(a),r*math.sin(a),z+scallop)))
        if j:
            for k in range(30):
                a=(j-1)*30+k;b=(j-1)*30+(k+1)%30
                faces.append((a,b,b+30,a+30))
    mesh("Drooping five lobed flower",vertices,faces,"glow_dew_bells")
    S.sphere("Bell stamen",center+Vector((0,0,-.04)),(.04,.04,.075),"glow_dew_bells")


def dew_bells():
    for j,(x,z) in enumerate(((-.43,.55),(-.15,.80),(.17,.44),(.43,.83))):
        stem([(0,0,.95),(x*.65,-.10,1.32),(x,-.28,z+.25)],.025)
        bell((x,-.28,z),.15)
        leaf((x*.5,-.07,1.12),(x+(.14 if j%2 else -.14),-.1,1.48),.105)


def firefly_moss():
    rng=random.Random(83055)
    for x,z in ((-.17,.88),(.16,.98),(0,.71)):
        S.sphere("Clinging moss cushion",(x,-.08,z),(.24,.11,.22),"swamp_leaf")
    for j in range(28):
        a=rng.uniform(0,math.tau)
        base=Vector((.19*math.cos(a),-.10,.91+.12*math.sin(a)))
        tip=base+Vector((.23*math.cos(a),-.17-rng.random()*.08,.24+rng.random()*.31))
        stem([base,base.lerp(tip,.5)+Vector((0,0,.07)),tip],.011)
        S.sphere("Luminous moss bud",tip,(.035,.027,.064),"glow_firefly_moss")
    for sign in (-1,1):
        stem([(sign*.12,-.1,.76),(sign*.24,-.18,.56),(sign*.15,-.20,.22)],.017)
        for j in range(5):
            leaf((sign*.2,-.17,.33+j*.075),(sign*(.25+.04*(j%2)),-.2,.29+j*.075),.04)


def depth_render(scene,camera,collection,path):
    zmin,zmax=F.camera_depth_range(collection,camera)
    bpy.context.view_layer.use_pass_z=True
    group=bpy.data.node_groups.new("Swamp plant body depth","CompositorNodeTree")
    scene.compositing_node_group=group
    group.interface.new_socket(name="Image",in_out="OUTPUT",socket_type="NodeSocketColor")
    nodes,links=group.nodes,group.links
    layers=nodes.new("CompositorNodeRLayers")
    mapper=nodes.new("ShaderNodeMapRange")
    mapper.clamp=True
    for key,value in (("From Min",zmin),("From Max",zmax),("To Min",1),("To Max",0)):
        mapper.inputs[key].default_value=value
    multiply=nodes.new("ShaderNodeMath");multiply.operation="MULTIPLY"
    output=nodes.new("NodeGroupOutput")
    links.new(layers.outputs["Depth"],mapper.inputs["Value"])
    links.new(mapper.outputs["Result"],multiply.inputs[0])
    links.new(layers.outputs["Alpha"],multiply.inputs[1])
    links.new(multiply.outputs[0],output.inputs["Image"])
    scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
    scene.compositing_node_group=None
    bpy.data.node_groups.remove(group)


def main():
    OUT.mkdir(parents=True,exist_ok=True)
    S.clear_scene()
    P.make_material(S,"swamp_root","wood_dark")
    stem_mat=P.make_material(S,"swamp_stem","wood_handle")
    ramp=next(n for n in stem_mat.node_tree.nodes if n.type=="VALTORGB")
    ramp.color_ramp.elements[0].color=(.027,.06,.026,1)
    ramp.color_ramp.elements[1].color=(.065,.125,.045,1)
    leaf_mat=S.material("swamp_leaf",(.075,.18,.08),roughness=.83)
    for key,_label,_source,color,_radius,_alpha in SPECS:
        rgb=tuple(((color>>shift)&255)/255 for shift in (16,8,0))
        linear=tuple(((x+.055)/1.055)**2.4 for x in rgb)
        S.emissive_material("glow_"+key,linear,strength=.78,roughness=.64)
    scene,camera=F.setup_scene()
    bpy.context.preferences.filepaths.save_version=0
    camera.data.ortho_scale=S.PROP_ORTHO_SCALE
    camera.data.shift_y=S.PROP_BOTTOM_RATIO-.5
    scene.render.resolution_x=scene.render.resolution_y=512
    for key,*_ in SPECS:
        S.new_model(key,(0,0,0))
        attachment()
        globals()[key]()
    assets=[]
    for key,label,light,color,radius,alpha in SPECS:
        item={"id":key,"labelZh":label,"weight":1,"glow":{"color":color,"radius":radius,"alpha":alpha,
              "coreRadius":22,"coreAlpha":.18,"flicker":.035,"pulsePeriodMs":2600},"views":{}}
        for direction,degrees in (("down",-S.ROOT_ROTATION_DEG),("up",S.ROOT_ROTATION_DEG)):
            for name,col in S.MODEL_COLLECTIONS.items():col.hide_render=name!=key
            root=S.MODEL_ROOTS[key]
            root.rotation_euler.z=math.radians(degrees)
            bpy.context.view_layer.update()
            def project(point):
                p=world_to_camera_view(scene,camera,root.matrix_world@Vector(point))
                return [round(p.x,7),round(1-p.y,7)]
            name=f"swamp_wall_plant_{key}_{direction}"
            scene.render.filepath=str(OUT/(name+".png"))
            bpy.ops.render.render(write_still=True)
            depth_render(scene,camera,S.MODEL_COLLECTIONS[key],OUT/(name+"_depth.png"))
            item["views"][direction]={"key":name,"src":f"assets/terrain/swamp-wall-plants/{name}.png",
                "origin":project(MOUNT),"lightOrigin":project(light),"displayWidth":307.2,"source":name+".png"}
        assets.append(item)
    for key,col in S.MODEL_COLLECTIONS.items():col.hide_render=False
    for i,(key,*_) in enumerate(SPECS):S.MODEL_ROOTS[key].location.x=i*2.3
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/"swamp_wall_plants.blend"))
    manifest={"stage":"five native luminous wall plants; user visual/runtime acceptance pending",
        "generator":"tools/ai-gen/build-swamp-wall-plants.py","blend":"swamp_wall_plants.blend",
        "materialLibrary":"tools/ai-gen/environment-prop-materials.py","materialVersion":P.VERSION,
        "materialNotes":"shared wood/root PBR plus local green stems/leaves and five moderate emissive organs",
        "camera":{"elevation":S.CAMERA_ELEVATION_DEG,"rootDirections":[-S.ROOT_ROTATION_DEG,S.ROOT_ROTATION_DEG],
                  "orthoScale":S.PROP_ORTHO_SCALE,"bottomRatio":S.PROP_BOTTOM_RATIO,"resolution":[512,512]},
        "mountAnchorLocal":MOUNT,"worldPixelsPerModelUnit":48,"aiGeneration":False,
        "policy":"two actual model orientations; no image mirror, ground plane, wall/gate rewrite or collision",
        "assets":assets}
    (OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
    print("SWAMP_WALL_PLANTS_RENDERED",OUT,flush=True)


if __name__=="__main__":main()
