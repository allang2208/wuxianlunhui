"""V2: authored cloth + fine heraldic albedo + world-map matte PBR rendering.

Original ImageGen textures stay unchanged. All shape, weave, wear, color response,
lights and camera are editable in the Blender source. No game/runtime execution.
"""
from pathlib import Path
from types import SimpleNamespace
import importlib.util
import json
import math
import random
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

OUT=Path(__file__).resolve().parent
REPO=OUT.parents[2]
spec=importlib.util.spec_from_file_location('world_map_camera',OUT.parent/'world-map-camera.py')
map_camera=importlib.util.module_from_spec(spec);spec.loader.exec_module(map_camera)
SIZE=1024
PROFILES=[
    dict(key='player',label='亲征军团',color=(.065,.15,.125),trim=(.26,.24,.17),shape='split',emblem='翼刃罗盘',phase=.2),
    dict(key='desert_patrol',label='荒原狼群',color=(.27,.105,.065),trim=(.29,.22,.13),shape='torn',emblem='沙漠狼首',phase=1.1),
    dict(key='frozen_patrol',label='雪原游猎队',color=(.105,.16,.195),trim=(.30,.34,.35),shape='point',emblem='霜冠熊首',phase=2.3),
    dict(key='forest_raiders',label='林地伏击群',color=(.085,.13,.047),trim=(.22,.205,.105),shape='fork',emblem='古树面具',phase=3.2),
    dict(key='ruin_watch',label='遗迹守卫',color=(.155,.115,.175),trim=(.235,.22,.18),shape='stepped',emblem='断门守望',phase=4.1),
    dict(key='mine_roamers',label='矿区游荡队',color=(.20,.135,.055),trim=(.255,.195,.115),shape='square',emblem='矿镐晶簇',phase=5.2),
]
ACTIVE=None


def material(name,color,roughness=.92,metallic=0):
    mat=bpy.data.materials.new(name);mat.use_nodes=True
    p=mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value=(*color,1)
    p.inputs['Roughness'].default_value=roughness
    p.inputs['Metallic'].default_value=metallic
    p.inputs['Specular IOR Level'].default_value=.22
    return mat


def principled(mat):return mat.node_tree.nodes.get('Principled BSDF')


def fabric(profile):
    key=profile['key'];color=profile['color']
    mat=material(key+' matte woven cloth and printed heraldry',color,.94)
    n,l=mat.node_tree.nodes,mat.node_tree.links;p=principled(mat)
    texcoord=n.new('ShaderNodeTexCoord')
    noise=n.new('ShaderNodeTexNoise');noise.inputs['Scale'].default_value=6;noise.inputs['Detail'].default_value=2
    l.new(texcoord.outputs['Generated'],noise.inputs['Vector'])
    base=n.new('ShaderNodeValToRGB')
    base.color_ramp.elements[0].color=(*(c*.82 for c in color),1)
    base.color_ramp.elements[1].color=(*(c*1.12 for c in color),1)
    l.new(noise.outputs['Fac'],base.inputs['Fac'])
    uv=n.new('ShaderNodeUVMap');uv.uv_map='Heraldry'
    decal=n.new('ShaderNodeTexImage');decal.name='Original fine heraldic artwork, unchanged'
    decal.image=bpy.data.images.load(str(OUT/'emblems'/f'{key}.png'))
    decal.image.pack();decal.extension='CLIP';decal.interpolation='Linear'
    l.new(uv.outputs['UV'],decal.inputs['Vector'])
    # A textile ink palette removes the generated illustration's metallic color response.
    # This is a normal material graph, not a repaint of the original image.
    bw=n.new('ShaderNodeRGBToBW');l.new(decal.outputs['Color'],bw.inputs[0])
    ink=n.new('ShaderNodeValToRGB');ink.color_ramp.interpolation='LINEAR'
    ink.color_ramp.elements.remove(ink.color_ramp.elements[1])
    colors=[(.0,(.085,.068,.044,1)),(.17,(.23,.185,.115,1)),(.45,(.49,.435,.30,1)),(.72,(.70,.66,.51,1)),(1,(.83,.81,.69,1))]
    for i,(pos,c) in enumerate(colors):
        e=ink.color_ramp.elements[0] if i==0 else ink.color_ramp.elements.new(pos)
        e.position=pos;e.color=c
    l.new(bw.outputs[0],ink.inputs[0])
    mix=n.new('ShaderNodeMixRGB');mix.blend_type='MIX'
    l.new(decal.outputs['Alpha'],mix.inputs[0]);l.new(base.outputs['Color'],mix.inputs[1]);l.new(ink.outputs['Color'],mix.inputs[2])
    l.new(mix.outputs[0],p.inputs['Base Color'])
    waves=[]
    for direction in ['X','Z']:
        wave=n.new('ShaderNodeTexWave');wave.wave_type='BANDS';wave.bands_direction=direction
        wave.inputs['Scale'].default_value=105;wave.inputs['Distortion'].default_value=.7
        l.new(texcoord.outputs['Generated'],wave.inputs['Vector']);waves.append(wave)
    weave=n.new('ShaderNodeMath');weave.operation='MULTIPLY'
    l.new(waves[0].outputs['Fac'],weave.inputs[0]);l.new(waves[1].outputs['Fac'],weave.inputs[1])
    bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.09;bump.inputs['Distance'].default_value=.004
    l.new(weave.outputs[0],bump.inputs['Height']);l.new(bump.outputs['Normal'],p.inputs['Normal'])
    p.inputs['Sheen Weight'].default_value=.10
    return mat


