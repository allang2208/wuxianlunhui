"""Pack refined native renders, their ground anchor and offline art previews.

No background removal, silhouette repainting, game execution or screenshot check.
Running without --install only rebuilds previews in this source folder.
"""
from pathlib import Path
import argparse
import json
import math
from PIL import Image, ImageDraw, ImageFont

OUT=Path(__file__).resolve().parent
REPO=OUT.parents[2]
FRAME=256
FONT='C:/Windows/Fonts/msyh.ttc'


def font(size):return ImageFont.truetype(FONT,size)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--install',action='store_true')
    args=parser.parse_args()
    installed=REPO/'data/world-map-army-visuals.json'
    if args.install and installed.exists() and json.loads(installed.read_text(encoding='utf-8')).get('version',1)>2:
        raise SystemExit('A newer flag version is installed; restore the user-selected source explicitly before replacing it.')
    source=json.loads((OUT/'manifest.json').read_text(encoding='utf-8'))
    layout=json.loads((REPO/'data/world-map-layout.json').read_text(encoding='utf-8'))
    if source['camera']['elevationDegrees']!=layout['cameraElevationDegrees']:
        raise SystemExit('Flag renders and terrain projection differ. Re-render before installing.')
    atlas=Image.new('RGBA',(FRAME*3,FRAME*2))
    frames={}
    sheet=Image.new('RGB',(1500,1010),'#171c20')
    d=ImageDraw.Draw(sheet)
    d.text((32,18),'世界地图 / 军团兵旗 · 材质与纹章精修',font=font(32),fill='#e6e8e6')
    d.text((32,66),'细化模型 → 纹章贴图 → 世界地图同源哑光材质 / 55° 正交渲染',font=font(17),fill='#b6bfbc')
    miniatures=[]
    for index,profile in enumerate(source['profiles']):
        key=profile['key'];column=index%3;row=index//3
        raw=Image.open(OUT/'renders'/f'{key}.png').convert('RGBA')
        tile=raw.resize((FRAME,FRAME),Image.Resampling.LANCZOS)
        atlas.alpha_composite(tile,(column*FRAME,row*FRAME))
        bbox=tile.getchannel('A').getbbox()
        frames[key]=dict(column=column,row=row,bounds=[round(v/FRAME,6) for v in bbox],label=profile['label'])
        x=24+column*494;y=114+row*442
        d.rounded_rectangle((x,y,x+474,y+420),radius=12,fill='#242b2e',outline='#465153')
        d.text((x+20,y+14),profile['label'],font=font(23),fill='#e5e8e5')
        clay=Image.open(OUT/'whitebox'/f'{key}.png').convert('RGBA').resize((215,215),Image.Resampling.LANCZOS)
        art=raw.resize((270,270),Image.Resampling.LANCZOS)
        sheet.paste(clay,(x+1,y+65),clay)
        sheet.paste(art,(x+190,y+40),art)
        d.text((x+73,y+287),'白模',font=font(16),fill='#a5afaf')
        d.text((x+289,y+287),'材质成品',font=font(16),fill='#a5afaf')
        d.line((x+18,y+322,x+456,y+322),fill='#465153')
        small=raw.resize((88,88),Image.Resampling.LANCZOS)
        sheet.paste(small,(x+15,y+326),small)
        d.text((x+121,y+346),'88px 显示尺寸',font=font(18),fill='#e5e8e5')
        d.text((x+121,y+377),profile['emblem'],font=font(16),fill='#a5afaf')
        miniatures.append(tile)
    sheet.save(OUT/'army-flags-preview.jpg',quality=94)
    meta=dict(version=2,path='assets/ui/world-map/army-flags.png',frameSize=FRAME,columns=3,rows=2,
              anchor=source['camera']['anchor'],cameraElevationDegrees=source['camera']['elevationDegrees'],
              camera=source['camera'],modelPose=source['modelPose'],frames=frames)
    atlas.save(OUT/'army-flags.png',optimize=True)
    (OUT/'army-visuals.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    # Offline arrangement over actual terrain tiles: an art scale sample, not game evidence.
    terrain=Image.open(REPO/'assets/ui/world-map/terrain-atlas.png').convert('RGBA')
    sample=Image.new('RGBA',(1500,660),'#171c20');draw=ImageDraw.Draw(sample)
    draw.text((30,20),'兵旗 × 位面地貌 / 离线素材组合',font=font(28),fill='#e5e8e5')
    draw.text((30,62),'不代表游戏截图；地格坐标、敌我身份与战斗判定保持原有代码规则。',font=font(16),fill='#a5afaf')
    for index,biome in enumerate(['desert','snow','forest','ruins','mine']):
        scale=65;center=(155+index*297,340);a=layout['atlas'];factor=scale/a['pixelsPerWorldUnit']
        stamps=[]
        for q,r in [(0,0),(1,0),(-1,0),(0,1),(0,-1),(1,-1),(-1,1)]:
            tile=layout['tiles'][f'{biome}_{(index+q-r)%10:02d}']
            px=center[0]+math.sqrt(3)*(q+r/2)*scale;py=center[1]-1.5*r*math.sin(math.radians(layout['cameraElevationDegrees']))*scale
            stamps.append((py,px,tile))
        for py,px,tile in sorted(stamps,key=lambda v:v[0]):
            raw=terrain.crop((tile['x'],tile['y'],tile['x']+320,tile['y']+320))
            size=round(320*factor);raw=raw.resize((size,size),Image.Resampling.LANCZOS)
            sample.alpha_composite(raw,(round(px-a['anchorPx'][0]*factor),round(py-a['anchorPx'][1]*factor)))
        flag=miniatures[index+1].resize((112,112),Image.Resampling.LANCZOS)
        anchor=meta['anchor']
        sample.alpha_composite(flag,(round(center[0]-anchor[0]*112),round(center[1]-anchor[1]*112)))
        draw.text((center[0]-66,490),layout['biomes'][biome]['label'],font=font(22),fill='#e5e8e5')
    sample.convert('RGB').save(OUT/'army-flags-terrain-preview.jpg',quality=94)
    # Final-source rebuilding must not depend on removed, unselected V1 renders.
    if args.install:
        atlas.save(REPO/'assets/ui/world-map/army-flags.png',optimize=True)
        (REPO/'data/world-map-army-visuals.json').write_text(json.dumps(meta,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
        source['stage']='integrated-awaiting-user-runtime-review'
        source['runtimeInstalled']=True
        source['runtime']=dict(atlas=meta['path'],metadata='data/world-map-army-visuals.json',decodedBytes=FRAME*3*FRAME*2*4,
                               approval='User selected the original V2 display for fuller, clearer heraldry; runtime appearance remains for user review',sourceVersion=2)
        (OUT/'manifest.json').write_text(json.dumps(source,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print('Packed six flags; offline art previews saved. Runtime installed:',args.install)


if __name__=='__main__':main()
