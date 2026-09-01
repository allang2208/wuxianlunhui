"""Native strategic mountains and edge-river kit. Asset authoring, no runtime install.

Use Blender --background --factory-startup --python-exit-code 1 --python <this>.
Optional -- --only forest_ridge river_edge_090 river_joint_a_03 for a small batch.
"""
from pathlib import Path
import argparse
import importlib.util
import json
import math
import random
import sys

import bpy
from mathutils import Vector
from mathutils.geometry import tessellate_polygon
from bpy_extras.object_utils import world_to_camera_view

OUT = Path(__file__).resolve().parent
REPO = OUT.parents[2]
spec = importlib.util.spec_from_file_location('strategic_hex_source', OUT.parent / '_world_hex_map_20260830/build-hex-models.py')
h = importlib.util.module_from_spec(spec)
spec.loader.exec_module(h)
SIZE = 512
FRAME = 320
SEED = 122901
WATER_HALF = .066
BANK_HALF = .14
JOINT_RADIUS = .22
EDGE_HALF_LENGTH = .5 - JOINT_RADIUS
MOUNTAIN_HEIGHT_SCALE = {'ridge': 1.35, 'massif': 1.42, 'pass': 1.28}
PROFILES = []


def collection(key, **data):
    col = bpy.data.collections.new(key)
    bpy.context.scene.collection.children.link(col)
    h.ACTIVE = col
    h.COLLECTIONS[key] = col
    PROFILES.append(dict(key=key, render=f'renders/{key}.png', sourceCollection=key, **data))
    return col


def mesh(name, vertices, faces, materials, indices=None):
    data = bpy.data.meshes.new(name)
    data.from_pydata(vertices, [], faces)
    data.update()
    obj = bpy.data.objects.new(name, data)
    h.ACTIVE.objects.link(obj)
    for key in materials:
        data.materials.append(h.MATS[key])
    if indices:
        for polygon, index in zip(data.polygons, indices):
            polygon.material_index = index
    uv = data.uv_layers.new(name='GroundXY')
    for polygon in data.polygons:
        for loop in polygon.loop_indices:
            v = data.vertices[data.loops[loop].vertex_index].co
            uv.data[loop].uv = (v.x, v.y)
    return obj


