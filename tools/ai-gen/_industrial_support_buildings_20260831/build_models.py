"""Author three intermediate-era variants from existing editable family models."""
import importlib.util
import json
import math
from pathlib import Path
import shutil
import sys

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DESIGN = json.loads((HERE / 'design.json').read_text(encoding='utf-8'))


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


pbr = load('industrial_pbr', ROOT / 'tools/ai-gen/_industrial_recruitment_materials_20260831/build_material_models.py')
kit = pbr.kit


def palette(key, root):
    wall = {'cavalry_academy_industrial': 'ADA797',
            'artillery_workshop_industrial': 'A89585',
            'steam_arsenal_industrial': 'A38B7B'}[key]
    roof = '82908B' if key == 'cavalry_academy_industrial' else '839195'
    return {
        'brick': pbr.finish('Industrial_Brick', wall, root, kind='brick'),
        'roof': pbr.finish('Painted_Metal_Roof', roof, root, .72, .18, 'sheet_metal'),
        'foundation': pbr.finish('Quiet_Stone_Base', 'ACA99E', root, .94),
        'trim': pbr.finish('Stone_Trim', 'B6B5AB', root, .88),
        'steel': pbr.finish('Muted_Painted_Steel', '667471', root, .76, .22),
        'iron': pbr.finish('Blackened_Iron', '4E5959', root, .72, .32),
        'wood': pbr.finish('Worn_Timber', '8C7960', root, .91),
        'canvas': pbr.finish('Khaki_Padding', 'ADA080', root, .98),
        'brass': pbr.finish('Dull_Brass', '9A8767', root, .7, .25),
        'glass': pbr.finish('Muted_Window_Glass', '91A4A1', root, .36, .08),
        'dark': pbr.finish('Interior_Dark', '343B37', root, .98),
    }


def set_material(ob, material):
    for index in range(len(ob.data.materials)):
        ob.data.materials[index] = material


def remove_named(root, fragments):
    for ob in list(root.children_recursive):
        if any(part in ob.name for part in fragments):
            bpy.data.objects.remove(ob, do_unlink=True)


def recolor(root, mats, key):
    assignments = []
    for ob in root.children_recursive:
        if ob.type != 'MESH':
            continue
        for index, old in enumerate(list(ob.data.materials)):
            if not old:
                continue
            name = old.name
            target = None
            if 'Fieldstone_Foundation' in name:
                target = 'foundation'
            elif 'Weathered_Stone' in name or 'Muted_Plaster' in name:
                target = 'brick'
            elif 'Aged_Roof' in name:
                target = 'roof'
            elif 'Dark_Oak' in name:
                target = 'wood'
            elif 'Blackened_Iron' in name:
                target = 'iron'
            elif 'Aged_Brass' in name:
                target = 'brass'
            elif 'Warm_Glass' in name:
                target = 'glass'
            elif 'Straw' in name:
                target = 'canvas'
            elif name.endswith('_MAT_interior'):
                target = 'dark'
            if target:
                if any(token in ob.name for token in ['Frame_', 'Bay_Jamb', 'Fascia', 'Timber_Post', 'Timber_Brace']):
                    target = 'steel'
                if 'CatSaddlePad' in ob.name:
                    target = 'canvas'
                if key == 'cavalry_academy_industrial' and 'Perimeter' in ob.name and 'Post' in ob.name:
                    target = 'steel'
                if any(token in ob.name for token in ['CatCareStation', 'StoneSkirt', 'Foundation_Edge']):
                    target = 'trim'
                if any(token in ob.name for token in ['DarkInterior', 'DarkMouth']):
                    target = 'dark'
                ob.data.materials[index] = mats[target]
                assignments.append({'object': ob.name, 'slot': index, 'sourceMaterial': name,
                                    'material': mats[target].name})
    return assignments


