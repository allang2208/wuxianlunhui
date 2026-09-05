"""Sealed-Shaft Rock Wraith: fixed-scale authored keys -> RIFE -> runtime sheets.

This is the current production entry. Sources remain editable; no game or test
runner is launched. Use keys/interpolate per action, then publish the complete set.
"""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
STAGE = ROOT / 'repair-20260830'
ARCHIVE = ROOT / 'authored-keys-460'
RUNTIME = REPO / 'assets/enemies/sealed_shaft_rock_wraith'
BODY = 390
DISPLAY_BODY = 260
ACTIONS = ('idle', 'walking', 'crystalArmSmash', 'borequake', 'drillRush', 'dying')
FILES = dict(zip(ACTIONS, ('idle', 'walking', 'crystal_arm_smash', 'borequake', 'drill_rush', 'dying')))
TIMING = {
    'idle': {'frameCount': 50, 'frameRate': 12, 'repeat': -1},
    'walking': {'frameCount': 50, 'frameRate': 12, 'repeat': -1},
    'crystalArmSmash': {'frameCount': 61, 'duration': 5083, 'contactFrame': 20, 'repeat': 0},
    'borequake': {'frameCount': 61, 'duration': 5083, 'releaseFrame': 24, 'repeat': 0},
    'drillRush': {'frameCount': 61, 'duration': 5083, 'prepareMs': 1500, 'chargeMs': 1100,
                  'chargeStartFrame': 18, 'chargeEndFrame': 49, 'repeat': 0},
    'dying': {'frameCount': 41, 'duration': 3417, 'corpseSettledFrame': 28, 'repeat': 0},
}
NEW_SOURCES = {
    'walking': ('walking-minimax-h3-v02.mp4', tuple(range(0, 121, 5))),
    # Trim the leading one-second hold; retain all fall phases and the settled corpse.
    'dying': ('dying-minimax-h3-v02.mp4', tuple(range(24, 85, 3))),
}
# Offline contact-sheet review: only failed odd interpolation frames, never
# authored keys. Fast turning/running exposes ncnn red/black codec fragments.
REVIEWED_ODD_HOLDS = {
    'walking': [21, 23, 31],
    'crystalArmSmash': [19],
    'drillRush': [15, 17, 21, 27, 31, 33, 39, 41, 43, 51],
}
# The rapid fall has a clear native pose at source frame 52; use it instead
# of RIFE's collapsed drill between source keys 51 and 54.
REVIEWED_NATIVE_MIDDLES = {'dying': {19: 52}}


def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    sys.modules[name] = loaded
    spec.loader.exec_module(loaded)
    return loaded


RIFE_PATH = REPO / 'tools/ai-gen/rife-spritesheet-interpolate.py'
RIFE = module(RIFE_PATH, 'sealed_wraith_rife_20260830')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def relative(path):
    return path.relative_to(REPO).as_posix()


def bounds(frame):
    return Image.fromarray(frame[..., 3]).getbbox()


def crop_uniform(frames, foot_y, margin=12):
    """One symmetric X crop for the entire action; never fit individual poses."""
    height, width = frames[0].shape[:2]
    boxes = [bounds(frame) for frame in frames]
    if any(box is None for box in boxes):
        raise ValueError('Empty authored pose')
    half = math.ceil(max(max(width / 2 - b[0], b[2] - width / 2) for b in boxes)) + margin
    crop_w = min(width, half * 2)
    x0 = (width - crop_w) // 2
    y0 = max(0, min(b[1] for b in boxes) - margin)
    y1 = min(height, max(b[3] for b in boxes) + margin)
    return [f[y0:y1, x0:x0 + crop_w].copy() for f in frames], foot_y - y0


def transform(frame, scale, size, dx, dy):
    # The same affine coefficient drives both axes. RGBa avoids dark resampling halos.
    image = Image.fromarray(frame, 'RGBA').convert('RGBa').transform(
        size, Image.Transform.AFFINE,
        (1 / scale, 0, -dx / scale, 0, 1 / scale, -dy / scale),
        Image.Resampling.BICUBIC).convert('RGBA')
    result = np.asarray(image).copy()
    result[result[..., 3] == 0, :3] = 0
    return result


