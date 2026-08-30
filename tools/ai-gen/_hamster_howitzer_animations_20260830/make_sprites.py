"""Task-local BiRefNet -> fixed-transform keys -> RIFE -> timed sprite delivery.

Uses the same cached ComfyUI-RMBG module as ai-asset.py cutout. No runtime writes.
"""
from __future__ import annotations
import argparse
import json
import math
from pathlib import Path
import subprocess
import sys

import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parent
KINDS = ('idle', 'run', 'attack', 'die')
PLAN = json.loads((ROOT/'sprite-production-plan.json').read_text(encoding='utf-8-sig'))
SCALE = PLAN['sourceScale']
ANCHOR = PLAN['anchorInVideo']
DENSE = {'attack': (50,72), 'die': (24,80)}
EVENTS = {'attack': {'muzzleFlashSourceFrame': 54}, 'die': {'fallenHoldSourceFrame': 84}}


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')


def read_video(path):
    cap = cv2.VideoCapture(str(path))
    fps = cap.get(cv2.CAP_PROP_FPS)
    frames = []
    while True:
        ok, bgr = cap.read()
        if not ok:
            break
        frames.append(Image.fromarray(cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB)))
    cap.release()
    if not frames or fps <= 0:
        raise RuntimeError(f'Cannot decode source: {path}')
    return frames, fps


