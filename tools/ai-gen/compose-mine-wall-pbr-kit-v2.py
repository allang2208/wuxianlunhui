"""Offline sprite sheets, wall/gate assemblies and authored-motion preview.

No game execution, screenshot comparison, asset installation or test harness.
"""
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_wall_pbr_kit_v2_20260830"
V1 = HERE / "_mine_wall_pbr_kit_20260830"
spec = importlib.util.spec_from_file_location("assembly",HERE/"compose-mine-wall-pbr-kit.py")
assembly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assembly)
label, kit = assembly.label, assembly.kit


def gate_jobs(origin, frame, geo, flip=False):
    p0,p1 = geo["base"]
    sx,sy = 384/(p1[0]-p0[0]),192/(p1[1]-p0[1])
    x = origin[0] - (geo["canvas"][0]-p0[0] if flip else p0[0])*sx
    y = origin[1] - p0[1]*sy
    lo,hi = geo["gateX"]
    jobs = []
    for i in range(geo["depthSlices"]):
        tx0,tx1 = lo+(hi-lo)*i/geo["depthSlices"],lo+(hi-lo)*(i+1)/geo["depthSlices"]
        sprite = kit.gate_slice(frame,math.floor(tx0),math.ceil(tx1))
        # Keep source columns before reflecting the full canvas. Runtime uses
        # bindGateSourceCrop + signed scaleX to avoid Phaser's flipped crop UVs.
        if flip:
            sprite = sprite.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        sprite = sprite.resize((round(sprite.width*sx),round(sprite.height*sy)),Image.Resampling.LANCZOS)
        depth_tx = tx0 if geo.get("tuckEndSlices") and i == 0 else tx1
        depth = origin[1]+(depth_tx-p0[0])/(p1[0]-p0[0])*192+3.9
        jobs.append((depth,"gate",(sprite,(round(x),round(y)))))
    return jobs


def paint(canvas,jobs):
    for _,kind,payload in sorted(jobs,key=lambda j:j[0]):
        if kind == "wall":
            kit.paste_ground(canvas,*payload)
        else:
            canvas.alpha_composite(*payload)


def doorway(canvas,origin,sprites,frame,wall_geo,gate_geo,flip=False,open_hidden=False):
    indexes = (-1,0,6,7)
    cells = [(0,i) if flip else (i,0) for i in indexes]
    jobs = assembly.mixed_jobs(cells,origin,sprites,wall_geo)
    if not open_hidden:
        jobs += gate_jobs(origin,frame,gate_geo,flip)
    paint(canvas,jobs)


def luminance_summary(sprites):
    stats = {}
    for key,sprite in sprites.items():
        pixels = np.asarray(sprite)
        mask = pixels[:,:,3] > 200
        lum = (pixels[:,:,:3]/255.0) @ np.array([.2126,.7152,.0722])
        stats[key] = {"size":list(sprite.size),"alphaBBox":list(sprite.getchannel("A").getbbox()),
                      "bodyMedian":float(np.median(lum[mask])),"bodyMean":float(np.mean(lum[mask]))}
    return {"method":"sRGB luminance over alpha > 200; output material metadata, not runtime lighting",
            "walls":stats,"medianSpread":max(s["bodyMedian"] for s in stats.values())-min(s["bodyMedian"] for s in stats.values()),
            "meanSpread":max(s["bodyMean"] for s in stats.values())-min(s["bodyMean"] for s in stats.values()),
            "guideline":{"medianSpread":.01,"meanSpread":.015}}


