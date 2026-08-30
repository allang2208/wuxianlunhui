"""Offline candidate sheets; no game launch, installation or runtime claims."""
import importlib.util
import json
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "_mine_wall_a_rockface_20260830"
OLD = HERE / "_abandoned_mine_wall_kit_20260828"
spec = importlib.util.spec_from_file_location("mine_wall_composite", HERE / "finalize-abandoned-mine-wall-kit-ai12.py")
kit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(kit)
FONT_PATH = "C:/Windows/Fonts/msyh.ttc"


def label(canvas, xy, text, size=22, color=(207,215,217)):
    ImageDraw.Draw(canvas).text(xy, text, font=ImageFont.truetype(FONT_PATH,size), fill=color)


def wall_jobs(cells, origin, sprite, geo):
    # Shared corner deduplicated by grid coordinate; fixed +/-64,+32 pitches.
    jobs = []
    for u,v in sorted(set(cells), key=lambda p:(sum(p),p)):
        c = (origin[0]+(u-v)*64, origin[1]+(u+v)*32)
        jobs.append((c[1]+4,"wall",(sprite,c,geo)))
    return jobs


def paint(canvas, jobs):
    for _,kind,payload in sorted(jobs,key=lambda j:j[0]):
        if kind == "wall":
            kit.paste_ground(canvas,*payload)
        else:
            kit.paste_gate(canvas,*payload)


def gate_jobs(a, frame, geo):
    b = (a[0]+384,a[1]+192)
    x0,x1 = geo["gateX"]
    jobs=[]
    for i in range(geo["depthSlices"]):
        tx0=x0+(x1-x0)*i/geo["depthSlices"]
        tx1=x0+(x1-x0)*(i+1)/geo["depthSlices"]
        y1=a[1]+(tx1-geo["base"][0][0])/(geo["base"][1][0]-geo["base"][0][0])*192
        jobs.append((y1+3.9,"gate",(kit.gate_slice(frame,math.floor(tx0),math.ceil(tx1)),a,b,geo)))
    return jobs


def main():
    geo=json.loads((OUT/"geometry.json").read_text(encoding="utf-8"))
    oldgeo=json.loads((OLD/"geometry.json").read_text(encoding="utf-8"))
    native=Image.open(OUT/"wall_a_native.png").convert("RGBA")
    native.getchannel("A").save(OUT/"wall_a_alpha.png")
    candidate=native
    candidate_stage="原生PBR模型候选"
    old=Image.open(ROOT/"assets/terrain/abandoned_mine_wall_block_a.png").convert("RGBA")
    # A neutral matte image is safe for later img2img; transparent-black RGB
    # must not become a painted dark outline in the generated material.
    init=Image.new("RGB",native.size,(160,160,160))
    init.paste(native,mask=native.getchannel("A"))
    init.save(OUT/"wall_a_init.png")
    compare=Image.new("RGBA",(1200,940),(29,33,37,255))
    label(compare,(30,22),"矿洞 A 款 · 连续开凿岩面 / 独立候选，未替换游戏素材",28)
    for i,(sprite,title) in enumerate(((old,"旧版：堆石 + 重复木撑"),(candidate,"新A款：连续岩层 / "+candidate_stage))):
        preview=sprite.resize((580,580),Image.Resampling.LANCZOS)
        compare.alpha_composite(preview,(10+600*i,80))
        label(compare,(24+600*i,660),title)
        kit.paste_ground(compare,sprite,(300+600*i,900),geo)
    label(compare,(30,711),"下排：按现有 260×259 画布显示；占地128×64 / 原锚点 / 禁止翻转光向",18)
    compare.save(OUT/"wall-a-comparison.png")
    sheet=Image.new("RGBA",(1700,1780),(24,29,33,255))
    label(sheet,(32,24),"矿洞岩壁 · 离线拼装样张",30)
    label(sheet,(32,69),"固定 ±64,+32 步长；同一A款；转角共用一块；未运行游戏",19)
    label(sheet,(35,118),"01  正向连续墙 · 8格")
    paint(sheet,wall_jobs([(i,0) for i in range(8)],(165,325),candidate,geo))
    label(sheet,(895,118),"02  反向连续墙 · 8格（无镜像）")
    paint(sheet,wall_jobs([(0,i) for i in range(8)],(1510,325),candidate,geo))
    label(sheet,(35,650),"03  双臂转角 · 顶角只放一块")
    paint(sheet,wall_jobs([(i,0) for i in range(5)]+[(0,i) for i in range(5)],(360,860),candidate,geo))
    label(sheet,(895,650),"04  闭合小房间 · 四角共享")
    cells=[(i,0) for i in range(5)]+[(i,4) for i in range(5)]+[(0,i) for i in range(5)]+[(4,i) for i in range(5)]
    paint(sheet,wall_jobs(cells,(1250,850),candidate,geo))
    for column,frame_index in enumerate((0,15)):
        label(sheet,(35+860*column,1210),f"0{5+column}  墙—旧门—墙 · 帧{frame_index} / 6层排序")
        origin=(200+860*column,1430)
        frame=Image.open(OLD/f"generation/final_12step/gate_frames/gate_{frame_index:02d}.png").convert("RGBA")
        jobs=wall_jobs([(-1,0),(0,0),(6,0),(7,0)],origin,candidate,geo)
        jobs+=gate_jobs(origin,frame,oldgeo["gate"])
        paint(sheet,jobs)
    label(sheet,(35,1738),"门仅作既有接口参照，本轮未重做门；单A长距离重复感与游戏遮挡仍待后续处理。",18)
    sheet.save(OUT/"wall-a-seam-assembly.png")
    # Ground context uses the installed slate floor, without pretending this
    # is a screenshot or reproducing game noise/decal/occlusion systems.
    floor=Image.open(ROOT/"assets/terrain/floor_abandoned_mine_seamless.png").convert("RGB").resize((512,512),Image.Resampling.LANCZOS)
    context=Image.new("RGBA",(1200,880),(26,30,34,255))
    for y in range(0,880,512):
        for x in range(0,1200,512):
            context.paste(floor,(x,y))
    context.alpha_composite(Image.new("RGBA",context.size,(12,17,21,105)))
    cells=[(i,0) for i in range(7)]+[(0,i) for i in range(6)]
    paint(context,wall_jobs(cells,(560,280),candidate,geo))
    label(context,(30,24),"现有冷灰矿洞地板 + 新岩壁（离线搭配示意）",26)
    context.save(OUT/"wall-a-floor-context.png")
    manifest={"stage":candidate_stage,"runtimeInstalled":False,"geometry":"geometry.json",
              "model":"mine_wall_a_rockface.blend","native":"wall_a_native.png",
              "candidate":"wall_a_native.png",
              "bodyDepth":"wall_a_body_depth.png","alpha":"wall_a_alpha.png",
              "oldGateSource":"../_abandoned_mine_wall_kit_20260828/generation/final_12step/gate_frames",
              "previews":["wall-a-comparison.png","wall-a-seam-assembly.png","wall-a-floor-context.png"],
              "scope":"A baseline only; B/C, gate, formal assets and runtime untouched",
              "assembly":"Offline same-anchor sprite composition, not runtime verification",
              "knownLimits":["Only A is new; old B/C are not style-matched","Old gate shown only as interface reference",
                             "Fixed sprite lighting and repeat motifs remain visible at long distances"]}
    (OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    print("Wrote candidate comparison, seam assembly, floor context and manifest:",OUT)


if __name__=="__main__":
    main()