def attach(obj,name,mat):
    obj.name=name;obj.data.materials.append(mat)
    for coll in list(obj.users_collection):coll.objects.unlink(obj)
    ACTIVE.objects.link(obj)
    return obj


def rod(name,start,end,radius,mat,vertices=10):
    a,b=Vector(start),Vector(end)
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices,radius=radius,depth=(b-a).length,location=(a+b)/2)
    obj=attach(bpy.context.object,name,mat);obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    bevel=obj.modifiers.new('Small worn edge','BEVEL');bevel.width=.0025;bevel.segments=1
    return obj


def curve(name,points,width,mat):
    data=bpy.data.curves.new(name,'CURVE');data.dimensions='3D';data.bevel_depth=width;data.bevel_resolution=1
    line=data.splines.new('POLY');line.points.add(len(points)-1)
    for p,co in zip(line.points,points):p.co=(*co,1)
    obj=bpy.data.objects.new(name,data);ACTIVE.objects.link(obj);data.materials.append(mat)
    return obj


def mesh(name,vertices,faces,mat):
    data=bpy.data.meshes.new(name);data.from_pydata(vertices,[],faces);data.update()
    obj=bpy.data.objects.new(name,data);ACTIVE.objects.link(obj);data.materials.append(mat)
    return obj


def cloth_y(x,z,phase):
    # User-selected readable presentation: keep this global lean and full emblem area.
    # Ground/base and camera remain physical; do not force the cloth into the rejected V3 pose.
    return -.055 + .30*(z-2.2) + .017*math.sin(x*9+phase+z*1.2) + .007*math.sin(z*10+x*3+phase)


def bottom(x,shape):
    u=x/.54
    if shape=='split':return .84+.20*max(0,1-abs(u)*2.8)
    if shape=='point':return .70+.25*abs(u)
    if shape=='fork':return .81+.23*max(0,1-abs(u)*1.4)
    if shape=='torn':return .86+.029*math.sin(u*17)+.024*math.sin(u*31)
    if shape=='stepped':return .85+.10*(abs(u)>.76)
    return .91+.01*math.sin(u*8)


def detail(name,x,z,phase,mat,width=.004):
    y=cloth_y(x,z,phase)-.01
    return curve(name,[(x-.007,y,z+.013),(x+.007,y-.004,z-.014)],width,mat)


