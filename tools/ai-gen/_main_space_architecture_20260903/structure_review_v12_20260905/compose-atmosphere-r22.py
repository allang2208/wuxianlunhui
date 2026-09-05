"""Offline art presentation, not a game run or a runtime validation."""
import math
from pathlib import Path
import numpy as np
from PIL import Image, ImageDraw

BASE=Path(__file__).resolve().parent; OUT=BASE/'delivery_r22'
helper=BASE/'preview-paving-r22.py'; s={'__file__':str(helper)}
exec(compile(helper.read_text(encoding='utf-8').split('sprite, xy = layer(')[0],str(helper),'exec'),s)
W,H=s['W'],s['H']; pp=s['pp']; world=s['world']; font=s['font']
hub=s['hub']; cfg=hub['atmosphere']; arch=hub['architecture']; REPO=s['REPO']
under,underxy=s['layer'](arch['underlay'],True)
stack=[(entry['depthY'],*s['layer'](entry),'normal') for entry in arch['occluders']]
for record,(_,sprite,xy) in zip(s['scope']['actor_records'],s['scope']['actors']):
    key=record['id']
    if key=='portal':
        c=s['scope']['config']['portals']['mainHub']['building']; pos=[c['x'],c['y']]
    elif key=='player': pos=record['runtimeSpawnPosition']
    else: pos=record['runtimePosition']
    target=world(*pos); old=record['footPixel']
    stack.append((pos[1],sprite,(round(xy[0]+target[0]-old[0]),round(xy[1]+target[1]-old[1])),'normal'))

def glow(light, strength, pool=False):
    radius=light['poolRadius'] if pool else light['radius']
    w=max(1,round(radius*2/pp)); h=max(1,round((radius if pool else radius*2)/pp))
    yy,xx=np.mgrid[0:h,0:w]
    d=np.sqrt(((xx+.5-w/2)/(w/2))**2+((yy+.5-h/2)/(h/2))**2)
    opacity=np.interp(d,[0,.18,.55,1],[.92,.52,.14,0])
    opacity*=strength*(light['poolAlpha'] if pool else light['alpha'])
    color=light['color']; rgb=np.array([(color>>16)&255,(color>>8)&255,color&255])
    pixels=np.zeros((h,w,4),dtype=np.uint8);pixels[:,:,:3]=rgb;pixels[:,:,3]=np.rint(opacity*255)
    x,y=world(light['x'],light['groundY'] if pool else light['y'])
    return Image.fromarray(pixels),(round(x-w/2),round(y-h/2))

def additive(canvas,sprite,xy):
    x,y=xy; w,h=sprite.size
    source=np.asarray(sprite,dtype=np.float32)
    region=np.asarray(canvas.crop((x,y,x+w,y+h)),dtype=np.float32).copy()
    region[:,:,:3]=np.minimum(255,region[:,:,:3]+source[:,:,:3]*source[:,:,3:4]/255)
    canvas.paste(Image.fromarray(region.astype(np.uint8)),xy)

def ambient(phase):
    solar=math.sin(phase*math.pi*2); daylight=max(0,min(1,(solar+.15)/1.15))
    def smooth(x,a,b):
        t=max(0,min(1,(x-a)/(b-a)));return t*t*(3-2*t)
    nw=1-smooth(daylight,.04,.38);tw=1-smooth(abs(solar),.02,.45)
    weights=[.34*nw,.1*tw*(1-nw),.18*(1-daylight)*(1-nw)*(1-tw)]
    opacity=sum(weights)
    colors=np.array([[16,38,74],[154,77,47],[26,38,61]])
    rgb=(colors*np.array(weights)[:,None]).sum(axis=0)/max(opacity,1e-9)
    return tuple(int(x) for x in rgb)+(round(opacity*255),)

