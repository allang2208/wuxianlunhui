"""Compose direct asset previews and source-aligned detail views."""
from pathlib import Path
import json

import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageOps
from scipy import ndimage


HERE = Path(__file__).resolve().parent
CUTOUT = HERE/'cutout'
before = Image.open(HERE.parent/'refine_s48_v03_b01/candidates/recon_camp_industrial/recon_camp_industrial_refine_v01_raw.png').convert('RGB')
edited = Image.open(HERE/'recon_camp_industrial_s48_v01_compass_fix.png').convert('RGB')
full = Image.open(CUTOUT/'recon_camp_industrial_cutout_full.png').convert('RGBA')
final = Image.open(CUTOUT/'recon_camp_industrial_cutout.png').convert('RGBA')
font_path = 'C:/Windows/Fonts/msyh.ttc'


def text(canvas, xy, value, size=24, color='#35443d'):
    ImageDraw.Draw(canvas).text(xy, value, fill=color, font=ImageFont.truetype(font_path,size))


def checker(size, cell=24, colors=('#53565a','#92979b')):
    background = Image.new('RGB',size,colors[0])
    draw=ImageDraw.Draw(background)
    for y in range(0,size[1],cell):
        for x in range(0,size[0],cell):
            if (x//cell+y//cell)%2:
                draw.rectangle((x,y,x+cell-1,y+cell-1),fill=colors[1])
    return background


preview=checker(final.size)
preview.paste(final,(0,0),final)
preview.save(HERE/'recon_camp_industrial_transparent_preview.png')

review=Image.new('RGB',(1560,1400),'#e8ebe6')
for index,(name,color) in enumerate([('黑底','#080a0d'),('灰底','#787878'),('白底','#ffffff'),('真实 Alpha',None)]):
    x=24+(index%2)*768
    y=20+(index//2)*690
    text(review,(x,y),name,28)
    image = Image.merge('RGB',(final.getchannel('A'),)*3) if color is None else Image.new('RGB',final.size,color)
    if color is not None:
        image.paste(final,(0,0),final)
    image.thumbnail((744,620),Image.Resampling.LANCZOS)
    review.paste(image,(x+(744-image.width)//2,y+48))
review.save(CUTOUT/'black_gray_white_alpha_review.png')

detail=Image.new('RGB',(1390,650),'#e8ebe6')
text(detail,(22,14),'罗盘修正前后 · 同一建筑显示比例',30)
# Normalize only this comparison view, not either editable source.
normalized=edited.resize(before.size,Image.Resampling.LANCZOS)
for index,(source,title) in enumerate([(before,'48步01原图'),(normalized,'局部修正版')]):
    x=22+index*450
    text(detail,(x,65),title,25)
    crop=source.crop((512,380,622,510)).resize((396,468),Image.Resampling.NEAREST)
    detail.paste(crop,(x,111))
text(detail,(931,123),'缩小为简洁罗盘',25)
text(detail,(931,169),'移除挂环与凸件',25)
text(detail,(931,215),'黄铜边框收敛',25)
text(detail,(22,600),'源图分别为1024²与1254²；仅对照图等比归一，不宣称其他区域逐像素相同。',21)
detail.save(HERE/'compass_before_after.png')

railing=Image.new('RGB',(1590,1180),'#e8ebe6')
for row,(name,box,factor) in enumerate([
    ('塔楼栏杆',(187,515,265,624),4),
    ('塔架开口与地台边缘',(223,725,309,834),4),
]):
    top=25+row*575
    text(railing,(22,top),name,26)
    raw=edited.crop(box)
    cut=full.crop(box)
    bg=checker(cut.size,10,('#ffffff','#a7adb0'))
    bg.paste(cut,(0,0),cut)
    black=Image.new('RGB',cut.size,'#060608')
    black.paste(cut,(0,0),cut)
    alpha=Image.merge('RGB',(cut.getchannel('A'),)*3)
    for column,(image,title) in enumerate([(raw,'原图'),(bg,'透明棋盘'),(black,'黑底'),(alpha,'Alpha')]):
        x=22+column*390
        text(railing,(x,top+42),title,22)
        image=image.resize((image.width*factor,image.height*factor),Image.Resampling.NEAREST)
        railing.paste(image,(x,top+78))
railing.save(CUTOUT/'railing_and_base_detail.png')

rgba=np.asarray(full)
alpha=rgba[...,3]
labels,count=ndimage.label(alpha>16,structure=np.ones((3,3)))
components=[]
for idx,box in enumerate(ndimage.find_objects(labels),1):
    if box is None:continue
    yy,xx=box
    components.append({'area':int(np.count_nonzero(labels[box]==idx)),
                       'bbox':[xx.start,yy.start,xx.stop,yy.stop]})
crop=json.loads((CUTOUT/'crop-metadata.json').read_text(encoding='utf-8'))
x0,y0,x1,y1=crop['cropBox']
fa=np.asarray(final)
checks={'fullSize':full.size,'cutoutSize':final.size,'cropBox':crop['cropBox'],
        'finalAlphaChangedByCrop':int(np.count_nonzero(alpha[y0:y1,x0:x1]!=fa[...,3])),
        'transparentPixelsWithDirtyRgb':int(np.count_nonzero((fa[...,3]==0)&np.any(fa[...,:3]!=0,axis=2))),
        'componentsAbove16':components}
(CUTOUT/'delivery-pixel-record.json').write_text(json.dumps(checks,indent=2)+'\n',encoding='utf-8')
print(json.dumps(checks))
