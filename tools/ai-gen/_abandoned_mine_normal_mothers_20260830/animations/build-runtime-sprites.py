#!/usr/bin/env python3
"""Compact runtime sheets derived only from the approved mine monster keys."""
from __future__ import annotations

import argparse
import importlib.util
import json
import math
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
OUT = ROOT / "runtime-build"
spec = importlib.util.spec_from_file_location("mine_sprite_helpers", ROOT / "build-sprites.py")
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
ASSETS = {"core-drill-larva":"core_drill_larva", "ore-shardling":"ore_shardling"}
STATE_MAP = {"idle":"idle", "walking":"walk", "attacking":"attack", "dying":"death"}


def write(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def prepare():
    retained=OUT/"source-manifest.json"
    if retained.exists():
        records=json.loads(retained.read_text(encoding="utf-8"))["actions"]
        if len(records)==8 and all((ROOT/r["source"]).is_file() for r in records):
            print("[runtime keys] Using retained approved RIFE inputs; no second resampling.",flush=True)
            return
    master=json.loads((ROOT/"sprite-build/source-manifest.json").read_text(encoding="utf-8"))
    if not all((ROOT/a["sheet"]).is_file() for a in master["actions"]):
        raise RuntimeError("Missing retained RIFE input. Restore it from the accepted archive, or explicitly rebuild video cutouts/source sheets with build-sprites.py before prepare.")
    records=[]
    for action in master["actions"]:
        asset,state=action["asset"],action["state"]
        original=action["sourceFrameIndices"]
        indices=original
        if state=="attacking":
            indices=list(range(24,97,4)) if asset=="core-drill-larva" else list(range(12,113,4))
        elif state=="dying":
            indices=list(range(0,121,4))
        w,h=action["transform"]["frameWidth"]//2, action["transform"]["frameHeight"]//2
        src=np.asarray(Image.open(ROOT/action["sheet"]).convert("RGBA"))
        cells=[]
        for source_index in indices:
            i=original.index(source_index)
            x=i%action["cols"]*w*2;y=i//action["cols"]*h*2
            rgba=np.asarray(Image.fromarray(src[y:y+h*2,x:x+w*2]).resize((w,h),Image.Resampling.LANCZOS)).copy()
            rgba[rgba[...,3]==0,:3]=0
            cells.append(rgba)
        cols=8
        sheet=np.zeros((math.ceil(len(cells)/cols)*h,cols*w,4),np.uint8)
        for i,cell in enumerate(cells):
            sheet[i//cols*h:(i//cols+1)*h,i%cols*w:(i%cols+1)*w]=cell
        source=OUT/asset/"source"/f"{STATE_MAP[state]}.png"
        source.parent.mkdir(parents=True,exist_ok=True)
        Image.fromarray(sheet).save(source)
        mode=action["mode"]
        count=len(cells)*2-(mode=="one-shot")
        if state=="idle": duration=count/24*1000
        elif state=="walking": duration=1000
        elif state=="attacking": duration=1200 if asset=="core-drill-larva" else 1600
        else: duration=1600 if asset=="core-drill-larva" else 1800
        contact_source=60 if asset=="core-drill-larva" else 68
        record={"asset":asset,"family":ASSETS[asset],"state":STATE_MAP[state],"source":source.relative_to(ROOT).as_posix(),"sourceVideo":action["sourceVideo"],"sourceFrameIndices":indices,"sourceFrameCount":len(cells),"frameWidth":w,"frameHeight":h,"columns":cols,"frameCount":count,"footY":action["transform"]["footY"]/2,"duration":duration,"frameRate":count*1000/duration,"mode":mode,"repeat":-1 if mode=="loop" else 0}
        if state=="attacking": record["contactFrame"]=indices.index(contact_source)*2
        records.append(record)
        helper.previews(cells,OUT/asset/"previews"/f"{STATE_MAP[state]}-keys",count*500/duration,state,indices)
        print(f"[runtime keys] {asset}/{state}: {len(cells)} -> {count}, {w}x{h}, {duration:.1f} ms",flush=True)
    write(OUT/"source-manifest.json",{"actions":records})


def build():
    prepare()
    records=json.loads((OUT/"source-manifest.json").read_text(encoding="utf-8"))["actions"]
    for rec in records:
        dest=REPO/"assets/enemies"/rec["family"]/f"{rec['state']}.png"
        report=OUT/rec["asset"]/"reports"/f"{rec['state']}.json"
        cmd=[sys.executable,str(REPO/"tools/ai-gen/rife-spritesheet-interpolate.py"),"--sheet",str(ROOT/rec["source"]),"--out",str(dest),"--name",f"{rec['family']}-{rec['state']}","--frame-width",str(rec["frameWidth"]),"--frame-height",str(rec["frameHeight"]),"--cols","8","--frame-count",str(rec["sourceFrameCount"]),"--frame-rate",str(rec["frameRate"]/2),"--mode",rec["mode"],"--out-cols","8","--preview-dir",str(OUT/rec["asset"]/"previews/rife"),"--report",str(report),"--repair-red-outliers","--preserve-vertical-motion"]
        subprocess.run(cmd,check=True,stdout=subprocess.DEVNULL)
        result=json.loads(report.read_text(encoding="utf-8"))
        checks=result["validation"]
        if checks["emptyFrames"] or checks["touchingFrames"] or not checks["originalKeyFramesPreservedAtEvenIndices"] or checks["nonzeroRgbInTransparentPixels"] or checks["visibleDarkOutlierFrames"] or checks["visibleRedOutlierFrames"] or checks["middleFrameHeldSourceKeyFallbacks"]:
            raise RuntimeError(f"Runtime sprite production needs review: {rec['asset']}/{rec['state']}")
        rec["sheet"]=dest.relative_to(REPO).as_posix()
        rec["report"]=report.relative_to(ROOT).as_posix()
        rec["productionMetrics"]=checks
        sheet=np.asarray(Image.open(dest).convert("RGBA"))
        w,h=rec["frameWidth"],rec["frameHeight"]
        cells=[sheet[i//8*h:(i//8+1)*h,i%8*w:(i%8+1)*w].copy() for i in range(rec["frameCount"])]
        helper.previews(cells,OUT/rec["asset"]/"previews"/rec["state"],rec["frameRate"],rec["state"])
        print(f"[runtime ready] {rec['sheet']} / {rec['frameCount']} frames",flush=True)
    write(OUT/"runtime-manifest.json",{"sourceApproval":"User requested uniform scale, optimized interpolation and game integration", "runtimeIntegrationActive":True,"assetOnly":False,"sourceMotionPolicy":"Uniform half-size scaling across each monster; trim attack holds and resample only original keys; preserve translation, turn, recoil and final corpse. No second interpolation of interpolated frames.","actions":records})


def previews():
    """Delivery boards only: game-config scale, no game/browser/runtime execution."""
    configs=json.loads((REPO/"data/enemy-config.json").read_text(encoding="utf-8"))
    records=json.loads((OUT/"runtime-manifest.json").read_text(encoding="utf-8"))["actions"]
    keys={"core-drill-larva":"coreDrillLarva","ore-shardling":"oreShardling"}
    font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",22)
    small=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",16)
    def paste_cell(canvas,cell,cx,foot,foot_y,scale,alpha=1):
        sprite=cell.resize((round(cell.width*scale),round(cell.height*scale)),Image.Resampling.LANCZOS)
        if alpha<1:
            sprite.putalpha(sprite.getchannel("A").point(lambda a:round(a*alpha)))
        canvas.paste(sprite,(round(cx-sprite.width/2),round(foot-foot_y*scale)),sprite)
    cells={}
    for rec in records:
        sheet=Image.open(REPO/rec["sheet"]).convert("RGBA")
        w,h=rec["frameWidth"],rec["frameHeight"]
        cells[(rec["asset"],rec["state"])]=[sheet.crop((i%8*w,i//8*h,(i%8+1)*w,(i//8+1)*h)) for i in range(rec["frameCount"])]
    board=Image.new("RGB",(1060,450),"#20242a")
    draw=ImageDraw.Draw(board)
    draw.text((24,15),"同一比例 / 共用地面线（2×展示，非游戏截图）",font=font,fill="white")
    draw.line((25,352,1035,352),fill="#69b7a5",width=2)
    miner=configs["minerZombie"]
    miner_cell=Image.open(REPO/miner["textures"]["idle"]).convert("RGBA").crop((0,0,512,512))
    miner_scale=miner["render"]["spriteSize"]/512
    miner_foot=256+miner["render"]["footOffsetY"]/miner_scale
    paste_cell(board,miner_cell,180,352,miner_foot,miner_scale*2)
    draw.text((82,386),"矿工僵尸 / 4级基准",font=font,fill="white")
    for n,(asset,key) in enumerate(keys.items()):
        cfg=configs[key];layout=cfg["textures"]["frameLayouts"]["idle"]
        cx=525+n*345
        scale=cfg["render"]["spriteSize"]/cfg["textures"]["referenceCell"]*2
        paste_cell(board,cells[(asset,"idle")][0],cx,352,layout["footY"],scale)
        draw.text((cx-96,386),cfg["name"],font=font,fill="white")
        draw.text((cx-100,418),f"主体 {cfg['height']}px · 脚点固定",font=small,fill="#b9c8d4")
    board.save(OUT/"size-comparison.png")
    frames=[]
    labels={"idle":"待命","walk":"移动","attack":"攻击","death":"死亡"}
    for tick in range(144):
        time_ms=tick*25
        canvas=Image.new("RGB",(1280,620),"#20242a")
        draw=ImageDraw.Draw(canvas)
        for rec in records:
            asset,state=rec["asset"],rec["state"]
            row=list(keys).index(asset);col=list(labels).index(state)
            cfg=configs[keys[asset]]
            x,y=col*320,row*310
            loop=rec["repeat"]<0
            elapsed=time_ms%rec["duration"] if loop else time_ms
            frame=min(rec["frameCount"]-1,int(elapsed/rec["duration"]*rec["frameCount"]))
            alpha=1
            if state=="death":
                alpha=max(0,min(1,(rec["duration"]+cfg["death"]["holdMs"]+cfg["death"]["fadeMs"]-time_ms)/cfg["death"]["fadeMs"]))
            draw.line((x+12,y+255,x+308,y+255),fill="#517567",width=1)
            scale=cfg["render"]["spriteSize"]/cfg["textures"]["referenceCell"]*2
            paste_cell(canvas,cells[(asset,state)][frame],x+160,y+255,rec["footY"],scale,alpha)
            draw.text((x+12,y+12),f"{cfg['name']} · {labels[state]}",font=small,fill="white")
            caption=f"{rec['frameCount']}帧 / {rec['duration']/1000:.2f}s"
            if state=="attack":caption+=f" / 命中f{rec['contactFrame']}"
            draw.text((x+12,y+278),caption,font=small,fill="#b9c8d4")
        frames.append(canvas)
    frames[0].save(OUT/"runtime-overview.gif",save_all=True,append_images=frames[1:],duration=helper.gif_timing(len(frames),40),loop=0,disposal=2,optimize=False)
    frames[0].save(OUT/"runtime-overview.png")
    print("[delivery previews] size-comparison.png + runtime-overview.gif",flush=True)


if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("stage",choices=("prepare","build","previews"))
    globals()[parser.parse_args().stage]()
