"""Rebuild only attack keys from retained cutouts; preserve source motion/timing.

Then run each task's interpolate stage and this script's package stage. No model
loading, external uploads or game execution. Never re-interpolate a final sheet.
"""
import argparse
import importlib.util
import json
import math
import shutil
from pathlib import Path
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent

def module(folder):
    spec = importlib.util.spec_from_file_location('production', folder/'make_sprites.py')
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod

def bounded_plume(cut, unit, frame):
    first = 54 if unit == 'howitzer' else 55
    if not first <= frame <= 100:
        return cut
    rgba = np.array(cut)
    yy, xx = np.indices(rgba.shape[:2])
    # Both fade zones lie beyond the solid barrel/crew in the firing frames.
    start = 890 if unit == 'howitzer' else 860
    t = np.clip((xx-start)/(990-start), 0, 1)
    fade = 1-t*t*(3-2*t)
    if unit == 'howitzer':
        top = np.clip(yy/100, 0, 1)
        fade *= np.where(xx >= 850, top*top*(3-2*top), 1)
    rgba[..., 3] = np.rint(rgba[..., 3]*fade).astype(np.uint8)
    rgba[rgba[..., 3] < 4] = 0
    return Image.fromarray(rgba)

def keys(unit):
    folder = ROOT.parent/f'_hamster_{unit}_animations_20260830'
    mod = module(folder)
    path = folder/'source-sheets/attack-keys.json'
    meta = json.loads(path.read_text(encoding='utf-8'))
    previous = ROOT/'before'/unit
    previous.mkdir(parents=True, exist_ok=True)
    for name in ['attack-keys.json', 'attack-keys.png']:
        if not (previous/name).exists(): shutil.copy2(folder/'source-sheets'/name, previous/name)
    frames, _ = mod.read_video(folder/meta['video'])
    revision = 'v02' if unit == 'howitzer' else 'v01'
    cells = []
    for frame in meta['sourceFrameIndices']:
        cut = Image.open(folder/f'cache/birefnet/attack-{revision}-{frame:04d}.png').convert('RGBA')
        cut = mod.restore_muzzle_matte(cut, frames[frame], frame)
        cut = bounded_plume(mod.remove_white_matte(cut), unit, frame)
        cut = cut.resize(tuple(round(v*mod.SCALE) for v in cut.size), Image.Resampling.LANCZOS)
        pixels = np.array(cut)
        pixels[pixels[..., 3] < 4] = 0
        cells.append(Image.fromarray(pixels))
    bounds = [cell.getchannel('A').getbbox() for cell in cells]
    center = round(mod.ANCHOR[0]*mod.SCALE)
    radius = max(max(center-b[0], b[2]-center) for b in bounds)+3
    crop = (center-radius, min(b[1] for b in bounds)-3, center+radius, max(b[3] for b in bounds)+3)
    cells = [cell.crop(crop) for cell in cells]
    w, h = cells[0].size
    cols = mod.layout(len(cells), w, h)
    mod.sheet_from(cells, cols).save(folder/'source-sheets/attack-keys.png')
    meta.update(actionCropInScaledCanvas=list(crop), footX=center-crop[0],
                footY=mod.ANCHOR[1]*mod.SCALE-crop[1], frameWidth=w, frameHeight=h,
                cols=cols, rows=math.ceil(len(cells)/cols),
                muzzleEdgeRefinement={'script':'../_engineering_line_completion_20260830/refine_muzzle.py',
                    'method':'Smoothstep alpha fade beyond solid muzzle; no outpaint, body warping or retiming.',
                    'rightFadeSourceX':[890 if unit=='howitzer' else 860,990],
                    'topFadeSourceY':[0,100] if unit=='howitzer' else None})
    mod.write_json(path, meta)
    print(unit, 'attack keys', w, h, 'same', len(cells), 'source poses', flush=True)

def package(unit):
    folder = ROOT.parent/f'_hamster_{unit}_animations_20260830'
    mod = module(folder)
    meta = json.loads((folder/'source-sheets/attack-keys.json').read_text(encoding='utf-8'))
    report = json.loads((folder/'final/attack-rife.json').read_text(encoding='utf-8'))
    manifest_path = folder/'spritesheet-manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
    action = manifest['actions']['attack']
    sheet = Image.open(folder/'final/attack.png').convert('RGBA')
    count, cols = report['outputFrameCount'], report['cols']
    w, h = meta['frameWidth'], meta['frameHeight']
    cells = [sheet.crop((i%cols*w, i//cols*h, (i%cols+1)*w, (i//cols+1)*h)) for i in range(count)]
    action.update(meta, frameCount=count, endFrame=count-1, cols=cols, rows=report['rows'],
                  sheetSize=list(sheet.size), decodedMiB=sheet.width*sheet.height*4/1024**2)
    # The retained per-frame duration array remains unchanged.
    preview = f'previews/attack-transparent-edge-refined.gif'
    images = [mod.checker(c).resize((w*2,h*2),Image.Resampling.NEAREST) for c in cells]
    palette_source = Image.new('RGB',(128,72*len(images)))
    for i,im in enumerate(images): palette_source.paste(im.resize((128,72)),(0,72*i))
    palette = palette_source.quantize(colors=255)
    images = [im.quantize(palette=palette) for im in images]
    images[0].save(folder/preview, save_all=True, append_images=images[1:],
        duration=mod.gif_durations(action['frameDurationsMs']), loop=0, disposal=2, optimize=False)
    action['preview'] = preview
    mod.contact(cells, 'attack', folder/'previews/attack-transparent-contact.png')
    manifest['decodedMiB'] = sum(a['decodedMiB'] for a in manifest['actions'].values())+manifest.get('projectile',{}).get('decodedMiB',0)
    if manifest['decodedMiB'] > 64: raise ValueError('Full family exceeds 64 MiB; do not import')
    manifest['muzzleEdgeRefinement'] = meta['muzzleEdgeRefinement']
    if unit=='howitzer':
        manifest['knownSourceLimits'] = ['Empty-handed reload ending cuts back to shell-holding idle; new H3 bridge blocked pending explicit payload approval.']
    else:
        manifest['notes'] = ['Accepted motion and timing preserved; muzzle plume alpha tapers before the source edge.',
                             'Original source keys remain at even output indices.']
    mod.write_json(manifest_path,manifest)
    print(unit, 'packaged', manifest['decodedMiB'], 'MiB',flush=True)

if __name__=='__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('stage',choices=['keys','package'])
    args=parser.parse_args()
    active = json.loads((ROOT.parent/'_hamster_howitzer_animations_20260830/spritesheet-manifest.json').read_text(encoding='utf-8'))
    if active.get('resupplyCompleted'):
        raise SystemExit('The howitzer now uses a composite attack. Rebuild with resupply_sprites.py; keep before-resupply source keys.')
    for unit in ['field_cannon','howitzer']:
        (keys if args.stage=='keys' else package)(unit)
