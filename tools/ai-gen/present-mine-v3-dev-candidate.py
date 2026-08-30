"""Render offline candidate assemblies and full-leaf motion; no runtime changes."""
import importlib.util
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw

HERE=Path(__file__).resolve().parent
SOURCE=HERE/"_mine_visual_finish_v3_20260830"
OUT=SOURCE/"dev-candidate"
spec=importlib.util.spec_from_file_location("v3_candidate_present",HERE/"finish-mine-v3-presentation.py")
p=importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
label, render = p.label, p.render


def main():
    geometry=json.loads((SOURCE/"geometry.json").read_text(encoding="utf-8"))
    wg,gg=geometry["wall"],geometry["gate"]
    walls={k:Image.open(OUT/f"wall_{k}.png").convert("RGBA") for k in "abc"}
    gate=Image.open(OUT/"gate.png").convert("RGBA")
    contact=Image.new("RGBA",(1600,1180),(24,29,33,255))
    label(contact,(30,20),"矿洞v3 · 新Dev材质整套候选 / 未安装",29)
    label(contact,(30,64),"岩体：同源周期材质重新渲染；木铁：Dev细节回到原组件；原模型、相机与接缝不变。",19)
    for i,key in enumerate("abc"):
        contact.alpha_composite(walls[key].resize((500,500),Image.Resampling.LANCZOS),(15+530*i,95))
        label(contact,(35+530*i,595),{"a":"A 连续岩体","b":"B 稀疏矿脉","c":"C 木撑补强"}[key],24)
    for col,(path,title) in enumerate(((SOURCE/"gate_native.png","本地门模型"),(OUT/"gate.png","Dev木铁候选 / 保留原Alpha"))):
        contact.alpha_composite(Image.open(path).convert("RGBA").resize((540,540),Image.Resampling.LANCZOS),(90+800*col,615))
        label(contact,(35+800*col,1130),title,22)
    contact.save(OUT/"asset-contact.png")

    sheet=Image.new("RGBA",(1800,1770),(24,29,33,255))
    label(sheet,(30,20),"新Dev矿洞墙门 · 按运行时坐标选款的离线拼装",29)
    label(sheet,(30,65),"示例原点(4096,4096)；固定±64,+32步长，墙不镜像。候选未替换正式PNG。",19)
    for flip in (False,True):
        cells=[(0,i) if flip else (i,0) for i in range(10)]
        render.paint(sheet,p.wall_jobs(cells,(1640 if flip else 160,315),walls,wg))
    corner=[(i,0) for i in range(5)]+[(0,i) for i in range(5)]
    ring=[(i,0) for i in range(5)]+[(i,4) for i in range(5)]+[(0,i) for i in range(5)]+[(4,i) for i in range(5)]
    render.paint(sheet,p.wall_jobs(corner,(450,915),walls,wg))
    render.paint(sheet,p.wall_jobs(ring,(1280,900),walls,wg))
    for flip in (False,True):
        p.doorway(sheet,(1590 if flip else 200,1450),walls,gate,wg,gg,flip)
    label(sheet,(30,1715),"重复纹理与木撑连续出现须如实保留；本图不是游戏截图，未验证随机布局或动态遮挡。",19)
    sheet.save(OUT/"assembly.png")

    room=Image.new("RGBA",(1600,1100),(16,21,25,255))
    diamond=Image.new("L",room.size)
    ImageDraw.Draw(diamond).polygon([(800,295),(1470,630),(800,965),(130,630)],fill=255)
    room.paste(p.floor(room.size),(0,0),diamond)
    sizing=json.loads((SOURCE/"prop-sizing.json").read_text(encoding="utf-8"))
    positions=[(800,450),(615,565),(970,620),(530,680),(910,490),(1120,700),
               (748,680),(720,780),(1040,790),(510,770),(865,850),(1190,600)]
    for asset,point in zip(sizing,positions):
        prop=Image.open(SOURCE/"props"/(asset["key"]+".png")).convert("RGBA")
        p.anchored(room,prop,point,asset["proposedSize"]*.8)
    cells=[(i,0) for i in range(11)]+[(0,i) for i in range(11)]
    render.paint(room,p.wall_jobs(cells,(800,295),walls,wg))
    label(room,(30,20),"新Dev墙面候选 + 已接入12件小物 + 当前正式地板",28)
    label(room,(30,65),"离线美术组合；墙按运行时规则选款，小物人为摆放、前墙省略，不代表真实随机布局。",18)
    label(room,(30,1038),"不加预览专用滤镜；候选墙未安装，地板/小物未修改，实机层次与可读性仍待用户测试。",18)
    room.save(OUT/"room-presentation.png")

    # Reuse the exact currently configured authored lift trajectory.
    import re
    config=(HERE.parents[1]/"src/world/wall-system.js").read_text(encoding="utf-8")
    match=re.search(r"leafMotion:\s*\{\s*fadeFraction:\s*([\d.]+),\s*liftPixels:\s*(\[[^\]]+\])",config)
    fade,lifts=float(match[1]),json.loads(match[2])
    # Preserve the existing 4x4 loader layout. Runtime full-leaf motion reads
    # frame zero and translates/fades the complete leaf, avoiding sheet clipping.
    frame_dir=OUT/"gate_frames"
    frame_dir.mkdir(exist_ok=True)
    sheet=Image.new("RGBA",(2560,2560))
    for index,lift in enumerate(lifts):
        leaf=Image.new("RGBA",(640,640))
        leaf.alpha_composite(gate,(0,-round(lift)))
        leaf.save(frame_dir/f"gate_{index:02d}.png")
        sheet.alpha_composite(leaf,((index%4)*640,(index//4)*640))
    sheet.save(OUT/"abandoned_mine_gate.png")
    def frame(openness):
        progress=min(1,openness/(1-fade))*(len(lifts)-1)
        lo=math.floor(progress)
        lift=lifts[lo]+(lifts[min(lo+1,len(lifts)-1)]-lifts[lo])*(progress-lo)
        t=max(0,min(1,(openness-(1-fade))/fade))
        alpha=1-t*t*(3-2*t)
        canvas=Image.new("RGBA",(1340,870),(24,29,33,255))
        label(canvas,(24,18),"新Dev门叶候选 · 原轨迹 / 720ms升降 + 180ms淡化",25)
        for flip in (False,True):
            origin=(1195 if flip else 145,550)
            cells=[(0,i) if flip else (i,0) for i in (-1,0,6,7)]
            jobs=p.wall_jobs(cells,origin,walls,wg)
            for depth,kind,(sprite,position) in render.gate_jobs(origin,gate,gg,flip):
                sprite.putalpha(sprite.getchannel("A").point(lambda a:round(a*alpha)))
                sy=192/(gg["base"][1][1]-gg["base"][0][1])
                jobs.append((depth,kind,(sprite,(position[0],round(position[1]-lift*sy)))))
            render.paint(canvas,jobs)
        label(canvas,(24,817),"完整门叶渐显后落下，升起后淡出；仅素材演示，未安装或运行游戏。",18)
        return canvas.convert("RGB")
    sequence=[(1,500)]+[(1-t/900,30) for t in range(0,900,30)]+[(0,650)]+[(t/900,30) for t in range(0,900,30)]
    frames=[frame(value) for value,_ in sequence]
    frames[0].save(OUT/"gate-motion.gif",save_all=True,append_images=frames[1:],duration=[ms for _,ms in sequence],loop=0,disposal=2)
    manifest_path = OUT/"manifest.json"
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    manifest = {
        "stage":"new Dev material candidate; not accepted or installed","runtimeInstalled":False,
        "model":"mine_visual_v3.blend","geometry":"geometry.json","rockSource":"material-source.json",
        "woodIronSource":"component-materials.json","walls":{k:f"wall_{k}.png" for k in "abc"},
        "gate":{"closedLeaf":"gate.png","sheet":"abandoned_mine_gate.png","frameSize":[640,640],
                "frameCount":len(lifts),"liftPixels":lifts,"fadeFraction":fade,
                "runtimeMotion":"existing full-leaf frame-zero motion; original sheet frames remain canvas-clipped"},
        "previewContract":"../manifest.json:previewContract",
        "previews":["asset-contact.png","assembly.png","room-presentation.png","gate-motion.gif"],
        "limits":["authored offline layouts only, not game screenshots","finite ABC variants and repeated support placement remain recognizable"],
        "tests":"未运行测试或运行时验证，按约定由用户测试。",
    }
    # A presentation rebuild is not a runtime installation or a new approval.
    for key in ("stage", "runtimeInstalled", "installationRecord", "installedOn", "cleanup"):
        if key in previous:
            manifest[key] = previous[key]
    manifest["workingOutputStatus"] = "rebuilt source output; last installation record unchanged"
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


if __name__=="__main__":
    main()
