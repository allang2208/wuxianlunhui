"""Pleat Devourer sources -> fixed-scale RGBA keys -> RIFE 2x -> timed previews.

Offline asset production only. No runtime files are written. Source trajectories
and one-shot clocks are retained; each action uses one crop and the same scale.
"""
from pathlib import Path
import argparse
import json
import math
import shutil
import subprocess
import sys

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent
ANIM = ROOT.parent
REPO = ROOT.parents[4]
TOOLS = REPO / 'tools/ai-gen'
RIFE = REPO.parent / '_tmp/elise_audit/rife/rife-ncnn-vulkan-20221029-windows/rife-ncnn-vulkan.exe'
SOURCES = {'idle': 'idle-v01', 'crawling': 'crawling-v01',
           'attack': 'attack-v04', 'dying': 'dying-v02-fold-settle'}
SCALE = 0.35


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def load(path):
    return json.loads(path.read_text(encoding='utf-8'))


def decode(action):
    path = ANIM / 'videos' / (SOURCES[action] + '.mp4')
    with av.open(str(path)) as container:
        stream = container.streams.video[0]
        fps = float(stream.average_rate)
        frames, times = [], []
        for frame in container.decode(stream):
            frames.append(frame.to_image().convert('RGB'))
            times.append(float(frame.time))
        duration = float(stream.duration * stream.time_base)
    return frames, fps, times, duration


def proxy(im):
    gray = cv2.cvtColor(np.asarray(im), cv2.COLOR_RGB2GRAY)
    count, labels, stats, _ = cv2.connectedComponentsWithStats((gray < 175).astype(np.uint8), 8)
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    mask = (labels == largest).astype(np.float32)
    # Dark-region proxy is used only to find candidate phases, never as final alpha.
    small = cv2.resize(mask, (256, 144), interpolation=cv2.INTER_AREA)
    return small


def contact(images, indices, path, cols=6):
    width, height = 320, 180
    out = Image.new('RGB', (cols * width, math.ceil(len(indices)/cols) * (height+22)), (235, 235, 235))
    draw = ImageDraw.Draw(out)
    for slot, index in enumerate(indices):
        x, y = slot % cols * width, slot // cols * (height+22)
        out.paste(images[index].resize((width, height)), (x, y))
        draw.text((x+5, y+height+3), f'f{index:03d} / {index/24:.3f}s', fill=(15, 15, 15))
    path.parent.mkdir(parents=True, exist_ok=True)
    out.save(path)


def prepare():
    for name in ('references', 'contacts', 'cutouts', 'keys', 'final', 'previews', 'reports', 'producer'):
        (ROOT/name).mkdir(parents=True, exist_ok=True)
    for name in ('rmbg_cutout.py', 'rife-spritesheet-interpolate.py'):
        if not (ROOT/'producer'/name).exists():
            shutil.copy2(TOOLS/name, ROOT/'producer'/name)
    inventory, candidates = {}, {}
    for action, stem in SOURCES.items():
        images, fps, times, duration = decode(action)
        provenance = ANIM/'videos'/(stem+'.mp4.json')
        if not provenance.exists():
            raise FileNotFoundError(provenance)
        images[0].save(ROOT/'references'/f'{action}-f000.png')
        inventory[action] = dict(video='../videos/'+stem+'.mp4', provenance='../videos/'+stem+'.mp4.json',
                                 frameCount=len(images), fps=fps, durationMs=duration*1000, size=list(images[0].size))
        if action in ('idle', 'crawling'):
            masks = [proxy(im) for im in images]
            scores = []
            periods = range(45, 91) if action == 'idle' else range(32, 69)
            for start in range(12, 73):
                for period in periods:
                    end = start + period
                    if end > 117:
                        continue
                    pose = float(np.abs(masks[start]-masks[end]).mean())
                    velocity = float(np.abs((masks[start+1]-masks[start])-(masks[end+1]-masks[end])).mean())
                    excursion = max(float(np.abs(masks[k]-masks[start]).mean()) for k in range(start, end, 3))
                    if excursion < (0.006 if action == 'idle' else 0.018):
                        continue
                    scores.append(dict(start=start, endExclusive=end, period=period,
                                       score=pose+.5*velocity, poseDelta=pose, excursion=excursion))
            scores.sort(key=lambda item:item['score'])
            top = []
            for entry in scores:
                if all(abs(entry['start']-v['start'])>5 or abs(entry['period']-v['period'])>5 for v in top):
                    top.append(entry)
                if len(top)==4:
                    break
            candidates[action] = top
            picks = [k for item in top for k in (item['start'], (item['start']+item['endExclusive'])//2,
                                                item['endExclusive']-1, item['endExclusive'])]
            if picks:
                contact(images, picks, ROOT/'contacts'/f'{action}-cycle-candidates.png', 4)
        else:
            contact(images, list(range(0, 121, 5)), ROOT/'contacts'/f'{action}-source-detail.png', 5)
    write(ROOT/'source-inventory.json', inventory)
    write(ROOT/'cycle-candidates.json', candidates)
    print(json.dumps(candidates, ensure_ascii=False), flush=True)


