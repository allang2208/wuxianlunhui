"""Selected recruitment art: existing building key tools plus offline previews."""
import argparse
from datetime import datetime
import json
from pathlib import Path
import subprocess
import sys
import numpy as np
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent
REPO=HERE.parents[2]
parser=argparse.ArgumentParser()
parser.add_argument('config',type=Path)
args=parser.parse_args()
config_path=args.config if args.config.is_absolute() else REPO/args.config
c=json.loads(config_path.read_text(encoding='utf-8'))
out=config_path.parent
source=REPO/c['source']
keyed=out/'keyed.png'
spatial=out/'spatial.png'
full=out/'body_full.png'
final=out/'transparent.png'
commands=[]


def run(tool,*parts):
    command=[sys.executable,str(REPO/'tools/ai-gen'/tool),*map(str,parts)]
    commands.append([tool,*map(str,parts)])
    subprocess.run(command,cwd=REPO,check=True)


raw=Image.open(source).convert('RGB')
w,h=raw.size
run('key-world122-building-body.py',source,keyed,
    '--soft-key-inner',c['softInner'],'--soft-key-outer',c['softOuter'])
parts=['--display-width',w,'--padding',max(w,h)]
for polygon in c.get('clearExteriorPolygons',[]):
    parts+=['--clear-alpha-polygon',';'.join(f'{x},{y}' for x,y in polygon)]
run('finalize-building-runtime.py',keyed,spatial,*parts,'--metadata',out/'spatial-metadata.json')
spill_source=spatial
pinhole_records=[]
if c.get('opaquePinholes'):
    pixels=np.array(Image.open(spatial).convert('RGBA'))
    for x,y in c['opaquePinholes']:
        before=pixels[y,x].copy()
        neighbors=pixels[max(0,y-1):min(h,y+2),max(0,x-1):min(w,x+2)]
        opaque=neighbors[neighbors[...,3]==255,:3]
        if not len(opaque):
            raise ValueError(f'No opaque neighbor for documented single-pixel repair at {x},{y}')
        pixels[y,x,:3]=np.median(opaque,axis=0).astype('uint8')
        pixels[y,x,3]=255
        pinhole_records.append({'xy':[x,y],'beforeRgba':before.tolist(),'afterRgba':pixels[y,x].tolist()})
    spill_source=out/'spatial_pinholes.png'
    Image.fromarray(pixels).save(spill_source)
local_spill_rects=c.get('localSpillRects',[])
edge_output=out/'body_edge_clean.png' if local_spill_rects else full
run('repair-local-green-spill.py',spill_source,edge_output,
    '--rect',f'0,0,{w},{h}','--min-green',c.get('edgeMinGreen',30),
    '--green-margin',c.get('edgeGreenMargin',15),'--min-alpha',1,
    '--max-edge-distance',c.get('edgeDistance',3))
local_source=edge_output
for i,rect in enumerate(local_spill_rects):
    local_output=full if i==len(local_spill_rects)-1 else out/f'local_spill_{i+1:02d}.png'
    run('repair-local-green-spill.py',local_source,local_output,
        '--rect',','.join(map(str,rect)),'--min-green',c.get('edgeMinGreen',30),
        '--green-margin',c.get('edgeGreenMargin',15),'--min-alpha',1)
    local_source=local_output
full_img=Image.open(full).convert('RGBA')
bbox=full_img.getchannel('A').getbbox()
native_width=min(w,bbox[2]+4)-max(0,bbox[0]-4)
run('finalize-building-runtime.py',full,final,
    '--display-width',native_width,'--padding',4,'--preserve-alpha-exact',
    '--nearest-opaque-edge-rgb','--metadata',out/'crop-metadata.json')


def checker(im):
    yy,xx=np.indices((im.height,im.width))
    bg=np.where((((xx//24)+(yy//24))%2)[...,None],
                 [172,178,181],[218,221,221]).astype('uint8')
    canvas=Image.fromarray(bg).convert('RGBA')
    canvas.alpha_composite(im)
    return canvas.convert('RGB')


im=Image.open(final).convert('RGBA')
checker(im).save(out/'preview.png')
board=Image.new('RGB',(1440,1260),'#e9ede7')
d=ImageDraw.Draw(board)
font=lambda n:ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',n)
for i,(label,color) in enumerate([('黑底','#080808'),('灰底','#666666'),('白底','#ffffff'),('Alpha',None)]):
    x,y=(i%2)*720,(i//2)*630
    d.text((x+18,y+14),c['label']+' · '+label,font=font(23),fill='#34443b')
    if color is None:
        p=im.getchannel('A').convert('RGB')
    else:
        p=Image.new('RGBA',im.size,color)
        p.alpha_composite(im)
        p=p.convert('RGB')
    p.thumbnail((688,568),Image.Resampling.LANCZOS)
    board.paste(p,(x+16,y+55))
board.save(out/'background_alpha_preview.png')

rgb=np.asarray(raw).astype(float)
corners=np.concatenate([rgb[:12,:12].reshape(-1,3),rgb[:12,-12:].reshape(-1,3),
                        rgb[-12:,:12].reshape(-1,3),rgb[-12:,-12:].reshape(-1,3)])
key=np.median(corners,axis=0)
data=np.asarray(full_img)
samples={}
for name,rect in c.get('materialSamples',{}).items():
    x0,y0,x1,y1=rect
    part=data[y0:y1,x0:x1]
    samples[name]={'rect':rect,'pixels':int(part.shape[0]*part.shape[1]),
        'alphaBelow255':int(np.count_nonzero(part[...,3]<255)),
        'minimumKeyDistance':float(np.linalg.norm(rgb[y0:y1,x0:x1]-key,axis=-1).min())}
result=np.asarray(im)
record={
    'recordedAt':datetime.now().astimezone().isoformat(),'source':c['source'],
    'sourceSize':[w,h],'output':final.relative_to(REPO).as_posix(),
    'outputSize':list(im.size),'outputMode':im.mode,
    'alphaExtrema':list(im.getchannel('A').getextrema()),
    'keyRgb':key.tolist(),'softInner':c['softInner'],'softOuter':c['softOuter'],
    'transparentPixelsWithDirtyRgb':int(np.count_nonzero((result[...,3]==0)&np.any(result[...,:3]!=0,axis=2))),
    'materialSamples':samples,'oldDepthUsedForAlpha':False,'removeAllGreen':False,
    'isolatedPinholesRestored':pinhole_records,
    'localSpillRects':local_spill_rects,
    'fillHoles':False,'runtimeIntegrationActive':False,
    'limitations':'Native pixel crop only; display metadata is not runtime calibration. Offline asset production and previews only, no tests/build/game validation.',
    'commands':commands,
}
(out/'production-record.json').write_text(json.dumps(record,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({k:record[k] for k in ['outputSize','keyRgb','alphaExtrema','transparentPixelsWithDirtyRgb','materialSamples']},ensure_ascii=True))
