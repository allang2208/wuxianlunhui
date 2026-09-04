"""Derive the near-modern barracks from the project's modern tent assembly."""
import copy
import importlib.util
import json
import math
from pathlib import Path
import shutil

import bmesh
import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
DESIGN = json.loads((HERE / 'design.json').read_text(encoding='utf-8'))
loader = importlib.util.spec_from_file_location('settlement_builder', ROOT / 'tools/ai-gen/settlement-building-pack-blender.py')
builder = importlib.util.module_from_spec(loader)
loader.loader.exec_module(builder)
kit = builder.kit
manifest = json.loads((ROOT / 'tools/ai-gen/_settlement_building_pack_20260821/manifest.json').read_text(encoding='utf-8-sig'))
spec = copy.deepcopy(manifest['buildings']['hamster_barracks_lv3'])
spec['dimensions'] = DESIGN['dimensions']
spec['camera'] = dict(manifest['camera'], **spec.get('cameraOverrides', {}))
spec['palette'] = manifest['palette']

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
root = builder.build_hamster_barracks_lv3(spec)
collection = root.users_collection[0]
prefix = 'BarracksLV3_'


def mat(name, color, roughness=0.9, metal=0):
    return kit.material('IND2_' + name, (*color, 1), roughness=roughness, metallic=metal,
                        noise={'scale': 5, 'detail': 1, 'bump': 0.045, 'distance': 0.04,
                               'dark': (*(v * 0.94 for v in color), 1),
                               'light': (*(v * 1.04 for v in color), 1)})


canvas = mat('Khaki_Canvas', (0.34, 0.31, 0.215), 0.98)
canvas_dark = mat('Canvas_Shadow', (0.13, 0.125, 0.09), 0.99)
webbing = mat('Olive_Webbing', (0.19, 0.195, 0.13), 0.97)
wood = mat('Oiled_Structural_Timber', (0.20, 0.16, 0.105), 0.87)
steel = mat('Dark_Painted_Steel', (0.105, 0.12, 0.112), 0.72, 0.25)
deck = mat('Timber_Deck', (0.255, 0.215, 0.155), 0.91)
stone = mat('Worn_Concrete', (0.31, 0.315, 0.285), 0.96)
sand = mat('Sandbag', (0.39, 0.345, 0.25), 0.99)
rope_mat = mat('Hemp_Guy_Rope', (0.36, 0.31, 0.215), 0.99)
window = mat('Dark_Window_Mesh', (0.06, 0.07, 0.059), 0.95)


def obj(suffix):
    return bpy.data.objects[prefix + suffix]


def assign(ob, material):
    for index in range(len(ob.data.materials)):
        ob.data.materials[index] = material


for ob in list(root.children_recursive):
    if ob.type != 'MESH':
        continue
    for index, old in enumerate(list(ob.data.materials)):
        mapping = {
            'MAT_BarracksLV3_OliveCanvas': canvas,
            'MAT_BarracksLV3_DarkCanvas': canvas_dark,
            'MAT_BarracksLV3_CanvasWebbing': webbing,
            'MAT_BarracksLV3_FieldConcrete': stone,
            'MAT_BarracksLV3_Sandbag': sand,
            'MAT_BarracksLV3_AmmoOlive': webbing,
            'MAT_BarracksLV3_EquipmentDark': steel,
            'MAT_Blackened_Iron': steel,
            'MAT_Warm_Glass': window,
        }
        if old and old.name in mapping:
            ob.data.materials[index] = mapping[old.name]
    if 'Watchtower_' in ob.name and any(part in ob.name for part in ['Post', 'Rail', 'Brace']):
        assign(ob, wood if 'Brace' not in ob.name else steel)
    if 'Watchtower_' in ob.name and ob.name.endswith('Post') and 'RailPost' not in ob.name:
        ob.dimensions.x = 18
        ob.dimensions.y = 18
    if 'Ammo' in ob.name or 'SupplyCrate' in ob.name:
        if ob.name.endswith('_Body'):
            assign(ob, wood)
    if 'Window' in ob.name and 'Rolled' not in ob.name:
        assign(ob, window)

