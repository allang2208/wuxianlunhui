"""Offline authored preview from installed configuration, not a game/runtime test."""
from pathlib import Path
import bisect
import json
import math

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
cfg = json.loads((REPO/"data/enemy-config.json").read_text(encoding="utf-8"))["coffinWard"]
labels = {"idle":"待机", "walk":"行走", "attack":"单体拳砸", "death":"死亡 / 停尸 / 淡出"}
scale = cfg["render"]["spriteSize"] / cfg["textures"]["referenceCell"]
layouts = cfg["textures"]["frameLayouts"]
sequences, boundaries = {}, {}
font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",14)
small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",11)
for state,layout in layouts.items():
    sheet = Image.open(REPO/cfg["textures"][state]).convert("RGBA")
    w,h,cols = layout["frameWidth"],layout["frameHeight"],layout["columns"]
    sequences[state] = []
    for index in range(layout["frameCount"]):
        x,y = index%cols*w,index//cols*h
        cell = sheet.crop((x,y,x+w,y+h))
        sequences[state].append(cell.resize((round(w*scale),round(h*scale)),Image.Resampling.LANCZOS))
    elapsed = 0
    boundaries[state] = []
    for duration in layout["frameDurations"]:
        boundaries[state].append(elapsed)
        elapsed += duration

death_duration = layouts["death"]["duration"]
fade_start = death_duration + cfg["death"]["holdMs"]
end = fade_start + cfg["death"]["fadeMs"]
count = math.ceil((end+500)*24/1000)
frames=[]
for index in range(count):
    elapsed=index/24*1000
    board=Image.new("RGB",(480,500),(30,33,40))
    draw=ImageDraw.Draw(board)
    draw.text((10,8),"配置时钟离线预览 · 非游戏截图",font=font,fill="white")
    for panel,(state,layout) in enumerate(layouts.items()):
        x,y=panel%2*240,32+panel//2*234
        draw.text((x+10,y+4),labels[state],font=font,fill=(225,228,233))
        t=elapsed%layout["duration"] if layout["repeat"] == -1 else min(elapsed,layout["duration"])
        frame_index=max(0,bisect.bisect_right(boundaries[state],t)-1)
        frame=sequences[state][frame_index].copy()
        alpha=1
        if state == "death" and elapsed>=fade_start:
            alpha=max(0,(end-elapsed)/cfg["death"]["fadeMs"])
            frame.putalpha(frame.getchannel("A").point(lambda value:round(value*alpha)))
        for gy in range(y+30,y+202,12):
            for gx in range(x+4,x+236,12):
                shade=48 if ((gx-x)//12+(gy-y)//12)%2 else 57
                draw.rectangle((gx,gy,min(x+235,gx+11),min(y+201,gy+11)),fill=(shade,shade+3,shade+7))
        px=round(x+120-layout["footX"]*scale)
        py=round(y+198-layout["footY"]*scale)
        board.paste(frame,(px,py),frame)
        phase = "" if state != "death" else ("倒地" if elapsed<death_duration else "停尸" if elapsed<fade_start else "淡出" if elapsed<end else "结束")
        draw.text((x+10,y+207),f"帧 {frame_index}  {min(elapsed/1000,layout['duration']/1000):.2f}s  {phase}",font=small,fill=(186,193,205))
    frames.append(board)
durations=[round((i+1)*1000/24/10)*10-round(i*1000/24/10)*10 for i in range(count)]
out=ROOT/"runtime/config-clock-preview.gif"
frames[0].save(out,save_all=True,append_images=frames[1:],duration=durations,loop=0,disposal=2,optimize=False)
runtime=json.loads((ROOT/"runtime/manifest.json").read_text(encoding="utf-8"))
runtime.update(configClockPreview="runtime/config-clock-preview.gif",previewKind="offline composition from configured frames, scale and lifecycle; not runtime verification")
(ROOT/"runtime/manifest.json").write_text(json.dumps(runtime,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")
print(f"Produced {out.name}, {sum(durations)}ms; no game process launched.")