variants=[('day','白昼',.25,0),('dusk','暮色',.5,.4),('night','夜晚',.75,1)]
frames=[]
for name,label,phase,strength in variants:
    path=hub['backdrop']['assetPath'] if name=='day' else hub['backdrop']['variants'][name]['assetPath']
    sky=Image.open(REPO/path).convert('RGBA')
    # Match the runtime top-aligned cover crop; retain the world baseline.
    scale=max(W/sky.width,H/sky.height)
    sky=sky.resize((round(sky.width*scale),round(sky.height*scale)),Image.Resampling.LANCZOS)
    sky=sky.crop(((sky.width-W)//2,0,(sky.width+W)//2,H))
    context=s['context'].copy();baseline=s['baseline']
    context.paste(sky.crop((0,0,W,baseline)),(0,0))
    if name!='night':
        birds=Image.new('RGBA',(W,H));d=ImageDraw.Draw(birds)
        for i in range(4):
            x=round(W*.66-i*23);y=round(H*.125+i*7);wing=-3 if i%2 else 2
            d.line([(x-5,y+wing),(x-2,y),(x,y+1),(x+2,y),(x+5,y+wing)],fill=(41,60,83,135),width=2)
        context.alpha_composite(birds)
    context.alpha_composite(under,underxy)
    localstack=list(stack)
    if strength:
        for light in cfg['lights']:
            additive(context,*glow(light,strength,True))
            sprite,xy=glow(light,strength)
            localstack.append((light['depth'],sprite,xy,'add'))
            if light.get('emitterRadius'):
                emitter={**light,'radius':light['emitterRadius'],'color':0xffdf98,'alpha':.95}
                sprite,xy=glow(emitter,strength)
                localstack.append((light['depth']+.001,sprite,xy,'normal'))
        edge=Image.new('RGBA',(W,H));d=ImageDraw.Draw(edge)
        for line in cfg['edgeHighlights']:
            c=line['color'];color=((c>>16)&255,(c>>8)&255,c&255,round(255*strength*line['alpha']))
            d.line([world(*line['from']),world(*line['to'])],fill=color,width=max(1,round(line['width']/pp)))
        context.alpha_composite(edge)
    for _,sprite,xy,mode in sorted(localstack,key=lambda e:e[0]):
        if mode=='add': additive(context,sprite,xy)
        else: context.alpha_composite(sprite,xy)
    tint=ambient(phase)
    if tint[3]: context.alpha_composite(Image.new('RGBA',(W,H),tint))
    context.convert('RGB').save(OUT/(name+'-full.png'))
    frames.append(context.convert('RGB'))

board=Image.new('RGB',(2400,1520),(18,29,39));d=ImageDraw.Draw(board)
d.text((30,20),'主神空间 R22 · 昼暮夜与环境照明',font=font(34),fill='white')
d.text((30,70),'同一相机、R21 白石主体与 R19 站位；背景换光、远鸟剪影、灯具微光',font=font(22),fill=(190,210,216))
for i,((name,label,phase,strength),frame) in enumerate(zip(variants,frames)):
    y=115+i*450
    board.paste(frame.crop((275,55,2797,1365)).resize((790,410),Image.Resampling.LANCZOS),(25,y+25))
    board.paste(frame.crop((970,560,2130,1190)).resize((755,410),Image.Resampling.LANCZOS),(840,y+25))
    board.paste(frame.crop((350,45,1250,535)).resize((755,410),Image.Resampling.LANCZOS),(1620,y+25))
    d.text((30,y-6),label+' · 全场',font=font(22),fill='white')
    d.text((845,y-6),'中央台阶与灯具',font=font(22),fill='white')
    d.text((1625,y-6),'后方山景与柱廊',font=font(22),fill='white')
d.text((30,1480),'离线效果预览；近似叠加现有环境色及微光，不含实机动态阴影，不代表运行验收。',font=font(22),fill=(190,210,216))
board.save(OUT/'01-day-dusk-night-preview.jpg',quality=94)

# A compact delivery record, with exact assets separate from the approximation.
(OUT/'README.md').write_text('''# 主神空间 R22 环境优化

已接入开发资源：同构昼暮夜远景、3 层缓慢云雾、间歇 3–5 只远景飞鸟、4 盏灯、祭坛/传送门微光、8 级台阶与主台嵌线夜间提示。

- 白昼原图保留；暮色与夜景是 image_gen.imagegen 各一次参考图编辑，源文件和约束见 asset-manifest.json。本轮没有调用 5080；沿用已认可 R21 的 5080 石纹与 Blender 分层主体。
- 昼夜直接读取已保存的世界时钟（默认 12 分钟一日）；不新增存档时钟。云雾和鸟的装饰动画随游戏暂停，离开主神空间或地图模式时隐藏，场景关闭销毁。
- 背景、云和鸟共用原世界基线裁切；灯光按灯具/建筑深度，地面光池与台阶嵌线在地台之上、建筑阴影和人物之下。
- R21 材质、R19 NPC 位置、R16 通行范围和碰撞没有修改。

## 文件

- 01-day-dusk-night-preview.jpg：三时段同镜头与局部预览。
- day-full.png / dusk-full.png / night-full.png：3072×1728 离线整场。
- asset-manifest.json：生成出处、光源锚点、模型投影线坐标与交付边界。
- ../package-atmosphere-r22.py、../compose-atmosphere-r22.py：打包与离线合成脚本。

运行代码：src/world/main-hub-atmosphere.js（环境效果）、src/world/main-hub-architecture.js（纹理入口）、src/world/world-render-layers.js（贴地光层）、src/phaser/scenes/GameScene.js（场景同步与清理）。双份配置：data/game-config.json、public/data/game-config.json。

## 交付边界

预览使用实际资源离线合成，环境色和光晕为近似；不包含实机太阳阴影、雾和动画采样，不是游戏截图。未运行测试或运行时验证，按约定由用户测试；未同步 EXE。

用户验收重点：昼暮夜过渡是否自然；移动/缩放后背景裁口和远鸟是否始终在建筑后；夜间台阶、灯具遮挡与亮度；离场/返回和暂停时效果状态。
''',encoding='utf-8')