def archived_keys(name):
    info = read(ARCHIVE / 'source-sheet-report.json')['actions'][name]
    frames = RIFE.extract_cells(ARCHIVE / f'{name}.png', info['frameWidth'],
                               info['frameHeight'], info['cols'], info['frameCount'])
    scale = BODY / 460
    width = math.ceil(info['frameWidth'] * scale / 2) * 2
    height = math.ceil(info['frameHeight'] * scale)
    foot_y = round(650 * scale)
    dx = width / 2 - info['frameWidth'] / 2 * scale
    dy = foot_y - 650 * scale
    resized = [transform(f, scale, (width, height), dx, dy) for f in frames]
    resized, foot_y = crop_uniform(resized, foot_y)
    return resized, foot_y, {
        'source': info['source'], 'sourceIndices': info['sourceIndices'],
        'authoredKeyArchive': relative(ARCHIVE / f'{name}.png'),
        'authoredSourceBodyHeight': 460, 'keyResampleScale': scale,
        'fixedScaleFromVideo': info['fixedScale'] * scale,
        'horizontalMode': info['horizontalMode'], 'verticalMode': info['verticalMode'],
    }


def video_keys(name):
    helper = module(REPO / 'tools/ai-gen/_hamster_halberd_20260825/build-halberdier-sheets.py',
                    'sealed_wraith_cutout_20260830')
    filename, indices = NEW_SOURCES[name]
    video = ROOT / 'videos' / filename
    decoded, fps = helper.BASE.decode_video(video)
    cache_dir = STAGE / 'cutouts' / video.stem
    cache_dir.mkdir(parents=True, exist_ok=True)
    model, frames = None, []
    for index in indices:
        cache = cache_dir / f'{index:03}.png'
        if cache.exists():
            rgba = np.asarray(Image.open(cache).convert('RGBA')).copy()
        else:
            if model is None:
                model = helper.BASE.get_model()
            rgba = helper.BASE.cutout_rgba(decoded[index], model)
            Image.fromarray(rgba, 'RGBA').save(cache)
        frames.append(rgba)
        print(f'{name}: source frame {index}', flush=True)
    # Match the original reference-body definition (21px morphological opening),
    # excluding the thin drill. Every frame uses this single reference scale/root.
    _, top, _, bottom = helper.opened_body_bbox(frames[0], 21)
    scale = BODY / (bottom - top + 1)
    root_x = helper.body_anchor_x(frames[0])
    boxes = [bounds(f) for f in frames]
    margin = 16
    half = math.ceil(max(max(root_x - b[0], b[2] - root_x) for b in boxes) * scale) + margin
    foot_y = math.ceil((bottom - min(b[1] for b in boxes)) * scale) + margin
    height = foot_y + math.ceil((max(b[3] for b in boxes) - bottom) * scale) + margin
    placed = [transform(f, scale, (half * 2, height), half - root_x * scale,
                        foot_y - bottom * scale) for f in frames]
    return placed, foot_y, {
        'source': f'videos/{filename}', 'sourceIndices': list(indices), 'videoFrameRate': fps,
        'sourceBodyHeight': bottom - top + 1, 'fixedScaleFromVideo': scale,
        'sourceRootX': root_x, 'sourceFootY': bottom,
        'horizontalMode': 'fixed-reference-root', 'verticalMode': 'preserve-source-motion',
    }


def make_keys(names):
    path = STAGE / 'source-sheet-report.json'
    report = read(path) if path.exists() else {'targetEffectiveBodyHeight': BODY, 'actions': {}}
    for name in names:
        frames, foot_y, origin = video_keys(name) if name in NEW_SOURCES else archived_keys(name)
        h, w = frames[0].shape[:2]
        cols = min(8, len(frames))
        output = STAGE / 'keys' / f'{name}.png'
        output.parent.mkdir(parents=True, exist_ok=True)
        Image.fromarray(RIFE.compose(frames, cols), 'RGBA').save(output, optimize=True)
        mode = 'loop' if TIMING[name]['repeat'] < 0 else 'one-shot'
        RIFE.write_previews(name, frames, 6, mode, STAGE / 'previews' / 'keys')
        report['actions'][name] = {
            **origin, 'frameCount': len(frames), 'frameWidth': w, 'frameHeight': h,
            'cols': cols, 'rows': math.ceil(len(frames) / cols), 'footX': w / 2,
            'footY': foot_y, 'authoredBodyHeight': BODY, 'sourceSheetFrameRate': 6,
            'repeat': TIMING[name]['repeat'], 'scaleMode': 'one-fixed-scale-per-source',
        }
        write(path, report)
        print(f'{name}: {len(frames)} keys, {w}x{h}, footY={foot_y}', flush=True)