def cavalry(root, collection, mats):
    remove_named(root, ['CavalrySchoolLV2_LongSpear_'])
    # Reuse both edge racks; the central cat-riding route stays empty.
    for rack, y in enumerate((-142, -36)):
        for index, x in enumerate((-330, -292, -254)):
            name = f'IndustrialCavalry_RidingCarbine_{rack}_{index}'
            kit.box(collection, root, name + '_Stock', (12, 10, 37),
                    (x, y - 10, 42), mats['wood'], bevel_width=3)
            kit.box(collection, root, name + '_Receiver', (7, 8, 28),
                    (x, y - 10, 73), mats['iron'], bevel_width=1)
            kit.cylinder(collection, root, name + '_Barrel', 2.5, 42,
                         (x, y - 10, 104), mats['iron'], vertices=16, bevel_width=.5)
            kit.box(collection, root, name + '_Bolt', (11, 12, 4),
                    (x + 3, y - 10, 78), mats['iron'], bevel_width=1)
    kit.framed_glass_panel(collection, root, 'IndustrialCavalry_HallSideWindow',
                           (-204, 218, 118), 88, 44, mats['glass'], mats['steel'], mats['steel'],
                           orientation='side', vertical_divisions=3, horizontal_divisions=1)
    for ob in root.children_recursive:
        if ob.type == 'MESH' and 'AgilityJump' in ob.name and 'Post_' in ob.name:
            x, y, _ = ob.location
            kit.box(collection, root, ob.name + '_SteelShoe', (18, 18, 16),
                    (x, y, 22), mats['steel'], bevel_width=1.5)


def engineering(root, collection, mats):
    remove_named(root, ['EngineerLV2_Roof_Courses'])
    beam = bpy.data.objects['EngineerLV2_Hoist_Crossbeam']
    x, y, z = beam.location
    beam.dimensions = (132, 8, 22)
    set_material(beam, mats['steel'])
    for side in (-1, 1):
        kit.box(collection, root, f'IndustrialArtillery_HoistFlange_{side}', (132, 28, 5),
                (x, y, z + side * 12), mats['steel'], bevel_width=1)
        post = bpy.data.objects[f'EngineerLV2_Hoist_Post_{side}']
        post.dimensions.x = 16
        post.dimensions.y = 18
        set_material(post, mats['steel'])
        set_material(bpy.data.objects[f'EngineerLV2_Hoist_Foot_{side}'], mats['steel'])
    for ob in root.children_recursive:
        if ob.type == 'MESH' and ('AxleStock_Wheel' in ob.name or 'OpenServiceDoors' in ob.name):
            set_material(ob, mats['steel'] if 'Wheel' not in ob.name else mats['iron'])
    roof = bpy.data.objects['EngineerLV2_Roof_Main']
    half_depth = max(v.co.y for v in roof.data.vertices)
    rise = max(v.co.z for v in roof.data.vertices)
    slope = math.degrees(math.atan2(rise, half_depth))
    pane_y = roof.location.y - half_depth * .48
    pane_z = roof.location.z + rise * .52 + 2
    for index, pane_x in enumerate((-68, 68)):
        kit.box(collection, root, f'IndustrialArtillery_FlushRoofLight_{index}_Frame',
                (108, 48, 4), (pane_x, pane_y, pane_z), mats['steel'],
                rotation=(slope, 0, 0), bevel_width=1)
        kit.box(collection, root, f'IndustrialArtillery_FlushRoofLight_{index}_Glass',
                (96, 36, 3), (pane_x, pane_y, pane_z + 2.5), mats['glass'],
                rotation=(slope, 0, 0), bevel_width=.8)
        kit.box(collection, root, f'IndustrialArtillery_FlushRoofLight_{index}_Mullion',
                (5, 39, 3), (pane_x, pane_y, pane_z + 4), mats['steel'],
                rotation=(slope, 0, 0), bevel_width=.5)
    for side in (-1, 1):
        kit.box(collection, root, f'IndustrialArtillery_AssemblyRail_{side}', (5, 112, 4),
                (side * 29, -118, 16), mats['iron'], bevel_width=.8)


