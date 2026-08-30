"""Native strategic city/outpost models; shared 55-degree camera and matte PBR.

Asset production only. No game launch, runtime tests, AI repainting or changes to
the existing terrain/flag sources. Run with Blender --background --python.
"""
from pathlib import Path
from types import SimpleNamespace
import argparse
import importlib.util
import json
import math
import random
import sys
import bpy
from mathutils import Vector
from bpy_extras.object_utils import world_to_camera_view

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
SIZE = 768
ROOT_YAW = 18
PROFILES = [dict(key=f'{biome}_{kind}', biome=biome, kind=kind, label=f'{label}{noun}')
            for biome, label in [('desert', '荒原'), ('snow', '雪原'), ('forest', '林地'), ('ruins', '遗迹'), ('mine', '矿区')]
            for kind, noun in [('town', '城寨'), ('outpost', '据点')]]
PROFILES += [dict(key=f'destroyed_{kind}', biome='ruins', kind=kind, destroyed=True, label=label)
             for kind, label in [('town', '城市废墟'), ('outpost', '据点废墟')]]
ACTIVE = None
ROOT = None


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


CAMERA = module('settlement_map_camera', OUT.parent / 'world-map-camera.py')
PBR = module('settlement_material_library', OUT.parent / 'environment-prop-materials.py')