def interpolate(names):
    source = read(STAGE / 'source-sheet-report.json')['actions']
    for name in names:
        info = source[name]
        command = [sys.executable, str(RIFE_PATH), '--sheet', str(STAGE / 'keys' / f'{name}.png'),
                   '--out', str(STAGE / 'interpolated' / f'{name}.png'), '--name', name,
                   '--frame-width', str(info['frameWidth']), '--frame-height', str(info['frameHeight']),
                   '--cols', str(info['cols']), '--frame-count', str(info['frameCount']),
                   '--frame-rate', '6', '--mode', 'loop' if info['repeat'] < 0 else 'one-shot',
                   '--out-cols', '8', '--preview-dir', str(STAGE / 'previews' / 'interpolated'),
                   '--report', str(STAGE / 'interpolation-reports' / f'{name}.json'),
                   '--repair-red-outliers', '--hold-large-repair', '--preserve-vertical-motion']
        log = STAGE / 'logs' / f'{name}-rife.log'
        log.parent.mkdir(parents=True, exist_ok=True)
        with log.open('w', encoding='utf-8') as output:
            subprocess.run(command, check=True, stdout=output, stderr=subprocess.STDOUT)
        repair_reviewed_middles(name)
        print(f'{name}: RIFE complete, log={log.name}', flush=True)


def repair_reviewed_middles(name):
    holds = REVIEWED_ODD_HOLDS.get(name, [])
    native = REVIEWED_NATIVE_MIDDLES.get(name, {})
    if not holds and not native:
        return
    path = STAGE / 'interpolation-reports' / f'{name}.json'
    info = read(path)
    sheet = STAGE / 'interpolated' / f'{name}.png'
    frames = RIFE.extract_cells(sheet, info['frameWidth'], info['frameHeight'],
                               info['cols'], info['outputFrameCount'])
    for index in holds:
        if index % 2 != 1:
            raise ValueError('Reviewed fallback must never replace an authored key')
        frames[index] = frames[index - 1].copy()
    if native:
        source = read(STAGE / 'source-sheet-report.json')['actions'][name]
        helper = module(REPO / 'tools/ai-gen/_hamster_halberd_20260825/build-halberdier-sheets.py',
                        'sealed_wraith_native_fall_20260830')
        video = ROOT / source['source']
        decoded, _ = helper.BASE.decode_video(video)
        model = None
        for index, source_index in native.items():
            if index % 2 != 1:
                raise ValueError('Native middle must never replace an authored key')
            cache = STAGE / 'cutouts' / video.stem / f'{source_index:03}.png'
            if cache.exists():
                rgba = np.asarray(Image.open(cache).convert('RGBA')).copy()
            else:
                if model is None:
                    model = helper.BASE.get_model()
                rgba = helper.BASE.cutout_rgba(decoded[source_index], model)
                Image.fromarray(rgba, 'RGBA').save(cache)
            scale = source['fixedScaleFromVideo']
            frames[index] = transform(
                rgba, scale, (source['frameWidth'], source['frameHeight']),
                source['footX'] - source['sourceRootX'] * scale,
                source['footY'] - source['sourceFootY'] * scale)
    Image.fromarray(RIFE.compose(frames, info['cols']), 'RGBA').save(sheet, optimize=True)
    RIFE.write_previews(name, frames, 6, info['mode'], STAGE / 'previews' / 'interpolated')
    info['manualVisualRepairs'] = {'heldOddFrames': holds, 'nativeMiddleSourceFrames': native,
                                  'keyFramesChanged': False,
                                  'reason': 'red/black codec fragments or collapsed drill in generated middle pose'}
    write(path, info)


