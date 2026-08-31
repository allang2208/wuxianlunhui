"""Explicitly requested offline FlySwarm asset/config inspection; does not launch the game."""
from pathlib import Path
import importlib.util
import json
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]

def read_json(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))

def read_frames(path, count):
    sheet = np.asarray(Image.open(path).convert("RGBA")).copy()
    return sheet, [sheet[(i//8)*512:(i//8+1)*512, (i%8)*512:(i%8+1)*512].copy() for i in range(count)]

def main():
    source_sheet, keys = read_frames(REPO/"assets/enemies/flyswarm/idle.png", 32)
    sheet, frames = read_frames(REPO/"assets/enemies/flyswarm/idle-rife64.png", 64)
    for frame in keys:
        frame[frame[..., 3] == 0, :3] = 0
    spec = importlib.util.spec_from_file_location("rife_snapshot", ROOT/"rife-production-snapshot.py")
    rife = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(rife)
    production = read_json(ROOT/"reports/rife.json")
    observations = rife.validate(keys, frames, "loop", production['validation']['middleFrameFootShifts'],
                                 [], [], [], False, 0, False, 18)
    before = read_json(ROOT/"before/data-flyswarm.json")
    after = read_json(REPO/"data/enemy-config.json")['flySwarm']
    public = read_json(REPO/"public/data/enemy-config.json")['flySwarm']
    changes = []
    def walk(a, b, key=""):
        if isinstance(a, dict) and isinstance(b, dict):
            for k in sorted(a.keys() | b.keys()): walk(a.get(k), b.get(k), f"{key}.{k}".lstrip('.'))
        elif isinstance(a, list) and isinstance(b, list) and len(a) == len(b):
            for i, (left, right) in enumerate(zip(a,b)): walk(left, right, f"{key}[{i}]")
        elif a != b: changes.append({'field': key, 'before': a, 'after': b})
    walk(before, after)
    size_paths = {'size', 'collisionRadius', 'render.spriteSize', 'render.collisionWidth',
                  'render.collisionHeight', 'render.footOffsetY', 'render.colliderOffsetY',
                  'render.projectileHitbox.width', 'render.projectileHitbox.height'}
    sizes = [c for c in changes if c['field'] in size_paths or c['field'].startswith('hitCircles[')]
    timing = {}
    for name in ('flyswarm-rife64-2s.gif', 'flyswarm-before-after-2s.gif'):
        with Image.open(ROOT/'previews'/name) as gif:
            durations = []
            for i in range(gif.n_frames):
                gif.seek(i)
                durations.append(gif.info.get('duration', 0))
            timing[name] = {'frames': len(durations), 'durationMs': sum(durations)}
    centroid_deviations = []
    def centroid(frame):
        alpha = frame[...,3].astype(float)
        return np.array([(alpha.sum(axis=0)*np.arange(512)).sum(),
                         (alpha.sum(axis=1)*np.arange(512)).sum()])/alpha.sum()
    for i in range(32):
        delta = centroid(frames[i*2+1])-(centroid(keys[i])+centroid(keys[(i+1)%32]))/2
        centroid_deviations.append(delta.tolist())
    checks = {
        'sheetLayout64x512': sheet.shape == (4096,4096,4),
        'sourceLayout32x512': source_sheet.shape == (2048,4096,4),
        'visibleSourceKeysUnchanged': observations['originalKeyFramesPreservedAtEvenIndices'],
        'noEmptyFrames': not observations['emptyFrames'],
        'noClippedVisibleFrames': not observations['touchingFrames'],
        'noTransparentRgb': observations['nonzeroRgbInTransparentPixels'] == 0,
        'noNewDarkOutlierBlocks': not observations['visibleDarkOutlierFrames'],
        'noVerticalRealignment': not any(production['validation']['middleFrameFootShifts']),
        'dataAndPublicMatch': after == public,
        'allChangedSizesTimes1p2': all(abs(c['after']-c['before']*1.2)<1e-8 for c in sizes),
        'nonSizeGameplayUnchanged': all(c['field'] in size_paths or c['field'].startswith(('hitCircles[', 'textures.')) for c in changes),
        'cycleStill2Seconds': after['textures']['idleFrameCount']/after['textures']['idleFrameRate'] == 2,
        'bothPreviewClocks2Seconds': all(t['durationMs']==2000 and t['frames']==64 for t in timing.values()),
    }
    contact = Image.new('RGB', (1024,1024), '#292e32')
    draw = ImageDraw.Draw(contact)
    for i, frame in enumerate(frames):
        cell = Image.fromarray(frame).resize((128,128), Image.Resampling.LANCZOS)
        x,y = i%8*128, i//8*128
        contact.paste(cell, (x,y), cell)
        draw.text((x+3,y+3), str(i), fill='white')
    contact.save(ROOT/'previews/review-all64.png')
    report = {'scope':'offline asset pixels and config only; not runtime acceptance',
              'checks':checks, 'allScopedChecksPass':all(checks.values()),
              'changes':changes, 'observations':observations, 'previewClocks':timing,
              'rgbaMiB':int(sheet.size/1048576),
              'maxMidpointCentroidDeviationWorldXY':(np.abs(centroid_deviations).max(axis=0)*144/512).tolist(),
              'centroidNote':'Diagnostic only: natural motion is not straightened to match a centroid.',
              'runtimeChecks':'Not run. User to review loop seam, wings, contact range and walls.'}
    (ROOT/'reports/review.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'checks':checks,'rgbaMiB':report['rgbaMiB'],
                      'maxMidpointCentroidDeviationWorldXY':report['maxMidpointCentroidDeviationWorldXY']},indent=2))

if __name__ == '__main__':
    main()
