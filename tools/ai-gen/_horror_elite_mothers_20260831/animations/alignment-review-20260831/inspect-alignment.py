"""Requested offline size/root/contact evidence; never loads or edits game assets."""
import json
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw, ImageFont

OUT = Path(__file__).resolve().parent
ANIMATIONS = OUT.parent
REPO = ANIMATIONS.parents[3]
CONFIG = json.loads((REPO / 'data/enemy-config.json').read_text(encoding='utf-8'))
FONT = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 17)
SMALL = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 14)
ACTORS = [('stitchface-headsman', 'stitchfaceHeadsman', '缝面刽子手'),
          ('waxface-mourner', 'waxfaceMourner', '蜡面哀祷者')]
STATES = {'idle': 'idle', 'walking': 'walk', 'attacking': 'attack', 'dying': 'death'}
ZOOM = 2  # Enlarged offline diagram, not an in-game screenshot.
plate = Image.new('RGB', (1600, 870), (29, 33, 40))
draw = ImageDraw.Draw(plate)
draw.text((18, 10), '正式PNG按运行时比例还原 · 2倍离线示意 · 十字为逻辑脚点 · 绿线为139.515px身体基准', font=FONT, fill='white')
report = {'scope': 'offline PNG measurements and render-contract arithmetic only',
          'gameTestsRun': False, 'runtimeVerified': False, 'previewZoom': ZOOM, 'actors': []}


def frame(sheet, row, index):
    w, h = row['frameWidth'], row['frameHeight']
    x, y = index % row['cols'] * w, index // row['cols'] * h
    return sheet.crop((x, y, x + w, y + h))


for actor_index, (directory, key, label) in enumerate(ACTORS):
    root = ANIMATIONS / directory
    manifest = json.loads((root / 'sprite-build-v01/manifest.json').read_text(encoding='utf-8'))
    cfg = CONFIG[key]
    scale = cfg['render']['spriteSize'] / cfg['textures']['referenceCell']
    body = manifest['calibration']['preparedBodyHeightPx'] * scale
    result = {'id': key, 'runtimeScaleX': scale, 'runtimeScaleY': scale,
              'worldBodyHeight': body, 'actions': []}
    for column, row in enumerate(manifest['actions']):
        state = STATES[row['action']]
        layout = cfg['textures']['frameLayouts'][state]
        sheet = Image.open(root / row['sheet']).convert('RGBA')
        w, h = layout['frameWidth'], layout['frameHeight']
        foot_x, foot_y = layout['footX'], layout['footY']
        offset_y = (foot_y - h / 2) * scale
        # GameScene: longest-side displaySize from the entity is divided by longest frame side.
        option_size = max(w, h) * scale
        display_w, display_h = w * option_size / max(w, h), h * option_size / max(w, h)
        samples = []
        for index in range(layout['frameCount']):
            pixels = np.asarray(frame(sheet, row, index))
            ys, xs = np.nonzero(pixels[..., 3] >= 32)
            samples.append({'frame': index, 'bbox': [int(xs.min()), int(ys.min()), int(xs.max()+1), int(ys.max()+1)]})
        rec = {'state': state, 'frames': layout['frameCount'], 'frameSize': [w, h],
               'displaySize': [display_w, display_h], 'foot': [foot_x, foot_y],
               'footOffsetY': offset_y, 'worldRootError': [(foot_x-w/2)*scale, -offset_y+(foot_y-h/2)*scale],
               'durationMs': sum(layout['frameDurations']), 'sourceScale': row['sourceScale'],
               'sourceToWorldScale': row['sourceScale']*scale,
               'sourceRoundingXWorld': (row['sourceRootX']*row['sourceScale']-row['cropScaled'][0]-foot_x)*scale,
               'alpha32PerFrame': samples}
        result['actions'].append(rec)
        index = row.get('contactFrame', 0) if state == 'attack' else layout['frameCount']-1 if state == 'death' else 0
        cell = frame(sheet, row, index)
        cx, cy = column*400+200, actor_index*400+370
        draw.ellipse((cx-36.3*ZOOM, cy-18.15*ZOOM, cx+36.3*ZOOM, cy+18.15*ZOOM), outline='#6689a9', width=2)
        enlarged = cell.resize((round(w*scale*ZOOM), round(h*scale*ZOOM)), Image.Resampling.LANCZOS)
        px, py = round(cx-foot_x*scale*ZOOM), round(cy-foot_y*scale*ZOOM)
        plate.paste(enlarged, (px, py), enlarged)
        draw.line((cx-150, cy, cx+150, cy), fill='#63d9b3', width=1)
        draw.line((cx-150, cy-body*ZOOM, cx+150, cy-body*ZOOM), fill='#63d9b3', width=1)
        draw.line((cx, cy-12, cx, cy+12), fill='#ffcd70', width=2)
        draw.line((cx-12, cy, cx+12, cy), fill='#ffcd70', width=2)
        draw.text((column*400+15, actor_index*400+45), f'{label}  {state} f{index}', font=FONT, fill='white')
        draw.text((column*400+15, actor_index*400+396), f'格 {w}×{h}  世界 {display_w:.2f}×{display_h:.2f}', font=SMALL, fill='#bbc7d4')
        if state == 'attack':
            result['eventFrame'] = row['contactFrame']
            result['eventMs'] = sum(layout['frameDurations'][:row['contactFrame']])
            detail = Image.new('RGB', (w*2*3, h*2+60), (29,33,40))
            detail_draw = ImageDraw.Draw(detail)
            for panel, f in enumerate([row['contactFrame']-2,row['contactFrame'],row['contactFrame']+2]):
                tile = frame(sheet,row,f).resize((w*2,h*2),Image.Resampling.NEAREST)
                detail.paste(tile,(panel*w*2,45),tile)
                x0, y0 = panel*w*2+foot_x*2, 45+foot_y*2
                detail_draw.line((x0,45,x0,h*2+45),fill='#63d9b3')
                detail_draw.line((panel*w*2,y0,(panel+1)*w*2,y0),fill='#63d9b3')
                detail_draw.text((panel*w*2+5,8),f'f{f}  {sum(layout["frameDurations"][:f]):.1f}ms',font=FONT,fill='white')
                if key == 'stitchfaceHeadsman':
                    reach_x = x0 + cfg['basicMelee']['impactReach']/scale*2
                    detail_draw.line((reach_x,45,reach_x,h*2+45),fill='#ffb65e',width=2)
            detail.save(OUT/f'{directory}-contact.png')
    report['actors'].append(result)
plate.save(OUT/'world-scale-and-roots.png')
(OUT/'measurements.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
for actor in report['actors']:
    compact={k:v for k,v in actor.items() if k!='actions'}
    compact['actions']=[{k:v for k,v in a.items() if k!='alpha32PerFrame'} for a in actor['actions']]
    print(json.dumps(compact,ensure_ascii=False))
