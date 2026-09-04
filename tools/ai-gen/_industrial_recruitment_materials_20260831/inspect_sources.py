"""Read the three existing editable building sources without changing them."""
import json
from pathlib import Path
import bpy

ROOT = Path(__file__).resolve().parents[3]
PACK = ROOT / 'tools/ai-gen/_settlement_building_pack_20260821'
SOURCES = {
    'recon_camp': PACK / 'thatch_hut_lv2/rework_tier_materials_20260828/thatch_hut_lv2_model.blend',
    'infantry_barracks': PACK / 'hamster_barracks_lv2/rework_axis_symmetric_20260828/hamster_barracks_lv2_axis_symmetric_model.blend',
    'rifle_range': PACK / 'shooting_range_lv2/shooting_range_lv2_model.blend',
}
report = {}
for key, path in SOURCES.items():
    bpy.ops.wm.open_mainfile(filepath=str(path))
    scene = bpy.context.scene
    objects = [o for o in scene.objects if o.type == 'MESH']
    report[key] = {
        'source': str(path.relative_to(ROOT)).replace('\\', '/'),
        'render': {'engine': scene.render.engine, 'exposure': scene.view_settings.exposure,
                   'transform': scene.view_settings.view_transform,
                   'camera': scene.camera.name if scene.camera else None},
        'materials': {m.name: [o.name for o in objects if m.name in o.data.materials]
                      for m in bpy.data.materials if m.users},
        'objects': [{'name': o.name, 'materials': [m.name if m else None for m in o.data.materials]}
                    for o in objects],
    }
    print(json.dumps({'id': key, 'meshes': len(objects), 'materials': list(report[key]['materials']),
                      'render': report[key]['render']}, ensure_ascii=False))
(Path(__file__).parent / 'source-inventory.json').write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
