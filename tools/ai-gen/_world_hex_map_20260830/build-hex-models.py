"""Author the strategic-map hex kit in Blender; never install runtime assets.

blender --background --factory-startup --python build-hex-models.py -- [--only desert_01 snow_01 forest_01]
Geometry -> existing project surface textures + native PBR -> orthographic PNG.
This is a separate strategic-map projection, not World-122's tactical grid.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import random
import sys
from pathlib import Path
from types import SimpleNamespace

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
camera_spec = importlib.util.spec_from_file_location('world_map_camera', OUT.parent/'world-map-camera.py')
map_camera = importlib.util.module_from_spec(camera_spec)
camera_spec.loader.exec_module(map_camera)
SIZE = 768
ELEVATION = map_camera.ELEVATION_DEGREES
ORTHO = 2.6
ROOT_SEED = 122830
MATS = {}
COLLECTIONS = {}
ACTIVE = None

BIOMES = {
    'desert': dict(sceneId='scene8', label='沙漠位面', texture='floor_sand_seamless.png', tint=(.43,.28,.12), variants=['风积沙丘','砂岩孤峰','仙人掌荒地']),
    'snow': dict(sceneId='scene9', label='雪原位面', texture='floor_snow_fresh_seamless.png', tint=(.68,.77,.83), variants=['雪覆山脊','寒地针林','冰晶雪原']),
    'forest': dict(sceneId='scene10', label='森林位面', texture='floor_grass_forest_seamless.png', tint=(.09,.145,.038), variants=['阔叶密林','针叶林地','林间空地']),
    'ruins': dict(sceneId='scene11', label='遗迹位面', texture='floor_dungeon_black_bricks_seamless.png', tint=(.13,.155,.16), variants=['断柱遗址','残垣石坪','荒废石环']),
    'mine': dict(sceneId='scene12', label='矿洞位面', texture='floor_abandoned_mine_seamless.png', tint=(.19,.15,.105), variants=['层状岩脊','坑口山地','露天矿脉']),
}


def material(name, color, roughness=.9, metallic=0):
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    m.use_nodes = True
    p = principled(m)
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    MATS[name] = m
    return m


def principled(mat):
    return next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')


def setup_materials():
    library = REPO / 'tools/ai-gen/environment-prop-materials.py'
    spec = importlib.util.spec_from_file_location('environment_pbr', library)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    helper = SimpleNamespace(material=material, principled_bsdf=principled)
    for preset in ['slate','slate_edge','wood','wood_dark','iron','mineral']:
        mod.make_material(helper, 'hex_'+preset, preset)
    for name, rgb in {
        'sandstone':(.32,.205,.105), 'sandstone_light':(.48,.335,.18),
        'snow':(.69,.78,.83), 'snow_shade':(.46,.59,.66),
        'ice':(.23,.43,.52), 'rock':(.19,.225,.235),
        'leaf_dark':(.035,.072,.026), 'leaf':(.07,.135,.038),
        'leaf_light':(.135,.205,.065), 'pine':(.035,.085,.064),
        'cactus':(.13,.19,.095), 'stone':(.22,.24,.23),
        'moss':(.085,.12,.043), 'clay':(.48,.51,.52),
        'void':(.012,.014,.013), 'ore':(.30,.34,.32),
    }.items():
        material(name, rgb, .72 if name=='ice' else .94)
    # Surface variation is authored in materials, not painted over the render.
    for name in ['rock','sandstone','sandstone_light','stone','leaf','leaf_dark','leaf_light','pine','snow']:
        mat=MATS[name];n,l=mat.node_tree.nodes,mat.node_tree.links;p=principled(mat)
        base=tuple(p.inputs['Base Color'].default_value)
        coord=n.new('ShaderNodeTexCoord');noise=n.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value=18 if name.startswith('leaf') else 7
        noise.inputs['Detail'].default_value=3
        l.new(coord.outputs['Generated'],noise.inputs['Vector'])
        ramp=n.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color=tuple(c*.72 for c in base[:3])+(1,)
        ramp.color_ramp.elements[1].color=tuple(min(1,c*1.16) for c in base[:3])+(1,)
        l.new(noise.outputs['Fac'],ramp.inputs['Fac']);l.new(ramp.outputs['Color'],p.inputs['Base Color'])
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.28
        bump.inputs['Distance'].default_value=.023 if name.startswith('leaf') else .012
        l.new(noise.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs['Normal'],p.inputs['Normal'])
    for name, data in BIOMES.items():
        mat = material('ground_'+name, data['tint'])
        n, l = mat.node_tree.nodes, mat.node_tree.links
        tex = n.new('ShaderNodeTexImage')
        tex.image = bpy.data.images.load(str(REPO/'assets/terrain'/data['texture']), check_existing=True)
        tex.image.pack()
        tex.extension = 'REPEAT'
        uv = n.new('ShaderNodeTexCoord')
        l.new(uv.outputs['UV'], tex.inputs['Vector'])
        mix = n.new('ShaderNodeMixRGB')
        mix.blend_type = 'MIX'
        mix.inputs[0].default_value = .55 if name=='forest' else .27
        mix.inputs[2].default_value = (*data['tint'],1)
        l.new(tex.outputs['Color'], mix.inputs[1])
        l.new(mix.outputs['Color'], principled(mat).inputs['Base Color'])
        bump = n.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .14
        bump.inputs['Distance'].default_value = .025
        l.new(tex.outputs['Color'], bump.inputs['Height'])
        l.new(bump.outputs['Normal'], principled(mat).inputs['Normal'])
    return dict(library='tools/ai-gen/environment-prop-materials.py', version=mod.VERSION)


def own(obj, name, mat):
    obj.name = name
    for col in list(obj.users_collection):
        col.objects.unlink(obj)
    ACTIVE.objects.link(obj)
    if mat:
        obj.data.materials.append(MATS[mat])
    return obj


def box(name, loc, dims, mat, bevel=.015, rz=0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = own(bpy.context.object, name, mat)
    o.dimensions = dims
    o.rotation_euler.z = rz
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        b = o.modifiers.new('Small worn edges','BEVEL'); b.width=bevel; b.segments=2
        o.modifiers.new('Weighted corner normals','WEIGHTED_NORMAL')
    return o


def cone(name, loc, r1, r2, depth, mat, vertices=10):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=r1, radius2=r2, depth=depth, location=loc)
    return own(bpy.context.object, name, mat)


def rock(name, loc, scale, mat, rng, subdiv=1):
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=subdiv, radius=1, location=loc)
    o = own(bpy.context.object, name, mat)
    for v in o.data.vertices:
        v.co *= rng.uniform(.85,1.12)
    o.scale = scale
    o.rotation_euler.z = rng.uniform(-math.pi,math.pi)
    if mat.startswith('leaf') or mat in ['moss','snow']:
        for poly in o.data.polygons:poly.use_smooth=True
    return o


def height(x, y, biome, variant):
    # Border is exactly z=0 for every tile; relief stays inside a shared hex.
    normals = [math.radians(60*i) for i in range(6)]
    edge = max((x*math.cos(a)+y*math.sin(a))/(math.sqrt(3)/2) for a in normals)
    taper = max(0,1-max(0,edge)**6)**2
    phase = variant*.63
    if biome=='desert':
        h = .115+.105*math.sin(5*x+2*y+phase)+.037*math.sin(9*x-3*y)
    elif biome=='snow':
        h = .08+.035*math.cos(5*x+phase)*math.cos(4*y)
    elif biome=='forest':
        h = .045+.022*math.sin(6*x+phase)*math.cos(4*y)
    elif biome=='ruins':
        h = .015+.009*math.cos(5*x+phase)
    else:
        h = .055+.035*math.sin(7*x+phase)*math.cos(5*y)
    return max(0,h)*taper


def terrain(biome, variant):
    corners = [(math.cos(math.radians(30+60*k)), math.sin(math.radians(30+60*k))) for k in range(6)]
    segments, rings = 72, 24
    verts = [(0,0,height(0,0,biome,variant))]
    for ring in range(1,rings+1):
        t = ring/rings
        for j in range(segments):
            side, f = divmod(j, segments//6)
            u = f/(segments//6)
            a,b = corners[side],corners[(side+1)%6]
            x,y = t*(a[0]*(1-u)+b[0]*u),t*(a[1]*(1-u)+b[1]*u)
            verts.append((x,y,height(x,y,biome,variant)))
    faces = [(0,1+j,1+(j+1)%segments) for j in range(segments)]
    for ring in range(1,rings):
        a,b = 1+(ring-1)*segments,1+ring*segments
        for j in range(segments):
            k=(j+1)%segments; faces.append((a+j,b+j,b+k,a+k))
    mesh = bpy.data.meshes.new('SharedHex_ReliefMesh'); mesh.from_pydata(verts,[],faces); mesh.update()
    obj = bpy.data.objects.new('HexSurface_'+biome,mesh); ACTIVE.objects.link(obj)
    obj.data.materials.append(MATS['ground_'+biome])
    uv = mesh.uv_layers.new(name='GroundTextureUV')
    for p in mesh.polygons:
        p.use_smooth=True
        for li in p.loop_indices:
            co=mesh.vertices[mesh.loops[li].vertex_index].co
            uv.data[li].uv=((co.x+1)/2,(co.y+1)/2)
    return corners


def pine(x,y,z,h,rng,snow=False):
    cone('Pine_trunk',(x,y,z+h*.28),h*.045,h*.03,h*.56,'hex_wood',8)
    for i in range(4):
        cone('Pine_crown',(x,y,z+h*(.36+i*.155)),h*(.24-i*.041),.008,h*(.43-i*.04),'pine',11)
        if snow:
            cone('Pine_snow',(x,y,z+h*(.405+i*.155)),h*(.215-i*.038),.002,h*(.36-i*.035),'snow',11)


def leafy_tree(x,y,z,h,rng):
    cone('Broadleaf_trunk',(x,y,z+h*.34),h*.057,h*.025,h*.68,'hex_wood',9)
    for j in range(6):
        a=j*math.tau/5
        rad=h*.14 if j<5 else 0
        rock('Broadleaf_crown',(x+rad*math.cos(a),y+rad*math.sin(a),z+h*(.69 if j<5 else .86)),
             (h*.25,h*.23,h*.235),rng.choice(['leaf','leaf','leaf_light','leaf_dark']),rng,2)


def cactus(x,y,z,h):
    cone('Cactus_trunk',(x,y,z+h/2),.043,.039,h,'cactus',10)
    for sign,level in [(-1,.52),(1,.36)]:
        box('Cactus_branch',(x+sign*.052,y,z+h*level),(.13,.067,.067),'cactus',.027)
        cone('Cactus_arm',(x+sign*.11,y,z+h*level+.075),.031,.025,.18,'cactus',8)


def mountain(x,y,z,s,rng,snow=False):
    verts=[]
    n,rings=16,7
    ribs=[rng.uniform(.76,1.22) for _ in range(n)]
    for ring in range(rings):
        t=ring/rings
        for i in range(n):
            a=i*math.tau/n
            radius=(1-t)**.8*(1 if ring==0 else rng.uniform(.9,1.06))
            verts.append((x+s*(math.cos(a)*.58*radius*ribs[i]+t*.075),
                          y+s*(math.sin(a)*.48*radius*ribs[i]+t*.09),
                          z+s*(t*.83+(rng.uniform(-.035,.035) if ring else 0))))
    verts.append((x+s*.075,y+s*.09,z+s*.85))
    faces=[]
    for ring in range(rings-1):
        for i in range(n):
            k=(i+1)%n;a,b=ring*n,(ring+1)*n
            faces.extend([(a+i,a+k,b+i),(a+k,b+k,b+i)])
    for i in range(n):faces.append(((rings-1)*n+i,(rings-1)*n+(i+1)%n,rings*n))
    mesh=bpy.data.meshes.new('RidgeMesh');mesh.from_pydata(verts,[],faces);mesh.update()
    o=bpy.data.objects.new('SnowRidge' if snow else 'RockRidge',mesh);ACTIVE.objects.link(o)
    for mat in ['rock','snow' if snow else 'hex_slate_edge','snow_shade' if snow else 'hex_slate']:
        mesh.materials.append(MATS[mat])
    for i,p in enumerate(mesh.polygons):
        midz=sum(mesh.vertices[j].co.z for j in p.vertices)/len(p.vertices)
        # Jagged snow line and exposed ribs; no uniform white cone cap.
        threshold=z+s*(.30+.08*math.sin(i*.85))
        p.material_index=(1 if midz>threshold and p.normal.z>.18 else 0) if snow else (2 if i%4==0 else 1)


def scenery(b, v, rng):
    def h(x,y):return height(x,y,b,v)
    if b=='desert':
        if v==2:
            for i,(x,y,s) in enumerate([(-.2,.1,.3),(.1,.25,.22),(.32,.12,.15)]):
                for j in range(3):
                    rock('Sandstone_stratum',(x,y,h(x,y)+s*.28+j*s*.3),(s*(1-j*.12),s*.62,s*.28),
                         'sandstone_light' if j==2 else 'sandstone',rng,1)
        if v==3:
            for x,y,s in [(-.34,.12,.39),(.26,.2,.30)]:cactus(x,y,h(x,y),s)
        for i in range(4 if v==1 else 7):
            x,y=rng.uniform(-.5,.5),rng.uniform(-.42,.4)
            s=rng.uniform(.025,.065);rock('Desert_stone',(x,y,h(x,y)+s*.25),(s,s*.65,s*.4),'sandstone',rng)
    elif b=='snow':
        if v==1:
            mountain(-.12,.18,h(-.12,.18),.68,rng,True)
            mountain(.31,.13,h(.31,.13),.41,rng,True)
        elif v==2:
            for x,y,s in [(-.3,.25,.52),(.1,.28,.62),(.35,-.1,.39),(-.13,-.22,.44)]:pine(x,y,h(x,y),s,rng,True)
        else:
            for i in range(6):
                x,y=rng.uniform(-.38,.38),rng.uniform(-.27,.35)
                cone('Refrozen_ice',(x,y,h(x,y)+.09),rng.uniform(.05,.10),.013,rng.uniform(.12,.3),'ice',5)
        for i in range(5):
            x,y=rng.uniform(-.5,.5),rng.uniform(-.4,.4)
            rock('Snowdrift',(x,y,h(x,y)+.02),(.13,.085,.055),'snow',rng,2)
    elif b=='forest':
        points=[(-.34,.3,.62),(.08,.34,.71),(.4,.13,.55),(-.32,-.18,.51),(.16,-.22,.57),(-.02,.04,.62)]
        if v==3:points=[(-.39,.22,.50),(.39,.28,.45)]
        for x,y,s in points:
            (pine if v==2 else leafy_tree)(x,y,h(x,y),s,rng)
        for i in range(6):
            x,y=rng.uniform(-.5,.5),rng.uniform(-.4,.3)
            rock('Forest_shrub',(x,y,h(x,y)+.026),(.1,.065,.047),'moss' if i%2 else 'leaf',rng,2)
    elif b=='ruins':
        if v==1:
            for x,y,s in [(-.35,.24,.50),(0,.30,.30),(.34,.22,.41)]:
                z=h(x,y);box('Column_base',(x,y,z+.03),(.21,.21,.06),'stone')
                cone('Broken_column',(x,y,z+s/2),.066,.061,s,'stone',10)
                box('Column_cap',(x,y,z+s),(.17,.17,.045),'stone',.012,rz=.06)
            box('Fallen_lintel',(.02,-.21,h(.02,-.21)+.05),(.54,.12,.10),'stone',rz=-.22)
        elif v==2:
            for i in range(6):
                x=-.44+i*.17
                for j in range(2 if i in [0,1,5] else 3):
                    box('Ruined_wall',(x,.18,h(x,.18)+.055+j*.105),(.16,.145,.10),'stone',.01)
        else:
            for i in range(9):
                a=i*math.tau/9;x,y=.38*math.cos(a),.38*math.sin(a)
                box('Stone_ring',(x,y,h(x,y)+.03),(.18,.11,.06),'stone',.014,a)
            for x,y in [(-.3,.27),(.3,.27)]:cone('Worn_standing_stone',(x,y,h(x,y)+.15),.065,.05,.3,'stone',6)
        for i in range(5):
            x,y=rng.uniform(-.52,.52),rng.uniform(-.45,.1)
            rock('Ruin_rubble',(x,y,h(x,y)+.025),(.07,.06,.045),'stone',rng)
    else:
        for x,y,s in [(-.30,.27,.35),(.08,.37,.49),(.38,.24,.32)]:
            mountain(x,y,h(x,y),s if v==2 else s*1.12,rng)
        if v==2:
            z=h(.02,.04)
            box('Mine_dark_opening',(.02,.085,z+.14),(.32,.12,.28),'void',.025)
            for x in [-.17,.21]:box('Mine_timber_post',(x,-.002,z+.16),(.064,.075,.34),'hex_wood',.009)
            box('Mine_lintel',(.02,-.002,z+.34),(.46,.095,.076),'hex_wood',.009)
            for y in [-.10,-.23,-.36]:box('Mine_sleeper',(.02,y,h(.02,y)+.015),(.3,.055,.03),'hex_wood_dark',.007)
            for x in [-.07,.11]:box('Mine_rail',(x,-.23,h(x,-.23)+.035),(.024,.44,.024),'hex_iron',.003)
        elif v==3:
            for i in range(5):
                x,y=rng.uniform(-.35,.4),rng.uniform(-.32,.1)
                o=cone('Exposed_mineral',(x,y,h(x,y)+.07),.055,.025,rng.uniform(.11,.20),'ore',5)
                o.rotation_euler.y=rng.uniform(-.3,.3)
        for i in range(8):
            x,y=rng.uniform(-.5,.5),rng.uniform(-.4,.38)
            rock('Mine_slate',(x,y,h(x,y)+.025),(.075,.055,.035),'hex_slate_edge',rng)


def setup_scene():
    bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
    scene=bpy.context.scene
    scene.render.engine='CYCLES'
    scene.cycles.samples=32
    scene.cycles.use_denoising=True
    # CPU is predictable and does not alter or contend for another session's GPU service.
    scene.cycles.device='CPU'
    scene.render.threads_mode='FIXED';scene.render.threads=8
    scene.render.resolution_x=SIZE;scene.render.resolution_y=SIZE;scene.render.resolution_percentage=100
    scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA'
    scene.render.image_settings.color_depth='8';scene.render.film_transparent=True
    scene.render.image_settings.compression=30
    scene.view_settings.view_transform='Standard';scene.view_settings.look='Medium High Contrast'
    scene.view_settings.exposure=-.45
    scene.world.use_nodes=True
    scene.world.node_tree.nodes.get('Background').inputs[0].default_value=(.72,.79,.84,1)
    scene.world.node_tree.nodes.get('Background').inputs[1].default_value=.55
    for name,loc,energy,size,color in [
        ('Shared_soft_key',(-3,-4,7),420,5,(1,.94,.84)),
        ('Shared_sky_fill',(4,1,5),140,5,(.79,.87,1)),
    ]:
        light=bpy.data.lights.new(name,'AREA');light.energy=energy;light.shape='DISK';light.size=size;light.color=color
        ob=bpy.data.objects.new(name,light);scene.collection.objects.link(ob);ob.location=loc
        ob.rotation_euler=(-ob.location).to_track_quat('-Z','Y').to_euler()
    camera=map_camera.create_camera(scene,'StrategicHexCamera',(0,0,.22),ORTHO)
    bpy.context.view_layer.update()
    return scene,camera


def render(scene,path):
    path.parent.mkdir(parents=True,exist_ok=True)
    scene.render.filepath=str(path)
    bpy.ops.render.render(write_still=True)
    print('HEX_RENDER_DONE '+str(path),flush=True)


def main():
    global ACTIVE
    parser=argparse.ArgumentParser();parser.add_argument('--only',nargs='*')
    args=parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    scene,camera=setup_scene();palette=setup_materials()
    assets=[]
    for bi,(biome,data) in enumerate(BIOMES.items()):
        for variant in [1,2,3]:
            key=f'{biome}_{variant:02d}'
            ACTIVE=bpy.data.collections.new(key);scene.collection.children.link(ACTIVE);COLLECTIONS[key]=ACTIVE
            corners=terrain(biome,variant);scenery(biome,variant,random.Random(ROOT_SEED+bi*100+variant))
            ACTIVE.hide_render=True
            assets.append(dict(key=key,biome=biome,variant=variant,label=data['variants'][variant-1],
                               sceneId=data['sceneId'],render=f'model-renders/{key}.png',
                               materialSource='assets/terrain/'+data['texture']))
    anchor=world_to_camera_view(scene,camera,Vector((0,0,0)))
    projected=[]
    for x,y in corners:
        p=world_to_camera_view(scene,camera,Vector((x,y,0)));projected.append([p.x*SIZE,(1-p.y)*SIZE])
    manifest=dict(version=1,stage='native-model-material-candidates',runtimeInstalled=False,
        generation=dict(method='Blender geometry, packed project textures, native PBR, Cycles CPU rendering',
                        aiGeneration=False,externalTransmission=False,seed=ROOT_SEED),
        camera=dict(map_camera.CONTRACT,orthoScale=ORTHO,
                    resolution=[SIZE,SIZE],anchorPx=[anchor.x*SIZE,(1-anchor.y)*SIZE],
                    cornersPx=projected,pixelsPerWorldUnit=SIZE/ORTHO),
        grid=dict(orientation='pointy-top',coordinateSystem='axial q,r',radius=1,
                  centerFormula=['sqrt(3)*(q+r/2)','1.5*r'],groundEdgeZ=0,
                  lightDirection='fixed upper-left',rotationOfRenderedTilesAllowed=False),
        materialLibrary=palette,biomes=BIOMES,assets=assets,
        sourceModel='world-hex-models.blend',sourceScript=Path(__file__).name)
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    bpy.context.preferences.filepaths.save_version=0
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'world-hex-models.blend'))
    for item in assets:
        key=item['key']
        if args.only and key not in args.only:continue
        COLLECTIONS[key].hide_render=False
        scene.view_layers[0].material_override=None
        if item['variant']==1:
            objects=list(COLLECTIONS[key].objects)
            for obj in objects:obj.hide_render=not obj.name.startswith('HexSurface_')
            render(scene,OUT/'model-renders'/f"{item['biome']}_00.png")
            for obj in objects:obj.hide_render=False
        render(scene,OUT/item['render'])
        if item['variant']==1:
            scene.view_layers[0].material_override=MATS['clay']
            render(scene,OUT/'whitebox'/f'{key}.png')
            scene.view_layers[0].material_override=None
        COLLECTIONS[key].hide_render=True
    COLLECTIONS['desert_01'].hide_render=False
    for key,collection in COLLECTIONS.items():
        collection.hide_viewport=key!='desert_01'
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'world-hex-models.blend'))
    print('HEX_KIT_FINISHED',flush=True)


if __name__=='__main__':main()