def open_arsenal_loading_bay(root, collection, mats):
    # Cut a real recessed entrance in the source's solid hall and upper trim.
    cutter = kit.box(collection, root, 'IndustrialArsenal_LoadingBay_Cutter',
                     (118, 86, 144), (-90, -104, 86), mats['dark'], bevel_width=0)
    bpy.context.view_layer.update()
    targets = [ob for ob in root.children_recursive if ob.type == 'MESH' and (
        ob.name in ('BlacksmithLV2_Arsenal_StoneHall', 'BlacksmithLV2_Arsenal_PlasterUpper')
        or ob.name.startswith('BlacksmithLV2_Arsenal_FrontTimber_'))]
    for ob in targets:
        modifier = ob.modifiers.new('IndustrialArsenal_OpenLoadingBay', 'BOOLEAN')
        modifier.operation = 'DIFFERENCE'
        modifier.solver = 'EXACT'
        modifier.object = cutter
        bpy.context.view_layer.objects.active = ob
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    bpy.data.objects.remove(cutter, do_unlink=True)

    interior = bpy.data.objects['BlacksmithLV2_LoadingBay_DarkInterior']
    interior.location = (-90, -65, 86)
    interior.dimensions = (118, 4, 140)
    kit.box(collection, root, 'IndustrialArsenal_LoadingBay_RecessFloor', (114, 76, 1.2),
            (-90, -102, 16.6), mats['steel'], bevel_width=.3)
    bpy.data.objects['BlacksmithLV2_LoadingBay_InteriorRack'].location.y = -73
    for ob in root.children_recursive:
        if ob.name.startswith('BlacksmithLV2_LoadingBay_HangingTool_'):
            ob.location.y = -80

    # Swing each complete leaf about its jamb, fully inward to stay on the base.
    for side in (-1, 1):
        leaf = bpy.data.objects[f'BlacksmithLV2_LoadingBay_ArmoredDoors_Leaf_{side:+d}']
        angle = math.radians(-side * 90)
        half_leaf = 28
        leaf.rotation_euler.z = angle
        leaf.location.x = -90 + side * 55 - side * half_leaf * math.cos(angle)
        leaf.location.y = -140 - side * half_leaf * math.sin(angle)
        leaf['open_angle_degrees'] = 90
        leaf['opens_inward'] = True


