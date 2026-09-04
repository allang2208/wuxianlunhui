from pathlib import Path
import json
import shutil
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
icons = ROOT/'upgrade-icons'
manifest = json.loads((icons/'manifest.json').read_text(encoding='utf8'))
labels = ['合金钻头','高速电机','晶石背架','助力矿靴','专家扩编']
font = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',20)
board = Image.new('RGB',(5*224,258),'#121a23')
draw = ImageDraw.Draw(board)
for i, entry in enumerate(manifest['icons']):
    raw = icons/'raw'/f"{entry['name']}.png"
    raw.parent.mkdir(exist_ok=True)
    shutil.copy2(entry['source'],raw)
    im = Image.open(raw).convert('RGBA')
    a = np.asarray(im.getchannel('A'))
    if a.min() == 255:
        rgb = np.asarray(im)[:,:,:3]
        dark = rgb.max(axis=2) < 24
        seeds = np.zeros(dark.shape,dtype=bool)
        seeds[0,:]=dark[0,:];seeds[-1,:]=dark[-1,:];seeds[:,0]=dark[:,0];seeds[:,-1]=dark[:,-1]
        exterior = ndimage.binary_propagation(seeds,mask=dark)
        a = np.where(exterior,0,255).astype('uint8')
        im.putalpha(Image.fromarray(a))
    crop = im.crop(im.getbbox())
    crop.thumbnail((199,199),Image.Resampling.LANCZOS)
    final = Image.new('RGBA',(209,209))
    final.paste(crop,((209-crop.width)//2,(209-crop.height)//2))
    path = REPO/'assets/ui/building-upgrades'/f"{entry['name']}.png"
    final.save(path,optimize=True)
    mirror = REPO/'assets/ui/runtime-icons/ui/building-upgrades'/path.name
    mirror.parent.mkdir(parents=True,exist_ok=True)
    final.resize((128,128),Image.Resampling.LANCZOS).save(mirror,optimize=True)
    board.paste(final,(i*224+7,5),final)
    draw.text((i*224+62,224),labels[i],font=font,fill='#deeaf5')
    entry['rawWorkspacePath'] = str(raw.relative_to(REPO)).replace('\\','/')
    entry['runtimePath'] = str(path.relative_to(REPO)).replace('\\','/')
    entry['lightweightPath'] = str(mirror.relative_to(REPO)).replace('\\','/')
board.save(icons/'upgrade-icons-contact.png')
(icons/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding='utf8')

assets = json.loads((ROOT/'runtime/asset-manifest.json').read_text(encoding='utf8'))
cfgpath = REPO/'data/hamster-mining-expert-config.json'
cfg = json.loads(cfgpath.read_text(encoding='utf8'))
cfg['animations'] = {}
for key, name in [('idle','idle'),('walk','walking'),('carryWalk','carry-walking'),('mining','mining')]:
    source = assets['actions'][name]
    definition = {k:source[k] for k in ('frameWidth','frameHeight','cols','rows','frameCount','frameRate','durationMs','footY')}
    definition['src'] = f'assets/companions/hamster_mining_expert/{name}.png'
    definition['frames'] = [0,definition['frameCount']-1]
    definition['repeat'] = 0 if key == 'mining' else -1
    if key == 'mining': definition['waitFrame'] = 0
    cfg['animations'][key] = definition
cfgpath.write_text(json.dumps(cfg,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
assets['scaleReference'] = {'config':'data/hamster-miner-config.json','referenceAlphaHeight':438,
    'referenceDisplaySize':99,'expertDisplaySize':cfg['displaySize'],
    'expectedReferenceBodyPx':438*99/512,'expectedExpertIdleBodyPx':415*.5*cfg['displaySize']/512,
    'note':'One common source scale for all actions; original foot motion retained. Excludes drill reach from size fit.'}
(ROOT/'runtime/asset-manifest.json').write_text(json.dumps(assets,ensure_ascii=False,indent=2),encoding='utf8')
# Formal-time preview at 3x display size, foot anchors from exactly the game config.
frames = []
actions = [('walk','空载移动'),('mining','电钻采矿'),('carryWalk','负重移动')]
for tick in range(120):
    canvas = Image.new('RGB',(810,370),'#283138')
    paint = ImageDraw.Draw(canvas)
    for col,(key,label) in enumerate(actions):
        d=cfg['animations'][key]
        index=tick%d['frameCount']
        sheet=Image.open(REPO/d['src']).convert('RGBA')
        w,h=d['frameWidth'],d['frameHeight']
        im=sheet.crop((index%d['cols']*w,index//d['cols']*h,index%d['cols']*w+w,index//d['cols']*h+h))
        scale=cfg['displaySize']/512*3
        im=im.resize((round(w*scale),round(h*scale)),Image.Resampling.LANCZOS)
        x=col*270+135-im.width//2;y=320-round(d['footY']*scale)
        paint.line((col*270+5,321,col*270+265,321),fill='#65858a')
        canvas.paste(im,(x,y),im)
        paint.text((col*270+85,338),label,font=font,fill='#f1f5f8')
    frames.append(canvas)
durations=[round((i+1)*1000/24/10)*10-round(i*1000/24/10)*10 for i in range(120)]
frames[0].save(ROOT/'runtime/accepted-actions.gif',save_all=True,append_images=frames[1:],duration=durations,loop=0,optimize=False,disposal=2)
frames[0].save(ROOT/'runtime/accepted-actions.png')
print('Formal animations, icons, 128px icon mirrors, configuration and previews written.')