def main():
    manifest_path = OUT/"manifest.json"
    previous = json.loads(manifest_path.read_text(encoding="utf-8")) if manifest_path.exists() else {}
    geometry = json.loads((OUT/"geometry.json").read_text(encoding="utf-8"))
    wall_geo,gate_geo = geometry["wall"],geometry["gate"]
    sprites = {key:Image.open(OUT/f"wall_{key}.png").convert("RGBA") for key in "abc"}
    frames = [Image.open(OUT/f"gate_frames/gate_{i:02d}.png").convert("RGBA") for i in range(16)]
    for key,sprite in sprites.items():
        sprite.getchannel("A").save(OUT/f"wall_{key}_alpha.png")
    (OUT/"gate_alpha").mkdir(exist_ok=True)
    sheet = Image.new("RGBA",(2560,2560))
    for i,frame in enumerate(frames):
        frame.getchannel("A").save(OUT/f"gate_alpha/gate_{i:02d}.png")
        sheet.alpha_composite(frame,((i%4)*640,(i//4)*640))
    sheet.save(OUT/"abandoned_mine_gate.png")
    material = luminance_summary(sprites)
    (OUT/"material-summary.json").write_text(json.dumps(material,ensure_ascii=False,indent=2),encoding="utf-8")

    contact = Image.new("RGBA",(1500,1120),(27,32,36,255))
    label(contact,(30,22),"矿洞墙门 v2 · 浅裂理岩面 + 同源木铁材质",30)
    label(contact,(30,69),"保留占地、锚点、相机和独立门叶；本图为离线素材候选，未替换正式资产。",19)
    for i,(key,title) in enumerate(zip("abc",("A 开凿岩面","B 稀疏矿脉","C 木撑补强"))):
        contact.alpha_composite(sprites[key].resize((450,450),Image.Resampling.LANCZOS),(25+i*500,110))
        label(contact,(40+i*500,568),title,24)
    label(contact,(30,638),"同一门叶：关闭 / 升降中 / 开启原帧（游戏完全开启时隐藏门叶）",21)
    for i,index in enumerate((0,7,15)):
        contact.alpha_composite(frames[index].resize((450,450),Image.Resampling.LANCZOS),(25+i*500,680))
        label(contact,(35+i*500,1065),f"帧 {index:02d} · 原模型/原轨迹",19)
    contact.save(OUT/"wall-gate-contact.png")

    compare = Image.new("RGBA",(1500,1010),(27,32,36,255))
    label(compare,(30,22),"长墙细节收敛 · v1 / v2 / 上一版正式素材",29)
    old = Image.open(HERE/"_abandoned_mine_wall_kit_20260828/generation/final_12step/abandoned_mine_wall_block_a.png").convert("RGBA")
    for col,(sprite,title) in enumerate(((Image.open(V1/"wall_a.png").convert("RGBA"),"v1：连续波浪层纹"),(sprites["a"],"v2：浅裂理 / 局部中断"),(old,"上一版正式：堆石与逐格木撑"))):
        compare.alpha_composite(sprite.resize((450,450),Image.Resampling.LANCZOS),(25+col*500,90))
        label(compare,(25+col*500,552),title,22)
        kit.paste_ground(compare,sprite,(250+col*500,902),wall_geo)
    label(compare,(30,618),"下排按现有260×259画布显示；不改变世界尺寸或靠运行时随机缩放隐藏重复。",18)
    compare.save(OUT/"wall-revision-comparison.png")

    seams = Image.new("RGBA",(1800,1860),(24,29,33,255))
    label(seams,(30,22),"墙门整套 · 双方向离线拼装",30)
    label(seams,(30,68),"墙不镜像；门按现有双轴映射镜像并分六层；固定步长±64,+32。",19)
    for flip in (False,True):
        label(seams,(35+900*flip,118),"反向混排 · 10格" if flip else "正向混排 · 10格",23)
        cells = [(0,i) if flip else (i,0) for i in range(10)]
        paint(seams,assembly.mixed_jobs(cells,(1640 if flip else 160,320),sprites,wall_geo))
    label(seams,(35,694),"共享转角 · 同款连续岩体",23)
    paint(seams,assembly.mixed_jobs([(i,0) for i in range(5)]+[(0,i) for i in range(5)],(410,912),sprites,wall_geo))
    label(seams,(935,694),"闭合房间 · 四角不重复叠块",23)
    cells = [(i,0) for i in range(5)]+[(i,4) for i in range(5)]+[(0,i) for i in range(5)]+[(4,i) for i in range(5)]
    paint(seams,assembly.mixed_jobs(cells,(1340,876),sprites,wall_geo))
    for flip in (False,True):
        label(seams,(35+900*flip,1278),"反向墙—新门—墙" if flip else "正向墙—新门—墙",23)
        doorway(seams,(1590 if flip else 200,1500),sprites,frames[0],wall_geo,gate_geo,flip)
    label(seams,(35,1802),"离线资产呈现；不能代替游戏遮挡/碰撞/战斗验收。有限墙款仍有重复，已降低连续强层纹。",18)
    seams.save(OUT/"wall-gate-seams.png")

    def animation_frame(index,hidden=False):
        canvas = Image.new("RGBA",(1340,640),(24,29,33,255))
        label(canvas,(24,18),"双方向升降门 · 离线素材动画 / 900ms开合 / 完全开启后隐藏",23)
        for flip in (False,True):
            doorway(canvas,(1195 if flip else 145,305),sprites,frames[index],wall_geo,gate_geo,flip,hidden)
        label(canvas,(24,602),"保持原16帧升降轨迹和六层排序；仅呈现素材，不执行游戏逻辑。",17)
        return canvas.convert("RGB")
    animated,durations = [animation_frame(0)],[600]
    for index in range(16):
        animated.append(animation_frame(index))
        durations.append(30 if index in (0,15) else 60)
    animated.append(animation_frame(15,True))
    durations.append(650)
    for index in range(15,-1,-1):
        animated.append(animation_frame(index))
        durations.append(30 if index in (0,15) else 60)
    animated[0].save(OUT/"wall-gate-animation.gif",save_all=True,append_images=animated[1:],duration=durations,loop=0,disposal=2)
    manifest = {"stage":"v2 complete wall/gate material candidate","runtimeInstalled":False,
                "model":"mine_wall_and_gate_pbr_v2.blend","geometry":"geometry.json","materialSummary":"material-summary.json",
                "walls":{key:{"beauty":f"wall_{key}.png","alpha":f"wall_{key}_alpha.png","bodyDepth":f"wall_{key}_body_depth.png"} for key in "abc"},
                "gate":{"sheet":"abandoned_mine_gate.png","frameSize":[640,640],"frames":16,"frameDir":"gate_frames","alphaDir":"gate_alpha","depthDir":"gate_depth","motion":"geometry.json gateMotion","animationMs":900,"hideWhenOpen":True},
                "albedo":{**json.loads((V1/"manifest.json").read_text(encoding="utf-8"))["albedo"],"reusedFrom":"../_mine_wall_pbr_kit_20260830/slate_albedo_imagegen.png","newImageGeneration":False},
                "previews":["wall-gate-contact.png","wall-revision-comparison.png","wall-gate-seams.png","wall-gate-animation.gif"],
                "knownLimits":["A finite three-variant set remains recognizable at long distances","Original 640px gate canvas clips the raised leaf as before; fully open state hides it","Gate negative axis uses existing flipX mapping, not a newly rendered camera view","This generation did not run game tests or install runtime files"]}
    # Rebuilding creates a candidate, never a silent runtime replacement. Keep
    # the prior explicit installation record even if the new PNGs are changed.
    last_installation = previous.get("lastInstallation")
    if previous.get("runtimeInstalled"):
        last_installation = {key:previous[key] for key in ("acceptedOn","approval","installer","installed") if key in previous}
    if last_installation:
        manifest["lastInstallation"] = last_installation
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    print(json.dumps({"output":str(OUT),"materialSummary":material},ensure_ascii=False))


if __name__ == "__main__":
    main()
