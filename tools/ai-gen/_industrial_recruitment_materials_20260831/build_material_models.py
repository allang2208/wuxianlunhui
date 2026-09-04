"""Create three local Blender material proposals; never alter source geometry."""
import importlib.util
import json
from pathlib import Path
import shutil
import sys

import bpy

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
DESIGN = json.loads((HERE / 'design.json').read_text(encoding='utf-8'))
spec = importlib.util.spec_from_file_location('building_kit', ROOT / 'tools/ai-gen/building-component-kit.py')
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)


def rgba(hex_color):
    values = [int(hex_color[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return tuple(v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4 for v in values) + (1,)


def finish(name, color, root, roughness=0.8, metallic=0.0, kind='plain'):
    """Shared PBR helper supplies the shader; detail remains subordinate."""
    base = rgba(color)
    mat = kit.material('IND_' + name, base, roughness=roughness, metallic=metallic)
    nodes, links = mat.node_tree.nodes, mat.node_tree.links
    shader = nodes.get('Principled BSDF')
    coord = nodes.new('ShaderNodeTexCoord')
    coord.object = root
    noise = nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 0.035
    noise.inputs['Detail'].default_value = 1
    noise.inputs['Roughness'].default_value = 0.45
    links.new(coord.outputs['Object'], noise.inputs['Vector'])
    ramp = nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = tuple(v * 0.91 for v in base[:3]) + (1,)
    ramp.color_ramp.elements[1].color = tuple(min(1, v * 1.06) for v in base[:3]) + (1,)
    links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    links.new(ramp.outputs['Color'], shader.inputs['Base Color'])
    if kind == 'brick':
        # Tri-planar courses use source-root coordinates, preserving all mesh data.
        split = nodes.new('ShaderNodeSeparateXYZ')
        links.new(coord.outputs['Object'], split.inputs['Vector'])
        geom = nodes.new('ShaderNodeNewGeometry')
        transform = nodes.new('ShaderNodeVectorTransform')
        transform.vector_type = 'NORMAL'
        transform.convert_from = 'WORLD'
        transform.convert_to = 'OBJECT'
        links.new(geom.outputs['Normal'], transform.inputs['Vector'])
        absolute = nodes.new('ShaderNodeVectorMath')
        absolute.operation = 'ABSOLUTE'
        links.new(transform.outputs['Vector'], absolute.inputs[0])
        weights = nodes.new('ShaderNodeSeparateXYZ')
        links.new(absolute.outputs['Vector'], weights.inputs[0])
        colors, heights = [], []
        for axis, u, v in [('X', 'Y', 'Z'), ('Y', 'X', 'Z'), ('Z', 'X', 'Y')]:
            vector = nodes.new('ShaderNodeCombineXYZ')
            links.new(split.outputs[u], vector.inputs['X'])
            links.new(split.outputs[v], vector.inputs['Y'])
            brick = nodes.new('ShaderNodeTexBrick')
            links.new(vector.outputs[0], brick.inputs['Vector'])
            brick.inputs['Scale'].default_value = 1
            brick.inputs['Brick Width'].default_value = 32
            brick.inputs['Row Height'].default_value = 15
            brick.inputs['Mortar Size'].default_value = 0.6
            brick.inputs['Mortar Smooth'].default_value = 0.3
            brick.inputs['Color1'].default_value = tuple(v * 0.94 for v in base[:3]) + (1,)
            brick.inputs['Color2'].default_value = tuple(v * 1.03 for v in base[:3]) + (1,)
            brick.inputs['Mortar'].default_value = tuple(v * 0.76 for v in base[:3]) + (1,)
            weighted = nodes.new('ShaderNodeVectorMath')
            weighted.operation = 'SCALE'
            links.new(brick.outputs['Color'], weighted.inputs[0])
            links.new(weights.outputs[axis], weighted.inputs['Scale'])
            colors.append(weighted.outputs['Vector'])
            height = nodes.new('ShaderNodeMath')
            height.operation = 'MULTIPLY'
            links.new(brick.outputs['Fac'], height.inputs[0])
            links.new(weights.outputs[axis], height.inputs[1])
            heights.append(height.outputs[0])
        for sockets, node_type in [(colors, 'ShaderNodeVectorMath'), (heights, 'ShaderNodeMath')]:
            for socket in sockets[1:]:
                add = nodes.new(node_type)
                add.operation = 'ADD'
                links.new(sockets[0], add.inputs[0])
                links.new(socket, add.inputs[1])
                sockets[0] = add.outputs[0]
        links.new(colors[0], shader.inputs['Base Color'])
        bump = nodes.new('ShaderNodeBump')
        bump.invert = True
        bump.inputs['Strength'].default_value = 0.12
        bump.inputs['Distance'].default_value = 0.5
        links.new(heights[0], bump.inputs['Height'])
        links.new(bump.outputs[0], shader.inputs['Normal'])
    elif kind == 'sheet_metal':
        wave = nodes.new('ShaderNodeTexWave')
        wave.wave_type = 'BANDS'
        wave.bands_direction = 'X'
        wave.inputs['Scale'].default_value = 0.03
        wave.inputs['Distortion'].default_value = 0
        links.new(coord.outputs['Object'], wave.inputs['Vector'])
        seams = nodes.new('ShaderNodeMath')
        seams.operation = 'GREATER_THAN'
        seams.inputs[1].default_value = 0.975
        links.new(wave.outputs['Fac'], seams.inputs[0])
        bump = nodes.new('ShaderNodeBump')
        bump.inputs['Strength'].default_value = 0.12
        bump.inputs['Distance'].default_value = 0.35
        links.new(seams.outputs[0], bump.inputs['Height'])
        links.new(bump.outputs[0], shader.inputs['Normal'])
    return mat


def materials(key, root):
    roof_color = '82908B' if key == 'recon_camp' else '829299'
    brick_color = 'ABA596' if key == 'recon_camp' else ('AC9383' if key == 'infantry_barracks' else '9FA29C')
    return {
        'brick': finish('Industrial_Brick', brick_color, root, kind='brick'),
        'stone': finish('Quiet_Fieldstone', 'A9A69B', root, roughness=0.9),
        'trim': finish('Grey_CastStone_Trim', 'B4B6AF', root, roughness=0.86),
        'plaster': finish('Lime_Plaster', 'C0BCAA', root, roughness=0.9),
        'roof': finish('Painted_Metal_Roof', roof_color, root, roughness=0.69, metallic=0.22, kind='sheet_metal'),
        'steel': finish('Matte_Painted_Steel', '646E68', root, roughness=0.73, metallic=0.18),
        'iron': finish('Blackened_Iron', '515B5C', root, roughness=0.65, metallic=0.3),
        'wood': finish('Retained_Worn_Timber', '897660', root, roughness=0.86),
        'brass': finish('Dull_Oxidized_Brass', '928368', root, roughness=0.65, metallic=0.3),
        'canvas': finish('Khaki_Canvas', 'A59E81', root, roughness=0.96),
        'dark': finish('Portal_Shadow', '383B37', root, roughness=0.98),
        'target': finish('OffWhite_Target_Face', 'D0CBBA', root, roughness=0.94),
        'target_ring': finish('Charcoal_Target_Ring', '464944', root, roughness=0.94),
    }


def choose(key, obj, old, mats):
    name = obj.name
    if 'DarkPortal' in name:
        return mats['steel']
    if 'Target_' in name:
        if name.endswith('_Outer'):
            return mats['target']
        if name.endswith('_MiddleRing') or name.endswith('_Center'):
            return mats['target_ring']
    if 'Fieldstone_Foundation' in old:
        if 'Foundation' in name:
            return mats['stone']
        if 'Crate' in name:
            return mats['iron']
        return mats['trim']
    if 'WeatheredBrick' in old or 'Weathered_Stone' in old:
        if any(part in name for part in ['BaseSkirt', 'Jamb', 'ReinforcedFoot', 'Parapet']):
            return mats['trim']
        return mats['brick']
    if 'Muted_Plaster' in old:
        return mats['brick'] if key == 'infantry_barracks' else mats['plaster']
    if 'AgedClayTile' in old or 'Aged_Roof' in old:
        return mats['roof']
    if 'Dark_Oak' in old:
        retained = ['Leaf_', 'Shutter_', 'SupplyMapCase', 'FiringBench', 'Target_', 'Longbow',
                    'Matchlock', 'Crate', 'PowderKeg', 'Arrow', 'WeaponRack']
        return mats['wood'] if any(part in name for part in retained) else mats['steel']
    if 'CrimsonDark' in old:
        return mats['dark']
    if 'Crimson' in old or 'Straw' in old:
        return mats['canvas']
    if 'Blackened_Iron' in old:
        return mats['iron']
    if 'Aged_Brass' in old:
        return mats['brass']
    return None


def build(entry):
    key = entry['id']
    out = HERE / key
    out.mkdir(exist_ok=True)
    bpy.ops.wm.open_mainfile(filepath=str(ROOT / entry['source']))
    scene = bpy.context.scene
    root = next(o for o in scene.objects if o.type == 'EMPTY' and '_ROOT_' in o.name)
    mats = materials(key, root)
    assignments = []
    for obj in scene.objects:
        if obj.type != 'MESH':
            continue
        for index, old in enumerate(list(obj.data.materials)):
            new = choose(key, obj, old.name, mats) if old else None
            if new:
                assignments.append({'object': obj.name, 'slot': index, 'from': old.name, 'to': new.name})
                obj.data.materials[index] = new
    source_preview = ROOT / entry['sourcePreview']
    shutil.copy2(source_preview, out / (key + '_source_model_preview.png'))
    preview = out / (key + '_material_approval_preview.png')
    scene.render.filepath = str(preview)
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.render.film_transparent = True
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    bpy.context.preferences.filepaths.save_version = 0
    blend = out / (key + '_material_model.blend')
    bpy.ops.wm.save_as_mainfile(filepath=str(blend))
    bpy.ops.render.render(write_still=True)
    record = dict(entry, outputBlend=blend.relative_to(ROOT).as_posix(),
                  preview=preview.relative_to(ROOT).as_posix(), assignments=assignments,
                  meshCount=sum(o.type == 'MESH' for o in scene.objects),
                  geometryChanged=False, cameraChanged=False, lightingChanged=False,
                  approved=False, runtimeIntegrated=False)
    (out / 'material-assignments.json').write_text(json.dumps(record, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    kit.render_depth(scene, root, scene.camera, str(out / (key + '_depth.png')), key)
    print('MATERIAL_MODEL_READY ' + key, flush=True)


if __name__ == '__main__':
    requested = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
    for entry in DESIGN['buildings']:
        if not requested or entry['id'] in requested:
            build(entry)
