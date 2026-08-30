"""Offline art plates + optional development-only installation; no game test."""
import argparse
import importlib.util
import json
import math
import shutil
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "tools/ai-gen/_swamp_wall_plants_20260830"
spec = importlib.util.spec_from_file_location("wall_layout", Path(__file__).with_name("compose-swamp-stone-wall-kit.py"))
W = importlib.util.module_from_spec(spec)
spec.loader.exec_module(W)


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def label(canvas, xy, text, size=22):
    ImageDraw.Draw(canvas).text(xy, text, font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", size), fill=(220,232,212))


def glow_sprite(radius, color, alpha):
    size = math.ceil(radius * 2)
    y, x = np.mgrid[0:size, 0:size]
    d = np.hypot(x-size/2, y-size/2)/radius
    falloff = np.interp(d, [0,.18,.55,1], [.92,.52,.14,0]) * alpha
    rgb = np.array([(color >> s) & 255 for s in (16,8,0)])
    pixels = np.zeros((size,size,4), dtype=np.uint8)
    pixels[:,:,:3] = np.rint(falloff[:,:,None]*rgb).astype(np.uint8)
    pixels[:,:,3] = 255
    return Image.fromarray(pixels)


def plant_jobs(asset, cell, offset, direction, cfg):
    view = asset["views"][direction]
    cx,cy = W.world(cell)
    sy = -1 if direction == "up" else 1
    # Fixed along/height in this illustration; runtime adds small hashed offsets.
    x = offset[0]+cx-W.ORIGIN[0]-sy*cfg["faceOffset"]["x"]
    y = offset[1]+cy-W.ORIGIN[1]+cfg["faceOffset"]["y"]-cfg["mountHeight"]
    width = view["displayWidth"]
    sprite = Image.open(OUT/view["source"]).convert("RGBA").resize((round(width),round(width)),Image.Resampling.LANCZOS)
    depth = cy+20
    jobs = []
    glow = asset["glow"]
    lx = x+(view["lightOrigin"][0]-view["origin"][0])*width
    ly = y+(view["lightOrigin"][1]-view["origin"][1])*width
    for radius,alpha in ((glow["radius"],glow["alpha"]),(glow["coreRadius"],glow["coreAlpha"])):
        jobs.append((depth+.07,glow_sprite(radius,glow["color"],alpha),(round(lx-radius),round(ly-radius)),"add"))
    jobs.append((depth+.12,sprite,(round(x-view["origin"][0]*width),round(y-view["origin"][1]*width)),"over"))
    return jobs


def paint(canvas, jobs):
    for _depth,sprite,position,mode in sorted(jobs,key=lambda item:item[0]):
        if mode == "add":
            layer = Image.new("RGB",canvas.size)
            layer.paste(sprite.convert("RGB"),position)
            canvas.paste(ImageChops.add(canvas.convert("RGB"),layer))
        else:
            canvas.alpha_composite(sprite,position)


def wall_jobs(cells, offset, walls, geo):
    return [(d,img,pos,"over") for d,img,pos in W.wall_jobs(cells,offset,walls,geo)]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--install",action="store_true")
    args = parser.parse_args()
    manifest = json.loads((OUT/"manifest.json").read_text(encoding="utf-8"))
    cfg = {"version":1,"enabled":True,"source":"tools/ai-gen/_swamp_wall_plants_20260830/manifest.json",
           "density":.72,"spacing":260,"torchClearance":150,"repeatDistance":400,
           "maxPerRoom":5,"maxPerPassage":1,"maxTotal":20,"mountHeight":68,
           "faceOffset":{"x":40,"y":20},"gateClearance":130,"cornerClearance":90,"skipBlocks":[],
           "assets":manifest["assets"]}
    write_json(OUT/"runtime-config.json",cfg)
    wall_data = json.loads((ROOT/"data/swamp-stone-wall-kit.json").read_text(encoding="utf-8"))["geometry"]
    keys = [f"swamp_living_block_{letter}" for letter in "abcd"]
    walls = [Image.open(ROOT/wall_data[key]["source"]).convert("RGBA") for key in keys]
    geo = wall_data[keys[0]]
    poster = Image.new("RGBA",(1700,1360),(20,28,23,255))
    label(poster,(35,20),"沼泽墙壁小物 · 五款发光植物",36)
    label(poster,(35,76),"原生3D模型 / 两个独立墙向 / 挂点与发光点同源 / 保留已确认细碎枯枝墙",22)
    measures = []
    for i,asset in enumerate(cfg["assets"]):
        x = 15+i*340
        label(poster,(x+14,133),asset["labelZh"],26)
        for j,direction in enumerate(("down","up")):
            view = asset["views"][direction]
            img = Image.open(OUT/view["source"]).convert("RGBA")
            alpha = img.getchannel("A")
            alpha.save(OUT/(Path(view["source"]).stem+"_alpha.png"))
            box = alpha.getbbox()
            measures.append({"key":view["key"],"alphaBBox":box,"displayBodySize":[round((box[2]-box[0])*.6,2),round((box[3]-box[1])*.6,2)]})
            crop = img.crop((box[0]-8,box[1]-8,box[2]+8,box[3]+8))
            zoom = min(2.3, 235 / crop.height)
            crop = crop.resize((round(crop.width*zoom),round(crop.height*zoom)),Image.Resampling.LANCZOS)
            poster.alpha_composite(crop,(x+(330-crop.width)//2,182+j*260))
        label(poster,(x+22,712),"双墙向放大展示 · 非镜像",18)
    label(poster,(35,773),"原显示尺寸挂墙 · 稀疏混排 · 柔光示意",25)
    cells = [(i,0) for i in range(11)]
    jobs = wall_jobs(cells,(180,990),walls,geo)
    jobs += wall_jobs([(0,i) for i in range(11)],(1535,990),walls,geo)
    for i,asset in enumerate(cfg["assets"]):
        direction = "down" if i<3 else "up"
        cell = ((2+i*3,0) if i<3 else (0,2+(i-3)*5))
        offset = (180,990) if i<3 else (1535,990)
        jobs += plant_jobs(asset,cell,offset,direction,cfg)
    paint(poster,jobs)
    label(poster,(35,1310),"离线素材拼装，非实机截图；运行时使用现有局部柔光，不改变碰撞、门动画或固定EXE。",21)
    poster.convert("RGB").save(OUT/"swamp-wall-plants-overview.jpg",quality=95)
    # Native scale room illustration: five lights on the two camera-facing inner walls.
    room = Image.new("RGBA",(1900,1220),(18,27,20,255))
    floor = Image.open(ROOT/"assets/terrain/floor_swamp_wet_seamless.png").convert("RGBA").resize((512,512))
    for y in range(0,1220,512):
        for x in range(0,1900,512):room.paste(floor,(x,y))
    room.alpha_composite(Image.new("RGBA",room.size,(8,15,10,110)))
    cells = set([(i,0) for i in range(13)]+[(0,i) for i in range(13)]+[(12,i) for i in range(13)]+[(i,12) for i in range(13)])
    offset = (950,305)
    jobs = wall_jobs(cells,offset,walls,geo)
    for asset,cell,direction in zip(cfg["assets"],[(2,0),(6,0),(10,0),(0,4),(0,9)],["down"]*3+["up"]*2):
        jobs += plant_jobs(asset,cell,offset,direction,cfg)
    paint(room,jobs)
    label(room,(35,25),"细碎枯枝墙 + 五款发光植物 · 离线搭配预览",30)
    label(room,(35,76),"原显示尺寸；手工示例点位，非实际房间随机结果或门口验证。",21)
    room.convert("RGB").save(OUT/"swamp-wall-plants-room.jpg",quality=95)
    write_json(OUT/"asset-measurements.json",{"kind":"offline source alpha measurements only","views":measures})
    if args.install:
        for asset in cfg["assets"]:
            for view in asset["views"].values():
                target = ROOT/view["src"]
                target.parent.mkdir(parents=True,exist_ok=True)
                shutil.copyfile(OUT/view["source"],target)
        for target in (ROOT/"data/swamp-wall-plants.json",ROOT/"public/data/swamp-wall-plants.json"):
            write_json(target,cfg)
        write_json(OUT/"installation.json",{"developmentInstalled":True,"fixedExeUpdated":False,
            "userRequest":"墙壁小物同步生成五个，可以帮我做点发光植物挂上去形成光源",
            "runtimeAcceptance":"pending user test","config":"data/swamp-wall-plants.json"})
    print("SWAMP_PLANT_ASSETS_COMPOSED",OUT,"installed",args.install)


if __name__ == "__main__":main()
