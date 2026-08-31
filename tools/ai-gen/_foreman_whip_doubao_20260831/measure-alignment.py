"""Offline source-pixel measurements only; does not load or run the game."""
from pathlib import Path
import json
import numpy as np
import cv2
from PIL import Image, ImageDraw, ImageOps

ROOT = Path(__file__).resolve().parent
GAME = ROOT.parents[2]
cfg = json.loads((GAME / 'data/enemy-config.json').read_text(encoding='utf-8'))['foremanZombie']
manifest = json.loads((ROOT / 'hybrid-manifest.json').read_text())
entries = [(name, GAME / cfg['textures'][name], 512, 512, count, 8) for name, count in [('idle',1),('walk',20),('attack',31),('howl',24),('death',14)]]
entries.append(('candidate', ROOT / 'sheets/foreman-whip-hybrid-candidate.png',manifest['frameWidth'],manifest['frameHeight'],61,6))
report = {}
contact = Image.new('RGB', (1000, len(entries) * 340), '#303740')
draw = ImageDraw.Draw(contact)
for row, (name,path,w,h,count,cols) in enumerate(entries):
    sheet = Image.open(path).convert('RGBA')
    cols = sheet.width // w
    records=[]
    for i in range(count):
        frame = sheet.crop((i%cols*w,i//cols*h,i%cols*w+w,i//cols*h+h))
        alpha = np.asarray(frame)[...,3]
        core = cv2.morphologyEx((alpha>80).astype(np.uint8), cv2.MORPH_OPEN, np.ones((9,9),np.uint8))
        n, labels, stats, cent = cv2.connectedComponentsWithStats(core,8)
        if n<2: continue
        idx = 1 + int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))
        body = labels==idx
        ys,xs=np.where(body)
        bottom=int(ys.max()+1)
        fy,fx=np.where(body & (np.indices(body.shape)[0] >= bottom-10))
        # Approximate support span is reported separately from body bbox.
        records.append({'frame':i,'bodyBBox':[int(xs.min()),int(ys.min()),int(xs.max()+1),bottom], 'bodyHeight':bottom-int(ys.min()),'bodyWidth':int(xs.max()-xs.min()+1),'footBandCenterX':float((fx.min()+fx.max()+1)/2),'footBottom':bottom})
        if i in [0,count//2,count-1]:
            col=[0,count//2,count-1].index(i)
            scale=480/512
            placed=frame.resize((round(w*scale),round(h*scale)),Image.Resampling.LANCZOS)
            # Display original runtime anchoring and provisional candidate anchoring.
            ax = manifest['footX'] if name=='candidate' else 256
            ay = manifest['footY'] if name=='candidate' else 256+cfg['render']['footOffsetY']/scale
            x=col*333+166-round(ax*scale)
            y=row*340+300-round(ay*scale)
            contact.paste(placed,(x,y),placed)
            draw.line((col*333,row*340+300,col*333+333,row*340+300),fill='#55bbcc')
            draw.line((col*333+166,row*340+25,col*333+166,row*340+315),fill='#bb9955')
            draw.text((col*333+5,row*340+320),f'{name} f{i}',fill='white')
    report[name]={'path':str(path.relative_to(GAME)),'frameWidth':w,'frameHeight':h,'frameCount':count,'records':records,
                  'bodyHeightRange':[min(r['bodyHeight'] for r in records),max(r['bodyHeight'] for r in records)],
                  'footBottomRange':[min(r['footBottom'] for r in records),max(r['footBottom'] for r in records)],
                  'footCenterRange':[min(r['footBandCenterX'] for r in records),max(r['footBandCenterX'] for r in records)]}
(ROOT/'alignment-source-measurements.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
contact.save(ROOT/'previews/alignment-before.png')
for name,value in report.items(): print(name,json.dumps({k:v for k,v in value.items() if k not in ['path','records']}), 'first=',value['records'][0])
