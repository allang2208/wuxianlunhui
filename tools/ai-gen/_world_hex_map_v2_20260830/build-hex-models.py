"""Second hex kit: independent native models, UV phases and PBR detail.

Reuses the first kit's camera and primitive helpers. No raster rotation/mirroring,
AI transmission, game launch or runtime verification. Run with Blender --python.
"""
from pathlib import Path
import importlib.util
import json
import math
import random
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
spec = importlib.util.spec_from_file_location('hex_v1', OUT.parent/'_world_hex_map_20260830/build-hex-models.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
SEED = 1228302
VARIANTS = 10


def relief(x, y, biome, variant):
    a = variant * 1.937
    u, v = x*math.cos(a)-y*math.sin(a), x*math.sin(a)+y*math.cos(a)
    edge = max((x*math.cos(i*math.pi/3)+y*math.sin(i*math.pi/3))/(math.sqrt(3)/2) for i in range(6))
    taper = max(0, 1-max(0, edge)**6)**2
    if biome == 'desert':
        z = .065 + .057*math.sin(u*(5+variant%3)+v*1.3+a) + .015*math.cos(v*15+u*4)
    elif biome == 'snow':
        z = .047 + .027*math.sin(u*5+a)*math.cos(v*7) + .008*math.sin(u*20-v*3)
    elif biome == 'forest':
        z = .025 + .017*math.sin(u*7+a)*math.cos(v*6)
    elif biome == 'ruins':
        z = .012 + .007*math.cos(u*8+a)*math.sin(v*9)
    else:
        z = .038 + .026*math.sin(u*9+a)*math.cos(v*6)
    return max(0, z)*taper


def positions(rng, count, separation=.20, radius=.63):
    points=[]
    for _ in range(count*60):
        a=rng.uniform(0,math.tau);r=radius*math.sqrt(rng.random())
        x,y=r*math.cos(a),r*math.sin(a)
        if all(math.hypot(x-px,y-py)>separation for px,py in points):points.append((x,y))
        if len(points)>=count:break
    return points


def broadleaf(x,y,z,size,rng):
    # Branch-led irregular crowns; no repeated ring of identical spheres.
    lean=rng.uniform(-.045,.045)
    h.cone('Tree_trunk',(x,y,z+size*.34),size*.045,size*.019,size*.68,'hex_wood',9)
    for _ in range(rng.randint(4,7)):
        a=rng.uniform(0,math.tau);r=rng.uniform(.06,.20)*size
        cx,cy=x+math.cos(a)*r+lean,y+math.sin(a)*r
        cz=z+size*rng.uniform(.58,.90)
        branch=h.cone('Branch',(cx,cy,cz-size*.17),size*.016,.004,size*.29,'hex_wood',6)
        branch.rotation_euler.y=rng.uniform(-.7,.7)
        m=rng.choice(['leaf','leaf','leaf_dark','leaf_light'])
        for _ in range(rng.randint(3,5)):
            ox,oy=rng.uniform(-.085,.085)*size,rng.uniform(-.085,.085)*size
            s=rng.uniform(.095,.17)*size
            o=h.rock('Leaf_cluster',(cx+ox,cy+oy,cz+rng.uniform(-.045,.055)*size),
                     (s*1.1,s*.9,s*rng.uniform(.8,1.3)),m,rng,1)
            for p in o.data.polygons:p.use_smooth=False


def conifer(x,y,z,size,rng,snow=False):
    h.cone('Pine_trunk',(x,y,z+size*.45),size*.035,.008,size*.9,'hex_wood',8)
    tiers=rng.randint(4,6)
    for i in range(tiers):
        t=i/tiers; radius=size*(.25-.19*t)
        cz=z+size*(.25+.69*t)
        o=h.cone('Broken_pine_silhouette',(x,y,cz),radius,.002,size*(.32-.17*t),'pine',rng.randint(8,11))
        for vertex in o.data.vertices:
            if vertex.co.z<0:vertex.co.x*=rng.uniform(.68,1.22);vertex.co.y*=rng.uniform(.68,1.22)
        o.rotation_euler.z=rng.uniform(0,math.tau)
        if snow:
            for j in range(rng.randint(2,4)):
                a=rng.uniform(0,math.tau)
                h.rock('Snow_on_branch',(x+math.cos(a)*radius*.45,y+math.sin(a)*radius*.45,cz+size*.02),
                       (radius*.58,radius*.38,size*.035),'snow',rng,1)


def enhance_materials():
    palette=h.setup_materials()
    for biome in h.BIOMES:
        mat=h.MATS['ground_'+biome];n,l=mat.node_tree.nodes,mat.node_tree.links;p=h.principled(mat)
        previous=p.inputs['Base Color'].links[0].from_socket
        coord=n.new('ShaderNodeTexCoord');noise=n.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value=5.5;noise.inputs['Detail'].default_value=4.5
        l.new(coord.outputs['UV'],noise.inputs['Vector'])
        ramp=n.new('ShaderNodeValToRGB')
        ramp.color_ramp.elements[0].color=(.52,.52,.52,1)
        ramp.color_ramp.elements[1].color=(1.04,1.04,1.04,1)
        l.new(noise.outputs['Fac'],ramp.inputs['Fac'])
        mix=n.new('ShaderNodeMixRGB');mix.blend_type='MULTIPLY';mix.inputs[0].default_value=.43
        l.new(previous,mix.inputs[1]);l.new(ramp.outputs['Color'],mix.inputs[2]);l.new(mix.outputs['Color'],p.inputs['Base Color'])
        detail=n.new('ShaderNodeTexNoise');detail.inputs['Scale'].default_value=130;detail.inputs['Detail'].default_value=2
        l.new(coord.outputs['UV'],detail.inputs['Vector'])
        old=p.inputs['Normal'].links[0].from_socket
        bump=n.new('ShaderNodeBump');bump.inputs['Strength'].default_value=.24;bump.inputs['Distance'].default_value=.008
        l.new(old,bump.inputs['Normal']);l.new(detail.outputs['Fac'],bump.inputs['Height']);l.new(bump.outputs['Normal'],p.inputs['Normal'])
    return palette


def decorate(b,v,rng):
    z=lambda x,y:relief(x,y,b,v)
    # Three quiet surfaces per biome; seven independent feature arrangements.
    if b=='desert':
        if v in [4,7,9]:
            for x,y in positions(rng,rng.randint(1,3),.34,.43):
                s=rng.uniform(.13,.27)
                for j in range(rng.randint(2,4)):
                    h.rock('Eroded_sandstone',(x+j*.013,y,z(x,y)+s*.22+j*s*.31),
                           (s*(1-j*.09),s*rng.uniform(.56,.78),s*.25),'sandstone_light' if j%2 else 'sandstone',rng,2)
        if v in [3,6,8]:
            for x,y in positions(rng,rng.randint(1,4),.3,.48):h.cactus(x,y,z(x,y),rng.uniform(.19,.43))
    elif b=='snow':
        if v in [4,6,9]:
            for x,y in positions(rng,rng.randint(1,3),.4,.32):h.mountain(x,y,z(x,y),rng.uniform(.37,.72),rng,True)
        elif v in [3,5,8]:
            for x,y in positions(rng,rng.randint(3,7),.24,.58):conifer(x,y,z(x,y),rng.uniform(.30,.57),rng,True)
        elif v==7:
            for x,y in positions(rng,5,.18,.44):
                o=h.cone('Fractured_ice',(x,y,z(x,y)+.09),rng.uniform(.045,.1),.005,rng.uniform(.14,.31),'ice',5)
                o.rotation_euler.y=rng.uniform(-.4,.4)
    elif b=='forest':
        count=[0,1,2,4,7,8,5,6,3,7][v]
        for x,y in positions(rng,count,.24,.59):
            fn=conifer if v in [3,6] or rng.random()<.16 else broadleaf
            fn(x,y,z(x,y),rng.uniform(.32,.69),rng)
        if v in [2,7]:
            o=h.cone('Fallen_tree',(.04,-.15,z(.04,-.15)+.045),.043,.027,.46,'hex_wood_dark',9)
            o.rotation_euler=(math.pi/2,0,rng.uniform(-1,1))
        for x,y in positions(rng,rng.randint(5,12),.10,.7):
            s=rng.uniform(.035,.08)
            h.rock('Understorey',(x,y,z(x,y)+s*.4),(s,s*.8,s*.5),rng.choice(['leaf','moss','leaf_dark']),rng,1)
    elif b=='ruins':
        if v in [3,6,9]:
            for x,y in positions(rng,rng.randint(1,4),.28,.46):
                size=rng.uniform(.16,.48)
                h.box('Worn_plinth',(x,y,z(x,y)+.025),(.18,.19,.05),'stone',.018,rng.uniform(-.2,.2))
                column=h.cone('Fractured_column',(x,y,z(x,y)+size*.5),.063,.056,size,'stone',10)
                for vertex in column.data.vertices:
                    if vertex.co.z>0:vertex.co.z+=rng.uniform(-.05,.035)
        elif v in [4,7]:
            angle=rng.uniform(-.65,.65)
            for i in range(rng.randint(3,6)):
                x=(i-2)*.15;y=.14+x*math.sin(angle)
                for j in range(rng.randint(1,3)):
                    h.box('Broken_masonry',(x,y,z(x,y)+.05+j*.095),(.145,.13,.09),'stone',.016,angle)
        elif v in [5,8]:
            for x,y in positions(rng,rng.randint(5,9),.16,.52):
                h.box('Scattered_flagstone',(x,y,z(x,y)+.025),(rng.uniform(.12,.26),.13,.048),'stone',.013,rng.uniform(-1,1))
        for x,y in positions(rng,6,.14,.66):
            h.rock('Moss_patch',(x,y,z(x,y)+.012),(.065,.05,.018),'moss',rng,1)
    else:
        if v in [3,4,6,8,9]:
            for x,y in positions(rng,rng.randint(1,3),.33,.42):h.mountain(x,y,z(x,y),rng.uniform(.27,.64),rng)
        if v==7:
            # Only one rare mine entrance; surrounding tiles remain geological.
            h.mountain(-.18,.30,z(-.18,.30),.6,rng)
            h.box('Tunnel_shadow',(.02,.06,z(.02,.06)+.13),(.28,.13,.25),'void',.022)
            for x in [-.14,.18]:h.box('Pit_prop',(x,-.015,z(x,-.015)+.15),(.065,.07,.3),'hex_wood',.008)
            h.box('Pit_lintel',(.02,-.015,.32),(.41,.08,.06),'hex_wood',.009)
            for y in [-.16,-.28,-.40]:h.box('Rail_sleeper',(.02,y,z(.02,y)+.01),(.25,.042,.022),'hex_wood_dark',.005)
            for x in [-.06,.1]:h.box('Rail',(x,-.27,z(x,-.27)+.027),(.018,.39,.018),'hex_iron',.002)
        if v in [2,5,8]:
            for x,y in positions(rng,rng.randint(3,7),.17,.54):
                h.rock('Mineral_outcrop',(x,y,z(x,y)+.025),(.065,.043,.052),'hex_mineral',rng,1)
    for x,y in positions(rng,rng.randint(4,11),.12,.72):
        s=rng.uniform(.012,.05)
        mat={'desert':'sandstone','snow':'snow_shade','forest':'rock','ruins':'stone','mine':'hex_slate_edge'}[b]
        h.rock('Loose_stones',(x,y,z(x,y)+s*.3),(s,s*rng.uniform(.5,1),s*.5),mat,rng,1)


def main():
    h.height=relief
    scene,camera=h.setup_scene();palette=enhance_materials()
    scene.cycles.samples=48
    assets=[]
    for bi,(biome,info) in enumerate(h.BIOMES.items()):
        for v in range(VARIANTS):
            key=f'{biome}_{v:02d}';rng=random.Random(SEED+bi*1009+v*7919)
            col=bpy.data.collections.new(key);scene.collection.children.link(col);h.ACTIVE=col;h.COLLECTIONS[key]=col
            corners=h.terrain(biome,v)
            surface=next(o for o in col.objects if o.name.startswith('HexSurface'))
            angle=rng.uniform(0,math.tau);phase=(rng.random()*7,rng.random()*7);scale=rng.uniform(.85,1.40)
            for uv in surface.data.uv_layers.active.data:
                x,y=uv.uv
                uv.uv=((x*math.cos(angle)-y*math.sin(angle))*scale+phase[0],(x*math.sin(angle)+y*math.cos(angle))*scale+phase[1])
            decorate(biome,v,rng);col.hide_render=True
            assets.append(dict(key=key,biome=biome,variant=v,sceneId=info['sceneId'],sourceCollection=key,render=f'model-renders/{key}.png'))
    anchor=world_to_camera_view(scene,camera,Vector((0,0,0)))
    projected=[]
    for x,y in corners:
        p=world_to_camera_view(scene,camera,Vector((x,y,0)));projected.append([p.x*h.SIZE,(1-p.y)*h.SIZE])
    manifest=dict(version=2,seed=SEED,runtimeInstalled=False,biomes=h.BIOMES,assets=assets,
        generation=dict(method='Native Blender geometry -> project textures with independent UV phases -> layered PBR -> Cycles 48 samples',aiGeneration=False,externalTransmission=False),
        camera=dict(h.map_camera.CONTRACT,orthoScale=h.ORTHO,resolution=[h.SIZE,h.SIZE],anchorPx=[anchor.x*h.SIZE,(1-anchor.y)*h.SIZE],cornersPx=projected,pixelsPerWorldUnit=h.SIZE/h.ORTHO),
        grid=dict(orientation='pointy-top',radius=1,groundEdgeZ=0,rotationOfRenderedTilesAllowed=False),
        sourceModel='world-hex-models-v2.blend',sourceScript='build-hex-models.py',helperSource='../_world_hex_map_20260830/build-hex-models.py',materialLibrary=palette)
    (OUT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    bpy.context.preferences.filepaths.save_version=0
    for item in assets:
        key=item['key'];h.COLLECTIONS[key].hide_render=False
        h.render(scene,OUT/item['render'])
        if item['variant']==4:
            scene.view_layers[0].material_override=h.MATS['clay']
            h.render(scene,OUT/'whitebox'/f'{key}.png')
            scene.view_layers[0].material_override=None
        h.COLLECTIONS[key].hide_render=True
    for key,col in h.COLLECTIONS.items():col.hide_viewport=key!='forest_04'
    h.COLLECTIONS['forest_04'].hide_render=False
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'world-hex-models-v2.blend'))
    print('HEX_V2_FINISHED',flush=True)


if __name__=='__main__':main()
