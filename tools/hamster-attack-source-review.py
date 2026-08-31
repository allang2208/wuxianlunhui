"""Offline source-frame contact sheets; does not import or run the game."""
import json
import sys
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BEFORE = '--before' in sys.argv
EVIDENCE = ROOT / 'docs/audits/hamster-attack-tempo-2026-08-31'
SOURCE_INPUTS = json.loads((EVIDENCE/'source-frame-inputs.json').read_text(encoding='utf-8'))
OUT = EVIDENCE / ('before' if BEFORE else 'after')
OUT.mkdir(parents=True, exist_ok=True)
NAMES = ['militia', 'halberdier', 'guard', 'phalanx', 'champion', 'samurai',
         'warrior', 'ninja', 'light-cavalry', 'cavalry', 'camel-cavalry',
         'knight', 'winged-hussar', 'powered-eod-explosive-lancer', 'jaguar-warrior']
FONT = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 15)
rows = []
measurements = []
def read_config(filename):
    # Freeze historical overlays; newer/older runtime configs must not rewrite audit evidence.
    return SOURCE_INPUTS['before' if BEFORE else 'after'][filename]

for name in NAMES:
    filename = name if name == 'jaguar-warrior' else 'hamster-' + name
    cfg = read_config(filename)
    ai = cfg['ai']
    variants = ['attack_opening', 'attack_continuous'] if name == 'ninja' else ['attack']
    for key in variants:
        a = cfg['animations'][key]
        count = a['frameCount']
        contact = ai.get('attackDamageFrame', 1) - 1
        if name == 'samurai': contact = round(ai['attackContactDelayMs'] * a['frameRate'] / 1000)
        if name == 'ninja': contact = ai['openingDamageFrame' if key.endswith('opening') else 'continuousDamageFrame'] - 1
        indices = [0, max(0, contact-2), contact, min(count-1, contact+2)]
        if name in ['warrior', 'jaguar-warrior']:
            contact = ai.get('attackDamageFrame', 25 if name == 'warrior' else 14) - 1
            indices = [0,max(0,contact-2),contact,min(count-1,contact+2)]
        sheet = Image.open(ROOT / a['src']).convert('RGBA')
        row = Image.new('RGB', (2280, 285), '#20262d')
        d = ImageDraw.Draw(row)
        for j, idx in enumerate(indices):
            fw, fh = a['frameWidth'], a['frameHeight']
            col, r = idx % a['cols'], idx // a['cols']
            frame = sheet.crop((col*fw, r*fh, (col+1)*fw, (r+1)*fh))
            scale = cfg['displaySize'] / 512
            foot = cfg.get('spriteOffsetY', 0) - (fh-512)*0.4375*scale
            v = cfg.get('render', {}).get('attackVisualScale')
            if name == 'powered-eod-explosive-lancer':
                v = read_config('hamster-winged-hussar').get('render',{}).get('attackVisualScale')
            if v:
                heights = v['sourceBodyHeights']
                pos = min(len(heights)-1, idx / 2)
                lo, hi = int(pos), min(len(heights)-1, int(pos)+1)
                height = heights[lo] + (heights[hi]-heights[lo])*(pos-lo)
                scale *= min(1, v['referenceBodyHeight'] / height)
                foot = (fh/2-v['footY'])*scale
            if idx == contact:
                bbox = frame.getchannel('A').point(lambda value: 255 if value >= 32 else 0).getbbox()
                measurements.append(dict(unit=name,animation=key,frame=contact,scale=scale,
                    forwardAlphaExtent=round((bbox[2]-fw/2)*scale,2)))
            frame = frame.resize((round(fw*scale), round(fh*scale)), Image.Resampling.LANCZOS)
            ox, oy = j*570+190, 255
            row.paste(frame, (round(ox-frame.width/2), round(oy+foot-frame.height/2)), frame)
            d.line((ox, 25, ox, 280), fill='#56849c')
            d.line((j*570, oy, (j+1)*570, oy), fill='#56849c')
            reach = ai['attackRange']
            impact = ai.get('attackImpactRange',reach)
            if key == 'attack_continuous':
                reach = ai.get('continuousAttackRange',reach)
                impact = ai.get('continuousImpactRange',impact)
            d.line((ox+reach, 40, ox+reach, oy), fill='#ff8d64', width=2)
            d.line((ox+impact, 40, ox+impact, oy), fill='#89dfab', width=2)
            d.text((j*570+6, 5), f'{name} {key} f{idx}  approach {reach} / impact {impact}', font=FONT, fill='white')
        rows.append(row)
for page in range((len(rows)+3)//4):
    part = rows[page*4:page*4+4]
    img = Image.new('RGB', (2280, len(part)*285), '#20262d')
    for i, row in enumerate(part): img.paste(row, (0, i*285))
    img.save(OUT / f'melee-source-{page+1}.png')
print(f'{len(rows)} source animation rows saved to {OUT}')
print(json.dumps(measurements))
(OUT/'forward-extents.json').write_text(json.dumps(measurements,indent=2),encoding='utf-8')

cfg = read_config('hamster-ninja')
a = cfg['animations']['attack_opening']
sheet = Image.open(ROOT/a['src']).convert('RGBA')
zoom = Image.new('RGB', (6*340,340), '#30363d')
for j,idx in enumerate(range(14,20)):
    frame = sheet.crop(((idx%a['cols'])*512,(idx//a['cols'])*512,(idx%a['cols']+1)*512,(idx//a['cols']+1)*512))
    frame = frame.crop((90,150,430,490))
    zoom.paste(frame,(j*340,0),frame)
    ImageDraw.Draw(zoom).text((j*340+5,5),f'f{idx}',font=FONT,fill='white')
zoom.save(OUT/'ninja-opening-contact-detail.png')

for name, key in [('hamster-ninja', 'attack_opening'), ('hamster-ninja', 'attack_continuous'),
                  ('hamster-warrior', 'attack'), ('jaguar-warrior', 'attack'), ('hamster-phalanx', 'attack')]:
    cfg = read_config(name)
    a = cfg['animations'][key]
    sheet = Image.open(ROOT / a['src']).convert('RGBA')
    fw, fh = a['frameWidth'], a['frameHeight']
    canvas = Image.new('RGB', (1200, ((a['frameCount']+7)//8)*170), '#20262d')
    for idx in range(a['frameCount']):
        col, r = idx % a['cols'], idx // a['cols']
        frame = sheet.crop((col*fw, r*fh, (col+1)*fw, (r+1)*fh))
        frame.thumbnail((145,145), Image.Resampling.LANCZOS)
        x,y=(idx%8)*150,(idx//8)*170
        canvas.paste(frame,(x+(150-frame.width)//2,y+20),frame)
        ImageDraw.Draw(canvas).text((x+5,y+2),f'f{idx}',font=FONT,fill='white')
    canvas.save(OUT/f'{name}-{key}-all.png')