def selected_jobs():
    return load(ROOT/'selection.json')['jobs']


def clean(rgb, alpha):
    alpha = np.asarray(alpha, dtype=np.uint8).squeeze().copy()
    count, labels, stats, _ = cv2.connectedComponentsWithStats((alpha > 12).astype(np.uint8), 8)
    if count < 2:
        raise RuntimeError('No foreground returned by BiRefNet')
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate((labels == largest).astype(np.uint8), np.ones((3,3), np.uint8)) > 0
    alpha[(~keep) | (alpha <= 12)] = 0
    reliable = alpha >= 224
    if not reliable.any():
        raise RuntimeError('No reliable opaque foreground')
    _, near = distance_transform_edt(~reliable, return_indices=True)
    rgb = rgb.copy()
    edge = (alpha > 0) & ~reliable
    rgb[edge] = rgb[near[0][edge], near[1][edge]]
    rgb[alpha == 0] = 0
    return Image.fromarray(np.dstack((rgb, alpha)))


def cutouts():
    sys.path.insert(0, str(ROOT/'producer'))
    from rmbg_cutout import get_model, predict_alpha
    model = get_model()
    for job in selected_jobs():
        action = job['action']
        frames, _, _, _ = decode(action)
        keys = sorted({0} | set(job['sourceFrameIndices']))
        dest = ROOT/'cutouts'/action
        dest.mkdir(parents=True, exist_ok=True)
        for n, key in enumerate(keys):
            path = dest/f'f{key:03d}.png'
            if path.exists():
                continue
            image = frames[key]
            cached = ROOT/'references/idle-f000-alpha.png'
            alpha = np.asarray(Image.open(cached)) if action == 'idle' and key == 0 and cached.exists() else predict_alpha(model, image)
            clean(np.asarray(image), alpha).save(path)
            if n % 8 == 0 or n+1 == len(keys):
                print(f'[cutout] {action} {n+1}/{len(keys)}', flush=True)


def grid(count, width, height):
    options = []
    for cols in range(1, count+1):
        rows = math.ceil(count/cols)
        waste = (rows*cols-count)/(rows*cols)
        if max(cols*width, rows*height)<=4096 and waste<=.125:
            options.append((rows*cols, abs(math.log(cols*width/(rows*height))), cols, rows))
    if not options:
        raise RuntimeError('No layout meets texture-size and empty-cell limits')
    return min(options)[2:]


def frame_clock(job):
    keys = job['sourceFrameIndices']
    times = []
    for i, key in enumerate(keys):
        end = keys[i+1] if i+1<len(keys) else job['sourceEndExclusive']
        duration = (end-key)*1000/24
        times.extend([duration/2, duration/2] if i+1<len(keys) or job['mode']=='loop' else [duration])
    return times