def material(name, color, roughness=.92, metallic=0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    p = mat.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = roughness
    p.inputs['Metallic'].default_value = metallic
    p.inputs['Specular IOR Level'].default_value = .22
    return mat


def palette(biome):
    helpers = SimpleNamespace(material=material, principled_bsdf=lambda m: m.node_tree.nodes.get('Principled BSDF'))
    result = {key: PBR.make_material(helpers, f'{biome}_{key}', key)
              for key in ['slate', 'slate_edge', 'wood', 'wood_dark', 'iron', 'rust', 'canvas', 'rope']}
    colors = {
        'desert': ((.36, .265, .16), (.34, .15, .075)),
        'snow': ((.25, .285, .30), (.085, .145, .17)),
        'forest': ((.20, .225, .16), (.095, .155, .065)),
        'ruins': ((.23, .24, .235), (.155, .12, .17)),
        'mine': ((.205, .215, .225), (.16, .105, .055)),
    }
    for key, source, color in [('stone', 'slate', colors[biome][0]), ('roof', 'slate', colors[biome][1])]:
        mat = result[source].copy()
        mat.name = f'{biome}_{key}_weathered'
        ramp = next(n for n in mat.node_tree.nodes if n.type == 'VALTORGB')
        ramp.color_ramp.elements[0].color = (*(c * .78 for c in color), 1)
        ramp.color_ramp.elements[1].color = (*color, 1)
        result[key] = mat
    result['snow'] = material('Powder snow', (.67, .73, .77), .98)
    result['dark'] = material('Unlit recess', (.019, .024, .027), 1)
    result['moss'] = material('Sparse moss', (.12, .16, .065), 1)
    return result


def attach(obj, name, mat):
    obj.name = name
    obj.data.materials.append(mat)
    for coll in list(obj.users_collection):
        coll.objects.unlink(obj)
    ACTIVE.objects.link(obj)
    obj.parent = ROOT
    return obj


def box(name, location, size, mat, bevel=.025):
    bpy.ops.mesh.primitive_cube_add(size=1, location=location)
    obj = attach(bpy.context.object, name, mat)
    obj.scale = size
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('Worn structural edges', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
    return obj


def cone(name, location, radius, top, height, mat, vertices=12):
    bpy.ops.mesh.primitive_cone_add(vertices=vertices, radius1=radius, radius2=top, depth=height, location=location)
    return attach(bpy.context.object, name, mat)


def beam(name, a, b, width, mat):
    a, b = Vector(a), Vector(b)
    obj = box(name, (a + b) / 2, (width, width, (b - a).length), mat, .009)
    obj.rotation_euler = (b - a).to_track_quat('Z', 'Y').to_euler()
    return obj


def mesh(name, vertices, faces, mat):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    ACTIVE.objects.link(obj)
    obj.data.materials.append(mat)
    obj.parent = ROOT
    return obj


def roof(name, x, y, z, w, d, rise, mat):
    verts = [(x-w/2, y-d/2, z), (x+w/2, y-d/2, z), (x, y-d/2, z+rise),
             (x-w/2, y+d/2, z), (x+w/2, y+d/2, z), (x, y+d/2, z+rise)]
    return mesh(name, verts, [(0, 1, 2), (5, 4, 3), (0, 2, 5, 3), (2, 1, 4, 5), (0, 3, 4, 1)], mat)


def foundation(p, w, d):
    box('Low rough masonry footprint', (0, 0, .055), (w, d, .11), p['stone'], .14)
    box('Inset worn courtyard', (0, 0, .115), (w-.18, d-.18, .06), p['slate'], .10)
    for y in [-1.10, -.83, -.56, -.29]:
        box('Entrance paving', (0, y, .156), (.42, .22, .024), p['stone'], .018)


def doorway(p, x, y, z, width=.33, height=.52):
    box('Dark doorway', (x, y, z+height/2), (width, .035, height), p['dark'], .018)
    for dx in [-width/2-.03, width/2+.03]:
        box('Door frame post', (x+dx, y-.015, z+height/2), (.065, .09, height+.08), p['wood_dark'], .01)
    box('Door lintel', (x, y-.015, z+height+.02), (width+.13, .09, .075), p['wood_dark'], .012)


def hall(p, biome, x, y, w, d, height, tall=False):
    wall = p['wood'] if biome in ['forest', 'mine'] else p['stone']
    z = .15
    box('Hall masonry or timber body', (x, y, z+height/2), (w, d, height), wall, .035)
    box('Hall stone footing', (x, y, z+.05), (w+.1, d+.08, .16), p['stone'], .025)
    for dx in [-w/2+.035, w/2-.035]:
        box('Corner structural beam', (x+dx, y-d/2-.022, z+height/2), (.075, .075, height), p['wood_dark'], .012)
    doorway(p, x, y-d/2-.03, z, min(.34, w*.44), min(.59, height*.7))
    if tall:
        for dx in [-w*.28, w*.28]:
            box('Upper unlit window', (x+dx, y-d/2-.027, z+height*.79), (.13, .055, .23), p['dark'], .018)
    if biome == 'desert':
        box('Flat roof deck', (x, y, z+height+.035), (w+.12, d+.12, .09), p['stone'], .025)
        for dx in [-w/2, w/2]:
            box('Roof parapet', (x+dx, y, z+height+.13), (.08, d+.08, .18), p['stone'])
        box('Rear roof parapet', (x, y+d/2, z+height+.13), (w+.08, .08, .18), p['stone'])
        box('Canvas roof shade', (x, y-.02, z+height+.24), (w*.7, d*.65, .05), p['canvas'], .01)
    else:
        rise = w * (.78 if biome == 'snow' else .52)
        roof('Steep layered roof', x, y, z+height, w+.18, d+.18, rise, p['roof'])
        if biome == 'snow':
            roof('Fresh snow roof cap', x, y, z+height+.065, w+.15, d+.16, rise, p['snow'])
        for side in [-1, 1]:
            beam('Roof front rake', (x+side*(w+.18)/2, y-(d+.2)/2, z+height),
                 (x, y-(d+.2)/2, z+height+rise), .045, p['wood_dark'])
        box('Roof ridge beam', (x, y, z+height+rise+.012), (.06, d+.22, .055), p['wood_dark'], .012)


def wall(p, x, y, length, height=.64, vertical=False, snow=False):
    size = (.22, length, height) if vertical else (length, .22, height)
    box('Curtain wall', (x, y, .15+height/2), size, p['stone'])
    count = max(2, round(length/.39))
    for i in range(count):
        t = (i/(count-1)-.5)*(length-.18)
        px, py = (x, y+t) if vertical else (x+t, y)
        box('Crenellation', (px, py, .15+height+.095), (.21, .24, .20), p['stone'], .018)
        if snow:
            box('Snow on battlement', (px, py, .15+height+.207), (.22, .25, .04), p['snow'], .018)
    for level in [.37, .62]:
        if level < height:
            box('Mortar course', (x, y-.116, level), (length-.04, .013, .015) if not vertical else (.235, length-.04, .015), p['slate_edge'], 0)


def turret(p, biome, x, y):
    cone('Octagonal corner tower', (x, y, .72), .33, .29, 1.18, p['stone'], 8)
    cone('Tower crown band', (x, y, 1.33), .35, .35, .14, p['stone'], 8)
    if biome in ['snow', 'forest', 'mine']:
        cone('Tower pitched cap', (x, y, 1.64), .43, .03, .52, p['snow'] if biome == 'snow' else p['roof'], 8)
    else:
        for i in range(8):
            a = i*math.tau/8
            box('Tower merlon', (x+.28*math.cos(a), y+.28*math.sin(a), 1.50), (.16, .16, .22), p['stone'], .016)
    box('Tower arrow slit', (x, y-.292, .95), (.07, .03, .26), p['dark'], .01)


def palisade(p, x, y, length, vertical=False, height=.76):
    n = max(2, round(length/.21))
    for i in range(n):
        t = (i/(n-1)-.5)*(length-.1)
        px, py = (x, y+t) if vertical else (x+t, y)
        cone('Sharpened log palisade', (px, py, .15+height/2), .095, .078, height, p['wood'], 8)
        cone('Carved timber point', (px, py, .15+height+.09), .093, 0, .18, p['wood_dark'], 8)
    size = (.10, length, .07) if vertical else (length, .10, .07)
    box('Palisade cross brace', (x, y-.07, .50), size, p['wood_dark'], .01)


def watchtower(p, biome, x, y, height=1.70):
    for dx in [-.32, .32]:
        for dy in [-.32, .32]:
            beam('Watchtower structural post', (x+dx, y+dy, .14), (x+dx, y+dy, height+.2), .115, p['wood_dark'])
    for dy in [-.32, .32]:
        beam('Crossed timber support', (x-.32, y+dy, .25), (x+.32, y+dy, height-.12), .075, p['wood'])
        beam('Crossed timber support', (x+.32, y+dy, .25), (x-.32, y+dy, height-.12), .075, p['wood'])
    box('Raised watch platform', (x, y, height), (.92, .90, .14), p['wood'], .025)
    for dx in [-.41, .41]:
        box('Watch platform rail', (x+dx, y, height+.25), (.06, .88, .32), p['wood'], .018)
    box('Watch platform rear rail', (x, y+.4, height+.25), (.84, .07, .32), p['wood'], .018)
    roof('Watch shelter roof', x, y, height+.50, 1.05, 1.03, .43, p['roof'])
    if biome == 'snow':
        roof('Watch shelter snow', x, y, height+.55, 1.06, 1.04, .43, p['snow'])
    for i in range(7):
        z=.20+i*.20
        box('Tower ladder rung', (x, y-.47, z), (.28, .055, .045), p['wood'], .005)
    for dx in [-.16, .16]:
        beam('Tower ladder stile', (x+dx, y-.48, .15), (x+dx, y-.48, height), .04, p['wood'])


def supplies(p, x, y):
    for dx, dy, z, size in [(0, 0, .31, .34), (.39, .05, .28, .28), (.06, .02, .58, .24)]:
        box('Supply crate', (x+dx, y+dy, z), (size, size*.84, size), p['wood'], .012)
        for offset in [-size*.30, size*.30]:
            box('Crate iron strap', (x+dx+offset, y+dy, z), (.025, size*.86, size+.012), p['iron'], .004)
    cone('Supply barrel', (x-.33, y+.1, .34), .13, .12, .38, p['wood'], 12)
    for z in [.21, .44]:
        cone('Barrel band', (x-.33, y+.1, z), .134, .134, .04, p['iron'], 12)


def mine_headframe(p, x, y, height=2.50):
    for dy in [-.22, .22]:
        for side in [-1, 1]:
            beam('Mine headframe A leg', (x+side*.43, y+dy, .15), (x+side*.19, y+dy, height), .12, p['wood_dark'])
        beam('Mine headframe diagonal', (x-.39, y+dy, .35), (x+.24, y+dy, height-.3), .075, p['iron'])
    box('Headframe upper beam', (x, y, height), (.72, .74, .14), p['wood'], .016)
    bpy.ops.mesh.primitive_torus_add(major_radius=.23, minor_radius=.032, major_segments=24, minor_segments=6, location=(x, y-.02, height+.20), rotation=(math.pi/2, 0, 0))
    attach(bpy.context.object, 'Mine winding wheel', p['rust'])
    beam('Winding cable', (x+.17, y-.04, height+.35), (x+.17, y-.04, .37), .018, p['iron'])
    for yy in [-1.15, -.93, -.71, -.49]:
        box('Mine track sleeper', (x, yy, .17), (.58, .08, .065), p['wood_dark'], .008)
    for xx in [-.17, .17]:
        beam('Mine rail', (x+xx, -1.25, .20), (x+xx, -.37, .20), .033, p['iron'])


def build_town(p, biome):
    foundation(p, 4.02, 3.52)
    if biome == 'forest':
        palisade(p, 0, 1.37, 3.48, height=.73)
        for x in [-1.68, 1.68]:
            palisade(p, x, 0, 2.85, vertical=True, height=.73)
        for x in [-1.06, 1.06]:
            palisade(p, x, -1.38, 1.22, height=.58)
        hall(p, biome, -.02, .49, 1.37, 1.40, 1.25, True)
        watchtower(p, biome, -1.15, .87, 1.24)
        hall(p, biome, 1.08, .46, .65, 1.08, .74)
    else:
        wall(p, 0, 1.39, 3.48, snow=biome=='snow')
        for x in [-1.68, 1.68]:
            wall(p, x, 0, 2.87, vertical=True, snow=biome=='snow')
        for x in [-1.12, 1.12]:
            wall(p, x, -1.39, 1.15, height=.55, snow=biome=='snow')
        for x in [-1.62, 1.62]:
            for y in [-1.31, 1.31]:
                turret(p, biome, x, y)
        hall(p, biome, .14, .49, 1.18, 1.30, 1.30, True)
        hall(p, biome, -1.05, .43, .66, 1.13, .77)
        hall(p, biome, 1.05, .13, .65, .94, .73)
    for x in [-.43, .43]:
        box('Gate pier', (x, -1.35, .66), (.23, .32, 1.04), p['stone'], .025)
    box('Gate lintel', (0, -1.35, 1.13), (1.10, .38, .23), p['wood_dark'] if biome=='forest' else p['stone'], .035)
    doorway(p, 0, -1.52, .15, .57, .77)
    supplies(p, .75, -.78)
    if biome == 'mine':
        mine_headframe(p, -.74, .63, 2.55)
        box('Smelter chimney', (1.03, .86, 1.65), (.24, .26, 1.63), p['slate'], .022)
    if biome == 'ruins':
        for x, y, h in [(-.63, .98, 2.02), (.92, 1.04, 1.72)]:
            cone('Ancient buttress pillar', (x, y, .15+h/2), .16, .13, h, p['slate_edge'], 8)
            box('Ancient capstone', (x, y, .15+h), (.40, .37, .15), p['stone'])
    if biome == 'desert':
        for x in [-.35, .35]:
            cone('Water storage amphora', (x-.7, -.72, .43), .16, .10, .53, p['roof'], 12)


def build_outpost(p, biome):
    foundation(p, 3.34, 2.78)
    if biome in ['desert', 'ruins']:
        wall(p, 0, 1.03, 2.72, .48)
        wall(p, -1.27, 0, 2.02, .44, True)
        watchtower(p, biome, -.69, .40, 1.47)
        hall(p, biome, .63, .34, .78, .98, .69)
    elif biome == 'mine':
        hall(p, biome, .57, .42, 1.00, 1.10, .73)
        mine_headframe(p, -.63, .33, 2.12)
        palisade(p, 0, 1.06, 2.75, height=.45)
    else:
        palisade(p, 0, 1.03, 2.75, height=.62)
        palisade(p, -1.32, 0, 2.10, True, .58)
        watchtower(p, biome, -.68, .38, 1.48)
        roof('Supply canvas shelter', .63, .30, .17, 1.04, 1.30, .89, p['canvas'])
        mesh('Dark tent opening', [(.32, -.361, .18), (.94, -.361, .18), (.63, -.361, .88)], [(0, 1, 2)], p['dark'])
        if biome == 'snow':
            roof('Snow on canvas ridge', .63, .35, .23, .94, .93, .84, p['snow'])
    for x in [-.9, .9]:
        palisade(p, x, -1.02, .66, height=.42)
    supplies(p, .38, -.78)


def build_destroyed(p, kind):
    foundation(p, 4.02 if kind=='town' else 3.34, 3.52 if kind=='town' else 2.78)
    rng = random.Random(830310 + (kind=='town'))
    for x, y, w, h in [(-1.23, .83, .9, .56), (.94, .76, .7, .36), (-1.3, -.68, .5, .27)]:
        box('Broken wall stump', (x, y, .15+h/2), (w, .24, h), p['stone'], .06)
    for i in range(32 if kind=='town' else 20):
        x, y = rng.uniform(-1.36, 1.36), rng.uniform(-1.06, 1.04)
        size = rng.uniform(.12, .36)
        obj = box('Fallen masonry', (x, y, .16+size*.37), (size, size*.76, size*.71), p['stone'] if i%3 else p['slate'], .025)
        obj.rotation_euler = (.16*rng.random(), .24*rng.random(), rng.random()*math.pi)
    for x, y in [(-.55, .42), (.45, .24), (.65, -.37)]:
        beam('Charred collapsed beam', (x-.5, y-.2, .22), (x+.33, y+.25, .43), .12, p['wood_dark'])
    if kind=='town':
        cone('Broken keep core', (.12, .44, .53), .44, .35, .73, p['stone'], 7)
    else:
        for x in [-.72, -.32]:
            beam('Broken lookout post', (x, .44, .15), (x+.06, .42, .87), .12, p['wood_dark'])


def main():
    global ACTIVE, ROOT
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', nargs='*')
    args = parser.parse_args(sys.argv[sys.argv.index('--')+1:] if '--' in sys.argv else [])
    bpy.context.preferences.filepaths.save_version = 0
    bpy.ops.object.select_all(action='SELECT')
    bpy.ops.object.delete(use_global=False)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    scene.cycles.samples = 48
    scene.cycles.use_denoising = True
    scene.cycles.device = 'CPU'
    scene.render.threads_mode = 'FIXED'
    scene.render.threads = 8
    scene.render.resolution_x = scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = True
    scene.view_settings.view_transform = 'Standard'
    scene.view_settings.look = 'Medium High Contrast'
    scene.view_settings.exposure = -.45
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes.get('Background')
    bg.inputs[0].default_value = (.72, .79, .84, 1)
    bg.inputs[1].default_value = .55
    for name, loc, power, size, color in [('Map soft key', (-3,-4,7), 420, 5, (1,.94,.84)), ('Map sky fill', (4,1,5), 140, 5, (.79,.87,1))]:
        data = bpy.data.lights.new(name, 'AREA')
        data.energy, data.size, data.color = power, size, color
        data.shape = 'DISK'
        obj = bpy.data.objects.new(name, data)
        scene.collection.objects.link(obj)
        obj.location = loc
        obj.rotation_euler = (-obj.location).to_track_quat('-Z', 'Y').to_euler()
    target, ortho = (0, .05, .85), 5.4
    camera = CAMERA.create_camera(scene, 'Shared strategic settlement camera', target, ortho)
    palettes = {b: palette(b) for b in ['desert','snow','forest','ruins','mine']}
    collections = []
    for profile in PROFILES:
        ACTIVE = bpy.data.collections.new(profile['key'])
        scene.collection.children.link(ACTIVE)
        ROOT = bpy.data.objects.new(profile['key']+' ground origin', None)
        ACTIVE.objects.link(ROOT)
        ROOT.rotation_euler.z = math.radians(ROOT_YAW)
        p = palettes[profile['biome']]
        if profile.get('destroyed'):
            build_destroyed(p, profile['kind'])
        elif profile['kind'] == 'town':
            build_town(p, profile['biome'])
        else:
            build_outpost(p, profile['biome'])
        collections.append(ACTIVE)
    bpy.context.view_layer.update()
    anchor = world_to_camera_view(scene, camera, Vector((0,0,0)))
    for folder in ['renders', 'whitebox']:
        (OUT/folder).mkdir(exist_ok=True)
    clay = material('Neutral model clay', (.48,.50,.50), .9)
    for profile, coll in zip(PROFILES, collections):
        if args.only and profile['key'] not in args.only:
            continue
        for other in collections:
            other.hide_render = other != coll
        outputs = [('renders', None)]
        if profile['key'] in ['desert_town', 'forest_outpost']:
            outputs.insert(0, ('whitebox', clay))
        for folder, override in outputs:
            scene.view_layers[0].material_override = override
            scene.render.filepath = str(OUT/folder/f"{profile['key']}.png")
            print('SETTLEMENT_RENDER', profile['key'], folder, flush=True)
            bpy.ops.render.render(write_still=True)
    scene.view_layers[0].material_override = None
    for coll in collections:
        coll.hide_render = coll.hide_viewport = coll.name != 'desert_town'
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT/'world-settlements-v1.blend'))
    manifest = dict(version=1, stage='native-models-rendered', runtimeInstalled=False,
                    source='Authored Blender geometry; existing world-map matte material library and light rig',
                    authorization='User requested enemy cities/outposts to be modeled, rendered and integrated into the game',
                    camera=dict(CAMERA.CONTRACT, target=list(target), orthoScale=ortho, resolution=SIZE, anchor=[anchor.x,1-anchor.y]),
                    modelPose=dict(rootYawDegrees=ROOT_YAW, groundOrigin=[0,0,0], worldUp='+Z'),
                    materialLibrary=dict(path='tools/ai-gen/environment-prop-materials.py', version=PBR.VERSION),
                    profiles=PROFILES, rendering=dict(engine='Cycles', samples=48, denoising=True, threads=8, transparent=True),
                    budget=dict(frameSize=256, columns=4, rows=3, decodedBytes=4*256*3*256*4),
                    runtimeValidation='Not run; offline asset production only')
    (OUT/'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    print('SETTLEMENT_MODELS_COMPLETE', flush=True)


if __name__ == '__main__':
    main()