fh = DESIGN['dimensions']['foundation'][2]
tw, td, wh = DESIGN['dimensions']['tentWall']
rw, rd, rh = DESIGN['dimensions']['tentRoof']
tower_w, tower_d, tower_h = DESIGN['dimensions']['watchtower']
tent_x, tent_y, tower_x, tower_y = -48, 34, 160, 58
front = tent_y - td / 2
roof_base = fh + wh - 3

# Reuse the source's walls, doors and windows; replace only its solid wall core
# with thin independent canvas panels so the doorway has physical depth.
bpy.data.objects.remove(obj('InfantryTent_LowCanvasWall'), do_unlink=True)
kit.box(collection, root, 'IndustrialTent_BackCanvas', (tw, 6, wh),
        (tent_x, tent_y + td / 2 - 3, fh + wh / 2), canvas, bevel_width=2)
for side in (-1, 1):
    kit.box(collection, root, f'IndustrialTent_EndCanvas_{side:+d}', (6, td, wh),
            (tent_x + side * (tw / 2 - 3), tent_y, fh + wh / 2), canvas, bevel_width=2)
    width = (tw - 96) / 2
    kit.box(collection, root, f'IndustrialTent_FrontCanvas_{side:+d}', (width, 6, wh),
            (tent_x + side * (48 + width / 2), front + 3, fh + wh / 2), canvas, bevel_width=2)
    flap = obj('InfantryTent_' + ('Left' if side == -1 else 'Right') + 'TiedFlap')
    flap.dimensions = (24, 13, wh + 5)
    flap.location.x = tent_x + side * 57
    flap.location.z = fh + (wh + 5) / 2
    flap.rotation_euler.z = math.radians(side * 15)
    tie = obj('InfantryTent_' + ('Left' if side == -1 else 'Right') + 'FlapTie')
    tie.location.x = tent_x + side * 62
entrance = obj('InfantryTent_DarkEntrance')
entrance.location.y = front + 25
entrance.dimensions = (100, 4, wh)
entrance.location.z = fh + wh / 2
assign(entrance, window)
assign(obj('InfantryTent_ConcreteSkirt'), deck)
obj('InfantryTent_ConcreteSkirt').name = 'IndustrialTent_TimberFloor'
header = obj('InfantryTent_EntranceHeader')
header.location.z = fh + wh - 3
for side in (0, 1):
    post = obj(f'InfantryTent_EntrancePost_{side}')
    post.dimensions.z = wh
    post.location.z = fh + wh / 2


