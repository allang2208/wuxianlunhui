"""Read existing gaoler assets and author ground anchors; never repaint sprite pixels."""
from pathlib import Path
import json
import math
import sys
import av
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = ROOT.parent / '_abandoned_mine_lords_20260829/broken_cable_gaoler'
CONFIG = json.loads((REPO / 'data/enemy-config.json').read_text(encoding='utf-8'))['brokenCableGaoler']
INDEX = json.loads((SOURCE / 'task-index.json').read_text(encoding='utf-8'))
ACTIONS = ('chainSweep', 'hookWinch', 'cageSlam')


def cells(state):
    layout = CONFIG['textures']['frameLayouts'][state]
    sheet = Image.open(REPO / CONFIG['textures'][state]).convert('RGBA')
    w, h, cols = (layout[k] for k in ('frameWidth', 'frameHeight', 'columns'))
    return [sheet.crop((i % cols*w, i // cols*h, i % cols*w+w, i // cols*h+h))
            for i in range(layout['frameCount'])], layout


def references():
    snapshots = ROOT / 'before-config.json'
    if not snapshots.exists():
        snapshots.write_text(json.dumps(CONFIG, ensure_ascii=False, indent=2), encoding='utf-8')
        (ROOT / 'before-code.js').write_bytes((REPO / 'src/entities/enemy-types/broken-cable-gaoler.js').read_bytes())
    for state in ('idle', 'walking', *ACTIONS, 'dying'):
        frames, layout = cells(state)
        scale = CONFIG['render']['bodyDisplayHeight'] / layout['authoredBodyHeight']
        chosen = list(range(0, len(frames), 8))
        if chosen[-1] != len(frames)-1: chosen.append(len(frames)-1)
        canvas = Image.new('RGB', (500*4, 360*math.ceil(len(chosen)/4)), '#78828d')
        draw = ImageDraw.Draw(canvas)
        for n, i in enumerate(chosen):
            ox, oy = n%4*500, n//4*360
            sprite = frames[i].resize((round(layout['frameWidth']*scale), round(layout['frameHeight']*scale)), Image.Resampling.LANCZOS)
            x, y = round(250-layout['frameWidth']/2*scale), round(310-layout['footY']*scale)
            cell = Image.new('RGB', (500,360), '#78828d')
            cell.paste(sprite,(x,y),sprite)
            d = ImageDraw.Draw(cell)
            d.line((0,310,500,310),fill='#e6c859')
            d.line((250,0,250,340),fill='#e6c859')
            d.text((8,340),f'{state} f{i}; source center x={layout["frameWidth"]/2}',fill='white')
            canvas.paste(cell,(ox,oy))
        canvas.save(ROOT / f'{state}-body-reference.png')
    canvas = Image.new('RGB',(512*4,340*3),'#78828d')
    for row,state in enumerate(ACTIONS):
        path = SOURCE / INDEX['actions'][state]['sourceVideo']
        wanted = [0,36,76,104 if state == 'hookWinch' else 108]
        with av.open(str(path)) as video:
            for index, frame in enumerate(video.decode(video=0)):
                if index not in wanted: continue
                pic = frame.to_image()
                pic.thumbnail((512,310))
                x,y = wanted.index(index)*512,row*340
                canvas.paste(pic,(x,y))
                ImageDraw.Draw(canvas).text((x+8,y+316),f'{state}: original video f{index}',fill='white')
    canvas.save(ROOT / 'original-video-reference.png')


def support_foot(frame, layout):
    # Only the planted rear boot sole, never torso/cage/cable alpha centroids.
    alpha = np.asarray(frame)[...,3]
    floor = layout['footY']
    center = layout['frameWidth']/2
    left, right = max(0,round(center-230)), min(frame.width,round(center+35))
    lower = alpha[max(0,floor-60):floor+2,left:right] > 160
    rows = np.flatnonzero(lower.any(axis=1))
    if not len(rows): raise ValueError('No support boot in body-only ground window')
    sole_y = max(0,floor-60)+int(rows[-1])+1
    count = (alpha[max(0,sole_y-10):sole_y] > 160).sum(axis=0)
    occupied = np.flatnonzero(count >= 3)
    groups = np.split(occupied, np.where(np.diff(occupied) > 1)[0]+1)
    groups = [g for g in groups if len(g) >= 7 and center-230 <= (g[0]+g[-1])/2 <= center+35]
    if not groups: raise ValueError('No support boot in authored ground band')
    boot = min(groups, key=lambda g:g[0])
    return round((int(boot[0])+int(boot[-1]))/2, 2), sole_y


def author():
    idle, idle_layout = cells('idle')
    reference_scale = CONFIG['render']['bodyDisplayHeight']/idle_layout['authoredBodyHeight']
    ref_x, ref_y = support_foot(idle[0],idle_layout)
    reference_offset = (ref_x-idle_layout['frameWidth']/2)*reference_scale
    reference_y = (ref_y-idle_layout['footY'])*reference_scale
    result = {'reference': 'idle frame 0 support boot, same world foot offset',
              'referenceBootOffsetX': reference_offset, 'actions': {}}
    for state in ACTIONS:
        frames, layout = cells(state)
        scale = CONFIG['render']['bodyDisplayHeight']/layout['authoredBodyHeight']
        boots = []
        for index, frame in enumerate(frames):
            try: boots.append(support_foot(frame,layout))
            except ValueError as error:
                frame.save(ROOT/f'{state}-anchor-reference-f{index}.png')
                raise ValueError(f'{state} frame {index}: {error}') from error
        anchors = [round(x-reference_offset/scale,3) for x,y in boots]
        foot_y = [round(y-reference_y/scale,3) for x,y in boots]
        result['actions'][state] = {'anchorXByFrame': anchors,
            'footYByFrame': foot_y, 'supportBootByFrame': boots,
            'maxWorldCorrection': round(max(abs(x-layout['frameWidth']/2)*scale for x in anchors),2),
            'oldSupportFootTravelX': round((max(x for x,y in boots)-min(x for x,y in boots))*scale,2)}
        # Full motion, not a game capture. Both rows use the registered action duration.
        rendered = []
        durations = [round((i+1)*layout['duration']/len(frames)/10)*10-round(i*layout['duration']/len(frames)/10)*10 for i in range(len(frames))]
        for i, frame in enumerate(frames):
            canvas = Image.new('RGB',(1100,740),'#667480')
            draw = ImageDraw.Draw(canvas)
            sprite = frame.resize((round(layout['frameWidth']*scale),round(layout['frameHeight']*scale)),Image.Resampling.LANCZOS)
            for row,anchor in enumerate((layout['frameWidth']/2,anchors[i])):
                gx, gy = 320, row*370+315
                fy = layout['footY'] if row == 0 else foot_y[i]
                canvas.paste(sprite,(round(gx-anchor*scale),round(gy-fy*scale)),sprite)
                draw.line((0,gy,1100,gy),fill='#ddca73')
                draw.line((gx, row*370,gx,gy+10),fill='#ddca73')
                draw.text((12,row*370+344),f'{state} f{i}: '+('BEFORE' if row == 0 else 'FIXED SUPPORT FOOT / authored preview'),fill='white')
            rendered.append(canvas)
        rendered[0].save(ROOT/f'{state}-comparison.gif',save_all=True,append_images=rendered[1:],duration=durations,loop=0,disposal=2)
        chosen = list(range(0,len(frames),4))
        if chosen[-1] != len(frames)-1: chosen.append(len(frames)-1)
        contact = Image.new('RGB',(4*500,360*math.ceil(len(chosen)/4)),'#667480')
        for n,i in enumerate(chosen):
            contact.paste(rendered[i].crop((70,370,570,730)),(n%4*500,n//4*360))
        contact.save(ROOT/f'{state}-anchored-contact.png')
    (ROOT/'anchors.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({state:{k:v for k,v in data.items() if not isinstance(v,list)} for state,data in result['actions'].items()}))


def install():
    anchors = json.loads((ROOT/'anchors.json').read_text(encoding='utf-8'))['actions']
    calibration = {'method': 'support boot sole only; preserve idle f0 world offset; no pixel resampling', 'actions': {}}
    for state,record in anchors.items():
        layout = CONFIG['textures']['frameLayouts'][state]
        calibration['actions'][state] = {key:layout[key] for key in ('frameWidth','frameHeight','frameCount')}
        calibration['actions'][state].update({key:record[key] for key in ('anchorXByFrame','footYByFrame')})
    (SOURCE/'runtime-anchors.json').write_text(json.dumps(calibration,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    for path in (REPO/'data/enemy-config.json',REPO/'public/data/enemy-config.json'):
        text = path.read_bytes().decode('utf-8')
        start = text.index('{',text.index('"brokenCableGaoler":'))
        value,length = json.JSONDecoder().raw_decode(text[start:])
        for state,record in anchors.items():
            value['textures']['frameLayouts'][state]['anchorXByFrame'] = record['anchorXByFrame']
            value['textures']['frameLayouts'][state]['footYByFrame'] = record['footYByFrame']
        newline = '\r\n' if '\r\n' in text else '\n'
        rendered = json.dumps(value,ensure_ascii=False,indent=2).replace('\n',newline+'  ')
        path.write_bytes((text[:start]+rendered+text[start+length:]).encode('utf-8'))
    for path in (SOURCE/'runtime-layouts.json',REPO/'assets/enemies/broken_cable_gaoler/spritesheet-manifest.json'):
        value = json.loads(path.read_text(encoding='utf-8'))
        value['anchorCalibration'] = 'runtime-anchors.json in the source production folder'
        for state,record in anchors.items():
            for key in ('anchorXByFrame','footYByFrame'): value['actions'][state][key] = record[key]
        path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    index_path = SOURCE/'task-index.json'
    value = json.loads(index_path.read_text(encoding='utf-8'))
    value['runtimeAnchorCalibration'] = 'runtime-anchors.json'
    value['runtimeAnimationFixNotes'] = '../../../../docs/broken-cable-gaoler-attack-fix-2026-08-30.md'
    index_path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')


if __name__ == '__main__':
    if '--author' in sys.argv: author()
    elif '--install' in sys.argv: install()
    else: references()
