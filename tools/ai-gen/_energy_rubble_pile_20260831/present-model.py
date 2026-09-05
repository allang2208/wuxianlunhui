"""Lay out the Blender output and its authored footprint for model review."""

import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


OUT = Path(__file__).resolve().parent
manifest = json.loads((OUT/"manifest.json").read_text(encoding="utf-8"))
source = Image.open(OUT/manifest["files"]["preview"]).convert("RGBA")
box = source.getchannel("A").getbbox()
crop = source.crop(box)
board = Image.new("RGB", (1440,990), (27,31,35))
draw = ImageDraw.Draw(board)
FONT = "C:/Windows/Fonts/msyh.ttc"


def label(x,y,text,size=24,color=(216,223,224)):
    draw.text((x,y),text,font=ImageFont.truetype(FONT,size),fill=color)


def paste_model(panel, width, guide=False):
    scale = width/crop.width
    image = crop.resize((width,round(crop.height*scale)),Image.Resampling.LANCZOS)
    x,y = panel
    board.paste(image,(x,y),image)
    if guide:
        points = [(x+(px-box[0])*scale,y+(py-box[1])*scale)
                  for px,py in manifest["footprintProjectionPixels"]]
        draw.line(points+[points[0]],fill=(215,176,105),width=2)
    return image.height


label(48,32,"能量矿脉 · 1×1矿石堆砌",34)
label(48,86,"Blender模型预览｜底部也由独立矿石堆砌｜无地基平面｜4处能量矿物点缀",20,(153,170,176))
label(48,151,"主体模型",24)
paste_model((48,200),870)
label(994,151,"1×1占地方向参考",24)
paste_model((994,240),380,True)
label(994,477,"金线：标准方形占地的投影",18,(215,176,105))
label(994,510,"仅作参照，不属于模型",18,(153,170,176))
label(994,568,"缩至128px宽的示意",22)
paste_model((1120,620),128)
label(48,766,"造型范围",24)
label(48,810,"底层小矿石与上层大矿石叠放，外缘由石块自然咬合形成。",22)
label(48,850,"没有连续平板、地基或底座；保留等距方向与少量嵌入矿脉。",22)
label(48,906,"当前只交付模型。正式贴图、16格拼接系统、碰撞和采集逻辑均未改动。",20,(153,170,176))
path = OUT/"energy_rubble_pile_review_board.png"
board.save(path)
print(path)
