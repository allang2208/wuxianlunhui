"""Prepare the accepted cannon mother for H3 without repainting or stretching."""
import json
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / '_hamster_engineering_mothers_20260830/mother/hamster_field_cannon_crew-mother-v07-infantry-camera-white.png'
for folder in ('reference', 'prompts', 'videos', 'previews', 'logs'):
    (ROOT / folder).mkdir(exist_ok=True)
image = Image.open(SOURCE).convert('RGB')
scale = min(900 / image.width, 500 / image.height)
size = tuple(round(value * scale) for value in image.size)
offset = ((1024-size[0])//2, (576-size[1])//2)
canvas = Image.new('RGB', (1024, 576), 'white')
canvas.paste(image.resize(size, Image.Resampling.LANCZOS), offset)
reference = 'reference/field-cannon-v07-padded-1024x576.png'
canvas.save(ROOT / reference)
manifest = {
    'unitKey': 'hamster_field_cannon_crew', 'unitName': '仓鼠野战炮组',
    'date': '2026-08-30', 'assetOnly': True, 'runtimeIntegrationActive': False,
    'status': 'prepared', 'provider': 'h3',
    'mother': str(SOURCE.relative_to(ROOT.parent)).replace('\\', '/'),
    'approvalScope': 'Continue the next engineering unit from the accepted mother; requested H3 generation, explicit approval for the new payload transfer is pending; runtime import is not accepted.',
    'reference': {'path': reference, 'sourceSize': list(image.size),
                  'size': [1024, 576], 'uniformScale': scale,
                  'offset': list(offset), 'repainted': False},
    'viewContract': 'Fixed mildly elevated right-facing three-quarter camera; exactly two equally sized hamster engineers and one classical bronze cannon.',
    'budget': {'profile': 'crowd', 'targetMiB': 32, 'admissionLimitMiB': 64,
               'runtimeScale': None, 'actualDecodedMiB': None, 'formalChecksRun': False},
    'generation': {'endpoint': 'http://192.168.3.142:8188',
                   'authorization': 'Auto-review requires explicit approval for this field-cannon reference and four prompts to 192.168.3.142:8188; prior catapult approval was not accepted for this payload.',
                   'size': [1024, 576], 'frames': 124, 'fps': 24,
                   'steps': 20, 'candidatesPerAction': 1},
    'actions': {kind: {'prompt': f'prompts/{kind}-v01.txt', 'status': 'prepared',
                      'seed': 830201+i, 'loop': kind in ('idle', 'run'),
                      'actionMode': {'idle': 'loop', 'run': 'loop', 'attack': 'recover', 'die': 'one-way'}[kind],
                      'sourceVideo': None, 'sourceSheet': None, 'finalSheet': None, 'preview': None}
                for i, kind in enumerate(('idle', 'run', 'attack', 'die'))},
    'runtimeNotes': ['Candidate animation work only; no game asset, recruitment, combat, technology or balance changes.',
                     'Attack is one preloaded shot with whole-carriage recoil; release timing and projectile remain import work.',
                     'Review GIFs repeat for viewing; death action itself is one-way and never resurrects.']
}
index = ROOT / 'task-index.json'
if not index.exists():
    index.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(ROOT / reference, flush=True)
