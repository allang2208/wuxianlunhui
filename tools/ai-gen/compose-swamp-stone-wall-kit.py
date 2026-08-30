"""Compose authored asset previews, geometry data and optional installation.

This is an offline sprite production step, not a game/runtime test. Wall
selection and depth use the same world-coordinate maths as CombatRoomSystem.
"""
import argparse
import json
import math
import shutil
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"tools/ai-gen/_swamp_stone_wall_kit_20260830"
FONT="C:/Windows/Fonts/msyh.ttc"
ORIGIN=(2048,2048)


def write_json(path,data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def label(image,xy,text,size=23):
    ImageDraw.Draw(image).text(xy,text,font=ImageFont.truetype(FONT,size),fill=(222,228,210))


def world(cell):
    u,v=cell
    return ORIGIN[0]+(u-v)*64,ORIGIN[1]+(u+v)*32


def variant(center):
    x,y=[math.floor(v+.5) for v in center]
    h=((x*73856093)^(y*19349663)^0x07a6b1d5)&0xffffffff
    return (h>>8)%4


def wall_jobs(cells,offset,sprites,geo):
    jobs=[]
    cells=set(cells)
    for u,v in sorted(cells,key=lambda p:(sum(p),p)):
        center=world((u,v))
        ends=[center[1]]
        for neighbor in ((u+1,v),(u-1,v),(u,v+1),(u,v-1)):
            if neighbor in cells:
                ends.append((center[1]+world(neighbor)[1])/2)
        depth=max(ends)+4
        image=sprites[variant(center)].resize((260,259),Image.Resampling.LANCZOS)
        x=offset[0]+center[0]-ORIGIN[0]-geo["groundCenter"][0]*260/1024
        y=offset[1]+center[1]-ORIGIN[1]-geo["groundCenter"][1]*259/1024
        jobs.append((depth,image,(round(x),round(y))))
    return jobs


def gate_jobs(offset,frame,geo,flip=False):
    p0,p1=geo["base"]
    sx,sy=384/(p1[0]-p0[0]),192/(p1[1]-p0[1])
    x=offset[0]-(640-p0[0] if flip else p0[0])*sx
    y=offset[1]-p0[1]*sy
    jobs=[]
    for i in range(6):
        x0,x1=32+i*96,32+(i+1)*96
        sliced=Image.new("RGBA",frame.size)
        sliced.paste(frame.crop((x0,0,x1,640)),(x0,0))
        if flip:sliced=sliced.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        sliced=sliced.resize((round(640*sx),round(640*sy)),Image.Resampling.LANCZOS)
        end=x0 if i==0 else x1
        depth=ORIGIN[1]+(end-p0[0])*192/(p1[0]-p0[0])+3.9
        jobs.append((depth,sliced,(round(x),round(y))))
    return jobs


def paint(image,jobs):
    for _,sprite,position in sorted(jobs,key=lambda job:job[0]):
        image.alpha_composite(sprite,position)


def main():
    parser=argparse.ArgumentParser(description="Compose only the accepted vine gate; retired stone walls are never installed.")
    parser.add_argument("--install",action="store_true")
    parser.add_argument("--gate-only",action="store_true",help="Compatibility flag; this composer now always updates only the gate")
    args=parser.parse_args()
    installed=json.loads((ROOT/"data/swamp-stone-wall-kit.json").read_text(encoding="utf-8"))
    geometry=json.loads((OUT/"geometry.json").read_text(encoding="utf-8"))
    manifest_path=OUT/"manifest.json"
    manifest=json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    frames=[Image.open(OUT/"gate_frames"/f"gate_{i:02d}.png").convert("RGBA") for i in range(16)]
    sheet=Image.new("RGBA",(2560,2560))
    for i,frame in enumerate(frames):sheet.paste(frame,((i%4)*640,(i//4)*640))
    sheet.save(OUT/"swamp_stone_gate.png",optimize=True)
    gate=geometry["gate"]
    runtime={"tex":"swamp_stone_gate","source":"assets/terrain/swamp_stone_gate.png",
        "w":640,"h":640,"frames":16,**{k:gate[k] for k in ("base","face","gateX","wallH","slope","halfThick","depthSlices","tuckEndSlices","hideWhenOpen")},
        "editor":"沼泽六格双向生长藤蔓门","states":{"open":{"hole":[32,608]},"closed":{"hole":None}}}
    asset_data={**installed,"geometry":{**installed["geometry"],"swamp_stone_gate":runtime}}
    write_json(OUT/"runtime-wall-kit.json",asset_data)
    if args.install:
        shutil.copyfile(OUT/"swamp_stone_gate.png",ROOT/runtime["source"])
        for target in (ROOT/"data/swamp-stone-wall-kit.json",ROOT/"public/data/swamp-stone-wall-kit.json"):
            write_json(target,asset_data)
    manifest.update({"runtimeInstalled":args.install or manifest.get("runtimeInstalled",False),
        "activeScope":"accepted bilateral vine gate only; stone wall renders retired",
        "model":"swamp_stone_wall_kit.blend","geometry":"geometry.json","gate":"swamp_stone_gate.png",
        "builder":"tools/ai-gen/build-swamp-stone-wall-kit.py","composer":"tools/ai-gen/compose-swamp-stone-wall-kit.py",
        "walls":[],"previews":["../_swamp_deadwood_wall_kit_20260830/deadwood-wall-vine-gate.gif"]})
    write_json(manifest_path,manifest)
    print("Gate sheet composed; wall fields preserved. Use compose-swamp-living-wall-kit.py for assembly previews.")


if __name__=="__main__":main()
