"""Current R22 preview camera and uniformly scaled actor sources.

Compositing is presentation only: no game asset, sprite or config is overwritten.
"""
from pathlib import Path
import json
import math
from PIL import Image, ImageDraw, ImageFont, ImageChops

BASE=Path(__file__).resolve().parent
ROOT=BASE/'delivery_r21'
REPO=BASE.parents[3]
manifest=json.loads((ROOT/'camera-manifest.json').read_text(encoding='utf-8'))
config=json.loads((REPO/'data/game-config.json').read_text(encoding='utf-8'))
buildings=json.loads((REPO/'data/producer-buildings.json').read_text(encoding='utf-8'))
W,H=manifest['renderSize']; PP=manifest['worldPerPixel']; OX,OY=manifest['originPixel']
FONT=Path('C:/Windows/Fonts/msyh.ttc')
def font(size):return ImageFont.truetype(str(FONT),size)
def world(x,y):return (OX+(x-6144)/PP,OY+(y-4096)/PP)
def cover(img,size):
    scale=max(size[0]/img.width,size[1]/img.height)
    img=img.resize((round(img.width*scale),round(img.height*scale)),Image.Resampling.LANCZOS)
    x=(img.width-size[0])//2;y=(img.height-size[1])//2
    return img.crop((x,y,x+size[0],y+size[1]))

actor_records=[]
def actor(key,label,path,pos,sprite,frame=None,cells=None):
    img=Image.open(REPO/path).convert('RGBA')
    if frame:img=img.crop((0,0,*frame))
    # Every actor keeps its source aspect, including buildings used as NPCs.
    # Logical footprints are separate diagram data and never stretch the image.
    scale=sprite['size']/img.width
    size=img.width*scale;h=img.height*scale;offsetx=0
    bbox=img.getchannel('A').getbbox()
    # Human sprites have a real foot line; structures use the authored contact
    # anchor, scaled uniformly with their source instead of independent X/Y fit.
    if cells:
        foot=(sprite.get('footOffsetY',sprite.get('sizeH',sprite['size'])/2)
            /sprite.get('sizeH',sprite['size']))*h
    else:
        foot=(bbox[3]/img.height-.5)*h
    px,py=world(*pos)
    drawn=img.resize((round(size/PP),round(h/PP)),Image.Resampling.LANCZOS)
    left=round(px+offsetx/PP-drawn.width/2);top=round(py-foot/PP-drawn.height/2)
    record=dict(id=key,label=label,assetPath=path,frameIndex=0 if frame else None,frameSize=frame,
        worldPosition=list(pos),displaySize=[size,h],footOffsetY=foot,canvasBounds=[left,top,left+drawn.width,top+drawn.height],
        footPixel=[px,py],nominalFootprintCells=cells,sourceSize=list(img.size),
        sourceAspect=img.width/img.height,displayAspect=size/h,uniformScale=scale,
        alphaBounds=[left+bbox[0]*scale/PP,top+bbox[1]*scale/PP,
            left+bbox[2]*scale/PP,top+bbox[3]*scale/PP],previewPositionOnly=True)
    actor_records.append(record)
    return py,drawn,(left,top)

king_cfg=config['npcs']['shopMouseKing'];king=(6144+king_cfg['offset']['x'],4096+king_cfg['offset']['y'])
actors=[]
for key,label,path,frame in [
    ('shopMouseKing','小鼠大王','assets/npc/mouse_king/idle.png',(512,512)),
    ('mouseAttendant','小鼠侍从','assets/npc/mouse_attendant/idle.png',None),
    ('warehouse','仓库','assets/npc/warehouse/warehouse.png',None),
    ('mouseBlacksmith','铁匠','assets/npc/mouse_blacksmith/idle.png',(512,512)),
    ('altar','祭坛','assets/terrain/defense_base.png',None)]:
    cfg=config['npcs'][key]
    anchor=king if cfg.get('relativeTo')=='shopMouseKing' else (6144,4096)
    source_pos=king if key=='shopMouseKing' else (anchor[0]+cfg['offset']['x'],anchor[1]+cfg['offset']['y'])
    pos=source_pos
    actors.append(actor(key,label,path,pos,cfg['sprite'],frame,cfg.get('footprintCells')))
    actor_records[-1]['runtimePosition']=list(source_pos)
portal=buildings['portal'];placement=config['portals']['mainHub']['building']
actors.append(actor('portal','位面传送门','assets/terrain/portal.png',[placement['x'],placement['y']],
    dict(size=portal['displayW'],sizeH=portal['displayH'],footOffsetY=portal['footOffsetY'],visualFootprint=portal['visualFootprint']),cells=4))
spawn=config['scenes']['mainHub']['playerSpawn']
# Current player image is 144px display; its source alpha bottom supplies the idle foot.
player_img=Image.open(REPO/'assets/player/idle.png').convert('RGBA')
player_bottom=player_img.getchannel('A').getbbox()[3]
player_foot=(player_bottom/player_img.height-.5)*144
actors.append(actor('player','玩家出生点','assets/player/idle.png',[spawn['x'],spawn['y']],dict(size=144,footOffsetY=player_foot)))
actor_records[-1]['runtimeSpawnPosition']=[spawn['x'],spawn['y']]
actor_records[-1]['previewPositionOnly']=True
