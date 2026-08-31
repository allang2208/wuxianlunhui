"""Compose offline direction previews from the actual runtime sheet/projection."""
from pathlib import Path
import json
import math
from PIL import Image, ImageDraw, ImageFont, ImageOps

ROOT=Path(__file__).resolve().parent
GAME=ROOT.parents[2]
data=json.loads((ROOT/'previews/runtime-projection.json').read_text(encoding='utf-8'))
sheet=Image.open(GAME/data['bodySheet']).convert('RGBA')
layout=data['layout']
W,H=660,420
ZOOM=.8
PX=data['scale']*ZOOM
FONT=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',14)
SMALL=ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf',12)
elapsed=[sum(data['durations'][:i]) for i in range(62)]

def panel(view,index):
    image=Image.new('RGBA',(W,H),(37,44,53,255))
    draw=ImageDraw.Draw(image)
    rx,ry=330,325
    draw.text((16,12),f"{view['name']}  |  frame {index:02d}  |  {elapsed[index]:.1f} ms",font=FONT,fill='#e6edf3')
    draw.text((16,35),'Same body scale / fixed foot root / locked direction',font=SMALL,fill='#aebac7')
    draw.ellipse((rx-256,ry-128,rx+256,ry+128),outline='#414e5e',width=1)
    draw.line((12,ry,W-12,ry),fill='#435564')
    draw.line((rx,65,rx,H-54),fill='#435564')
    gx,gy=rx+view['groundTip'][0]*ZOOM,ry+view['groundTip'][1]*ZOOM
    ty=gy-data['strikeHeight']*ZOOM
    draw.line((gx,ty,gx,gy),fill='#8e784c')
    draw.ellipse((gx-4,ty-4,gx+4,ty+4),outline='#d8ba76',width=1)
    draw.ellipse((rx-4,ry-2,rx+4,ry+2),fill='#50b8bf')
    x=index%layout['cols']*layout['frameWidth']
    y=index//layout['cols']*layout['frameHeight']
    frame=sheet.crop((x,y,x+layout['frameWidth'],y+layout['frameHeight']))
    if view['flipX']: frame=ImageOps.mirror(frame)
    frame=frame.resize((round(layout['frameWidth']*PX),round(layout['frameHeight']*PX)),Image.Resampling.LANCZOS)
    footx=layout['frameWidth']-layout['footX'] if view['flipX'] else layout['footX']
    body_position=(round(rx-footx*PX),round(ry-layout['footY']*PX))
    whip=Image.new('RGBA',(W*2,H*2))
    wd=ImageDraw.Draw(whip)
    points=[((rx+p['x']*ZOOM)*2,(ry+p['y']*ZOOM)*2) for p in view['frames'][index]]
    opacity=data['opacities'][index]
    for thickness,color in zip(data['widths'],[(49,28,18),(119,77,42)]):
        for i,(a,b) in enumerate(zip(points,points[1:])):
            taper=1-.7*i/(len(points)-1)
            wd.line((a,b),fill=(*color,round(opacity*255)),width=max(1,round(thickness*PX*taper*2)))
    if index in (36,37):
        px,py=points[-1]
        wd.ellipse((px-4,py-4,px+4,py+4),fill=(228,189,122,204))
    whip=whip.resize((W,H),Image.Resampling.LANCZOS)
    if math.sin(view['angle'])<=.1: image=Image.alpha_composite(image,whip)
    image.alpha_composite(frame,body_position)
    if math.sin(view['angle'])>.1: image=Image.alpha_composite(image,whip)
    draw=ImageDraw.Draw(image)
    draw.rectangle((0,H-49,W,H),fill='#1b232d')
    draw.text((16,H-43),'320 ground px | impact 870.97 ms | sound 725.81 ms | 1500 ms total',font=SMALL,fill='#c2d1df')
    draw.text((16,H-25),'Offline asset preview at 80% display size. Not a game capture.',font=SMALL,fill='#8ea4b8')
    draw.rectangle((0,H-3,round(W*elapsed[index]/1500),H),fill='#c8a15c')
    return image.convert('RGB')

frames=[]
for index in range(61):
    canvas=Image.new('RGB',(W*2,H*2))
    for slot,view_index in enumerate([0,2,4,6]):
        canvas.paste(panel(data['views'][view_index],index),(slot%2*W,slot//2*H))
    frames.append(canvas)
gif_ms=[round(elapsed[i+1]/10)*10-round(elapsed[i]/10)*10 for i in range(61)]
gif_ms[0]+=250
gif_ms[-1]+=250
frames[0].save(ROOT/'previews/foreman-whip-runtime-directions.gif',save_all=True,
    append_images=frames[1:],duration=gif_ms,loop=0,optimize=False)
frames[36].save(ROOT/'previews/foreman-whip-runtime-contact.png')
contact=Image.new('RGB',(W*4,H*2))
for slot,view in enumerate(data['views']):
    contact.paste(panel(view,36),(slot%4*W,slot//4*H))
contact.save(ROOT/'previews/foreman-whip-runtime-eight-directions.png')
transition=Image.new('RGB',(W*3,H*2))
for slot,index in enumerate([0,1,3,57,59,60]):
    transition.paste(panel(data['views'][0],index),(slot%3*W,slot//3*H))
transition.save(ROOT/'previews/foreman-whip-runtime-transitions.png')
print('Exported direction GIF, contact plates and idle transition plate.')