def soften_existing_roof(ob, width, height, sag):
    """Subdivide the existing gable mesh and sag it; no replacement assembly."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    bmesh.ops.subdivide_edges(bm, edges=list(bm.edges), cuts=11, use_grid_fill=True)
    for vertex in bm.verts:
        if vertex.co.z <= 0.001:
            continue
        t = min(1, abs(vertex.co.y) / (width / 2))
        edge_height = height * (1 - t)
        ratio = min(1, vertex.co.z / max(0.01, edge_height))
        vertex.co.z -= sag * math.sin(math.pi * t) * ratio
    bm.to_mesh(ob.data)
    bm.free()
    ob.data.update()


soften_existing_roof(obj('InfantryTent_CanvasRoof'), rd, rh, 8)
soften_existing_roof(obj('Watchtower_CanvasCanopy'), DESIGN['dimensions']['watchtowerRoof'][1],
                     DESIGN['dimensions']['watchtowerRoof'][2], 4)

# These curves are tent-specific webbing / guy lines; all stay within the same base.
line_specs = []
for index, x in enumerate((tent_x - 100, tent_x, tent_x + 100)):
    points = []
    for step in range(25):
        y = -rd / 2 + rd * step / 24
        t = abs(y) / (rd / 2)
        z = roof_base + rh * (1 - t) - 8 * math.sin(math.pi * t) + 1.5
        points.append((x, tent_y + y, z))
    line_specs.append((f'IndustrialTent_Webbing_{index}', points, 2.0, webbing))
for side_x in (-1, 1):
    for side_y in (-1, 1):
        start = (tent_x + side_x * 124, tent_y + side_y * rd / 2, roof_base + 2)
        end = (tent_x + side_x * 155, tent_y + side_y * (rd / 2 + 29), fh + 6)
        line_specs.append((f'IndustrialTent_Guy_{side_x}_{side_y}', [start, end], 1.5, rope_mat))
        kit.box(collection, root, f'IndustrialTent_Stake_{side_x}_{side_y}', (6, 6, 15),
                (end[0], end[1], fh + 6), steel, rotation=(0, side_x * 12, 0), bevel_width=1)
for name, points, thickness, material in line_specs:
    curve = bpy.data.curves.new(name + '_Curve', 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = thickness
    curve.bevel_resolution = 2
    spline = curve.splines.new('POLY')
    spline.points.add(len(points) - 1)
    for point, co in zip(spline.points, points):
        point.co = (*co, 1)
    ob = bpy.data.objects.new(name, curve)
    collection.objects.link(ob)
    ob.parent = root
    curve.materials.append(material)

# Low timber lookout with shoes, usable ladder opening and grounded connector.
deck_z = fh + tower_h
assign(obj('Watchtower_Deck'), deck)
assign(obj('Watchtower_CanopyRidge'), wood)
for ob in root.children_recursive:
    if ob.type == 'MESH' and 'Watchtower_RailPost_' in ob.name:
        ob.dimensions.z = 56
        ob.location.z = deck_z + 28
for xs in (-1, 1):
    for ys in (-1, 1):
        kit.box(collection, root, f'IndustrialTower_SteelFoot_{xs}_{ys}', (24, 24, 24),
                (tower_x + xs * tower_w * 0.34, tower_y + ys * tower_d * 0.34, fh + 12),
                steel, bevel_width=2)
for side in (-1, 1):
    rail = obj(f'Watchtower_LadderRail_{side:+d}')
    rail.dimensions.z = tower_h + 40
    rail.location.z = fh + (tower_h + 40) / 2
for index, dz in enumerate((16, 42)):
    old = obj(f'Watchtower_FrontRail_{index}')
    y = old.location.y
    bpy.data.objects.remove(old, do_unlink=True)
    width = (tower_w + 22 - 60) / 2
    for side in (-1, 1):
        kit.box(collection, root, f'IndustrialTower_EntryRail_{index}_{side}', (width, 8, 7),
                (tower_x + side * (30 + width / 2), y, deck_z + dz), wood, bevel_width=1)
landing = obj('TentTowerConnectorLanding')
landing.location.z = fh + 6
assign(landing, deck)
landing.name = 'IndustrialTentTower_GroundWalkway'
radio = obj('TowerService_RadioFace')
assign(radio, steel)
for index in range(3):
    kit.cylinder(collection, root, f'IndustrialRadio_AnalogKnob_{index}', 3, 4,
                 (206 + index * 9, -5, fh + 24), wood, rotation=(90, 0, 0), vertices=16)

root.name = 'INDUSTRIAL_BARRACKS_ROOT_ROT_Z_44_8'
collection.name = 'INDUSTRIAL_BARRACKS_EDITABLE_COMPONENTS'
preview = HERE / 'industrial_barracks_model_preview.png'
kit.setup_scene(spec, str(preview))
camera = kit.setup_camera(spec, root)
bpy.context.scene.camera = camera
bpy.context.preferences.filepaths.save_version = 0
blend = HERE / 'industrial_barracks_model.blend'
bpy.ops.wm.save_as_mainfile(filepath=str(blend))
bpy.ops.render.render(write_still=True)
approval = builder.publish_approval_preview(DESIGN['id'], str(preview))
kit.render_depth(bpy.context.scene, root, camera, str(HERE / 'industrial_barracks_depth.png'), DESIGN['id'])
shutil.copy2(ROOT / DESIGN['referencePreview'], HERE / 'modern_reference_model_preview.png')
report = dict(DESIGN, meshCount=sum(o.type == 'MESH' for o in root.children_recursive),
              curveCount=sum(o.type == 'CURVE' for o in root.children_recursive),
              model=blend.relative_to(ROOT).as_posix(), approvalPreview=Path(approval).relative_to(ROOT).as_posix(),
              geometryChanged=True, runtimeChanged=False)
(HERE / 'model-manifest.json').write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print('MODEL_READY', str(blend), flush=True)
