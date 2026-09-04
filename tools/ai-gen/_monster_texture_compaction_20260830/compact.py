"""Compact two approved actors; preserve native key poses, frame counts and clocks.

Only even (native) keys are extracted from the approved runtime snapshot. The
old odd RIFE frames are never fed back into temporal interpolation. All states
of an actor use one spatial scale and one vertical crop, keeping the render
foot offset constant through action switches. No combat parameters are owned
by this script. Run prepare -> render -> finish -> publish.
"""
from __future__ import annotations

import argparse
import copy
import json
import math
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
RIFE = REPO / 'tools/ai-gen/rife-spritesheet-interpolate.py'
SPECS = {
    'werewolfKing': {
        'family': 'werewolf_king', 'scale': .75, 'profile': 'boss', 'limitMiB': 256,
        'sourceIndex': 'tools/ai-gen/_werewolf_king_20260828/spritesheet-index.json',
        'sourceVideos': {
            'idle': 'idle-doubao-v01.mp4', 'running': 'running-doubao-v01.mp4',
            'attack': 'attacking-doubao-v01.mp4', 'pounce': 'pounce-doubao-v02-side-plane-lock.mp4',
            'howl': 'howl-doubao-v01.mp4', 'dying': 'dying-doubao-v02-fixed-scale.mp4',
        },
    },
    'coreDrillWorm': {
        'family': 'core_drill_worm', 'scale': .625, 'profile': 'specialist', 'limitMiB': 128,
        'sourceIndex': 'tools/ai-gen/_core_drill_worm_20260829/spritesheet-manifest.json',
        'sourceVideos': {
            'idle': 'idle-doubao-v01.mp4', 'crawling': 'crawling-doubao-v01.mp4',
            'grinderAttack': 'grinder-attack-doubao-v02-fixed-mouth.mp4',
            'burrowEnter': 'burrow-ambush-doubao-v01.mp4', 'burrowExit': 'burrow-ambush-doubao-v01.mp4',
            'death': 'dying-doubao-v01.mp4',
        },
    },
}
SNAPSHOT = ROOT / 'source-snapshot.json'
MANIFEST = ROOT / 'runtime-manifest.json'
BASELINE = ROOT / 'baseline-metrics.json'


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def frames_from(path, layout):
    with Image.open(path) as sheet:
        w, h = layout['frameWidth'], layout['frameHeight']
        cols = sheet.width // w
        count = layout.get('frameCount', layout.get('outputFrameCount'))
        return [sheet.crop((i % cols*w, i//cols*h, i % cols*w+w, i//cols*h+h)).convert('RGBA')
                for i in range(count)]


def pack(frames, cols):
    w, h = frames[0].size
    sheet = Image.new('RGBA', (cols*w, math.ceil(len(frames)/cols)*h))
    for i, frame in enumerate(frames):
        sheet.paste(frame, (i % cols*w, i//cols*h))
    return sheet


def resize(frame, size):
    # Premultiplied alpha avoids dark fringes from transparent RGB.
    return frame.convert('RGBa').resize(size, Image.Resampling.LANCZOS).convert('RGBA')


def prepare():
    if not SNAPSHOT.exists():
        config = read_json(REPO / 'data/enemy-config.json')
        snapshot = {key: copy.deepcopy(config[key]) for key in SPECS}
        for key, spec in SPECS.items():
            for state, layout in snapshot[key]['textures']['frameLayouts'].items():
                source = REPO / snapshot[key]['textures'][state]
                dest = ROOT / 'approved-runtime-input' / spec['family'] / source.name
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source, dest)
        write_json(SNAPSHOT, snapshot)
    snapshot = read_json(SNAPSHOT)
    for key, spec in SPECS.items():
        for state, layout in snapshot[key]['textures']['frameLayouts'].items():
            out = ROOT / 'native-keys' / spec['family'] / f'{state}.png'
            if out.exists():
                # Archived native keys are the immutable input after cleanup.
                continue
            source = ROOT / 'approved-runtime-input' / spec['family'] / Path(snapshot[key]['textures'][state]).name
            if not source.exists():
                raise FileNotFoundError(f'Restore the archived native keys or baseline PNG before preparing {key}/{state}')
            frames = frames_from(source, layout)
            size = (round(layout['frameWidth']*spec['scale']), round(layout['frameHeight']*spec['scale']))
            # These two ratios give exact integral full-cell dimensions in all twelve states.
            if size != (layout['frameWidth']*spec['scale'], layout['frameHeight']*spec['scale']):
                raise ValueError(f'Nonuniform rounding is forbidden: {key}/{state}')
            keys = [resize(frame, size) for frame in frames[::2]]
            out = ROOT / 'native-keys' / spec['family'] / f'{state}.png'
            out.parent.mkdir(parents=True, exist_ok=True)
            pack(keys, 4).save(out, compress_level=9)
            print(f'prepared {key}/{state}: {len(keys)} native keys, scale {spec["scale"]}', flush=True)


def render(only):
    snapshot = read_json(SNAPSHOT)
    for key, spec in SPECS.items():
        for state, layout in snapshot[key]['textures']['frameLayouts'].items():
            if only and only != f'{key}/{state}':
                continue
            out = ROOT / 'rife' / spec['family'] / f'{state}.png'
            report = ROOT / 'rife' / spec['family'] / f'{state}.json'
            if out.exists() and report.exists():
                print(f'reusing {key}/{state}', flush=True)
                continue
            out.parent.mkdir(parents=True, exist_ok=True)
            cmd = [sys.executable, str(RIFE), '--sheet', str(ROOT/'native-keys'/spec['family']/f'{state}.png'),
                   '--out', str(out), '--name', f'{spec["family"]}-{state}',
                   '--frame-width', str(round(layout['frameWidth']*spec['scale'])),
                   '--frame-height', str(round(layout['frameHeight']*spec['scale'])),
                   '--cols', '4', '--frame-count', str(math.ceil(layout['frameCount']/2)),
                   '--frame-rate', str((layout.get('frameRate') or 24)/2),
                   '--mode', 'loop' if layout.get('repeat') == -1 else 'one-shot', '--out-cols', '4',
                   '--preview-dir', str(ROOT/'rife'/spec['family']/'source-clock-previews'),
                   '--report', str(report), '--repair-red-outliers', '--repair-magenta-middle',
                   '--preserve-vertical-motion']
            print(f'RIFE start {key}/{state}', flush=True)
            with (out.parent/f'{state}.log').open('w', encoding='utf-8') as log:
                subprocess.run(cmd, cwd=REPO, stdout=log, stderr=subprocess.STDOUT, check=True)
            if read_json(report)['outputFrameCount'] != layout['frameCount']:
                raise ValueError(f'Frame count changed: {key}/{state}')
            print(f'RIFE finished {key}/{state}', flush=True)


def bounds(frames):
    boxes = [frame.getchannel('A').getbbox() for frame in frames]
    if any(box is None for box in boxes):
        raise ValueError('An approved action cannot contain an empty frame')
    return (min(b[0] for b in boxes), min(b[1] for b in boxes),
            max(b[2] for b in boxes), max(b[3] for b in boxes))


def optimal_cols(w, h, count):
    candidates = [(c*math.ceil(count/c), max(c*w, math.ceil(count/c)*h), c)
                  for c in range(1, count+1)
                  if c*w <= 4096 and math.ceil(count/c)*h <= 4096
                  and (c*math.ceil(count/c)-count)/(c*math.ceil(count/c)) <= .125]
    if not candidates:
        raise ValueError(f'No <=4096 layout for {count} frames of {w}x{h}')
    return min(candidates)[2]


def durations(key, state, cfg):
    layout = cfg['textures']['frameLayouts'][state]
    n = layout['frameCount']
    if key == 'werewolfKing' and state == 'pounce':
        skill = cfg['attackSkills']['pounce']
        prep = skill.get('prepareFrames', 20)
        return [skill['prepareMs']/prep]*prep + [skill['chargeMs']/(n-prep)]*(n-prep)
    if layout.get('frameDurations'):
        return layout['frameDurations']
    return [layout.get('duration', n*1000/layout.get('frameRate', 24))/n]*n


def previews(key, state, old_cfg, new_layout, new_frames, spec):
    old_layout = old_cfg['textures']['frameLayouts'][state]
    source = ROOT/'approved-runtime-input'/spec['family']/Path(old_cfg['textures'][state]).name
    if not source.exists():
        # The retained comparison GIF is historical evidence, not a build input.
        # Restore the optional baseline archive only to regenerate comparisons.
        print(f'Comparison not regenerated without archived baseline: {key}/{state}', flush=True)
        return
    original = frames_from(source, old_layout)
    old_ref = old_cfg['textures'].get('referenceCell') or old_cfg['render']['referenceCell']
    old_scale = old_cfg['render']['spriteSize']/old_ref
    new_scale = old_scale/spec['scale']
    # Normal world size, fixed common ground point, with an explicit before/after comparison.
    width = max(420, math.ceil(old_layout['frameWidth']*old_scale+32))
    height = max(340, math.ceil(old_layout['frameHeight']*old_scale+56))
    panels = []
    font = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 15)
    foot = height-30
    for i, frame in enumerate(new_frames):
        panel = Image.new('RGB', (width*2, height), '#33383d')
        draw = ImageDraw.Draw(panel)
        for col, (actor, scale, anchor) in enumerate([
                (original[i], old_scale, old_layout['footY']), (frame, new_scale, new_layout['footY'])]):
            display = resize(actor, (round(actor.width*scale), round(actor.height*scale)))
            x = col*width+(width-display.width)//2
            y = round(foot-anchor*scale)
            draw.line((col*width+8, foot, (col+1)*width-8, foot), fill='#6e858a')
            panel.paste(display, (x,y), display)
            draw.text((col*width+12, 8), f'{"BEFORE" if col == 0 else "COMPACT"} / {state} / frame {i}', font=font, fill='white')
        panels.append(panel)
    outdir = ROOT/'previews'/spec['family']
    outdir.mkdir(parents=True, exist_ok=True)
    # GIF has 10ms timing resolution. Round cumulative boundaries, not every duration independently.
    elapsed = last = 0
    delays = []
    for ms in durations(key, state, old_cfg):
        elapsed += ms
        end = round(elapsed/10)*10
        delays.append(max(10, end-last))
        last = end
    panels[0].save(outdir/f'{state}.gif', save_all=True, append_images=panels[1:],
                   duration=delays, loop=0, disposal=2, optimize=False)
    samples = sorted(set([0, len(panels)//4, len(panels)//2, len(panels)*3//4, len(panels)-1]))
    contact = Image.new('RGB', (width*2, height*len(samples)), '#33383d')
    for row, index in enumerate(samples):
        contact.paste(panels[index], (0,row*height))
    contact.save(outdir/f'{state}-comparison.png')


def finish():
    snapshot = read_json(SNAPSHOT)
    # Rebuilding staging files does not deactivate an already published layout.
    active = MANIFEST.exists() and read_json(MANIFEST).get('runtimeIntegrationActive', False)
    manifest = {'version': 1, 'assetOnly': not active, 'runtimeIntegrationActive': active,
                'pipeline': 'approved runtime native even keys -> uniform premultiplied-alpha resize -> RIFE 2x -> symmetric crop/repack',
                'archivePolicy': 'native-keys are required inputs; rife PNG/logs, runtime staging and contact sheets are reproducible caches; approved-runtime-input is an optional local comparison archive',
                'previewClock': 'source-snapshot.json at production time; live config clocks may differ',
                'sourceSnapshot': str(SNAPSHOT.relative_to(REPO)).replace('\\','/'), 'actors': {}}
    baseline = read_json(BASELINE) if BASELINE.exists() else {}
    for key, spec in SPECS.items():
        cfg = snapshot[key]
        actions = {}
        for state, old in cfg['textures']['frameLayouts'].items():
            info = read_json(ROOT/'rife'/spec['family']/f'{state}.json')
            frames = frames_from(ROOT/'rife'/spec['family']/f'{state}.png', info)
            # Retain previously approved one-frame holds, not a new loop/pose edit.
            if key == 'werewolfKing' and state == 'idle':
                frames[47] = frames[46].copy()
            if key == 'werewolfKing' and state == 'pounce':
                for index in (19,35,37):
                    frames[index] = frames[index-1].copy()
            actions[state] = frames
        common_top = min(bounds(f)[1] for f in actions.values())-2
        common_bottom = max(bounds(f)[3] for f in actions.values())+2
        total_before = total_after = disk_before = disk_after = 0
        output = {'family': spec['family'], 'profile': spec['profile'], 'scale': spec['scale'],
                  'sourceIndex': spec['sourceIndex'],
                  'commonVerticalCrop': [common_top, common_bottom], 'actions': {}}
        for state, frames in actions.items():
            old = cfg['textures']['frameLayouts'][state]
            box = bounds(frames)
            cx = frames[0].width/2
            radius = math.ceil(max(cx-box[0], box[2]-cx)+2)
            crop = (int(cx-radius), common_top, int(cx+radius), common_bottom)
            cropped = [frame.crop(crop) for frame in frames]
            w,h = cropped[0].size
            cols = optimal_cols(w,h,len(frames))
            layout = copy.deepcopy(old)
            layout.update(frameWidth=w, frameHeight=h, columns=cols, rows=math.ceil(len(frames)/cols),
                          footY=old['footY']*spec['scale']-common_top)
            path = ROOT/'runtime'/spec['family']/Path(cfg['textures'][state]).name
            path.parent.mkdir(parents=True, exist_ok=True)
            sheet = pack(cropped,cols)
            sheet.save(path, compress_level=9)
            source = ROOT/'approved-runtime-input'/spec['family']/path.name
            if source.exists():
                with Image.open(source) as original:
                    before_bytes = original.width*original.height*4
                before_disk = source.stat().st_size
            else:
                before_bytes = baseline[key][state]['rgbaBytes']
                before_disk = baseline[key][state]['pngBytes']
            after_bytes = sheet.width*sheet.height*4
            total_before += before_bytes; total_after += after_bytes
            disk_before += before_disk; disk_after += path.stat().st_size
            texture_state = {'grinderAttack':'grinder_attack', 'burrowEnter':'burrow_enter',
                             'burrowExit':'burrow_exit'}.get(state,state)
            output['actions'][state] = {'layout': layout, 'crop': list(crop),
                'nativeInput': str((ROOT/'native-keys'/spec['family']/f'{state}.png').relative_to(REPO)).replace('\\','/'),
                'sourceVideo': str(Path(spec['sourceIndex']).parent/'videos'/spec['sourceVideos'][state]).replace('\\','/'),
                'sourceNativeIndices': list(range(0, old['frameCount'], 2)),
                'textureKey': f'enemy_{spec["family"]}_{texture_state}', 'runtimePath': cfg['textures'][state],
                'builtPath': str(path.relative_to(REPO)).replace('\\','/'),
                'rgbaBeforeBytes': before_bytes, 'rgbaAfterBytes': after_bytes,
                'preview': str((ROOT/'previews'/spec['family']/f'{state}.gif').relative_to(REPO)).replace('\\','/')}
            previews(key,state,cfg,layout,cropped,spec)
            print(f'packed {key}/{state}: {sheet.width}x{sheet.height}, {after_bytes/1048576:.2f} MiB', flush=True)
        if total_after/1048576 > spec['limitMiB']:
            raise ValueError(f'{key} exceeds its production review limit; do not publish')
        output.update(rgbaBeforeBytes=total_before, rgbaAfterBytes=total_after,
                      diskBeforeBytes=disk_before, diskAfterBytes=disk_after)
        manifest['actors'][key] = output
        write_json(ROOT/f'{spec["family"]}-budget.json', {
            'version': 1, 'id': key, 'profile': spec['profile'], 'sheets': [
                {'textureKey': a['textureKey'], 'path': a['runtimePath'],
                 'frameWidth': a['layout']['frameWidth'], 'frameHeight': a['layout']['frameHeight'],
                 'frameCount': a['layout']['frameCount'], 'endFrame': a['layout']['frameCount']-1,
                 'footX': a['layout']['frameWidth']/2, 'footY': a['layout']['footY']}
                for a in output['actions'].values()]})
        print(f'TOTAL {key}: {total_before/1048576:.2f} -> {total_after/1048576:.2f} MiB', flush=True)
    write_json(MANIFEST,manifest)


def publish():
    manifest = read_json(MANIFEST)
    snapshot = read_json(SNAPSHOT)
    # Prepare both config texts before replacing any image. Read fresh so unrelated
    # parallel edits, including combat tuning, are not overwritten by the snapshot.
    updates = []
    decoder = json.JSONDecoder()
    geometry = ('frameWidth','frameHeight','columns','rows','footY')
    for config_path in [REPO/'data/enemy-config.json', REPO/'public/data/enemy-config.json']:
        with config_path.open('r',encoding='utf-8',newline='') as handle:
            text = handle.read()
        original_text = text
        newline = '\r\n' if '\r\n' in text else '\n'
        for key, actor in manifest['actors'].items():
            match = re.search(r'^  "'+re.escape(key)+r'":\s*',text,re.M)
            start = match.end()
            live, length = decoder.raw_decode(text[start:])
            old_cfg = snapshot[key]
            for state, data in actor['actions'].items():
                old = old_cfg['textures']['frameLayouts'][state]
                current = live['textures']['frameLayouts'][state]
                if live['textures'][state] != old_cfg['textures'][state]:
                    raise ValueError(f'Parallel asset path changed: {key}/{state}')
                if any(current.get(field) not in (old.get(field),data['layout'].get(field)) for field in geometry):
                    raise ValueError(f'Parallel geometry changed: {key}/{state}')
                for field in geometry:
                    current[field] = data['layout'][field]
            if key == 'werewolfKing':
                live['textures']['referenceCell'] = old_cfg['textures']['referenceCell']*actor['scale']
            else:
                live['render']['referenceCell'] = old_cfg['render']['referenceCell']*actor['scale']
                idle = live['textures']['frameLayouts']['idle']
                live['render']['footOffsetY'] = (idle['footY']-idle['frameHeight']/2)*live['render']['spriteSize']/live['render']['referenceCell']
            rendered = json.dumps(live,ensure_ascii=False,indent=2).replace('\n','\n  ')
            if newline != '\n': rendered = rendered.replace('\n',newline)
            text = text[:start]+rendered+text[start+length:]
        updates.append((config_path,original_text,text))
    for path,original_text,_ in updates:
        with path.open('r',encoding='utf-8',newline='') as handle:
            if handle.read() != original_text:
                raise ValueError(f'Config edited concurrently; retry publication: {path}')
    for actor in manifest['actors'].values():
        for action in actor['actions'].values():
            dest = REPO/action['runtimePath']
            temporary = dest.with_suffix('.compacting.tmp')
            shutil.copy2(REPO/action['builtPath'], temporary)
            os.replace(temporary,dest)
    for path,_,text in updates:
        temporary = path.with_suffix('.compacting.tmp')
        with temporary.open('w',encoding='utf-8',newline='') as handle: handle.write(text)
        os.replace(temporary,path)
    manifest.update(assetOnly=False,runtimeIntegrationActive=True)
    write_json(MANIFEST,manifest)
    print('Published only two actors and their texture geometry; combat fields preserved.',flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('step',choices=['prepare','render','finish','publish'])
    parser.add_argument('--only')
    args = parser.parse_args()
    {'prepare':prepare, 'render':lambda:render(args.only), 'finish':finish, 'publish':publish}[args.step]()
