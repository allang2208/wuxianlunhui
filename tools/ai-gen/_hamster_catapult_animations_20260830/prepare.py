"""Prepare a padded video reference without repainting the accepted mother."""
from pathlib import Path
import json
from PIL import Image

ROOT = Path(__file__).resolve().parent
SOURCE = ROOT.parent / '_hamster_engineering_mothers_20260830/mother/hamster_catapult_crew-mother-v07-infantry-camera-white.png'
for folder in ('reference', 'videos', 'previews', 'source-sheets', 'final'):
    (ROOT / folder).mkdir(exist_ok=True)
image = Image.open(SOURCE).convert('RGB')
scale = min(960 / image.width, 540 / image.height)
size = tuple(round(value * scale) for value in image.size)
resized = image.resize(size, Image.Resampling.LANCZOS)
offset = ((1024-size[0])//2, (576-size[1])//2)
canvas = Image.new('RGB', (1024, 576), 'white')
canvas.paste(resized, offset)
canvas.save(ROOT / 'reference/catapult-v07-padded-1024x576.png')
manifest = {
    'unitKey': 'hamster_catapult_crew', 'unitName': '仓鼠投石组',
    'date': '2026-08-30', 'assetOnly': True, 'runtimeIntegrationActive': False,
    'status': 'video_generation_prepared',
    'mother': str(SOURCE.relative_to(ROOT.parent)).replace('\\', '/'),
    'approvalScope': 'User continued from accepted mother to four-action animation production; no runtime acceptance inferred.',
    'reference': {'path': 'reference/catapult-v07-padded-1024x576.png',
                  'sourceSize': list(image.size), 'size': [1024,576],
                  'uniformScale': scale, 'offset': list(offset), 'repainted': False},
    'viewContract': 'Fixed mildly elevated right-facing three-quarter camera; two equally sized hamsters plus one catapult.',
    'budget': {'profile': 'crowd', 'targetMiB': 32, 'admissionLimitMiB': 64,
               'runtimeScale': None, 'actualDecodedMiB': None, 'formalChecksRun': False},
    'actions': {kind: {'prompt': f'prompts/{kind}-v01.txt', 'status': 'prepared',
                     'loop': kind in ('idle','run'), 'sourceVideo': None,
                     'sourceSheet': None, 'finalSheet': None, 'preview': None}
                for kind in ('idle','run','attack','die')},
    'runtimeNotes': ['No recruitment, combat, technology or animation-config changes.',
                     'Attack source includes one thrown stone; projectile separation and release event remain runtime integration work.',
                     'Attack ends empty-handed after its single stone; loading continuity needs a chosen gameplay animation contract.']
}
index = ROOT / 'task-index.json'
if not index.exists():
    index.write_text(json.dumps(manifest, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(ROOT / 'reference/catapult-v07-padded-1024x576.png')
