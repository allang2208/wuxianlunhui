"""Accepted MiniMax H3 -> BiRefNet -> fixed scale/crop -> 2x RIFE. No per-frame alignment."""
from pathlib import Path
import importlib.util
import json
import math
import shutil
import subprocess
import sys
import av
import numpy as np
from scipy import ndimage
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OUT = ROOT / 'runtime'
OUT.mkdir(exist_ok=True)
sys.path.insert(0, str(REPO / 'tools/ai-gen'))
from rmbg_cutout import get_model, predict_alpha
spec = importlib.util.spec_from_file_location('tail_clean', ROOT / 'animations-v02-direction/prune-carry-tail.py')
tail = importlib.util.module_from_spec(spec)
spec.loader.exec_module(tail)
TASKS = {
    'walking': ('animations-v02-direction/videos/walking-h3-v01.mp4', list(range(24, 62, 2)), 'loop'),
    'carry-walking': ('animations-v02-direction/videos/carry-walking-h3-v01.mp4', list(range(20, 52, 2)), 'loop'),
    'mining': ('animations-v01/h3-v01/videos/mining-h3-v01.mp4', list(range(0, 36, 2)), 'one-shot'),
}
CELL = 272
SCALE = .5
model = get_model()
metadata = {'acceptedByUser': '2026-09-01 接入游戏', 'sourceScale': SCALE,
    'orientation': 'animations-v02-direction/manifest.json',
    'cutout': 'ComfyUI-RMBG BiRefNet-general', 'perFrameAlignment': False, 'actions': {}}