def build(profile,palette):
    phase,shape,key=profile['phase'],profile['shape'],profile['key']
    wood,iron,stone=palette['wood'],palette['iron'],palette['slate']
    trim=material(key+' oxidized fittings',profile['trim'],.80,.28)
    seam=material(key+' linen binding',tuple(c*.84+.055 for c in profile['trim']),.98)
    thread=palette['thread'];bone=palette['bone'];cloth=fabric(profile)
    rod('Low rough slate anchor',(0,.035,.02),(0,.035,.075),.185,stone,7)
    rod('Dark iron peg socket',(0,.035,.06),(0,.035,.13),.063,iron,8)
    rod('Weathered staff',(0,.035,.08),(0,.035,2.4),.027,wood,9)
    for z in [.20,.26,2.18,2.3]:rod('Small forged staff band',(0,.035,z),(0,.035,z+.035),.034,iron,8)
    rod('Crossbar',(-.60,.01,2.22),(.60,.01,2.22),.018,wood if key in ['desert_patrol','forest_raiders'] else iron)
    for x in [-.58,.58]:rod('Crossbar ferrule',(x-.023,.01,2.22),(x+.023,.01,2.22),.028,trim,8)
    nx,nz=64,52;vertices=[]
    for j in range(nz+1):
        t=j/nz
        for i in range(nx+1):
            x=-.54+i*1.08/nx;z=2.18*(1-t)+bottom(x,shape)*t
            vertices.append((x,cloth_y(x,z,phase),z))
    faces=[(j*(nx+1)+i,j*(nx+1)+i+1,(j+1)*(nx+1)+i+1,(j+1)*(nx+1)+i) for j in range(nz) for i in range(nx)]
    obj=mesh('Authored woven banner with integrated insignia',vertices,faces,cloth)
    uv=obj.data.uv_layers.new(name='Heraldry')
    for poly in obj.data.polygons:
        poly.use_smooth=True
        for loop in poly.loop_indices:
            x,_,z=obj.data.vertices[obj.data.loops[loop].vertex_index].co
            uv.data[loop].uv=((x+.46)/.92,(z-1.015)/1.085)
    obj.modifiers.new('Woven cloth thickness','SOLIDIFY').thickness=.006
    for x in [-.515,.515]:
        pts=[]
        for i in range(65):
            z=bottom(x,shape)+.035+i*(2.13-bottom(x,shape)-.035)/64
            pts.append((x,cloth_y(x,z,phase)-.008,z))
        curve('Narrow stitched fabric binding',pts,.007,seam)
        for i in range(25):
            z=bottom(x,shape)+.05+i*(2.1-bottom(x,shape)-.05)/24
            detail('Individual seam stitch',x,z,phase,thread,.0025)
    pts=[]
    for i in range(81):
        x=-.52+i*1.04/80;z=bottom(x,shape)+.02;pts.append((x,cloth_y(x,z,phase)-.008,z))
    curve('Cloth lower hem',pts,.009,seam)
    for x in [-.42,-.21,0,.21,.42]:
        curve('Leather attachment loop',[(x,.015,2.15),(x,.03,2.245),(x,-.055,2.245),(x,cloth_y(x,2.13,phase)-.006,2.13)],.012,wood)
        detail('Attachment rivet',x,2.14,phase,trim,.008)
    rng=random.Random(83030+int(phase*10))
    for side in [-1,1]:
        for j in range(8):
            x=side*(.51-rng.random()*.028);z=bottom(x,shape)+rng.random()*.22
            curve('Sparse frayed linen fibre',[(x,cloth_y(x,z,phase),z),(x+side*.015,cloth_y(x,z,phase)-.01,z-.025)],.0017,thread)
    # Distinct physical fittings remain subordinate to the cloth symbol.
    if key=='player':
        mesh('Slim command spear blade',[(0,.02,2.64),(-.068,.02,2.49),(0,-.018,2.46),(.068,.02,2.49),(0,.058,2.49)],[(0,1,2),(0,2,3),(0,3,4),(0,4,1)],trim)
        for x in [-.58,.58]:
            pts=[(x,.01,2.23),(x+.025,-.025,2.02),(x+.018,-.06,1.87)]
            curve('Short command cord',pts,.006,seam)
    elif key=='desert_patrol':
        for side in [-1,1]:
            curve('Carved horn finial',[(0,.035,2.39),(side*.09,.035,2.43),(side*.135,.02,2.54),(side*.12,0,2.59)],.018,bone)
        for i in range(3):
            x=.58+i*.028;z=1.97-i*.025
            curve('Hunting trophy cord',[(.58,.01,2.22),(x,-.06,z)],.003,wood)
            mesh('Small bone tooth',[(x-.017,-.065,z),(x+.017,-.065,z),(x+.006,-.07,z-.09)],[(0,1,2)],bone)
    elif key=='frozen_patrol':
        for i in range(24):
            x=-.54+i*1.08/23;z=2.13
            mesh('Snow pelt neck binding',[(x-.025,cloth_y(x,z,phase)-.016,z+.033),(x+.025,cloth_y(x,z,phase)-.016,z+.023),(x+.015,cloth_y(x,z,phase)-.028,z-.035-rng.random()*.018)],[(0,1,2)],bone)
        bpy.ops.mesh.primitive_cone_add(vertices=5,radius1=.062,radius2=0,depth=.23,location=(0,.035,2.51))
        attach(bpy.context.object,'Frost crystal finial',palette['ice'])
    elif key=='forest_raiders':
        for side in [-1,1]:
            curve('Branched living wood crown',[(0,.035,2.38),(side*.10,.03,2.44),(side*.18,.025,2.53),(side*.195,.01,2.60)],.015,wood)
            curve('Crown twig',[(side*.10,.03,2.44),(side*.21,.02,2.46)],.008,wood)
            mesh('Oak leaf on branch',[(side*.18,.01,2.50),(side*.24,-.006,2.55),(side*.19,.02,2.61),(side*.165,.03,2.55)],[(0,1,2),(0,2,3)],palette['leaf'])
        for z in [.18,.26,.35]:curve('Vine binding',[(.032,.005,z),(-.03,-.002,z+.025),(-.015,.065,z+.045),(.033,.04,z+.065)],.006,wood)
    elif key=='ruin_watch':
        mesh('Chiselled sentinel finial',[(0,.025,2.63),(-.09,.025,2.50),(0,-.01,2.40),(.09,.025,2.50),(0,.07,2.50)],[(0,1,2),(0,2,3),(0,3,4),(0,4,1),(1,4,3,2)],stone)
        for x in [-.58,.58]:rod('Square relic crossbar cap',(x,.01,2.20),(x,.01,2.26),.041,stone,4)
    else:
        rod('Miner hammer finial',(-.10,.035,2.46),(.10,.035,2.46),.038,iron,4)
        curve('Mining lantern hanger',[(.58,.01,2.22),(.625,-.03,2.11),(.62,-.04,2.04)],.008,iron)
        rod('Lantern cage',(.62,-.04,1.86),(.62,-.04,2.01),.055,iron,6)
        rod('Amber lantern glass',(.62,-.097,1.89),(.62,-.097,1.98),.029,palette['amber'],6)
        for x in [-.43,.43]:
            for z in [1.01,1.08]:detail('Reinforced leather corner',x,z,phase,wood,.009)


