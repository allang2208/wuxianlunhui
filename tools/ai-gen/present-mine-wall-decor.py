"""Offline asset presentation; authored wall panels, not random-room testing."""
import json
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools/ai-gen/_mine_wall_decor_20260830"
CONFIG = json.loads((ROOT / "data/abandoned-mine-wall-decor.json").read_text(encoding="utf-8"))


def text(canvas, xy, value, size=22):
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size)
    ImageDraw.Draw(canvas).text(xy, value, font=font, fill=(215,217,210))


def main():
    canvas = Image.new("RGBA", (1560,1060), (23,29,31,255))
    text(canvas, (24,18), "矿洞墙面挂饰 · 同源PBR / 双方向独立渲染", 30)
    text(canvas, (24,67), "上：主体放大　下：实际世界尺寸、zoom 1 的挂墙示意。人工摆放，不代表游戏截图或随机分布。", 20)
    wall = Image.open(ROOT / "assets/terrain/abandoned_mine_wall_block_a.png").convert("RGBA")
    wall = wall.resize((260,259), Image.Resampling.LANCZOS)
    for index, asset in enumerate(CONFIG["assets"]):
        offset = index * 520
        text(canvas, (offset+26,110), asset["labelZh"], 26)
        for col, direction in enumerate(("down","up")):
            view = asset["views"][direction]
            source = Image.open(ROOT / view["src"]).convert("RGBA")
            crop = source.crop(source.getchannel("A").getbbox())
            factor = min(180/crop.width, 178/crop.height)
            crop = crop.resize((round(crop.width*factor),round(crop.height*factor)),Image.Resampling.LANCZOS)
            canvas.alpha_composite(crop, (offset+54+col*220+(180-crop.width)//2,164))
            text(canvas, (offset+65+col*220,345), "右斜墙向" if direction=="down" else "左斜墙向",18)
        for row, direction in enumerate(("down","up")):
            origin = (offset+(108 if row==0 else 402), 548+row*267)
            sign = 1 if direction=="down" else -1
            jobs = []
            for cell in range(4):
                x,y = origin[0]+sign*cell*64, origin[1]+cell*32
                depth = y+(16 if cell<3 else 0)+4
                jobs.append((depth,wall,(round(x-130),round(y-761.9959*259/1024))))
            cx,cy=origin[0]+sign*64,origin[1]+32
            view=asset["views"][direction]
            size=round(view["displayWidth"])
            prop=Image.open(ROOT/view["src"]).convert("RGBA").resize((size,size),Image.Resampling.LANCZOS)
            pos=(round(cx-sign*CONFIG["faceOffset"]["x"]-view["origin"][0]*size),
                 round(cy+CONFIG["faceOffset"]["y"]-CONFIG["mountHeight"]-view["origin"][1]*size))
            jobs.append((cy+20.12,prop,pos))
            for depth,image,position in sorted(jobs,key=lambda item:item[0]):
                canvas.alpha_composite(image,position)
        text(canvas,(offset+24,981),"墙高、挂点与世界尺寸沿用正式参数",17)
    text(canvas,(24,1025),"挂饰无碰撞、无额外灯光；先留火把净空，再稀疏混搭绳圈 / 工具 / 木牌，保留空墙。",20)
    canvas.save(OUT / "wall-decor-presentation.png")


if __name__ == "__main__":
    main()