formal = REPO / 'assets/companions/hamster_mining_expert'
formal.mkdir(parents=True, exist_ok=True)
rife = OUT / 'rife-spritesheet-interpolate.py'
shutil.copy2(REPO / 'tools/ai-gen/rife-spritesheet-interpolate.py', rife)
# The copied script's REPO is different, so pass the established local binary explicitly.
rife_bin = REPO.parent / '_tmp/elise_audit/rife/rife-ncnn-vulkan-20221029-windows/rife-ncnn-vulkan.exe'
for name, (source, indices, mode) in TASKS.items():
    folder = OUT / name
    folder.mkdir(exist_ok=True)
    rgba = []
    for i, frame in enumerate(av.open(str(ROOT / source)).decode(video=0)):
        if i not in indices:
            continue
        cache = folder / f'source-{i:03d}.png'
        if cache.exists():
            cut = Image.open(cache).convert('RGBA')
        else:
            rgb = frame.to_ndarray(format='rgb24')
            if name == 'carry-walking':
                rgb, _ = tail.clean_tail(rgb)
            source_image = Image.fromarray(rgb)
            alpha = np.asarray(predict_alpha(model, source_image), dtype=np.uint8)
            # Trim only nearly invisible matting haze, retaining white cheek fur.
            alpha[alpha < 8] = 0
            cut = source_image.convert('RGBA')
            cut.putalpha(Image.fromarray(alpha))
            cut.save(cache)
        # White studio background: remove only white pixels connected to the exterior,
        # then undo white matte in partial-alpha edge pixels. Interior white fur stays.
        pixels = np.asarray(cut).copy()
        white = pixels[:,:,:3].min(axis=2) > 242
        seeds = np.zeros(white.shape,dtype=bool)
        seeds[0,:] = white[0,:]; seeds[-1,:] = white[-1,:]
        seeds[:,0] = white[:,0]; seeds[:,-1] = white[:,-1]
        exterior = ndimage.binary_propagation(seeds,mask=white)
        pixels[exterior,3] = 0
        a = pixels[:,:,3:4].astype(np.float32)/255
        edge = (a[:,:,0] > .02) & (a[:,:,0] < .98)
        unmatted = np.clip((pixels[:,:,:3].astype(np.float32)-255*(1-a))/np.maximum(a,.02),0,255)
        pixels[edge,:3] = unmatted[edge].astype(np.uint8)
        pixels[pixels[:,:,3] == 0,:3] = 0
        rgba.append(Image.fromarray(pixels))
        print(f'{name} source frame {i}', flush=True)
    bounds = [im.getbbox() for im in rgba]
    left, top = min(b[0] for b in bounds), min(b[1] for b in bounds)
    right, bottom = max(b[2] for b in bounds), max(b[3] for b in bounds)
    # One fixed crop for the entire action, common source scale for all actions.
    # Root at median boot center; retain natural body bob / alternate raised feet.
    boot_centers = []
    for im, b in zip(rgba, bounds):
        a = np.asarray(im.getchannel('A'))
        ys, xs = np.where(a[max(b[1], b[3]-90):b[3]] > 128)
        boot_centers.append(float(xs.min()+xs.max())/2)
    root_x = round(float(np.median(boot_centers)))
    foot_source_y = round(float(np.median([b[3] for b in bounds])))
    crop_x = round(root_x - CELL / (2*SCALE))
    crop_y = bottom + 8 - round(CELL/SCALE)
    crop = (crop_x, crop_y, crop_x+round(CELL/SCALE), crop_y+round(CELL/SCALE))
    if not (left >= crop[0]+4 and right <= crop[2]-4 and top >= crop[1]+4):
        raise RuntimeError(f'{name}: subject exceeds fixed cell at 0.5 scale: {bounds}')
    cells = [im.crop(crop).resize((CELL,CELL), Image.Resampling.LANCZOS) for im in rgba]
    cols = min(8, len(cells))
    sheet = Image.new('RGBA', (cols*CELL, math.ceil(len(cells)/cols)*CELL))
    for i, im in enumerate(cells):
        sheet.paste(im, (i%cols*CELL, i//cols*CELL))
    sheet_path = folder / 'source-keyframes.png'
    sheet.save(sheet_path)
    count = len(cells)*2 if mode == 'loop' else len(cells)*2-1
    final_cols = min((c for c in range(1, min(16,count)+1) if max(c,math.ceil(count/c))*CELL <= 4096), key=lambda c: (math.ceil(count/c)*c-count, abs(c-math.sqrt(count))))
    foot_y = round((foot_source_y-crop_y)*SCALE, 3)
    info = {'source': source, 'sourceIndices': indices, 'sourceFps': 24, 'keyframeFps': 12,
        'mode': mode, 'crop': crop, 'sourceRootX': root_x, 'footY': foot_y,
        'frameWidth': CELL,'frameHeight': CELL,'cols': final_cols,'rows': math.ceil(count/final_cols),
        'frameCount': count,'frameRate':24,'durationMs':count/24*1000,
        'sourceAlphaBounds': [left,top,right,bottom]}
    metadata['actions'][name] = info
    (OUT / 'asset-manifest.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf8')
    command = [sys.executable,'-B',str(rife),'--sheet',str(sheet_path),'--out',str(formal / f'{name}.png'),
        '--name',name,'--frame-width',str(CELL),'--frame-height',str(CELL),'--cols',str(cols),
        '--frame-count',str(len(cells)),'--frame-rate','12','--mode',mode,'--out-cols',str(final_cols),
        '--preview-dir',str(folder / 'previews'),'--report',str(folder/'rife-report.json'),
        '--rife',str(rife_bin),'--preserve-vertical-motion','--repair-red-outliers']
    with (folder/'rife.log').open('w',encoding='utf8') as log:
        subprocess.run(command,check=True,stdout=log,stderr=subprocess.STDOUT)
    if name == 'mining':
        cells[0].save(formal / 'idle.png')
        metadata['actions']['idle'] = {**info,'frameCount':1,'cols':1,'rows':1,'frameRate':1,'durationMs':1000}
    print(f'finished {name}: {count} frames / 24fps',flush=True)
metadata['decodedBytes'] = sum(i['cols']*i['rows']*CELL*CELL*4 for i in metadata['actions'].values())
(OUT / 'asset-manifest.json').write_text(json.dumps(metadata,ensure_ascii=False,indent=2),encoding='utf8')
print('Production complete',flush=True)
