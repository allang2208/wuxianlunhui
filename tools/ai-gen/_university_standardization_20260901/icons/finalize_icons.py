"""Finalize the university upgrade and standardization technology icons."""
import json
import runpy
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[3]
SHARED = runpy.run_path(str(ROOT.parent.parent / '_royal_mint_icons_20260824' / 'finalize_icons.py'))
SPECS = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['icons']


def keep_center_alpha_component(image: Image.Image) -> Image.Image:
    """Drop isolated generator specks while preserving the connected badge."""
    rgba = image.convert('RGBA')
    alpha = rgba.getchannel('A')
    binary = alpha.point(lambda value: 255 if value > 0 else 0)
    seed = (binary.width // 2, binary.height // 2)
    if binary.getpixel(seed) == 0:
        return rgba
    ImageDraw.floodfill(binary, seed, 128)
    component = binary.point(lambda value: 255 if value == 128 else 0)
    clean_alpha = Image.fromarray(
        np.where(np.asarray(component) > 0, np.asarray(alpha), 0).astype(np.uint8),
        'L',
    )
    rgba.putalpha(clean_alpha)
    return rgba


def normalize_source(source: Image.Image, *, shape: str, size: int, visible: int) -> Image.Image:
    rgba = keep_center_alpha_component(source)
    alpha_bbox = rgba.getchannel('A').getbbox()
    if not alpha_bbox:
        raise RuntimeError('empty generated icon')
    if alpha_bbox == (0, 0, rgba.width, rgba.height):
        rgba = SHARED['cut_badge'](rgba, 'black', shape)
    final = SHARED['normalize'](rgba, size, visible)
    pixels = np.asarray(final).copy()
    pixels[pixels[:, :, 3] == 0, :3] = 0
    return Image.fromarray(pixels, 'RGBA')


records = []
for spec in SPECS:
    source = Image.open(ROOT / spec['raw'])
    is_technology = spec['kind'] == 'technology'
    final = normalize_source(
        source,
        shape='hex' if is_technology else 'square',
        size=1024 if is_technology else 256,
        visible=1000 if is_technology else 244,
    )
    destination = PROJECT / spec['runtime']
    destination.parent.mkdir(parents=True, exist_ok=True)
    final.save(destination, optimize=True)
    lightweight = None
    if not is_technology:
        lightweight = PROJECT / 'assets/ui/runtime-icons' / Path(spec['runtime']).relative_to('assets')
        lightweight.parent.mkdir(parents=True, exist_ok=True)
        final.resize((128, 128), Image.Resampling.LANCZOS).save(lightweight, optimize=True)
    records.append({
        'id': spec['id'],
        'kind': spec['kind'],
        'source': spec['source'],
        'raw': spec['raw'],
        'sourceMode': source.mode,
        'sourceSize': list(source.size),
        'runtime': spec['runtime'],
        'runtimeLightweight': (str(lightweight.relative_to(PROJECT)).replace('\\', '/')
                               if lightweight else None),
        'outputSize': list(final.size),
        'alphaBBox': list(final.getchannel('A').getbbox() or ()),
    })

(ROOT / 'runtime-metadata.json').write_text(
    json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(records, ensure_ascii=False, indent=2))
