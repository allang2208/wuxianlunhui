"""Export the approved walking video's stable full gait cycle; no runtime tests.

Only publishes walking after its staged source selection and previews are ready.
Other actions, monster logic, move speed and combat parameters are untouched.
"""
import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
OUT = ROOT / 'walking-loop-repair'
REPO = ROOT.parents[3]


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, ROOT / filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def prepare():
    build = module('runtime_build', 'build-runtime-sprites.py')
    manifest = build.read(build.OUT / 'manifest.json')
    rec = next(r.copy() for r in manifest['actions'] if r['state'] == 'walking')
    job = next(j for j in build.read(ROOT/'task-index.json')['jobs'] if j['state'] == 'walking')
    if not job['approved'] or not (ROOT/job['video']).is_file():
        raise RuntimeError('Approved walking video required')
    # Native f88 and f134 have matching leg phase and movement direction.
    # The endpoint is excluded, so there is no duplicated foot-contact pause.
    ids = list(range(88, 134, 2))
    source = build.ARCHIVED_CUTOUTS / 'walking'
    cells = [np.asarray(Image.open(source/f'f{i:03d}.png').convert('RGBA')) for i in ids]
    rendered = [build.resample(cell, rec, manifest['sourcePixelScale']) for cell in cells]
    key_cols, _ = build.grid(len(cells), rec['frameWidth'], rec['frameHeight'])
    build.pack(rendered, key_cols).save(OUT/'walking-keys.png')
    # Old 144 source frames in 4s = 36 source frames/s. Preserve that cadence,
    # rather than stretching this single cycle to the old multi-cycle 4s.
    duration = 46/36*1000
    for key in ('productionReport', 'productionReportScope'):
        rec.pop(key, None)
    rec.update(sourceFrames=ids, keyCols=key_cols, keyCount=len(ids), frameCount=46,
        endFrame=45, footX=rec['frameWidth']/2, durationMs=duration, frameRate=36.0,
        nativeFrameOverrides=[], sourceSampleAdjustments=[],
        sourceWindow=dict(startFrame=88, endFrameExclusive=134, sourceFps=24,
            sourceDurationMs=46/24*1000, playbackRate=1.5,
            reason='Complete stable gait; matching foot phase and direction, exclude repeated endpoint'),
        preInterpolationSheet='runtime-build-v2/pre-interpolation/walking.png')
    build.save(OUT/'walking-manifest.json', rec)
    before = OUT/'before/enemy-config.json'
    if not before.exists():
        build.save(before, build.read(REPO/'data/enemy-config.json')['deepVeinMother'])
    print(f"Prepared source f88..132 step 2: 23 keys -> 46 frames / {duration:.3f}ms", flush=True)


def interpolate():
    rec = json.loads((OUT/'walking-manifest.json').read_text(encoding='utf-8'))
    cmd = [sys.executable, str(ROOT.parents[1]/'rife-spritesheet-interpolate.py'),
        '--sheet', str(OUT/'walking-keys.png'), '--out', str(OUT/'walking.png'),
        '--name', 'deep-vein-mother-walking-natural-cycle',
        '--frame-width', str(rec['frameWidth']), '--frame-height', str(rec['frameHeight']),
        '--cols', str(rec['keyCols']), '--frame-count', str(rec['keyCount']),
        '--frame-rate', str(rec['frameRate']/2), '--mode', 'loop',
        '--out-cols', str(rec['cols']), '--preview-dir', str(OUT/'rife-preview'),
        '--report', str(OUT/'rife-report.json'), '--repair-red-outliers', '--preserve-vertical-motion']
    with (OUT/'rife.log').open('w', encoding='utf-8') as log:
        subprocess.run(cmd, check=True, stdout=log, stderr=subprocess.STDOUT)
    print('Interpolated the selected complete cycle including its seam.', flush=True)