def compose():
    reference = Image.open(ROOT/'cutouts/idle/f000.png').convert('RGBA')
    box = reference.getchannel('A').getbbox()
    alpha = np.asarray(reference)[...,3]
    _, xs = np.nonzero(alpha[box[3]-16:box[3]]>24)
    source_origin = [(float(xs.min())+float(xs.max()))/2, box[3]-1]
    scaled_size = (448, 252)  # Exact uniform 0.35 of every 1280x720 source canvas.
    origin = [v*SCALE for v in source_origin]
    records = []
    for job in selected_jobs():
        action = job['action']
        cells = []
        for key in job['sourceFrameIndices']:
            im = Image.open(ROOT/'cutouts'/action/f'f{key:03d}.png').convert('RGBA')
            resized = np.asarray(im.convert('RGBa').resize(scaled_size, Image.Resampling.LANCZOS).convert('RGBA')).copy()
            resized[resized[...,3] == 0, :3] = 0
            cells.append(Image.fromarray(resized))
        boxes = [im.getchannel('A').getbbox() for im in cells]
        # Symmetric around the common ground root, with at least four pixels of padding.
        radius = math.ceil(max(origin[0]-min(b[0] for b in boxes), max(b[2] for b in boxes)-origin[0]))+4
        left = math.floor(origin[0]-radius)
        right = math.ceil(origin[0]+radius)
        top, bottom = min(b[1] for b in boxes)-4, max(b[3] for b in boxes)+4
        width, height = right-left, bottom-top
        cols, rows = grid(len(cells), width, height)
        sheet = Image.new('RGBA', (cols*width, rows*height))
        for i, im in enumerate(cells):
            sheet.paste(im.crop((left,top,right,bottom)), (i%cols*width, i//cols*height))
        sheet.save(ROOT/'keys'/f'{action}.png', optimize=True)
        clock = frame_clock(job)
        out_cols, out_rows = grid(len(clock), width, height)
        layout = dict(columns=out_cols, rows=out_rows, frameWidth=width, frameHeight=height,
                      frameCount=len(clock), endFrame=len(clock)-1, footX=round(origin[0]-left,4),
                      footY=round(origin[1]-top,4), repeat=-1 if job['mode']=='loop' else 0,
                      durationMs=round(sum(clock),6), frameDurationsMs=clock)
        records.append(dict(**job, layout=layout, keyColumns=cols, keyRows=rows,
                            crop=[left,top,right,bottom], sourceScale=SCALE,
                            gpuBytes=out_cols*out_rows*width*height*4))
        print(f'[keys] {action} {len(cells)} -> {len(clock)} frames, {width}x{height}, {out_cols}x{out_rows}', flush=True)
    total = sum(v['gpuBytes'] for v in records)
    result = dict(unitKey='pleat_devourer', profile='specialist', targetMiB=64, admissionMiB=128,
                  sourceOrigin=source_origin, sourceBox=list(box), sourceScale=SCALE, scaledSourceSize=scaled_size,
                  referenceCell=448, worldScale=None, normalZoomBodyPixels=None, maximumZoomBodyPixels=None,
                  scaleNote='Production resolution only; no runtime entity or world-size decision exists.',
                  motionPolicy='Same fixed source root and uniform scale; no per-frame shifts, resizing or foot locking.',
                  jobs=records, gpuBytes=total, gpuMiB=total/1024**2, runtimeIntegrated=False)
    write(ROOT/'composition.json', result)
    print(json.dumps({'gpuMiB':result['gpuMiB'], 'sourceOrigin':source_origin}), flush=True)
    if total > 128*1024**2:
        raise RuntimeError('Specialist admission budget exceeded; do not promote output')


def interpolate():
    for job in load(ROOT/'composition.json')['jobs']:
        action, layout = job['action'], job['layout']
        dest, report = ROOT/'final'/f'{action}.png', ROOT/'reports'/f'{action}-rife.json'
        if dest.exists() and report.exists():
            print(f'[rife] retaining completed {action}', flush=True)
            continue
        command = [sys.executable, str(ROOT/'producer/rife-spritesheet-interpolate.py'),
                   '--sheet', str(ROOT/'keys'/f'{action}.png'), '--out', str(dest),
                   '--name', f'pleat-devourer-{action}', '--frame-width', str(layout['frameWidth']),
                   '--frame-height', str(layout['frameHeight']), '--cols', str(job['keyColumns']),
                   '--frame-count', str(len(job['sourceFrameIndices'])), '--frame-rate', str(job['keyFps']),
                   '--mode', job['mode'], '--out-cols', str(layout['columns']), '--rife', str(RIFE),
                   '--preview-dir', str(ROOT/'previews/rife-default-clock'), '--report', str(report),
                   '--preserve-vertical-motion', '--repair-red-outliers']
        print(f'[rife] {action} started', flush=True)
        with (ROOT/'reports'/f'{action}-rife.log').open('w', encoding='utf-8') as output:
            subprocess.run(command, stdout=output, stderr=subprocess.STDOUT, check=True)
        print(f'[rife] {action} complete', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('stage', choices=('prepare','cutouts','compose','interpolate'))
    args = parser.parse_args()
    globals()[args.stage]()
