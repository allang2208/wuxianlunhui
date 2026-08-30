"""Produce offline A/B/C assembly previews and candidate provenance only."""
import importlib.util
import json
from pathlib import Path

from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_wall_pbr_kit_20260830"
spec = importlib.util.spec_from_file_location("assembly", HERE / "compose-mine-wall-a-rockface.py")
assembly = importlib.util.module_from_spec(spec)
spec.loader.exec_module(assembly)
label, paint, kit = assembly.label, assembly.paint, assembly.kit


def mixed_jobs(cells, origin, sprites, geo):
    jobs = []
    # Mostly bare rock. Mineral/support accents stay sparse and predictable.
    pattern = "aabacaa"
    for u, v in sorted(set(cells), key=lambda p: (sum(p), p)):
        key = pattern[(u + 3 * v) % len(pattern)]
        center = (origin[0] + (u - v) * 64, origin[1] + (u + v) * 32)
        jobs.append((center[1] + 4, "wall", (sprites[key], center, geo)))
    return jobs


def main():
    geo = json.loads((OUT / "geometry.json").read_text(encoding="utf-8"))
    oldgeo = json.loads((assembly.OLD / "geometry.json").read_text(encoding="utf-8"))
    sprites = {key: Image.open(OUT / f"wall_{key}.png").convert("RGBA") for key in "abc"}
    for key, sprite in sprites.items():
        sprite.getchannel("A").save(OUT / f"wall_{key}_alpha.png")
    contact = Image.new("RGBA", (1500,1010), (28,32,36,255))
    label(contact,(30,22),"矿洞岩壁 A / B / C · 共享模型与PBR材质候选",30)
    label(contact,(30,68),"AI只提供平面底色；轮廓、光影、透视、Depth由Blender统一渲染。尚未替换正式素材。",19)
    titles = ("A 连续开凿岩面", "B 稀疏矿脉 / 无自发光", "C 局部木撑 / 克制铁箍")
    for i,key in enumerate("abc"):
        contact.alpha_composite(sprites[key].resize((490,490),Image.Resampling.LANCZOS),(5+500*i,105))
        label(contact,(28+500*i,596),titles[i],23)
        kit.paste_ground(contact,sprites[key],(250+500*i,902),geo)
    label(contact,(30,661),"下排：现有260×259显示画布；占地128×64；相同锚点、相同岩体，不翻转、不漂移尺寸。",19)
    label(contact,(30,963),"本图为离线素材制作样张，不是游戏截图；旧矿洞门未重做。",18)
    contact.save(OUT / "wall-kit-contact.png")

    sheet = Image.new("RGBA", (1700,1780), (24,29,33,255))
    label(sheet,(32,24),"矿洞岩壁 · A/B/C混排离线拼装",30)
    label(sheet,(32,69),"沿用 ±64,+32步长；转角去重；所有墙共用岩层与底色周期；门沿用旧资源。",19)
    label(sheet,(35,118),"01 正向连续混排 · 8格")
    paint(sheet,mixed_jobs([(i,0) for i in range(8)],(165,325),sprites,geo))
    label(sheet,(895,118),"02 反向连续混排 · 8格（无镜像）")
    paint(sheet,mixed_jobs([(0,i) for i in range(8)],(1510,325),sprites,geo))
    label(sheet,(35,650),"03 双臂转角 · 共享顶角")
    paint(sheet,mixed_jobs([(i,0) for i in range(5)]+[(0,i) for i in range(5)],(360,860),sprites,geo))
    label(sheet,(895,650),"04 闭合房间 · 共享四角")
    cells = [(i,0) for i in range(5)]+[(i,4) for i in range(5)]+[(0,i) for i in range(5)]+[(4,i) for i in range(5)]
    paint(sheet,mixed_jobs(cells,(1250,850),sprites,geo))
    for col,frame_index in enumerate((0,15)):
        label(sheet,(35+860*col,1210),f"0{5+col} 墙—旧门—墙 · 帧{frame_index} / 六层排序")
        origin=(200+860*col,1430)
        frame=Image.open(assembly.OLD/f"generation/final_12step/gate_frames/gate_{frame_index:02d}.png").convert("RGBA")
        jobs=mixed_jobs([(-1,0),(0,0),(6,0),(7,0)],origin,sprites,geo)
        paint(sheet,jobs+assembly.gate_jobs(origin,frame,oldgeo["gate"]))
    label(sheet,(35,1738),"岩层有规律重复，旧门材质尚未同步；此图不能替代运行时门开合与动态遮挡验收。",18)
    sheet.save(OUT / "wall-kit-seam-assembly.png")

    floor=Image.open(assembly.ROOT/"assets/terrain/floor_abandoned_mine_seamless.png").convert("RGB").resize((512,512),Image.Resampling.LANCZOS)
    context=Image.new("RGBA",(1200,880))
    for y in range(0,880,512):
        for x in range(0,1200,512):
            context.paste(floor,(x,y))
    context.alpha_composite(Image.new("RGBA",context.size,(12,17,21,105)))
    paint(context,mixed_jobs([(i,0) for i in range(7)]+[(0,i) for i in range(6)],(560,280),sprites,geo))
    label(context,(30,24),"冷灰矿洞地板 + A/B/C岩壁 · 离线搭配示意",26)
    context.save(OUT / "wall-kit-floor-context.png")
    manifest={
        "stage":"A/B/C shared model PBR candidates", "runtimeInstalled":False,
        "model":"mine_wall_pbr_kit.blend", "geometry":"geometry.json",
        "variants":{key:{"beauty":f"wall_{key}.png","alpha":f"wall_{key}_alpha.png","bodyDepth":f"wall_{key}_body_depth.png"} for key in "abc"},
        "albedo":{"file":"slate_albedo_imagegen.png","provider":"built-in imagegen","actualSize":[1254,1254],
                  "promptFile":"slate-albedo-prompt.txt","generatedSource":"C:/Users/allan/.codex/generated_images/01a0503a-ea76-7b41-93cb-8be0380b0688/exec-84ba1c3b-4700-48cb-a8f4-a149e293fb44.png",
                  "use":"Base Color only, shared shader mirror period; not AI wall-image refinement or displacement"},
        "previews":["wall-kit-contact.png","wall-kit-seam-assembly.png","wall-kit-floor-context.png"],
        "oldGateSource":"../_abandoned_mine_wall_kit_20260828/generation/final_12step/gate_frames",
        "scope":"Candidates only; no runtime configs, formal PNG replacement or gate redesign",
        "knownLimits":["Authored slab layers and mirror period remain recognizable on long walls",
                       "Old gate has not received the new shared material",
                       "Offline composition is not game rendering, all gate directions or dynamic occlusion acceptance"]}
    (OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    print("CANDIDATE_ONLY",OUT)


if __name__ == "__main__":
    main()