def peak(x, y, width, height, biome, rng, yaw=0):
    """Irregular strata and shared ridge ribs, matching the installed faceted terrain."""
    n, rings = 17, 7
    ribs = [rng.uniform(.78, 1.13) for _ in range(n)]
    vertices = []
    for ring in range(rings):
        t = ring / rings
        for i in range(n):
            a = i * math.tau / n + yaw
            radius = (1 - t) ** .84 * ribs[i] * (1 + .10 * math.sin(ring * 2.3 + i * .9) * math.sin(t * math.pi))
            shoulder = .025 * math.sin(i * 1.7 + ring * 1.3) if ring else 0
            vertices.append((x + width * (math.cos(a) * radius + .11 * t),
                             y + width * (.65 * math.sin(a) * radius + .12 * t),
                             max(0, height * t + shoulder)))
    vertices.append((x + width * .11, y + width * .12, height))
    faces = []
    for ring in range(rings - 1):
        for i in range(n):
            k = (i + 1) % n
            a, b = ring * n, (ring + 1) * n
            faces += [(a + i, a + k, b + i), (a + k, b + k, b + i)]
    for i in range(n):
        faces.append(((rings - 1) * n + i, (rings - 1) * n + (i + 1) % n, rings * n))
    palette = {
        'desert': ['sandstone', 'sandstone_light', 'sandstone'],
        'snow': ['rock', 'snow', 'snow_shade'],
        'forest': ['rock', 'hex_slate_edge', 'moss'],
        'ruins': ['stone', 'hex_slate_edge', 'hex_slate'],
        'mine': ['hex_slate', 'hex_slate_edge', 'rock'],
    }[biome]
    obj = mesh('Stratified_ridge', vertices, faces, palette)
    for i, polygon in enumerate(obj.data.polygons):
        z = sum(vertices[j][2] for j in polygon.vertices) / len(polygon.vertices)
        if biome == 'snow':
            polygon.material_index = 1 if z > height * (.30 + .08 * math.sin(i * .85)) and polygon.normal.z > .28 else 0
        elif biome == 'forest' and z < height * .32 and polygon.normal.z > .4:
            polygon.material_index = 2
        else:
            polygon.material_index = 1 if (i // n) % 3 == 1 else 0


def mountain(biome, kind, index):
    rng = random.Random(SEED + index * 7919)
    collection(f'{biome}_{kind}', category='mountain', biome=biome, kind=kind,
               label={'ridge': '连峰山脊', 'massif': '雄峰山体', 'pass': '开阔山口'}[kind],
               heightScale=MOUNTAIN_HEIGHT_SCALE[kind], ports=[])
    if kind == 'ridge':
        peaks = [(-.42, -.05, .38, .63), (-.02, .14, .49, .92), (.46, .09, .32, .57)]
    elif kind == 'massif':
        peaks = [(-.27, .28, .41, .72), (.19, .06, .57, 1.03), (-.30, -.25, .31, .42)]
    else:
        # The E-W saddle is geometry, not a painted slash through a solid mountain.
        peaks = [(-.16, .44, .57, .87), (.19, -.43, .48, .65)]
    for x, y, width, height in peaks:
        peak(x, y, width, height * MOUNTAIN_HEIGHT_SCALE[kind], biome, rng, rng.uniform(-.3, .3))
    for _ in range(13):
        a = rng.uniform(0, math.tau)
        x, y = .75 * math.cos(a), .61 * math.sin(a)
        if kind == 'pass' and abs(y) < .16:
            continue
        size = rng.uniform(.022, .064)
        material = {'desert': 'sandstone', 'snow': 'snow_shade', 'forest': 'rock', 'ruins': 'stone', 'mine': 'hex_slate'}[biome]
        h.rock('Talus_at_foot', (x, y, size * .26), (size, size * .76, size * .5), material, rng, 1)
    if kind == 'pass':
        mesh('Open_saddle_floor', [(-.77, -.105, .003), (.77, -.105, .003), (.77, .105, .003), (-.77, .105, .003)],
             [(0, 1, 2, 3)], ['ground_' + biome])


def outline(angles, length, half_width):
    angles = sorted(math.radians(angle) for angle in angles)
    if len(angles) == 1:
        angle = angles[0]
        points = [(length, -half_width), (length, half_width)]
        points += [(half_width * math.cos(math.radians(degree)), half_width * math.sin(math.radians(degree)))
                   for degree in range(90, 271, 15)]
        points = [(x * math.cos(angle) - y * math.sin(angle), x * math.sin(angle) + y * math.cos(angle)) for x, y in points]
        return points, {0}
    points = []
    for i, angle in enumerate(angles):
        c, s = math.cos(angle), math.sin(angle)
        points += [(length * c + half_width * s, length * s - half_width * c),
                   (length * c - half_width * s, length * s + half_width * c)]
        next_angle = angles[(i + 1) % len(angles)] + (math.tau if i == len(angles) - 1 else 0)
        half_gap = (next_angle - angle) / 2
        radius = half_width / math.sin(half_gap)
        middle = angle + half_gap
        points.append((radius * math.cos(middle), radius * math.sin(middle)))
    # Slight bank erosion is modeled inside each piece and tapers to zero at the
    # common port. The river is not a rectangular man-made canal.
    detailed, open_edges = [], set()
    for i, first in enumerate(points):
        second = points[(i + 1) % len(points)]
        detailed.append(first)
        if i % 3 == 0:
            open_edges.add(len(detailed) - 1)
            continue
        dx, dy = second[0] - first[0], second[1] - first[1]
        distance = math.hypot(dx, dy)
        for step in range(1, 6):
            t = step / 6
            erosion = .013 * (half_width / BANK_HALF) * math.sin(t * math.pi) ** 2 * math.sin(t * math.pi * 3 + i * .7)
            detailed.append((first[0] + dx * t + dy / distance * erosion,
                             first[1] + dy * t - dx / distance * erosion))
    return detailed, open_edges


def river(key, angles, length, kind):
    ports = [dict(angleDegrees=angle, position=[length * math.cos(math.radians(angle)), length * math.sin(math.radians(angle)), 0],
                  waterWidth=2 * WATER_HALF, bankWidth=2 * BANK_HALF) for angle in angles]
    collection(key, category='river', kind=kind, ports=ports)
    # Every port has the same cross-section. No random vertices, bevels or props near ends.
    rings = [(WATER_HALF, .018), (.083, .012), (.111, .030), (BANK_HALF, 0)]
    vertices, faces, material_indices = [], [], []
    for width, height in rings:
        points, open_edges = outline(angles, length, width)
        vertices += [(x, y, height) for x, y in points]
    count = len(vertices) // len(rings)
    for ring in range(len(rings) - 1):
        for i in range(count):
            if i in open_edges:
                continue
            j = (i + 1) % count
            # Open cross-section at each port: never put a dark wall across water.
            faces.append((ring * count + i, ring * count + j, (ring + 1) * count + j, (ring + 1) * count + i))
            material_indices.append([0, 1, 2][ring])
    mesh('River_banks', vertices, faces, ['river_shallows', 'river_bank', 'river_bank_outer'], material_indices)
    water_vertices = vertices[:count]
    vectors = [Vector(vertex) for vertex in water_vertices]
    triangles = tessellate_polygon([vectors])
    # Blender 5.1 tessellation returns indices into the flattened polygon vertices.
    water_faces = [tuple(triangle) for triangle in triangles]
    mesh('Continuous_water', water_vertices, water_faces, ['river_water'])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--only', nargs='*')
    parser.add_argument('--model-only', action='store_true', help='Rebuild model and manifest, reusing existing renders.')
    args = parser.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])
    h.SIZE = SIZE
    scene, camera = h.setup_scene()
    library = h.setup_materials()
    scene.cycles.samples = 48
    scene.render.threads = 8
    h.material('river_water', (.035, .105, .126), .32, .08)
    h.material('river_shallows', (.073, .143, .145), .72)
    h.material('river_bank', (.125, .108, .078), .94)
    h.material('river_bank_outer', (.16, .155, .105), .96)
    for key in ['river_water', 'river_bank', 'river_bank_outer']:
        material = h.MATS[key]
        nodes, links = material.node_tree.nodes, material.node_tree.links
        uv = nodes.new('ShaderNodeTexCoord')
        noise = nodes.new('ShaderNodeTexNoise')
        noise.inputs['Scale'].default_value = 28 if key == 'river_water' else 45
        noise.inputs['Detail'].default_value = 2
        links.new(uv.outputs['UV'], noise.inputs['Vector'])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = .12
        bump.inputs['Distance'].default_value = .002
        links.new(noise.outputs['Fac'], bump.inputs['Height'])
        links.new(bump.outputs['Normal'], h.principled(material).inputs['Normal'])
    index = 0
    for biome in h.BIOMES:
        for kind in ['ridge', 'massif', 'pass']:
            mountain(biome, kind, index)
            index += 1
    for angle in [30, 90, 150]:
        river(f'river_edge_{angle:03d}', [angle, angle + 180], EDGE_HALF_LENGTH, 'edge')
    # Three grid edges meet at each vertex; the alternating vertex parity has
    # separately rendered directions. No rotation or mirror of shaded PNGs.
    for parity, directions in [('a', [30, 150, 270]), ('b', [90, 210, 330])]:
        for mask in [3, 5, 6, 7]:
            angles = [angle for i, angle in enumerate(directions) if mask & (1 << i)]
            river(f'river_joint_{parity}_{mask:02d}', angles, JOINT_RADIUS, 'junction' if mask == 7 else 'bend')
        for angle in directions:
            river(f'river_end_{angle:03d}', [angle], JOINT_RADIUS, 'end')
    anchor = world_to_camera_view(scene, camera, Vector((0, 0, 0)))
    manifest = dict(version=1, stage='formal-mountain-atlas-with-river-candidates', runtimeInstalled=False,
        publicationScope='formal mountain resources and reproducible source; runtime wiring remains local until the strategic-map base is published', seed=SEED,
        generation=dict(method='Native Blender geometry / shared strategic PBR / Cycles 48 samples', aiGeneration=False, externalTransmission=False),
        camera=dict(h.map_camera.CONTRACT, orthoScale=h.ORTHO, resolution=[SIZE, SIZE], anchorPx=[anchor.x * SIZE, (1 - anchor.y) * SIZE],
                    pixelsPerWorldUnit=SIZE / h.ORTHO, lighting='shared hex soft key (-3,-4,7), cool fill (4,1,5)'),
        sourceModel='world-map-relief.blend', sourceScript='build-terrain-features.py',
        helperSource='../_world_hex_map_20260830/build-hex-models.py', materialLibrary=library,
        mountainProfile=dict(heightScaleByKind=MOUNTAIN_HEIGHT_SCALE,
                             horizontalFootprint='unchanged', passClearance='unchanged'),
        connections=dict(grid='pointy-top hex radius 1; rivers run on shared edges, not across tile centers',
                         hexEdgeLength=1, edgeHalfLength=EDGE_HALF_LENGTH, junctionRadius=JOINT_RADIUS,
                         crossSection=rings_metadata(), rotationOfRenderedImagesAllowed=False),
        retiredCandidates=dict(keys=['bridge_000', 'bridge_060', 'bridge_120'],
                               reason='2026-09-01 user removed bridges; direct river crossings have a movement cost.'),
        plannedAtlas=dict(frameSize=FRAME, frameCount=len(PROFILES), columns=8, rows=math.ceil(len(PROFILES) / 8)), assets=PROFILES)
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for col in h.COLLECTIONS.values():
        col.hide_render = True
    bpy.context.preferences.filepaths.save_version = 0
    for item in PROFILES:
        if args.model_only:
            continue
        if args.only and item['key'] not in args.only:
            continue
        col = h.COLLECTIONS[item['key']]
        col.hide_render = False
        h.render(scene, OUT / item['render'])
        if item['key'] in ['forest_ridge', 'snow_pass', 'river_joint_a_03']:
            scene.view_layers[0].material_override = h.MATS['clay']
            h.render(scene, OUT / 'whitebox' / (item['key'] + '.png'))
            scene.view_layers[0].material_override = None
        col.hide_render = True
    for key, col in h.COLLECTIONS.items():
        col.hide_viewport = key != 'forest_ridge'
    h.COLLECTIONS['forest_ridge'].hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=str(OUT / 'world-map-relief.blend'))
    print('WORLD_MAP_RELIEF_MODEL_SAVED' if args.model_only else 'WORLD_MAP_RELIEF_RENDERED', flush=True)


def rings_metadata():
    return [dict(halfWidth=WATER_HALF, z=.018), dict(halfWidth=.083, z=.012), dict(halfWidth=.111, z=.030), dict(halfWidth=BANK_HALF, z=0)]


if __name__ == '__main__':
    main()
