"""Offline production presentation and explicit curated-prop installation.

This entry presents native wall/gate candidates. New Dev results live separately
in dev-candidate; this entry runs no tests, game code or remote uploads.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import re
import shutil

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
OUT = HERE / "_mine_visual_finish_v3_20260830"
PROPS = HERE / "_mine_props_material_review_20260830"
spec = importlib.util.spec_from_file_location("mine_v3_assembly", HERE/"compose-mine-wall-pbr-kit-v2.py")
render = importlib.util.module_from_spec(spec)
spec.loader.exec_module(render)
label = render.label
WORLD_ORIGIN = (4096, 4096)  # Explicit example world point, independent of poster placement.


def write(path, value):
    path.write_text(json.dumps(value,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def prepare():
    (OUT/"props").mkdir(exist_ok=True)
    sizing = json.loads((PROPS/"candidate-sizing.json").read_text(encoding="utf-8"))["assets"]
    for asset in sizing:
        shutil.copyfile(PROPS/asset["candidate"], OUT/"props"/(asset["key"]+".png"))
    write(OUT/"prop-sizing.json", sizing)
    old = json.loads((OUT/"manifest.json").read_text(encoding="utf-8")) if (OUT/"manifest.json").exists() else {}
    manifest = {
        "stage":"v3 local wall/gate candidate; curated props ready for installation",
        "wallsInstalled":False,"gateInstalled":False,"propsInstalled":old.get("propsInstalled",False),
        "model":"mine_visual_v3.blend","geometry":"geometry.json",
        "rockSource":"stone-provenance.json","wallNative":{k:f"wall_{k}_native.png" for k in "abc"},
        "gateNative":"gate_native.png","propSource":"../_mine_props_material_review_20260830/manifest.json",
        "propSizing":"prop-sizing.json","propCamera":"orthographic30deg/root44.8deg/ortho6.4/originY0.875",
        "remoteGeneration":{"status":"no generation status registered; preserve existing batch status when present",
                            "destination":"192.168.3.142:8188","scope":"new rock Depth; new gate/support green beauty plus their Depth; prompts/parameters only",
                            "excludes":["Blender files","source code","other project files"],"requests":["rock/request.json","gate/request.json","supports/request.json"]},
        "previews":["wall-gate-review.png","long-wall-assembly.png","room-presentation.png","prop-size-presentation.png","gate-full-leaf-fade.gif"],
        "limits":["wall/gate native material still below building-reference refinement; do not replace accepted runtime wall art yet",
                  "finite ABC pattern remains visible; example room is art composition, not dungeon generation or game screenshot",
                  "new gate front iron changes art depth only; original source-column registration and movement contract retained"],
        "tests":"未运行测试或运行时验证，按约定由用户测试。",
    }
    if "installation" in old:
        manifest["installation"] = old["installation"]
    if "previewContract" in old:
        manifest["previewContract"] = old["previewContract"]
    if "remoteGeneration" in old:
        manifest["remoteGeneration"] = old["remoteGeneration"]
    if "devCandidate" in old:
        manifest["devCandidate"] = old["devCandidate"]
    for key in ("stage", "wallsInstalled", "gateInstalled", "wallGateInstallation", "cleanup"):
        if key in old:
            manifest[key] = old[key]
    write(OUT/"manifest.json",manifest)


def anchored(canvas, sprite, center, size, origin=.875):
    im = sprite.resize((round(sprite.width*size/sprite.height),round(size)),Image.Resampling.LANCZOS)
    canvas.alpha_composite(im,(round(center[0]-im.width/2),round(center[1]-im.height*origin)))


def floor(size, scale=1):
    cfg = json.loads((ROOT/"data/abandoned-mine-terrain.json").read_text(encoding="utf-8"))
    tile = Image.open(ROOT/cfg["base"]["src"]).convert("RGBA")
    tile = tile.resize((round(tile.width*scale),round(tile.height*cfg["base"]["textureScaleY"]*scale)),Image.Resampling.LANCZOS)
    out = Image.new("RGBA",size)
    for y in range(0,size[1],tile.height):
        for x in range(0,size[0],tile.width):
            out.alpha_composite(tile,(x,y))
    return out


def wall_jobs(cells, origin, sprites, geo, world_origin=WORLD_ORIGIN):
    """Mirror the runtime coordinate hash and connected half-segment depth.

    Cells describe this authored assembly only; this does not invoke the dungeon
    generator. Moving an assembly on the poster must not change its wall variants.
    """
    cells = set(cells)
    step_u, step_v = geo["seamContract"]["runtimeSteps"]
    keys = tuple(sprites)
    jobs = []
    for u, v in sorted(cells, key=lambda p: (sum(p), p)):
        dx, dy = u*step_u[0]+v*step_v[0], u*step_u[1]+v*step_v[1]
        # JS Math.round (including negative coordinates), Math.imul low 32 bits,
        # then >>> 0, as in CombatRoomSystem._makeWorldBlockPiece.
        gx, gy = math.floor(world_origin[0]+dx+.5), math.floor(world_origin[1]+dy+.5)
        variant_hash = ((gx*73856093) ^ (gy*19349663) ^ 0x07a6b1d5) & 0xffffffff
        key = keys[variant_hash % len(keys)]
        center = (origin[0]+dx, origin[1]+dy)
        # A doorway has no wall half-segment into the opening. At corners the
        # shared block takes the greatest Y of all connected segment endpoints.
        half_y = [0]
        for du, dv in ((1,0),(-1,0),(0,1),(0,-1)):
            if (u+du,v+dv) in cells:
                half_y.append((du*step_u[1]+dv*step_v[1])/2)
        jobs.append((center[1]+max(half_y)+4,"wall",(sprites[key],center,geo)))
    return jobs


def doorway(canvas, origin, walls, gate, wg, gg, flip):
    cells = [(0,i) if flip else (i,0) for i in (-1,0,6,7)]
    render.paint(canvas,wall_jobs(cells,origin,walls,wg)+render.gate_jobs(origin,gate,gg,flip))


def present():
    geo = json.loads((OUT/"geometry.json").read_text(encoding="utf-8"))
    wg,gg = geo["wall"],geo["gate"]
    config=(ROOT/"src/world/wall-system.js").read_text(encoding="utf-8")
    style=re.search(r"\babandonedMine:\s*\{([^}]+)\}",config)[1]
    block_list=re.search(r"\bblocks:\s*\[([^\]]+)\]",style)[1]
    keys=re.findall(r"'abandoned_mine_block_([^']+)'",block_list)
    walls = {key:Image.open(OUT/f"wall_{key}_native.png").convert("RGBA") for key in keys}
    gate = Image.open(OUT/"gate_native.png").convert("RGBA")
    current = Image.open(ROOT/"assets/terrain/abandoned_mine_wall_block_a.png").convert("RGBA")
    oldgate = Image.open(ROOT/"assets/terrain/abandoned_mine_gate.png").convert("RGBA").crop((0,0,640,640))
    contact = Image.new("RGBA",(1600,1240),(24,29,33,255))
    label(contact,(30,20),"矿洞视觉 v3 · 本地优化稿，墙门尚未替换正式素材",28)
    label(contact,(30,64),"原生模型对照：保留原占地、锚点、相机和接缝；新Dev材质另见dev-candidate目录。",19)
    for col,(im,title) in enumerate(((current,"当前正式 A：横层与拉伸边带"),(walls["a"],"v3 A：斜向岩面 / 连续微起伏墙顶"),(walls["c"],"v3 C：同岩体 / 同源木铁"))):
        contact.alpha_composite(im.resize((510,510),Image.Resampling.LANCZOS),(10+col*530,100))
        label(contact,(24+col*530,611),title,21)
    for col,(im,title) in enumerate(((oldgate,"原门：铁条与铆钉埋入木条"),(gate,"v3门：前置铁条与连接点恢复可见"))):
        contact.alpha_composite(im.resize((700,700),Image.Resampling.LANCZOS),(30+col*800,570))
        label(contact,(30+col*800,1164),title,23)
    label(contact,(30,1210),"材质仍有提升空间；这轮完成结构与本地材质处理，不把它标为新Dev成品。",17)
    contact.save(OUT/"wall-gate-review.png")

    seams = Image.new("RGBA",(1800,1770),(24,29,33,255))
    label(seams,(30,20),"v3 拼装制作样张 · 双轴 / 转角 / 门端",29)
    label(seams,(30,65),"按游戏格心散列选款；示例世界原点(4096,4096)，不代表随机地图或动态遮挡已验收。",19)
    for flip in (False,True):
        cells = [(0,i) if flip else (i,0) for i in range(10)]
        render.paint(seams,wall_jobs(cells,(1640 if flip else 160,315),walls,wg))
    cells = [(i,0) for i in range(5)]+[(0,i) for i in range(5)]
    render.paint(seams,wall_jobs(cells,(450,915),walls,wg))
    cells = [(i,0) for i in range(5)]+[(i,4) for i in range(5)]+[(0,i) for i in range(5)]+[(4,i) for i in range(5)]
    render.paint(seams,wall_jobs(cells,(1280,900),walls,wg))
    for flip in (False,True):
        doorway(seams,(1590 if flip else 200,1450),walls,gate,wg,gg,flip)
    label(seams,(30,1715),"步长±64,+32；墙按相邻半段最远Y排序，门沿用六段源列裁片。正式墙门PNG保持不变。",19)
    seams.save(OUT/"long-wall-assembly.png")

    sizing = json.loads((OUT/"prop-sizing.json").read_text(encoding="utf-8"))
    names = {p["key"]:p["labelZh"] for p in json.loads((PROPS/"manifest.json").read_text(encoding="utf-8"))["props"]}
    sizes = Image.new("RGBA",(1440,850),(24,29,33,255))
    label(sizes,(25,20),"12件矿洞小物 · 统一模型相机、PBR材质与光向",28)
    label(sizes,(25,64),"左：位面原比例  右：地牢×0.8；按可见主体标定，禁止随机镜像。",19)
    for i,asset in enumerate(sizing):
        x=(i%4)*360+10;y=(i//4)*230+105
        patch=floor((340,155))
        sizes.alpha_composite(patch,(x,y+40))
        label(sizes,(x+12,y),names[asset["key"]],20)
        prop=Image.open(OUT/"props"/(asset["key"]+".png")).convert("RGBA")
        for pos,scale in ((x+93,1),(x+253,.8)):
            anchored(sizes,prop,(pos,y+128),asset["proposedSize"]*scale)
        label(sizes,(x+12,y+202),f"主体最长边 {asset['targetVisibleWorldPx']} / {asset['targetVisibleWorldPx']*.8:g} 世界像素",16)
    label(sizes,(25,812),"原地板，不加预览专用明暗滤镜。灯具熄灭；旧素材保留，不新增实体、碰撞或光源。",17)
    sizes.save(OUT/"prop-size-presentation.png")

    # A deliberately authored art vignette, not a new dungeon layout.
    room = Image.new("RGBA",(1600,1100),(16,21,25,255))
    tile = floor(room.size)
    diamond=Image.new("L",room.size)
    ImageDraw.Draw(diamond).polygon([(800,295),(1470,630),(800,965),(130,630)],fill=255)
    room.paste(tile,(0,0),diamond)
    positions=[(800,450),(615,565),(970,620),(530,680),(910,490),(1120,700),(748,680),(720,780),(1040,790),(510,770),(865,850),(1190,600)]
    for asset,point in zip(sizing,positions):
        anchored(room,Image.open(OUT/"props"/(asset["key"]+".png")).convert("RGBA"),point,asset["proposedSize"]*.8)
    cells=[(i,0) for i in range(11)]+[(0,i) for i in range(11)]
    render.paint(room,wall_jobs(cells,(800,295),walls,wg))
    label(room,(30,20),"矿洞整套搭配 · v3墙面候选 + 新12件小物 + 当前正式地板",28)
    label(room,(30,65),"离线样张按游戏规则选墙；为展示内部资产省略前墙，小物人为摆放，不代表随机布局。",18)
    label(room,(30,1038),"地牢小物sizeScale=0.8；未加入游戏光照与角色，运行时可读性仍需用户测试。",19)
    room.save(OUT/"room-presentation.png")

    match=re.search(r"leafMotion:\s*\{\s*fadeFraction:\s*([\d.]+),\s*liftPixels:\s*(\[[^\]]+\])",config)
    fade_fraction,lifts=float(match[1]),json.loads(match[2])
    def frame(openness):
        p=min(1,openness/(1-fade_fraction))*(len(lifts)-1)
        lo=math.floor(p); hi=min(lo+1,len(lifts)-1)
        lift=lifts[lo]+(lifts[hi]-lifts[lo])*(p-lo)
        t=max(0,min(1,(openness-(1-fade_fraction))/fade_fraction))
        alpha=1-t*t*(3-2*t)
        canvas=Image.new("RGBA",(1340,870),(24,29,33,255))
        label(canvas,(24,18),"v3门叶候选 · 原轨迹 / 720ms升降 + 180ms淡化",26)
        for flip in (False,True):
            origin=(1195 if flip else 145,550)
            cells=[(0,i) if flip else (i,0) for i in (-1,0,6,7)]
            jobs=wall_jobs(cells,origin,walls,wg)
            for depth,kind,(sprite,position) in render.gate_jobs(origin,gate,gg,flip):
                sprite.putalpha(sprite.getchannel("A").point(lambda a:round(a*alpha)))
                sy=192/(gg["base"][1][1]-gg["base"][0][1])
                jobs.append((depth,kind,(sprite,(position[0],round(position[1]-lift*sy)))))
            render.paint(canvas,jobs)
        label(canvas,(24,817),"本GIF为素材动画预览；v3门未安装，游戏动画代码沿用已完成的完整门叶淡入淡出。",17)
        return canvas.convert("RGB")
    seq=[(1,500)]+[(1-t/900,30) for t in range(0,900,30)]+[(0,650)]+[(t/900,30) for t in range(0,900,30)]
    frames=[frame(p) for p,_ in seq]
    frames[0].save(OUT/"gate-full-leaf-fade.gif",save_all=True,append_images=frames[1:],duration=[ms for _,ms in seq],loop=0,disposal=2)
    manifest=json.loads((OUT/"manifest.json").read_text(encoding="utf-8"))
    manifest["previewContract"]={
        "worldOrigin":list(WORLD_ORIGIN),"worldOriginIsExample":True,
        "variantOrder":keys,"styleSource":"src/world/wall-system.js:ISO_WALL_STYLES.abandonedMine",
        "hashSource":"src/world/combat-room-system.js:_makeWorldBlockPiece",
        "hash":"((round(x)*73856093) XOR (round(y)*19349663) XOR 0x07a6b1d5) unsigned32 modulo variantCount",
        "wallDepth":"greatest connected half-segment endpoint Y + 4",
        "posterOffsetAffectsVariant":False,"wallMirror":False,
        "scope":"offline authored assemblies; not generated rooms, runtime lighting or dynamic occlusion proof",
    }
    write(OUT/"manifest.json",manifest)


def install_props():
    sizing=json.loads((OUT/"prop-sizing.json").read_text(encoding="utf-8"))
    cfg_paths=[ROOT/"data/abandoned-mine-terrain.json",ROOT/"public/data/abandoned-mine-terrain.json"]
    cfg=json.loads(cfg_paths[0].read_text(encoding="utf-8"))
    current={a["key"]:a for a in cfg["deco"]["assets"]}
    backup=OUT/"before_prop_install"
    backup.mkdir(exist_ok=True)
    for path in cfg_paths:
        dst=backup/(("public_" if "public" in path.parts else "")+path.name)
        dst.parent.mkdir(exist_ok=True)
        if not dst.exists():
            shutil.copyfile(path,dst)
    replacement=[]
    for asset in sizing:
        entry={**current[asset["key"]],"size":asset["proposedSize"],"originY":asset["originY"]}
        target=ROOT/entry["src"]
        if not (backup/target.name).exists():
            shutil.copyfile(target,backup/target.name)
        shutil.copyfile(OUT/"props"/target.name,target)
        replacement.append(entry)
    removed=[a for a in current if a not in {r["key"] for r in replacement}]
    # Preserve all unrelated configuration and the existing compact asset rows.
    for path in cfg_paths:
        text=path.read_text(encoding="utf-8")
        start=text.index('    "assets": [')
        end=text.index('\n    ]',start)+len('\n    ]')
        rows=['      '+json.dumps(a,ensure_ascii=False,separators=(', ', ': ')) for a in replacement]
        text=text[:start]+'    "assets": [\n'+',\n'.join(rows)+'\n    ]'+text[end:]
        if '"allowFlipX"' not in text:
            text=text.replace('    "placementMode": "world-grid",','    "placementMode": "world-grid",\n    "allowFlipX": false,',1)
        path.write_text(text,encoding="utf-8")
    manifest=json.loads((OUT/"manifest.json").read_text(encoding="utf-8"))
    removed=removed or manifest.get("installation",{}).get("retiredFromGenericScatter",[])
    manifest.update(stage="curated 12 props installed; wall/gate candidates remain separate from runtime assets",propsInstalled=True)
    manifest["installation"]={"scope":"12 props plus both config mirrors; no wall/gate PNG change", "date":"2026-08-30",
                              "authorization":"帮我做新的，替代旧的; 继续优化图图片不满意可以重抽。尽量做好来。",
                              "props":replacement,"retiredFromGenericScatter":removed,"oldFilesPhysicallyRemoved":False,
                              "noRandomMirror":True,"backup":"before_prop_install"}
    write(OUT/"manifest.json",manifest)
    oldpath=HERE/"_abandoned_mine_terrain_20260828/manifest.json"
    old=json.loads(oldpath.read_text(encoding="utf-8"))
    old.update(runtimeInstalled=False,supersededBy="tools/ai-gen/_mine_visual_finish_v3_20260830/manifest.json")
    write(oldpath,old)
    print("Installed curated 12 props; preserved old six files and current walls/gate.")


if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("stage",choices=("prepare","present","install-props"))
    args=p.parse_args()
    {"prepare":prepare,"present":present,"install-props":install_props}[args.stage]()
