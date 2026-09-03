"""Finalize planar observation array technology and upgrade icons."""
import json
import runpy
from pathlib import Path

import numpy as np
from PIL import Image


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
SHARED = runpy.run_path(str(ROOT.parent / '_royal_mint_icons_20260824' / 'finalize_icons.py'))
SPECS = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['icons']


def finalize(spec):
    source = Image.open(ROOT / spec['raw'])
    shape = 'hex' if spec['kind'] == 'technology' else 'square'
    size, visible = (1024, 1000) if shape == 'hex' else (256, 244)
    cutout = SHARED['cut_badge'](source, spec['background'], shape)
    final = SHARED['normalize'](cutout, size, visible)
    pixels = np.asarray(final).copy()
    pixels[pixels[:, :, 3] == 0, :3] = 0
    final = Image.fromarray(pixels, 'RGBA')
    destination = PROJECT / spec['runtime']
    destination.parent.mkdir(parents=True, exist_ok=True)
    final.save(destination, optimize=True)
    if spec['kind'] == 'upgrade':
        lightweight = PROJECT / 'assets/ui/runtime-icons' / Path(spec['runtime']).relative_to('assets')
        lightweight.parent.mkdir(parents=True, exist_ok=True)
        final.resize((128, 128), Image.Resampling.LANCZOS).save(lightweight, optimize=True)
    return source, final, destination


records = []
for spec in SPECS:
    source, final, destination = finalize(spec)
    records.append({
        'id': spec['id'],
        'kind': spec['kind'],
        'source': spec['source'],
        'raw': spec['raw'],
        'sourceMode': source.mode,
        'sourceSize': list(source.size),
        'runtime': spec['runtime'],
        'outputSize': list(final.size),
        'alphaBBox': list(final.getchannel('A').getbbox() or ()),
    })

(ROOT / 'runtime-metadata.json').write_text(
    json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(records, ensure_ascii=False, indent=2))
