"""Export the generated wall-tower badge using the shared technology-icon pipeline."""
import json
import runpy
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
spec = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))
settings = spec['finalization']
shared = runpy.run_path(str(ROOT.parent / '_royal_mint_icons_20260824/finalize_icons.py'))
source = Image.open(ROOT / spec['raw'])
rgba = source.convert('RGBA')
if rgba.getchannel('A').getextrema()[0] == 255:
    # The generated checkerboard is RGB, so use the measured six frame vertices.
    mask = Image.new('L', source.size, 0)
    ImageDraw.Draw(mask).polygon([tuple(p) for p in settings['outerFrameVertices']], fill=255)
    rgba.putalpha(mask.filter(ImageFilter.GaussianBlur(settings['alphaFeatherPx'])))
final = shared['normalize'](rgba, settings['size'][0], settings['visibleLongEdge'])
pixels = np.asarray(final).copy()
pixels[pixels[:, :, 3] == 0, :3] = 0
final = Image.fromarray(pixels, 'RGBA')
destination = PROJECT / spec['runtime']
destination.parent.mkdir(parents=True, exist_ok=True)
final.save(destination, optimize=True)
print(json.dumps({'runtime': spec['runtime'], 'mode': final.mode, 'size': final.size,
    'alphaRange': final.getchannel('A').getextrema(),
    'alphaBBox': final.getchannel('A').getbbox()}, ensure_ascii=False))