def layout_for(frames):
    h, w = frames[0].shape[:2]
    count = len(frames)
    choices = [(math.ceil(count / cols) * cols, max(cols * w, math.ceil(count / cols) * h), cols)
               for cols in range(1, 4096 // w + 1) if math.ceil(count / cols) * h <= 4096]
    if not choices:
        raise ValueError(f'{count} cells of {w}x{h} cannot fit a 4096px sheet')
    _, _, cols = min(choices)
    return cols, math.ceil(count / cols)


def current_timing(config=None):
    # Gameplay tuning owns timing. Asset rebuilds only own frame geometry/counts
    # and must not restore earlier attack durations over a parallel balance edit.
    if config is None:
        config = read(REPO / 'data/enemy-config.json')['sealedShaftRockWraith']
    result = {}
    for name, defaults in TIMING.items():
        values = dict(defaults)
        layout = config.get('textures', {}).get('frameLayouts', {}).get(name, {})
        skill = config.get('attackSkills', {}).get(name, {})
        for key in defaults:
            if key != 'frameCount':
                values[key] = skill.get(key, layout.get(key, defaults[key]))
        # Preserve selective recovery tuning when rebuilding the same frame sequence.
        if len(layout.get('frameDurations', [])) == values['frameCount']:
            values['frameDurations'] = list(layout['frameDurations'])
        if name == 'dying':
            values['duration'] = config.get('death', {}).get('animMs', values['duration'])
            values['corpseSettledFrame'] = defaults['corpseSettledFrame']
        result[name] = values
    return result


def config_replacements(actions):
    replacements = {}
    for path in (REPO / 'data/enemy-config.json', REPO / 'public/data/enemy-config.json'):
        text = path.read_text(encoding='utf-8')
        timing = current_timing(json.loads(text)['sealedShaftRockWraith'])
        start = text.index('  "sealedShaftRockWraith": {')
        end = text.index('\n  "deepVeinMother": {', start)
        block = text[start:end]
        for name, info in actions.items():
            prefix = f'        "{name}": {{'
            begin = block.index(prefix)
            stop = block.index('\n', begin)
            suffix = ',' if block[begin:stop].rstrip().endswith(',') else ''
            values = {k: info[k] for k in ('columns', 'rows', 'frameWidth', 'frameHeight', 'frameCount',
                      'endFrame', 'footX', 'footY', 'authoredBodyHeight')}
            values.update({k: v for k, v in timing[name].items() if k != 'frameCount'})
            line = '        ' + json.dumps(name) + ': ' + json.dumps(values, ensure_ascii=False) + suffix
            block = block[:begin] + line + block[stop:]
        idle = actions['idle']
        idle_offset = round((idle['footY'] - idle['frameHeight'] / 2) * DISPLAY_BODY / BODY, 4)
        block = re.sub(r'("footOffsetY":\s*)[\d.]+',
                       lambda match: match.group(1) + str(idle_offset), block, count=1)
        replacements[path] = text[:start] + block + text[end:]
    return replacements


def write_configs(actions):
    for path, text in config_replacements(actions).items():
        # Windows can reject opening a watched JSON in truncate mode. Replace
        # a fully written sibling, so a failed write never truncates the config.
        temporary = path.with_name(f'.{path.name}.sealed-wraith.tmp')
        temporary.write_text(text, encoding='utf-8')
        temporary.replace(path)


def publish():
    source = read(STAGE / 'source-sheet-report.json')
    timing = current_timing()
    actions, prepared = {}, {}
    # Prepare all six layouts and config replacements before overwriting assets.
    for name in ACTIONS:
        src = source['actions'][name]
        interp = read(STAGE / 'interpolation-reports' / f'{name}.json')
        count = TIMING[name]['frameCount']
        if interp['outputFrameCount'] != count:
            raise ValueError(f'{name} frame count changed; explicitly update its timing first')
        frames = RIFE.extract_cells(STAGE / 'interpolated' / f'{name}.png', src['frameWidth'],
                                   src['frameHeight'], interp['cols'], count)
        frames, foot_y = crop_uniform(frames, src['footY'], margin=4)
        cols, rows = layout_for(frames)
        h, w = frames[0].shape[:2]
        actions[name] = {**timing[name], 'frameWidth': w, 'frameHeight': h, 'columns': cols,
                         'rows': rows, 'endFrame': count - 1, 'footX': w / 2, 'footY': foot_y,
                         'authoredBodyHeight': BODY, 'runtimePixelScale': DISPLAY_BODY / BODY,
                         'sheetWidth': w * cols, 'sheetHeight': h * rows,
                         'source': relative(ROOT / 'sheets/interpolated' / f'{name}.png'),
                         'sourceVideo': relative(ROOT / src['source']),
                         'runtime': relative(RUNTIME / f'{FILES[name]}.png')}
        prepared[name] = (frames, cols)
    total = sum(a['sheetWidth'] * a['sheetHeight'] * 4 for a in actions.values()) / 1024 ** 2
    if total > 256:
        raise ValueError(f'Whole family is {total:.2f}MiB, above boss admission limit')
    config_replacements(actions)
    for name, (frames, cols) in prepared.items():
        Image.fromarray(RIFE.compose(frames, cols), 'RGBA').save(REPO / actions[name]['runtime'], optimize=True)
        for srcdir, destdir in [('keys', 'source-sheets-pre-interpolation'),
                               ('interpolated', 'sheets/interpolated')]:
            target = ROOT / destdir / f'{name}.png'
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(STAGE / srcdir / f'{name}.png', target)
        report = read(STAGE / 'interpolation-reports' / f'{name}.json')
        report['sourceSheet'] = str(ROOT / 'source-sheets-pre-interpolation' / f'{name}.png')
        report['outputSheet'] = str(ROOT / 'sheets/interpolated' / f'{name}.png')
        write(ROOT / 'interpolation-reports' / f'{name}.json', report)
        for suffix in ('-interpolated.gif', '-interpolated-contact.png'):
            shutil.copy2(STAGE / 'previews/interpolated' / f'{name}{suffix}',
                         ROOT / 'previews/interpolated' / f'{name}{suffix}')
    source.update({'assetOnly': False, 'runtimeIntegration': True,
                   'pipeline': 'approved authored keys/new H3 -> fixed scale -> RIFE v4.6 exact half-step -> 4K packing'})
    write(ROOT / 'source-sheet-report.json', source)
    write(ROOT / 'interpolation-report.json', {
        'assetOnly': False, 'runtimeIntegration': True,
        'actions': {name: read(ROOT / 'interpolation-reports' / f'{name}.json') for name in ACTIONS}})
    # Refresh after encoding: balance edits can land while PNGs are written.
    for name, values in current_timing().items():
        actions[name].update(values)
    manifest = {'characterKey': 'sealedShaftRockWraith', 'assetOnly': False,
                'runtimeIntegrationActive': True, 'runtimeBodyHeight': DISPLAY_BODY,
                'profile': 'boss', 'directRgbaMiB': total, 'runtimeTested': False,
                'cropPolicy': 'one symmetric crop per action; fixed scale; natural motion retained',
                'actions': actions}
    write(ROOT / 'runtime-layouts.json', manifest)
    write(RUNTIME / 'spritesheet-manifest.json', manifest)
    write(ROOT / 'sprite-budget-manifest.json', {
        'version': 1, 'id': 'sealed-shaft-rock-wraith', 'profile': 'boss',
        'sheets': [{'textureKey': f'enemy_sealed_shaft_rock_wraith_{name}', 'path': a['runtime'],
                    **{k: a[k] for k in ('frameWidth', 'frameHeight', 'frameCount', 'endFrame', 'footX', 'footY')}}
                   for name, a in actions.items()], 'dependencies': []})
    # Replace just the six compact layout lines in both config files, preserving
    # parallel-session changes and unrelated monster entries verbatim.
    # Read again immediately before writing so other sessions' unrelated config
    # edits during PNG encoding are not replaced by an earlier snapshot.
    write_configs(actions)
    print(f'Published complete family: {total:.2f}MiB', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('step', choices=('keys', 'interpolate', 'repair-middles', 'publish'))
    parser.add_argument('--actions', nargs='+', choices=ACTIONS, default=list(ACTIONS))
    args = parser.parse_args()
    if args.step == 'keys':
        make_keys(args.actions)
    elif args.step == 'interpolate':
        interpolate(args.actions)
    elif args.step == 'repair-middles':
        for name in args.actions:
            repair_reviewed_middles(name)
    else:
        publish()


if __name__ == '__main__':
    main()
