"""Package R21 assets and change only current hub visual fields, per config."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

BASE=Path(__file__).resolve().parent;REPO=BASE.parents[3];OUT=BASE/'delivery_r21'
DEST=REPO/'assets/terrain/main_hub_v21';DEST.mkdir(parents=True,exist_ok=True)
camera=json.loads((OUT/'camera-manifest.json').read_text(encoding='utf-8'))
manifest=json.loads((OUT/'layer-manifest.json').read_text(encoding='utf-8'))
pp=camera['worldPerPixel'];ox,oy=camera['originPixel']
hub=json.loads((REPO/'data/game-config.json').read_text(encoding='utf-8'))['scenes']['mainHub']
depths={entry['id']:entry['depthY'] for entry in hub['architecture']['occluders']}
remaining=np.ones((1728,3072),dtype=np.float32);records=[]
for entry in sorted(manifest['layers'],key=lambda item:depths.get(item['id'],-1e9),reverse=True):
 name=entry['id'];source=Image.open(OUT/'raw'/entry['file']).convert('RGBA');bbox=source.getchannel('A').getbbox()
 if bbox is None:raise ValueError('Empty semantic layer: '+name)
 pixels=np.array(source.crop(bbox));left,top=entry['canvasCrop'][:2]
 bounds=[bbox[0]+left,bbox[1]+top,bbox[2]+left,bbox[3]+top]
 available=remaining[bounds[1]:bounds[3],bounds[0]:bounds[2]];coverage=pixels[:,:,3].astype(np.float32)/255
 opacity=np.divide(coverage,available,out=np.zeros_like(coverage),where=available>1e-6)
 pixels[:,:,3]=np.rint(np.clip(opacity,0,1)*255).astype(np.uint8);available[:]=np.maximum(0,available-coverage)
 pixels[pixels[:,:,3]==0,:3]=0;Image.fromarray(pixels).save(DEST/(name+'.png'))
 visual=dict(textureKey='main_hub_v21_'+name,assetPath='assets/terrain/main_hub_v21/'+name+'.png',
  screenCenterX=round(6144+((bounds[0]+bounds[2])/2-ox)*pp,6),screenCenterY=round(4096+((bounds[1]+bounds[3])/2-oy)*pp,6),
  displayW=round((bounds[2]-bounds[0])*pp,6),displayH=round((bounds[3]-bounds[1])*pp,6))
 records.append(dict(id=name,visual=visual,canvasBounds=bounds,source='raw/'+entry['file']))
paving=Image.open(OUT/'raw/plaza-periodic-projected.png').convert('RGB');paving.save(DEST/'plaza.png')

# Preserve unrelated formatting and parallel-session edits outside these values.
decoder=json.JSONDecoder()
def value_span(text,path,start=0):
 while text[start].isspace():start+=1
 if text[start]!='{':raise ValueError('Expected object')
 pos=start+1
 while True:
  while text[pos].isspace() or text[pos]==',':pos+=1
  if text[pos]=='}':raise KeyError(path)
  key,pos=decoder.raw_decode(text,pos)
  while text[pos].isspace():pos+=1
  if text[pos]!=':':raise ValueError('Expected colon')
  pos+=1
  while text[pos].isspace():pos+=1
  _,end=decoder.raw_decode(text,pos)
  if key==path[0]:return (pos,end) if len(path)==1 else value_span(text,path[1:],pos)
  pos=end
def replace(text,path,value):
 start,end=value_span(text,path);line=text[text.rfind('\n',0,start)+1:start];indent=len(line)-len(line.lstrip())
 newline='\r\n' if '\r\n' in text else '\n'
 rendered=json.dumps(value,ensure_ascii=False,indent=2).replace('\n',newline+' '*indent)
 return text[:start]+rendered+text[end:]

visuals={entry['id']:entry['visual'] for entry in records}
for relative in ('data/game-config.json','public/data/game-config.json'):
 path=REPO/relative
 with path.open(encoding='utf-8-sig',newline='') as handle:text=handle.read()
 hub=json.loads(text)['scenes']['mainHub'];arch=hub['architecture']
 before=dict(version=arch['version'],comment=arch.get('comment'),underlay=arch['underlay'],occluders=arch['occluders'],floor=hub['floor'])
 snapshot=OUT/('before-'+relative.replace('/','-'))
 if not snapshot.exists():snapshot.write_text(json.dumps(before,ensure_ascii=False,indent=2),encoding='utf-8')
 under={**arch['underlay'],**visuals['terrace']};under['x']=under.pop('screenCenterX');under['y']=under.pop('screenCenterY')
 occluders=[{**entry,**visuals[entry['id']]} for entry in arch['occluders']]
 floor={**hub['floor'],'tiles':['main_hub_v21_plaza'],'continuous':True,'textureScaleY':1,'glow':False,'overlapX':0,'overlapY':0,
  'textureSources':[dict(key='main_hub_v21_plaza',path='assets/terrain/main_hub_v21/plaza.png')]}
 changes=[(['architecture','version'],21),(['architecture','comment'],'R21：R20微抛光白石推广到全场；8格周期、逐块矿物纹方向和光泽差异，均匀天空反光避免重复亮斑。保留R19站位、R16通行范围及独立碰撞/遮挡深度。'),
  (['architecture','underlay'],under),(['architecture','occluders'],occluders),(['floor'],floor)]
 for keys,value in changes:text=replace(text,['scenes','mainHub']+keys,value)
 with path.open('w',encoding='utf-8',newline='') as handle:handle.write(text)
(OUT/'asset-manifest.json').write_text(json.dumps(dict(stage='development-assets-integrated',sourceModel='main-hub-r21-stone.blend',
 materialSource='R20 native materials; existing RTX 5080 seed 906514',worldPerPixel=pp,originPixel=[ox,oy],assets=records,
 plaza=dict(path='assets/terrain/main_hub_v21/plaza.png',size=list(paving.size),textureScaleY=1,worldPhase=[0,0],alreadyProjected=True),
 preserved=['R19 NPC anchors','walkableArea','collisionProxies','pieces','depthY','playerSpawn','backdrop'],
 runtimeValidation='not-run'),ensure_ascii=False,indent=2),encoding='utf-8')
