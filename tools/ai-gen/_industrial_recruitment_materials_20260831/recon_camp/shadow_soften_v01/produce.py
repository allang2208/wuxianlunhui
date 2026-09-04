"""Export this lighting candidate with the existing building keying tools."""
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
SOURCE = HERE / 'recon_camp_industrial_shadow_softened_raw_green.png'
BEFORE = HERE.parent / 'compass_fix_v01/cutout/recon_camp_industrial_cutout.png'
KEYED = HERE / 'recon_camp_industrial_shadow_softened_keyed.png'
EDGE = HERE / 'recon_camp_industrial_shadow_softened_edge.png'
FINAL = HERE / 'recon_camp_industrial_shadow_softened_transparent.png'
commands = []


def run(name, *args):
    commands.append([name, *map(str, args)])
    subprocess.run([sys.executable, str(REPO / 'tools/ai-gen' / name),
                    *map(str, args)], cwd=REPO, check=True)


run('key-world122-building-body.py', SOURCE, KEYED,
    '--soft-key-inner', 50, '--soft-key-outer', 140,
    '--nearest-opaque-edge-rgb')
run('repair-local-green-spill.py', KEYED, EDGE,
    '--rect', '0,0,1377,1142', '--min-green', 30, '--green-margin', 15,
    '--min-alpha', 1, '--max-edge-distance', 3)
run('finalize-building-runtime.py', EDGE, FINAL,
    '--display-width', 1377, '--padding', 4, '--preserve-alpha-exact',
    '--nearest-opaque-edge-rgb', '--metadata', HERE / 'crop-metadata.json')


def checker(size, cell=24):
    yy, xx = np.indices((size[1], size[0]))
    grid = np.where(((xx // cell + yy // cell) % 2)[..., None],
                    [172, 178, 181], [214, 218, 219]).astype('uint8')
    return Image.fromarray(grid).convert('RGBA')


def on_checker(im):
    bg = checker(im.size)
    bg.alpha_composite(im)
    return bg.convert('RGB')


def font(size):
    return ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', size)


before = Image.open(BEFORE).convert('RGBA')
after = Image.open(FINAL).convert('RGBA')
full = Image.open(EDGE).convert('RGBA')
on_checker(after).save(HERE / 'transparent_preview.png')

board = Image.new('RGB', (1480, 730), '#e8eae6')
d = ImageDraw.Draw(board)
d.text((24, 15), '侦察营地 · 阴影减淡前后', font=font(27), fill='#303b38')
for x, label, im in [(24, '处理前：地台投影较重', before),
                     (758, '减影版：保留石缝与柱脚暗部', after)]:
    d.text((x, 61), label, font=font(22), fill='#303b38')
    thumb = on_checker(im)
    thumb.thumbnail((698, 584), Image.Resampling.LANCZOS)
    board.paste(thumb, (x, 101))
d.text((24, 693), '仅为等比例预览；新图细纹理有生成差异，原图保留。未接入游戏。',
       font=font(18), fill='#47514d')
board.save(HERE / 'shadow_before_after.png')

# Normalize only the comparison view. The transparent production PNG is never resized.
normalized = full.resize(before.size, Image.Resampling.LANCZOS)
detail = Image.new('RGB', (1400, 620), '#e8eae6')
d = ImageDraw.Draw(detail)
for x, label, im in [(20, '处理前 · 左侧地台与塔下', before),
                     (715, '减影版 · 左侧地台与塔下', normalized)]:
    d.text((x, 20), label, font=font(24), fill='#303b38')
    crop = on_checker(im.crop((0, 405, 400, 775)))
    crop.thumbnail((655, 530), Image.Resampling.LANCZOS)
    detail.paste(crop, (x, 72))
detail.save(HERE / 'shadow_detail.png')

review = Image.new('RGB', (1440, 1250), '#e8eae6')
d = ImageDraw.Draw(review)
for i, (name, color) in enumerate([('黑底', '#080808'), ('灰底', '#666666'),
                                  ('白底', '#ffffff'), ('Alpha', None)]):
    x, y = (i % 2) * 720, (i // 2) * 625
    d.text((x+18, y+14), name, font=font(24), fill='#303b38')
    if color is None:
        im = after.getchannel('A').convert('RGB')
    else:
        im = Image.new('RGBA', after.size, color)
        im.alpha_composite(after)
        im = im.convert('RGB')
    im.thumbnail((690, 560), Image.Resampling.LANCZOS)
    review.paste(im, (x+15, y+55))
review.save(HERE / 'background_alpha_preview.png')

raw = np.asarray(Image.open(SOURCE).convert('RGB')).astype(float)
rgba = np.asarray(after)
corners = np.concatenate([raw[:12,:12].reshape(-1,3), raw[:12,-12:].reshape(-1,3),
                          raw[-12:,:12].reshape(-1,3), raw[-12:,-12:].reshape(-1,3)])
key = np.median(corners, axis=0)
material_samples = {}
for name, (x0,y0,x1,y1) in {
    'roof': (680,310,800,360), 'front_stone': (700,870,880,920),
    'dark_window': (271,375,305,424), 'tower_post': (208,600,224,690)
}.items():
    distance = np.linalg.norm(raw[y0:y1,x0:x1]-key, axis=-1)
    material_samples[name] = {'rect':[x0,y0,x1,y1],
                              'minimumKeyDistance':float(distance.min()),
                              'alphaBelow255':int(np.count_nonzero(np.asarray(full)[y0:y1,x0:x1,3]<255))}
record = {
    'recordedAt':datetime.now().astimezone().isoformat(),
    'source':str(SOURCE.relative_to(REPO)), 'sourceSize':list(raw.shape[1::-1]),
    'output':str(FINAL.relative_to(REPO)), 'outputMode':after.mode,
    'outputSize':list(after.size), 'alphaExtrema':list(after.getchannel('A').getextrema()),
    'key':{'measuredRgb':key.tolist(),'cornerDistanceMax':float(np.linalg.norm(corners-key,axis=-1).max()),
           'softInner':50,'softOuter':140,'removeAllGreen':False,'oldDepthOrAlphaUsed':False},
    'protectedMaterialSamples':material_samples,
    'transparentPixelsWithDirtyRgb':int(np.count_nonzero((rgba[...,3]==0)&np.any(rgba[...,:3]!=0,axis=2))),
    'runtimeIntegrationActive':False,
    'limitations':'Display metadata is not game placement calibration. Offline asset production only; no tests, builds or runtime validation.',
    'commands':commands,
}
(HERE / 'production-record.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:record[k] for k in ['outputSize','outputMode','alphaExtrema','transparentPixelsWithDirtyRgb','protectedMaterialSamples']},indent=2))
