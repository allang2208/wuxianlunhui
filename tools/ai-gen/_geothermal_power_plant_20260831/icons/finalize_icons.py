"""Geothermal badges: reuse the project's geometric-alpha / visible-size pipeline."""
import json
import runpy
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[3]
shared = runpy.run_path(str(ROOT.parents[1] / '_royal_mint_icons_20260824/finalize_icons.py'))
specs = json.loads((ROOT / 'manifest.json').read_text(encoding='utf-8'))['icons']
names = ['地热发电', '地热标准化', '闭式循环', '深井换热', '余热回收', '地热编制']
preview = Image.new('RGB', (840, 636), (29, 34, 39))
draw = ImageDraw.Draw(preview)
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 20)
records = []

for index, spec in enumerate(specs):
    source = Image.open(ROOT / spec['raw'])
    technology = spec['kind'] == 'technology'
    if technology:
        # Explicit outer-frame vertices: bright silver is not checkerboard background.
        points = ([(628, 0), (1186, 315), (1186, 947), (628, 1253), (69, 946), (69, 316)]
            if spec['id'] == 'geothermal_power' else
            [(627, 2), (1189, 317), (1189, 938), (627, 1246), (63, 938), (63, 316)])
        mask = Image.new('L', source.size, 0)
        ImageDraw.Draw(mask).polygon(points, fill=255)
        cutout = source.convert('RGBA')
        cutout.putalpha(mask.filter(ImageFilter.GaussianBlur(.65)))
    else:
        # The new frame's four bevels are ~11% of its width, not the older mint's 5.5%.
        left, top, right, bottom = shared['find_badge_bounds'](source, spec['background'])
        bevel = round(min(right - left, bottom - top) * .11)
        mask = Image.new('L', source.size, 0)
        ImageDraw.Draw(mask).polygon([(left + bevel, top), (right - bevel, top),
            (right, top + bevel), (right, bottom - bevel), (right - bevel, bottom),
            (left + bevel, bottom), (left, bottom - bevel), (left, top + bevel)], fill=255)
        cutout = source.convert('RGBA')
        cutout.putalpha(mask.filter(ImageFilter.GaussianBlur(.65)))
    size, visible = (1024, 1000) if technology else (256, 244)
    final = shared['normalize'](cutout, size, visible)
    pixels = np.asarray(final).copy()
    pixels[pixels[:, :, 3] == 0, :3] = 0
    final = Image.fromarray(pixels, 'RGBA')
    destination = PROJECT / spec['runtime']
    destination.parent.mkdir(parents=True, exist_ok=True)
    final.save(destination, optimize=True)
    # DOM upgrade cards consume the lightweight mirror, not full-sized world textures.
    if not technology:
        runtime_icon = PROJECT / 'assets/ui/runtime-icons' / Path(spec['runtime']).relative_to('assets')
        runtime_icon.parent.mkdir(parents=True, exist_ok=True)
        final.resize((128, 128), Image.Resampling.LANCZOS).save(runtime_icon, optimize=True)
    thumb = final.resize((256, 256), Image.Resampling.LANCZOS)
    x, y = index % 3 * 280 + 12, index // 3 * 318 + 8
    preview.paste(thumb, (x, y), thumb)
    draw.text((x + 128, y + 266), names[index], anchor='mt', font=font, fill=(225, 231, 235))
    records.append({'id': spec['id'], 'raw': spec['raw'], 'sourceMode': source.mode,
        'sourceSize': list(source.size), 'runtime': spec['runtime'], 'outputSize': list(final.size),
        'alphaBBox': final.getchannel('A').getbbox()})

preview.save(ROOT / 'icons-preview.png', optimize=True)
(ROOT / 'runtime-metadata.json').write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding='utf-8')
print(json.dumps(records, ensure_ascii=False, indent=2))