def previews():
    build = module('runtime_build', 'build-runtime-sprites.py')
    rec = build.read(OUT/'walking-manifest.json')
    frames = []
    font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 18)
    sheet = Image.open(OUT/'walking.png').convert('RGBA')
    w, h, cols = rec['frameWidth'], rec['frameHeight'], rec['cols']
    scale = 300/rec['authoredBodyHeight']
    for i in range(rec['frameCount']):
        cell = sheet.crop((i%cols*w, i//cols*h, (i%cols+1)*w, (i//cols+1)*h))
        cell = cell.resize((round(w*scale), round(h*scale)), Image.Resampling.LANCZOS)
        frame = Image.new('RGB', (560, 520), '#252931')
        frame.paste(cell, (280-cell.width//2, round(445-rec['footY']*scale)), cell)
        draw = ImageDraw.Draw(frame)
        draw.text((8, 8), '行走 · 完整步态循环 / 1.278s', font=font, fill='white')
        draw.text((8, 490), f'f{i}/45 | body 300px', fill='#bac5d1')
        frames.append(frame)
    # GIF only supports 10ms ticks. Accumulate rounding across three cycles;
    # no extra hold on frame 0 or the last frame.
    repeated = []
    for cycle in range(3):
        for frame in frames:
            copy = frame.copy()
            ImageDraw.Draw(copy).text((350, 8), f'第{cycle+1}轮', font=font, fill='#d2b2f3')
            repeated.append(copy)
    ticks = [round(i*100/rec['frameRate'])*10 for i in range(len(repeated)+1)]
    repeated[0].save(OUT/'walking-three-cycles.gif', save_all=True, append_images=repeated[1:],
        duration=[b-a for a,b in zip(ticks,ticks[1:])], loop=0, disposal=2)
    seam = Image.new('RGB', (2240, 1040), '#252931')
    for p, i in enumerate([42,43,44,45,0,1,2,3]):
        seam.paste(frames[i], (p%4*560, p//4*520))
    seam.save(OUT/'walking-loop-seam-after.png')
    contact = Image.new('RGB', (2240, 1560), '#252931')
    for p, i in enumerate([0,4,8,12,16,20,24,28,32,36,40,44]):
        contact.paste(frames[i], (p%4*560, p//4*520))
    contact.save(OUT/'walking-gait-after.png')
    rec['productionReport'] = build.read(OUT/'rife-report.json')['validation']
    rec['productionReportScope'] = 'Final selected walking cycle, no native overrides or held frames'
    build.save(OUT/'walking-manifest.json', rec)
    print('Created three continuous cycles and seam/gait contacts for visual delivery.', flush=True)


def publish():
    build = module('runtime_build', 'build-runtime-sprites.py')
    install = module('runtime_install', 'install-runtime.py')
    rec = build.read(OUT/'walking-manifest.json')
    for relative in ('data/enemy-config.json', 'public/data/enemy-config.json'):
        path = REPO/relative
        text = path.read_text(encoding='utf-8')
        cfg = json.loads(text)['deepVeinMother']
        layout = cfg['textures']['frameLayouts']['walking']
        layout.update(frameCount=rec['frameCount'], endFrame=rec['endFrame'],
            duration=rec['durationMs'], frameRate=rec['frameRate'])
        install.write(path, install.replace_value(text, 'deepVeinMother', cfg))
    for source, destination in ((OUT/'walking.png', REPO/rec['asset']),
        (OUT/'walking.png', build.SHEETS/'walking.png'),
        (OUT/'walking-keys.png', build.OUT/'pre-interpolation/walking.png'),
        (OUT/'rife-report.json', build.OUT/'rife-reports/walking.json')):
        temp = destination.with_name(destination.name+'.animation-tmp')
        shutil.copyfile(source, temp)
        temp.replace(destination)
    manifest = build.read(build.OUT/'manifest.json')
    manifest['actions'] = [rec if r['state']=='walking' else r for r in manifest['actions']]
    install.save(build.OUT/'manifest.json', manifest)
    budget = build.read(build.OUT/'sprite-budget-manifest.json')
    for row in budget['sheets']:
        if row['textureKey']==rec['textureKey']:
            row.update(frameCount=rec['frameCount'], endFrame=rec['endFrame'])
    install.save(build.OUT/'sprite-budget-manifest.json', budget)
    for path in (ROOT/'task-index.json', ROOT.parent/'task-index.json'):
        index = build.read(path)
        for job in index.get('jobs', []):
            if job.get('state')=='walking':
                job.update(spriteFrameCount=46, spriteFrameRate=36.0,
                    spriteLoopSourceWindow=rec['sourceWindow'], finalSpriteApprovedByUser=False,
                    continuousLoopPreview='walking-loop-repair/walking-three-cycles.gif')
        index['status'] = 'walking-loop-repaired-awaiting-user-runtime-test'
        index['runtimeValidated'] = False
        if path.parent != ROOT:
            index['scope'] = 'Seven approved animations, 297 effective frames. Walking now uses one stable 46-frame cycle; other six actions and combat tuning unchanged. No runtime tests.'
        install.save(path, index)
    print('Published walking only; six other PNGs, body geometry, move speed and combat left unchanged.', flush=True)


if __name__ == '__main__':
    stage = sys.argv[1]
    {'prepare': prepare, 'interpolate': interpolate, 'previews': previews, 'publish': publish}[stage]()
