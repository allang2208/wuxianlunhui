"""Package deadwood wall art and offline layouts; preserve accepted gate bytes."""
import argparse
import importlib.util
import json
import shutil
from pathlib import Path

import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parents[2]
OUT=ROOT/"tools/ai-gen/_swamp_deadwood_wall_kit_20260830"
GATE_SOURCE=ROOT/"tools/ai-gen/_swamp_stone_wall_kit_20260830"
spec=importlib.util.spec_from_file_location("layout",ROOT/"tools/ai-gen/compose-swamp-stone-wall-kit.py")
layout=importlib.util.module_from_spec(spec)
spec.loader.exec_module(layout)


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--install",action="store_true")
    args=parser.parse_args()
    manifest_path=OUT/"manifest.json"
    previous=json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    model=json.loads((OUT/"geometry.json").read_text(encoding="utf-8"))
    current=json.loads((ROOT/"data/swamp-stone-wall-kit.json").read_text(encoding="utf-8"))
    gate=current["geometry"]["swamp_stone_gate"]
    walls=[Image.open(OUT/(g["key"]+".png")).convert("RGBA") for g in model["walls"]]
    frames=[Image.open(GATE_SOURCE/"gate_frames"/f"gate_{i:02d}.png").convert("RGBA") for i in range(16)]
    runtime={}
    report=[]
    for info,img in zip(model["walls"],walls):
        key=info["key"]
        runtime[key]={"tex":key,"source":f"assets/terrain/{key}.png","w":1024,"h":1024,
                      "groundCenter":info["groundCenter"],"displayW":260,"displayH":259,
                      "wallH":132,"halfThick":13,"footprint":[128,64],"editor":info["label"]}
        alpha=img.getchannel("A")
        alpha.save(OUT/(key+"_alpha.png"))
        rgba=np.asarray(img)/255
        lum=(rgba[:,:,:3]@[.2126,.7152,.0722])[rgba[:,:,3]>.95]
        bbox=alpha.getbbox()
        report.append({"key":key,"alphaBBox":list(bbox),
                       "visibleBodyHeight":round((info["groundCenter"][1]-bbox[1])*259/1024,3),
                       "luminanceMedian":round(float(np.median(lum)),5),"luminanceMean":round(float(lum.mean()),5)})
    runtime["swamp_stone_gate"]=gate
    data={"version":5,"wallDesign":"deadwood-thicket",
          "source":"tools/ai-gen/_swamp_deadwood_wall_kit_20260830/geometry.json",
          "gateSource":current.get("gateSource","tools/ai-gen/_swamp_stone_wall_kit_20260830/geometry.json"),"geometry":runtime}
    layout.write_json(OUT/"runtime-wall-kit.json",data)
    poster=Image.new("RGBA",(1600,1620),(23,29,25,255))
    layout.label(poster,(35,22),"沼泽地牢 · 1×1 细碎枯枝墙",32)
    layout.label(poster,(35,72),"去掉粗根、横木和大扭结｜四组固定随机碎枝：走向、分叉、疏密不同｜离线样张",20)
    for i,(img,info) in enumerate(zip(walls,model["walls"])):
        poster.alpha_composite(img.resize((380,380),Image.Resampling.LANCZOS),(10+400*i,105))
        layout.label(poster,(45+400*i,492),f"{chr(65+i)} · {info['label']}",24)
    layout.label(poster,(35,545),"双向连续混排 · +64,+32 / -64,+32 · 原显示尺寸",23)
    layout.paint(poster,layout.wall_jobs([(i,0) for i in range(8)],(155,755),walls,model["walls"][0]))
    layout.paint(poster,layout.wall_jobs([(0,i) for i in range(8)],(1450,755),walls,model["walls"][0]))
    layout.label(poster,(35,1010),"双臂转角 · 共用同一格枯枝墙",23)
    layout.paint(poster,layout.wall_jobs([(i,0) for i in range(5)]+[(0,i) for i in range(5)],(350,1235),walls,model["walls"][0]))
    layout.label(poster,(840,1010),"枯枝墙—已确认的藤蔓门—枯枝墙",23)
    layout.paint(poster,layout.wall_jobs([(-1,0),(0,0),(6,0),(7,0)],(975,1235),walls,model["walls"][0])+
                 layout.gate_jobs((975,1235),frames[0],gate))
    layout.label(poster,(35,1547),"占地128×64 / 结构墙高132保持不变｜藤蔓门的模型、16帧和碰撞接线均未改动",20)
    poster.convert("RGB").save(OUT/"deadwood-wall-overview.jpg",quality=94)
    # Isolated tiles use the exact runtime display size. These are deliberately
    # labelled swatches; all connected-wall previews still use runtime hashing.
    swatches=Image.new("RGBA",(1200,380),(23,29,25,255))
    layout.label(swatches,(25,15),"四款辨识 · 260×259原显示尺寸 · 独立色样，非铺墙序列",24)
    for i,(img,info) in enumerate(zip(walls,model["walls"])):
        swatches.alpha_composite(img.resize((260,259),Image.Resampling.LANCZOS),(20+300*i,62))
        layout.label(swatches,(43+300*i,333),f"{chr(65+i)} · {info['label']}",23)
    swatches.convert("RGB").save(OUT/"deadwood-wall-variants.jpg",quality=94)
    context=Image.new("RGBA",(1900,1220))
    floor=Image.open(ROOT/"assets/terrain/floor_swamp_wet_seamless.png").convert("RGBA").resize((512,512))
    for y in range(0,1220,512):
        for x in range(0,1900,512):context.paste(floor,(x,y))
    context.alpha_composite(Image.new("RGBA",context.size,(8,15,10,110)))
    cells=set([(i,0) for i in range(13)]+[(0,i) for i in range(13)]+[(12,i) for i in range(13)]+[(i,12) for i in range(13)])
    layout.paint(context,layout.wall_jobs(cells,(950,305),walls,model["walls"][0]))
    layout.label(context,(35,25),"细碎枯枝墙 · 四款随机混排与12格闭环",30)
    layout.label(context,(35,77),"离线拼接，非实机截图；仅保留细碎枯枝，沿用世界坐标选款与原单格占地。",21)
    context.convert("RGB").save(OUT/"deadwood-wall-floor-context.jpg",quality=94)
    animation=[]
    for i in list(range(16))+list(range(14,-1,-1)):
        canvas=Image.new("RGBA",(1480,590),(23,29,25,255))
        layout.label(canvas,(25,15),"枯枝墙 + 已确认藤蔓门 · 双向门口离线拼装",25)
        for flip,origin in ((False,(130,295)),(True,(1350,295))):
            cells=[(0,k) if flip else (k,0) for k in (-1,0,6,7)]
            layout.paint(canvas,layout.wall_jobs(cells,origin,walls,model["walls"][0])+layout.gate_jobs(origin,frames[i],gate,flip))
        layout.label(canvas,(25,550),f"原门帧 {i:02d}/15 原样使用｜先裁源图列再镜像｜不代表Phaser实机验证",20)
        animation.append(canvas.convert("RGB"))
    animation[0].save(OUT/"deadwood-wall-vine-gate.gif",save_all=True,append_images=animation[1:],duration=60,loop=0)
    metrics={"kind":"offline asset production measurements, not runtime validation","walls":report,
             "luminanceMedianSpread":round(max(g["luminanceMedian"] for g in report)-min(g["luminanceMedian"] for g in report),5),
             "luminanceMeanSpread":round(max(g["luminanceMean"] for g in report)-min(g["luminanceMean"] for g in report),5)}
    layout.write_json(OUT/"asset-report.json",metrics)
    manifest={"stage":"fine twigs only following latest feedback; coarse roots/logs/knots removed; four seeded variants; user visual/runtime acceptance pending","runtimeInstalled":args.install or previous.get("runtimeInstalled",False),
              "model":"swamp_deadwood_wall_kit.blend","builder":"tools/ai-gen/build-swamp-living-wall-kit.py",
              "composer":"tools/ai-gen/compose-swamp-living-wall-kit.py","sourceType":"new native Blender geometry and procedural PBR",
              "walls":[g["key"] for g in model["walls"]],"gate":"assets/terrain/swamp_stone_gate.png",
              "gatePolicy":"accepted bilateral growth gate reused byte-for-byte; not written by this builder/composer",
              "reference":"assets/terrain/swamp_wall_straight.png; visual reference only, no pixels reused",
              "variantSeeds":model["variantSeeds"],"maxBaseTwigRadius":model["maxBaseTwigRadius"],
              "previews":["deadwood-wall-variants.jpg","deadwood-wall-overview.jpg","deadwood-wall-floor-context.jpg","deadwood-wall-vine-gate.gif"],
              "scope":"wall appearance only; footprint, collision, doors, gameplay and fixed EXE unchanged"}
    if args.install:
        for info in model["walls"]:
            key=info["key"]
            shutil.copyfile(OUT/(key+".png"),ROOT/runtime[key]["source"])
        for target in (ROOT/"data/swamp-stone-wall-kit.json",ROOT/"public/data/swamp-stone-wall-kit.json"):
            layout.write_json(target,data)
    if previous.get("visualAcceptance",{}).get("status")=="accepted":
        manifest["visualAcceptance"]=previous["visualAcceptance"]
        manifest["stage"]=previous["stage"]
    layout.write_json(OUT/"manifest.json",manifest)
    print(json.dumps(metrics,ensure_ascii=False))


if __name__=="__main__":main()
