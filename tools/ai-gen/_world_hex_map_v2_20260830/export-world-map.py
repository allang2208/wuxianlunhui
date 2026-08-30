"""Produce the runtime atlas/layout and offline art previews from Blender PNGs."""
from pathlib import Path
from collections import Counter
import json
import math
import random
from PIL import Image, ImageDraw, ImageFont

OUT=Path(__file__).resolve().parent
REPO=OUT.parents[2]
FRAME=320
MANIFEST=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
CAM=MANIFEST['camera']
BIOMES=MANIFEST['biomes']
SEED=MANIFEST['seed']
PREVIEW=OUT/'previews'
RUNTIME=REPO/'assets/ui/world-map'
COLORS={'desert':'#887247','snow':'#bcc6ca','forest':'#36432b','ruins':'#444644','mine':'#554f43'}
FONT='C:/Windows/Fonts/msyh.ttc'


def label(draw, xy, text, size=22, fill='#c4d3da'):
    draw.text(xy,text,font=ImageFont.truetype(FONT,size),fill=fill)


def position(q,r):return math.sqrt(3)*(q+r/2),1.5*r


def main():
    PREVIEW.mkdir(exist_ok=True);RUNTIME.mkdir(parents=True,exist_ok=True)
    atlas=Image.new('RGBA',(FRAME*10,FRAME*5));tiles={};images={}
    for i,a in enumerate(MANIFEST['assets']):
        im=Image.open(OUT/a['render']).convert('RGBA').resize((FRAME,FRAME),Image.Resampling.LANCZOS)
        x,y=(i%10)*FRAME,(i//10)*FRAME
        atlas.alpha_composite(im,(x,y));images[a['key']]=im;tiles[a['key']]={'x':x,'y':y}
    atlas.save(RUNTIME/'terrain-atlas.png',optimize=True)
    layout=json.loads((OUT.parent/'_world_hex_map_20260830/world-layout.json').read_text(encoding='utf-8'))
    placed={};counts=Counter()
    for c in layout['cells']:
        q,r,b=c['q'],c['r'],c['biome'];x,y=position(q,r)
        rng=random.Random(SEED+q*7907+r*100003)
        patch=(math.sin(x*.41+y*.31)+math.sin(y*.54-x*.17))*.25+.5
        weights=([1,1,1,2,3,3,2,2,1,2] if b=='forest' else [3,3,3,1,1,1,1,.35,1,1])
        if patch<.37:weights=[w*(3 if i<3 else .35) for i,w in enumerate(weights)]
        if patch>.66:weights=[w*(.35 if i<3 else 2) for i,w in enumerate(weights)]
        neighbours=[placed.get((q+dq,r+dr)) for dq,dr in [(1,0),(-1,0),(0,1),(0,-1),(1,-1),(-1,1)]]
        for v in range(10):
            if f'{b}_{v:02d}' in neighbours:weights[v]=0
        # A mine mouth is a rare geological motif, not a repeated building/city.
        if b=='mine' and counts['mine_07']>=2:weights[7]=0
        v=rng.choices(range(10),weights=weights,k=1)[0]
        c['tile']=f'{b}_{v:02d}';placed[q,r]=c['tile'];counts[c['tile']]+=1
    data=dict(version=2,seed=SEED,coordinateSystem='pointy-top axial q,r',cameraElevationDegrees=CAM['elevationDegrees'],
        atlas=dict(path='assets/ui/world-map/terrain-atlas.png',width=atlas.width,height=atlas.height,frameSize=FRAME,
                   anchorPx=[v*FRAME/CAM['resolution'][0] for v in CAM['anchorPx']],pixelsPerWorldUnit=FRAME/CAM['orthoScale']),
        biomes={b:dict(sceneId=d['sceneId'],label=d['label'],baseColor=COLORS[b]) for b,d in BIOMES.items()},
        tiles=tiles,cells=layout['cells'],planeAnchors=layout['planeAnchors'],
        note='Visual geography only. Portal state and SceneManager remain the travel authority. No city, army, pathfinding or save-state ownership.')
    serialized=json.dumps(data,ensure_ascii=False,indent=2)+'\n'
    for destination in [OUT/'world-map-layout.json',REPO/'data/world-map-layout.json',REPO/'public/data/world-map-layout.json']:
        destination.write_text(serialized,encoding='utf-8')
    # Independent offline art composition; this is not a game screenshot.
    canvas=Image.new('RGBA',(2560,1536),'#090c0f');draw=ImageDraw.Draw(canvas)
    scale=55;sy=math.sin(math.radians(CAM['elevationDegrees']));origin=(1280,810)
    factor=scale/data['atlas']['pixelsPerWorldUnit'];size=round(FRAME*factor)
    sprites={k:im.resize((size,size),Image.Resampling.LANCZOS) for k,im in images.items()}
    def project(c):
        x,y=position(c['q'],c['r']);return origin[0]+x*scale,origin[1]-y*sy*scale
    for c in data['cells']:
        x,y=project(c)
        points=[(x+math.cos(math.radians(30+i*60))*scale,y-math.sin(math.radians(30+i*60))*scale*sy) for i in range(6)]
        draw.polygon(points,fill=COLORS[c['biome']])
    for c in sorted(data['cells'],key=lambda c:project(c)[1]):
        x,y=project(c);a=data['atlas']['anchorPx']
        canvas.alpha_composite(sprites[c['tile']],(round(x-a[0]*factor),round(y-a[1]*factor)))
    draw=ImageDraw.Draw(canvas)
    for c in data['cells']:
        x,y=project(c);points=[(x+math.cos(math.radians(30+i*60))*scale,y-math.sin(math.radians(30+i*60))*scale*sy) for i in range(6)]
        draw.line(points+[points[0]],fill=(12,19,22,100),width=1)
    label(draw,(62,36),'世界地图 · 地貌精修',36,'#f3f6f8')
    label(draw,(64,95),'305 个六边格 / 5 类位面 / 50 张独立模型渲染变体 / 固定种子与邻格去重',23)
    label(draw,(64,1453),'离线美术预览（非游戏截图） · 原生建模 → 贴图与 PBR → 渲染 → 图集',20,'#9ca8b1')
    canvas.convert('RGB').save(PREVIEW/'world-map-v2.png')
    sheet=Image.new('RGB',(2400,1430),'#090c0f');draw=ImageDraw.Draw(sheet)
    label(draw,(28,18),'五类位面 · 每类十种独立变体',32,'#f3f6f8')
    label(draw,(30,68),'随机冠形、地形起伏、植被疏密、碎石与风化细节；固定光向，无贴图镜像翻转。',20)
    for i,(key,im) in enumerate(images.items()):
        x=(i%10)*240;y=135+(i//10)*255
        tile=im.resize((240,240),Image.Resampling.LANCZOS);sheet.paste(tile,(x,y),tile)
        label(draw,(x+24,y+220),key,17)
    sheet.save(PREVIEW/'hex-variants-v2.png')
    comparison=Image.new('RGB',(1750,900),'#090c0f');draw=ImageDraw.Draw(comparison)
    label(draw,(26,16),'同源模型与材质 / 第二版',30,'#f3f6f8')
    for i,b in enumerate(BIOMES):
        for row,folder in enumerate(['whitebox','model-renders']):
            im=Image.open(OUT/folder/f'{b}_04.png').convert('RGBA').resize((350,350),Image.Resampling.LANCZOS)
            comparison.paste(im,(i*350,85+row*390),im)
        label(draw,(i*350+80,837),BIOMES[b]['label'],22)
    comparison.save(PREVIEW/'model-material-v2.png')
    MANIFEST['runtimeInstalled']=True
    MANIFEST['runtimeAtlas']={**data['atlas'],'frameCount':len(images),'rgbaBaseMiB':atlas.width*atlas.height*4/(1024**2),'fileBytes':(RUNTIME/'terrain-atlas.png').stat().st_size}
    MANIFEST['layout']={'path':'data/world-map-layout.json','cellCount':len(data['cells']),'variantUsage':dict(counts),'stableSeed':SEED,'adjacentSameTilePrevented':True}
    (OUT/'manifest.json').write_text(json.dumps(MANIFEST,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps(MANIFEST['runtimeAtlas'],ensure_ascii=False))


if __name__=='__main__':main()