def arsenal(root, collection, mats):
    open_arsenal_loading_bay(root, collection, mats)
    remove_named(root, ['BlacksmithLV2_WeaponRack_', 'BlacksmithLV2_Arsenal_RoofCourse',
                        'BlacksmithLV2_Arsenal_Anvil', 'BlacksmithLV2_Arsenal_Workbench'])
    # Replace the front table and vise with grounded stock and production props.
    # Keep every new part within the foundation and below the forge opening.
    prefix = 'IndustrialArsenal_MaterialCrate'
    kit.box(collection, root, prefix + '_LowerBody', (42, 28, 26),
            (14, -159, 29), mats['wood'], bevel_width=1.5)
    for side in (-1, 1):
        kit.box(collection, root, f'{prefix}_LowerBand_{side}', (4, 29, 27),
                (14 + side * 13, -159, 29), mats['iron'], bevel_width=.5)
    for z in (24, 34):
        kit.box(collection, root, f'{prefix}_LowerPlankSeam_{z}', (40, .6, .7),
                (14, -173.1, z), mats['dark'], bevel_width=0)
    kit.box(collection, root, prefix + '_OpenBase', (36, 24, 3),
            (12, -159, 43.5), mats['wood'], bevel_width=.7)
    for side in (-1, 1):
        kit.box(collection, root, f'{prefix}_OpenSide_{side}', (3, 24, 17),
                (12 + side * 16.5, -159, 50.5), mats['wood'], bevel_width=.7)
        kit.box(collection, root, f'{prefix}_OpenEnd_{side}', (30, 3, 17),
                (12, -159 + side * 10.5, 50.5), mats['wood'], bevel_width=.7)
    for index, x in enumerate((2, 12, 22)):
        kit.box(collection, root, f'{prefix}_SteelBillet_{index}', (7, 17, 12),
                (x, -159, 51), mats['steel'], bevel_width=1)
    # A hammer and a spanner lie on the crate rims, without another tabletop.
    kit.box(collection, root, 'IndustrialArsenal_StockHammer_Handle', (28, 3, 3),
            (9, -156, 60.5), mats['wood'], bevel_width=.6)
    kit.box(collection, root, 'IndustrialArsenal_StockHammer_Head', (8, 12, 7),
            (23, -156, 63.5), mats['iron'], bevel_width=1)
    kit.box(collection, root, 'IndustrialArsenal_StockSpanner_Handle', (23, 3.2, 2.4),
            (7, -166, 60.2), mats['steel'], bevel_width=.7)
    kit.torus_ring(collection, root, 'IndustrialArsenal_StockSpanner_Ring', 3.7, 1.2,
                   (21, -166, 60.2), mats['steel'], major_segments=20, minor_segments=8)
    for side in (-1, 1):
        kit.box(collection, root, f'IndustrialArsenal_StockSpanner_Jaw_{side}', (6, 2, 2.4),
                (-6, -166 + side * 2, 60.2), mats['steel'], bevel_width=.5)
    # Compact gear-driven rolling machine on a solid floor plinth, not legs.
    kit.box(collection, root, 'IndustrialArsenal_StockMachine_Plinth', (38, 30, 8),
            (66, -156, 20), mats['iron'], bevel_width=1.5)
    kit.box(collection, root, 'IndustrialArsenal_StockMachine_Housing', (30, 26, 26),
            (66, -156, 37), mats['steel'], bevel_width=2)
    for side in (-1, 1):
        kit.box(collection, root, f'IndustrialArsenal_StockMachine_Bearing_{side}', (6, 23, 22),
                (66 + side * 13, -154, 55), mats['steel'], bevel_width=1.5)
    kit.cylinder(collection, root, 'IndustrialArsenal_StockMachine_Roller', 9, 22,
                 (66, -154, 57), mats['iron'], rotation=(0, 90, 0), vertices=32, bevel_width=1)
    kit.gear(collection, root, 'IndustrialArsenal_StockMachine_DriveGear', 15,
             (49, -154, 57), mats['steel'], axis='X', teeth=10)
    kit.cylinder(collection, root, 'IndustrialArsenal_StockMachine_AxleCap', 4.5, 8,
                 (43, -154, 57), mats['brass'], rotation=(0, 90, 0), vertices=24, bevel_width=.8)
    # Steam-era transmission occupies the old wall rack, not a second factory.
    x, y, z = -190, 26, 98
    kit.box(collection, root, 'IndustrialArsenal_EngineBed', (34, 114, 15),
            (-189, 23, 23.5), mats['steel'], bevel_width=3)
    kit.cylinder(collection, root, 'IndustrialArsenal_SteamCylinder', 16, 50,
                 (-189, -9, 57), mats['steel'], vertices=32, bevel_width=2)
    kit.cylinder(collection, root, 'IndustrialArsenal_PistonRod', 4, 34,
                 (-189, -9, 91), mats['iron'], vertices=20, bevel_width=1)
    kit.box(collection, root, 'IndustrialArsenal_ConnectingRod', (7, 36, 7),
            (-190, 8, 107), mats['iron'], bevel_width=1)
    kit.torus_ring(collection, root, 'IndustrialArsenal_DriveFlywheel', 36, 4,
                   (x, y, z), mats['iron'], rotation=(0, 90, 0), major_segments=48, minor_segments=10)
    for index, angle in enumerate((0, 45, 90, 135)):
        kit.box(collection, root, f'IndustrialArsenal_FlywheelSpoke_{index}', (5, 66, 5),
                (x, y, z), mats['steel'], rotation=(angle, 0, 0), bevel_width=1)
    kit.cylinder(collection, root, 'IndustrialArsenal_FlywheelHub', 9, 24,
                 (x, y, z), mats['brass'], rotation=(0, 90, 0), vertices=24)
    kit.framed_glass_panel(collection, root, 'IndustrialArsenal_HighSideWindow',
                           (-186, 26, 167), 112, 42, mats['glass'], mats['steel'], mats['steel'],
                           orientation='side', vertical_divisions=4, horizontal_divisions=1)
    # Mechanical drop hammer fits entirely in the old front anvil zone.
    hx, hy, base = 132, -158, 16
    kit.box(collection, root, 'IndustrialArsenal_PowerHammer_Base', (72, 32, 14),
            (hx, hy, base + 7), mats['steel'], bevel_width=3)
    for side in (-1, 1):
        kit.box(collection, root, f'IndustrialArsenal_PowerHammer_Guide_{side}', (11, 22, 102),
                (hx + side * 27, hy, base + 58), mats['steel'], bevel_width=2)
    kit.box(collection, root, 'IndustrialArsenal_PowerHammer_Header', (68, 26, 14),
            (hx, hy, base + 109), mats['iron'], bevel_width=3)
    kit.cylinder(collection, root, 'IndustrialArsenal_PowerHammer_SteamHead', 17, 36,
                 (hx, hy, base + 134), mats['steel'], vertices=32, bevel_width=2)
    kit.cylinder(collection, root, 'IndustrialArsenal_PowerHammer_Ram', 5, 48,
                 (hx, hy, base + 80), mats['iron'], vertices=24)
    kit.box(collection, root, 'IndustrialArsenal_PowerHammer_Striker', (32, 24, 18),
            (hx, hy, base + 55), mats['iron'], bevel_width=2)
    kit.box(collection, root, 'IndustrialArsenal_PowerHammer_Die', (38, 26, 20),
            (hx, hy, base + 25), mats['iron'], bevel_width=2)


