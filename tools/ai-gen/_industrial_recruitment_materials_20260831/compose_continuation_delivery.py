"""Offline art board; preserve source pixels and never change runtime resources."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

HERE=Path(__file__).resolve().parent
board=Image.new('RGB',(1640,1000),'#e9ede7')
d=ImageDraw.Draw(board)
font=lambda n:ImageFont.truetype('C:/Windows/Fonts/msyh.ttc',n)
d.text((30,20),'近代出兵建筑 · 连续制作进度',font=font(34),fill='#34443b')
items=[
    ('军营 V2','48步01 · 透明候选已完成',
     HERE/'infantry_barracks_tent_v2/refine_s48_b02/cutout/transparent.png'),
    ('靶场','48步01 · 透明候选已完成',
     HERE/'rifle_range/refine_s48_b03/cutout/transparent.png'),
]
for i,(name,state,path) in enumerate(items):
    x=20+i*810
    d.rounded_rectangle((x,88,x+800,944),radius=16,fill='#d9dfd9')
    d.text((x+24,108),name,font=font(30),fill='#34443b')
    d.text((x+24,154),state,font=font(24),fill='#5d6c62')
    im=Image.open(path).convert('RGBA')
    im.thumbnail((758,655),Image.Resampling.LANCZOS)
    board.paste(im,(x+(800-im.width)//2,875-im.height),im)
    d.text((x+24,902),'仅美术预览；未接入游戏',font=font(20),fill='#5d6c62')
d.text((30,962),'保留模型、原图、提示词及处理记录；画面等比展示，不代表游戏内尺寸标定。',font=font(21),fill='#657369')
board.save(HERE/'continuation_delivery_preview.png')