def main():
    global ACTIVE
    previous=json.loads((OUT/'manifest.json').read_text(encoding='utf-8')) if (OUT/'manifest.json').exists() else {}
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True
    scene.cycles.device='CPU';scene.render.threads_mode='FIXED';scene.render.threads=8
    scene.render.resolution_x=scene.render.resolution_y=SIZE;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.render.film_transparent=True
    scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast';scene.view_settings.exposure=-.45
    scene.world.use_nodes=True;bg=scene.world.node_tree.nodes.get('Background');bg.inputs[0].default_value=(.72,.79,.84,1);bg.inputs[1].default_value=.55
    for name,loc,power,size,color in [('World map soft key',(-3,-4,7),420,5,(1,.94,.84)),('World map sky fill',(4,1,5),140,5,(.79,.87,1))]:
        data=bpy.data.lights.new(name,'AREA');data.energy=power;data.shape='DISK';data.size=size;data.color=color
        obj=bpy.data.objects.new(name,data);scene.collection.objects.link(obj);obj.location=loc;obj.rotation_euler=(-obj.location).to_track_quat('-Z','Y').to_euler()
    camera=map_camera.create_camera(scene,'Shared strategic map camera',(0,0,1.20),2.10)
    spec=importlib.util.spec_from_file_location('world_prop_materials',REPO/'tools/ai-gen/environment-prop-materials.py')
    library=importlib.util.module_from_spec(spec);spec.loader.exec_module(library)
    helper=SimpleNamespace(material=material,principled_bsdf=principled)
    palette={key:library.make_material(helper,'world_flag_'+key,key) for key in ['slate','wood','iron']}
    palette.update(thread=material('Fine linen thread',(.32,.29,.225)),bone=material('Weathered ivory and snow pelt',(.49,.48,.405)),ice=material('Dull blue frost crystal',(.24,.36,.40),.78),leaf=material('Map oak green',(.10,.15,.044)),amber=material('Unlit amber glass',(.33,.205,.075),.78))
    clay=material('Model clay',(.48,.50,.50),.9)
    collections=[]
    for profile in PROFILES:
        ACTIVE=bpy.data.collections.new(profile['key']);scene.collection.children.link(ACTIVE)
        build(profile,palette);collections.append(ACTIVE)
    bpy.context.view_layer.update();anchor=world_to_camera_view(scene,camera,Vector((0,.035,0)))
    for folder in ['renders','whitebox']:(OUT/folder).mkdir(exist_ok=True)
    for profile,coll in zip(PROFILES,collections):
        for other in collections:other.hide_render=other!=coll
        for folder,override in [('whitebox',clay),('renders',None)]:
            scene.view_layers[0].material_override=override
            scene.render.filepath=str(OUT/folder/f"{profile['key']}.png");bpy.ops.render.render(write_still=True)
    for coll in collections:coll.hide_render=coll.hide_viewport=coll.name!='player'
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'world-army-flags-v2.blend'))
    manifest=dict(version=2,stage='refined-source-ready',runtimeInstalled=previous.get('runtimeInstalled',False),source='Authored Blender geometry + six original ImageGen heraldic textures + existing world-map material library',camera=dict(map_camera.CONTRACT,orthoScale=2.10,target=[0,0,1.20],resolution=SIZE,anchor=[anchor.x,1-anchor.y]),modelPose=dict(rootYawDegrees=0,staffAxis='+Z',clothGlobalLeanDegrees=math.degrees(math.atan(.30)),clothPresentation='user-selected readability priority',localFoldAmplitude=.024),lighting='Identical world-hex 55 degree projection, upper-left key and sky fill',profiles=PROFILES,emblemSources='emblem-sources.json',materialLibrary='tools/ai-gen/environment-prop-materials.py',cameraHelper='tools/ai-gen/world-map-camera.py',previousVersion='../_world_army_flags_20260830/')
    if previous.get('runtime'):manifest['runtime']=previous['runtime']
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('REFINED_ARMY_FLAGS_RENDERED',flush=True)


if __name__=='__main__':main()