BUILDERS = {'cavalry_academy_industrial': cavalry,
            'artillery_workshop_industrial': engineering,
            'steam_arsenal_industrial': arsenal}


def build(entry):
    key = entry['id']
    out = HERE / key
    out.mkdir(exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / entry['source']))
    scene = bpy.context.scene
    root = next(o for o in scene.objects if o.type == 'EMPTY' and '_ROOT_' in o.name)
    collection = root.users_collection[0]
    mats = palette(key, root)
    assignments = recolor(root, mats, key)
    BUILDERS[key](root, collection, mats)
    root.name = key.upper() + '_ROOT_ROT_Z_44_8'
    root['asset_status'] = 'model_candidate_awaiting_user_review'
    root['era'] = 'industrial_intermediate'
    root['building_family'] = key
    if 'tier' in root:
        del root['tier']
    collection.name = key.upper() + '_EDITABLE_COMPONENTS'
    preview = out / (key + '_model_approval_preview.png')
    scene.render.filepath = str(preview)
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = True
    bpy.context.preferences.filepaths.save_version = 0
    blend = out / (key + '_model.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.ops.render.render(write_still=True)
    kit.render_depth(scene, root, scene.camera, str(out / (key + '_depth.png')), key)
    shutil.copy2(ROOT / entry['sourcePreview'], out / (key + '_previous_model_preview.png'))
    shutil.copy2(ROOT / entry['modernPreview'], out / (key + '_modern_model_preview.png'))
    record = dict(entry, model=blend.relative_to(ROOT).as_posix(),
                  approvalPreview=preview.relative_to(ROOT).as_posix(),
                  meshCount=sum(o.type == 'MESH' for o in root.children_recursive),
                  assignments=assignments, geometryChanged=True, foundationChanged=False,
                  cameraChanged=False, approved=False, runtimeIntegrated=False)
    (out / 'model-manifest.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('MODEL_READY ' + key, flush=True)


if __name__ == '__main__':
    requested = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for entry in DESIGN['buildings']:
        if not requested or entry['id'] in requested:
            build(entry)
