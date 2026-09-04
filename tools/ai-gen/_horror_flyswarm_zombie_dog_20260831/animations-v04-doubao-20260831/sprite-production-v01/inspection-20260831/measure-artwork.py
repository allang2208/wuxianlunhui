"""Read sprite pixels/config to document scale, anchors and bite poses; no game execution."""
from pathlib import Path
import json
import math
import shutil
import numpy as np
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent
PROD = ROOT.parent
REPO = PROD.parents[4]
CFG = json.loads((REPO / 'data/enemy-config.json').read_text(encoding='utf-8'))['zombieDog']
COMPOSITION = json.loads((PROD / 'composition.json').read_text(encoding='utf-8'))
SCALE = CFG['render']['spriteSize'] / CFG['textures']['referenceCell']
for relative in ('src/entities/enemy-types.js', 'data/enemy-config.json', 'public/data/enemy-config.json', 'assets/enemies/zombie_dog/v3/manifest.json'):
    dest = ROOT / 'before' / relative
    dest.parent.mkdir(parents=True, exist_ok=True)
    if not dest.exists():
        shutil.copy2(REPO / relative, dest)


def cells(state):
    layout = CFG['textures']['frameLayouts'][state]
    w, h, cols = layout['frameWidth'], layout['frameHeight'], layout['columns']
    sheet = Image.open(REPO / CFG['textures'][state]).convert('RGBA')
    return [sheet.crop((i % cols*w, i//cols*h, i%cols*w+w, i//cols*h+h)) for i in range(layout['frameCount'])], layout, sheet.size


def tile(state, index, cell, layout, reach=None, mirror=False):
    im = Image.new('RGBA', (440, 290), (32, 37, 43, 255))
    draw = ImageDraw.Draw(im)
    draw.text((10, 10), f'{state} f{index}' + (' LEFT' if mirror else ' RIGHT'), fill='white')
    origin_x, origin_y = 220, 228
    draw.line((5, origin_y, 435, origin_y), fill=(65, 72, 80))
    visual = cell.resize((round(cell.width*SCALE*2), round(cell.height*SCALE*2)), Image.Resampling.LANCZOS)
    anchor_x = layout['anchorX']*SCALE*2
    if mirror:
        visual = visual.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        anchor_x = visual.width-anchor_x
    im.alpha_composite(visual, (round(origin_x-anchor_x), round(origin_y-layout['footY']*SCALE*2)))
    draw = ImageDraw.Draw(im)
    draw.ellipse((origin_x-3, origin_y-3, origin_x+3, origin_y+3), fill=(100, 220, 210))
    if reach is not None:
        endpoint = origin_x + (1 if not mirror else -1)*reach*2
        draw.line((endpoint, 32, endpoint, origin_y+15), fill=(250, 181, 85), width=1)
        draw.text((10, 30), f'muzzle x={reach:.3f}px; ground origin=cross', fill=(250, 181, 85))
    return im.convert('RGB')


report = {'kind':'Static artwork/config measurements; not a game or runtime test', 'pixelScaleXY':[SCALE,SCALE], 'actions':{}}
selected=[]
for state in ('idle','run','attack','death'):
    frames, layout, size = cells(state)
    job=next(j for j in COMPOSITION['jobs'] if j['action']=={'run':'running','death':'dying'}.get(state,state))
    crop = job['crop']
    anchor_source = [layout['anchorX']+crop[0],layout['footY']+crop[1]]
    boxes = [frame.getchannel('A').getbbox() for frame in frames]
    edges = [min(b[0],b[1],layout['frameWidth']-b[2],layout['frameHeight']-b[3]) for b in boxes]
    report['actions'][state] = dict(frameCount=len(frames), sheetSize=size,
        frameSize=[layout['frameWidth'],layout['frameHeight']],
        displayFrameSize=[layout['frameWidth']*SCALE,layout['frameHeight']*SCALE],
        scaleX=SCALE,scaleY=SCALE,sourceSpaceAnchor=anchor_source,
        originDriftFromIdle=None, minimumTransparentBorderPx=min(edges),
        frozenAnchorCorrectionX=(layout['frameWidth']/2-layout['anchorX'])*SCALE)
    first=Image.open(PROD/'cutouts'/job['action']/'f000.png')
    report['actions'][state]['sourceNeutralPoseAlphaBox']=first.getchannel('A').getbbox()
    for index in sorted({0,len(frames)//3,len(frames)*2//3,len(frames)-1}):
        selected.append(tile(state,index,frames[index],layout))
reference=report['actions']['idle']['sourceSpaceAnchor']
for action in report['actions'].values():
    action['originDriftFromIdle']=[round((a-b)*SCALE,9) for a,b in zip(action['sourceSpaceAnchor'],reference)]
board=Image.new('RGB',(1760,1160))
for i,im in enumerate(selected):
    board.paste(im,(i%4*440,i//4*290))
board.save(ROOT/'all-actions-fixed-origin.png')
frames, layout, _=cells('attack')
starts=[0]
for ms in layout['frameDurations'][:-1]: starts.append(starts[-1]+ms)
mouth=[]
for index, frame in enumerate(frames):
    alpha=np.asarray(frame)[...,3]
    # In this brief bite interval the muzzle, not the paw, is the rightmost
    # opaque feature above the fixed foot plane. Exclude the ground paw band.
    yy,xx=np.nonzero(alpha[:math.floor(layout['footY']-18)]>128)
    x=int(xx.max())
    mouth.append(dict(frame=index, timeMs=round(starts[index],6), durationMs=layout['frameDurations'][index],
        muzzleForwardPx=round((x-layout['anchorX'])*SCALE,6)))
report['attackFrames']=mouth
report['configuredTimeline']=CFG['basicMelee']['timeline']
report['contactWindow']=mouth[40:53]
board=Image.new('RGB',(1760,1160))
for slot,index in enumerate(range(36,52)):
    board.paste(tile('attack',index,frames[index],layout,mouth[index]['muzzleForwardPx']), (slot%4*440,slot//4*290))
board.save(ROOT/'bite-window-fixed-origin.png')
board=Image.new('RGB',(880,580))
for slot,(state,index) in enumerate((('idle',0),('idle',0),('attack',44),('attack',44))):
    fs,l,_=cells(state)
    board.paste(tile(state,index,fs[index],l,mirror=slot%2==1),(slot%2*440,slot//2*290))
board.save(ROOT/'left-right-fixed-origin.png')
(ROOT/'artwork-measurements.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:v for k,v in report.items() if k!='attackFrames'},ensure_ascii=False,indent=2))