def layout(count, width, height):
    options = []
    for cols in range(1, min(count,4096//width)+1):
        rows = math.ceil(count/cols)
        if rows*height <= 4096:
            options.append((cols*rows-count,abs(cols*width-rows*height),cols))
    if not options:
        raise RuntimeError('No single-sheet layout within 4096 pixels')
    return min(options)[2]


def sheet_from(cells, cols):
    width,height = cells[0].size
    sheet = Image.new('RGBA',(width*cols,height*math.ceil(len(cells)/cols)))
    for i,cell in enumerate(cells):
        sheet.paste(cell,((i%cols)*width,(i//cols)*height))
    return sheet


def remove_white_matte(cut):
    # Only excess white at soft edges is replaced by nearby opaque foreground.
    # Alpha, white muzzles and all disconnected crew/equipment are retained.
    rgba = np.array(cut)
    alpha = rgba[...,3]
    inside = ndimage.distance_transform_edt(alpha>8)
    core = (alpha>=250)&(inside>2.5)
    if not core.any():
        return cut
    distance,nearest = ndimage.distance_transform_edt(~core,return_indices=True)
    rgb = rgba[...,:3].astype(np.int16)
    interior = rgb[nearest[0],nearest[1]]
    excess = rgb.min(axis=2)-interior.min(axis=2)
    edge = (alpha>0)&(inside<=2.5)&(distance<=4)&(excess>20)
    rgba[edge,:3] = interior[edge].astype(np.uint8)
    rgba[alpha==0,:3] = 0
    return Image.fromarray(rgba,'RGBA')


def restore_muzzle_matte(cut, source, source_frame):
    """Recover omitted white-background VFX only beyond the cannon's muzzle area.

    BiRefNet keeps the solid crew/carriage, but omits parts of the detached plume.
    A bounded white-matte solve recovers smoke; the warm enclosing flame edges
    identify its otherwise indistinguishable white core. No pixels are invented
    outside the original source canvas and solid equipment is left untouched.
    """
    if not 54 <= source_frame <= 100:
        return cut
    rgba = np.array(cut)
    rgb = np.asarray(source,dtype=np.float32)
    left = 850
    region = rgb[:,left:]
    # Ignore near-white codec noise, retaining only meaningful smoke contrast.
    deficit = 255-region.min(axis=2)
    opacity = np.clip((deficit-6)/249,0,1)
    warm = ((region[...,0]>180)&(region[...,1]>40)
            &(region[...,0]>=region[...,1])&(region[...,2]<region[...,0]*0.75)
            &(region.max(axis=2)-region.min(axis=2)>50))
    if source_frame <= 57:
        for x in range(region.shape[1]):
            ys = np.flatnonzero(warm[:,x])
            if len(ys)>=2:
                opacity[ys[0]:ys[-1]+1,x] = 1
    alpha = np.rint(opacity*255).astype(np.uint8)
    alpha[alpha<4] = 0
    replace = (alpha>rgba[:,left:,3])&(rgba[:,left:,3]<200)
    unmatte = np.clip((region-255*(1-opacity[...,None]))/np.maximum(opacity[...,None],1/255),0,255)
    area = rgba[:,left:]
    area[replace,:3] = np.rint(unmatte[replace]).astype(np.uint8)
    area[replace,3] = alpha[replace]
    rgba[rgba[...,3]==0,:3] = 0
    return Image.fromarray(rgba,'RGBA')


def checker(cell):
    yy,xx = np.indices((cell.height,cell.width))
    shade = np.where((xx//16+yy//16)%2,54,43).astype(np.uint8)
    bg = Image.fromarray(np.repeat(shade[...,None],3,axis=2),'RGB')
    bg.paste(cell,(0,0),cell)
    return bg


def contact(cells, kind, output, indices=None):
    selected = np.linspace(0,len(cells)-1,12,dtype=int)
    width,height = cells[0].size
    result = Image.new('RGB',(width*4,(height+22)*3),'#20242a')
    draw = ImageDraw.Draw(result)
    for j,i in enumerate(selected):
        x,y = j%4*width,j//4*(height+22)
        result.paste(checker(cells[i]),(x,y+22))
        label = f'{kind} f{i}' if indices is None else f'{kind} source {indices[i]}'
        draw.text((x+4,y+4),label,fill='white')
    result.save(output)


def keyframes(kinds):
    selection = json.loads((ROOT/'runtime-source-selection.json').read_text(encoding='utf-8-sig'))
    if 'attack' in kinds and selection['actions']['attack'].get('sourceSegments'):
        raise RuntimeError('Composite attack: rebuild with ../_engineering_line_completion_20260830/resupply_sprites.py, preserving before-resupply keys.')
    sys.path.insert(0,str(TOOLS))
    from rmbg_cutout import get_model, predict_alpha
    model = get_model()
    index = json.loads((ROOT/'runtime-source-selection.json').read_text(encoding='utf-8-sig'))
    cache = ROOT/'cache/birefnet'
    cache.mkdir(parents=True,exist_ok=True)
    for kind in kinds:
        action = index['actions'][kind]
        if action['userAcceptance']['promptId'] != action['promptId']:
            raise RuntimeError(f'Unaccepted source identity: {kind}')
        frames,fps = read_video(ROOT/action['sourceVideo'])
        indices = list(range(0,len(frames),4))
        if kind in DENSE:
            start,end = DENSE[kind]
            indices = sorted(set(indices+list(range(start,end+1))+[len(frames)-1]))
        if kind == 'attack':
            indices = sorted(set(indices+list(range(120,176,2))))
        scaled = []
        for j,i in enumerate(indices):
            cached = cache/f'{kind}-{action["revision"]}-{i:04}.png'
            if cached.exists():
                cut = Image.open(cached).convert('RGBA')
            else:
                rgb = np.asarray(frames[i])
                alpha_path = ROOT/'cache/source-frames/idle-0000-alpha.png'
                alpha = (np.array(Image.open(alpha_path)) if kind=='idle' and i==0 and alpha_path.exists()
                         else np.asarray(predict_alpha(model,frames[i]),dtype=np.uint8))
                alpha[alpha<4] = 0
                rgba = np.dstack([rgb,alpha])
                rgba[alpha==0,:3] = 0
                cut = Image.fromarray(rgba,'RGBA')
                cut.save(cached)
            if kind == 'attack':
                cut = restore_muzzle_matte(cut,frames[i],i)
            cut = remove_white_matte(cut)
            scaled.append(cut.resize(tuple(round(v*SCALE) for v in cut.size),Image.Resampling.LANCZOS))
            print(f'{kind}: key {j+1}/{len(indices)} source {i}',flush=True)
        bounds = [cell.getchannel('A').getbbox() for cell in scaled]
        if any(b is None for b in bounds):
            raise RuntimeError(f'Empty cutout: {kind}; stop without replacing source.')
        center = round(ANCHOR[0]*SCALE)
        radius = max(max(center-b[0],b[2]-center) for b in bounds)+3
        crop = (center-radius,min(b[1] for b in bounds)-3,
                center+radius,max(b[3] for b in bounds)+3)
        cells = []
        for cell in scaled:
            rgba = np.array(cell.crop(crop))
            rgba[rgba[...,3]==0,:3] = 0
            cells.append(Image.fromarray(rgba,'RGBA'))
        width,height = cells[0].size
        cols = layout(len(cells),width,height)
        sheet_from(cells,cols).save(ROOT/f'source-sheets/{kind}-keys.png')
        durations = [(b-a)/fps*1000 for a,b in zip(indices,indices[1:]+[len(frames)])]
        events = dict(EVENTS.get(kind,{}))
        for key,source_frame in list(events.items()):
            events[key.replace('SourceFrame','OutputFrame')] = indices.index(source_frame)*2
        meta = {'kind':kind,'video':action['sourceVideo'],'promptId':action['promptId'],
                'sourceFrames':len(frames),'sourceFps':fps,'sourceFrameIndices':indices,
                'sourceDurationsMs':durations,'durationMs':len(frames)/fps*1000,
                'sourceScale':SCALE,'anchorInVideo':ANCHOR,'actionCropInScaledCanvas':list(crop),
                'footX':center-crop[0],'footY':ANCHOR[1]*SCALE-crop[1],
                'frameWidth':width,'frameHeight':height,'frameCount':len(cells),
                'cols':cols,'rows':math.ceil(len(cells)/cols),'loop':kind in ('idle','run'),
                'sourceSheet':f'source-sheets/{kind}-keys.png','keyEvents':events,
                'canvasTransform':'One global scale and one crop per action; no per-frame recentering or alpha-bottom alignment.',
                'cutout':'Cached ComfyUI-RMBG BiRefNet-general; keep all subjects/components; local white-edge RGB cleanup.',
                'muzzleMatteRecovery':({'sourceFrames':[54,100],'sourceXMin':850,
                    'method':'Bounded white-matte solve for omitted plume; warm envelope preserves white flame core; original solid foreground retained.'} if kind=='attack' else None),
                'runtimeIntegrationActive':False}
        write_json(ROOT/f'source-sheets/{kind}-keys.json',meta)
        contact(cells,kind,ROOT/f'previews/{kind}-keys-contact.png',indices)
        print(f'{kind}: {len(cells)} keys, cell {width}x{height}, foot {meta["footX"]}/{meta["footY"]}',flush=True)


def interpolate(kinds):
    for kind in kinds:
        meta = json.loads((ROOT/f'source-sheets/{kind}-keys.json').read_text(encoding='utf-8'))
        count = meta['frameCount']*2-(0 if meta['loop'] else 1)
        cols = layout(count,meta['frameWidth'],meta['frameHeight'])
        command = [sys.executable,str(TOOLS/'rife-spritesheet-interpolate.py'),
                   '--sheet',str(ROOT/meta['sourceSheet']),'--out',str(ROOT/f'final/{kind}.png'),
                   '--name',f'howitzer-{kind}','--frame-width',str(meta['frameWidth']),
                   '--frame-height',str(meta['frameHeight']),'--cols',str(meta['cols']),
                   '--frame-count',str(meta['frameCount']),'--frame-rate',str(meta['sourceFps']/4),
                   '--mode','loop' if meta['loop'] else 'one-shot','--out-cols',str(cols),
                   '--preview-dir',str(ROOT/f'cache/rife-preview/{kind}'),
                   '--report',str(ROOT/f'final/{kind}-rife.json'),
                   '--repair-red-outliers','--preserve-vertical-motion']
        with open(ROOT/f'logs/{kind}-rife.log','w',encoding='utf-8') as log:
            subprocess.run(command,stdout=log,stderr=subprocess.STDOUT,check=True)
        print(f'{kind}: RIFE complete, {count} frames',flush=True)


def gif_durations(durations):
    return (np.diff(np.r_[0,np.rint(np.cumsum(durations)/10).astype(int)])*10).tolist()


def package():
    from package_sprites import package as package_howitzer
    package_howitzer()


if __name__ == '__main__':
    ap = argparse.ArgumentParser()
    ap.add_argument('stage',choices=('keys','interpolate','package'))
    ap.add_argument('--kinds',nargs='+',choices=KINDS,default=list(KINDS))
    args = ap.parse_args()
    if args.stage == 'keys':
        keyframes(args.kinds)
    elif args.stage == 'interpolate':
        interpolate(args.kinds)
    else:
        package()
