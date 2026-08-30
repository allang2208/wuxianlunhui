"""Export candidate PNGs, Alpha sizing and offline scale/floor material previews.

No runtime asset/config writes. Preview distribution is illustrative, not a
Phaser screenshot, placement simulation, or runtime validation.
"""
import json
import random
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

REPO=Path(__file__).resolve().parents[2]
ROOT=REPO/"tools/ai-gen/_mine_props_material_review_20260830"
MODEL=REPO/"tools/ai-gen/_mine_props_model_review_20260830"
CFG=json.loads((REPO/"data/abandoned-mine-terrain.json").read_text(encoding="utf-8"))
M=json.loads((ROOT/"manifest.json").read_text(encoding="utf-8"))
FONT="C:/Windows/Fonts/msyh.ttc"
OLD={a["key"]:a for a in CFG["deco"]["assets"]}
SPRITES={}
SIZING=[]


def font(size):
    return ImageFont.truetype(FONT,size)


def bbox(im):
    return im.getchannel("A").point(lambda a:255 if a>8 else 0).getbbox()


def body(path):
    im=Image.open(path).convert("RGBA")
    return im.crop(bbox(im))


def centered(canvas,im,x,y,factor):
    im=im.resize((max(1,round(im.width*factor)),max(1,round(im.height*factor))),Image.Resampling.LANCZOS)
    canvas.paste(im,(round(x-im.width/2),round(y-im.height/2)),im)


def anchored(canvas,im,x,y,size,origin=.875):
    im=im.resize((max(1,round(size*im.width/im.height)),max(1,round(size))),Image.Resampling.LANCZOS)
    canvas.paste(im,(round(x-im.width/2),round(y-im.height*origin)),im)


def floor(width,height,zoom,offset=(0,0)):
    src=Image.open(REPO/CFG["base"]["src"]).convert("RGB")
    tile=src.resize((round(src.width*zoom),round(src.height*zoom*CFG["base"]["textureScaleY"])),Image.Resampling.LANCZOS)
    out=Image.new("RGB",(width,height))
    for y in range(-offset[1]%tile.height-tile.height,height,tile.height):
        for x in range(-offset[0]%tile.width-tile.width,width,tile.width):
            out.paste(tile,(x,y))
    return out


def save_gallery():
    out=Image.new("RGB",(1440,1072),"#121a21")
    d=ImageDraw.Draw(out)
    d.text((26,16),"矿洞 · Blender 材质候选",font=font(30),fill="#e5ebed")
    d.text((26,60),"左：基础材质模型  /  右：统一PBR材质直渲 · 同模型同相机，未使用AI",font=font(19),fill="#9eafbc")
    for i,p in enumerate(M["props"]):
        x=(i%3)*480; y=102+(i//3)*230
        d.rounded_rectangle((x+10,y,x+470,y+217),10,fill="#283640")
        d.text((x+24,y+12),f"{i+1:02d} {p['labelZh']}",font=font(22),fill="#e3e8eb")
        centered(out,body(MODEL/p["modelRender"]),x+127,y+122,.43)
        centered(out,body(ROOT/p["modelRender"]),x+358,y+122,.43)
        d.text((x+92,y+184),"基础材质",font=font(15),fill="#96a5b1")
        d.text((x+323,y+184),"新材质",font=font(15),fill="#d3b78c")
    d.text((26,1032),"旧源与正式资产保留；本图为离线渲染素材展示，不是游戏截图。",font=font(19),fill="#9eafbc")
    out.save(ROOT/"material-review.png")


def save_normal_sizes():
    out=Image.new("RGB",(1440,952),"#121a21")
    d=ImageDraw.Draw(out)
    d.text((26,16),"矿洞小物 · 正常显示尺寸",font=font(30),fill="#e5ebed")
    d.text((26,61),"每格：当前正式 / 新候选位面 / 新候选地牢 · 图片100%显示时为标注像素尺寸",font=font(19),fill="#9eafbc")
    for i,(p,s) in enumerate(zip(M["props"],SIZING)):
        x=(i%4)*360; y=110+(i//4)*264
        patch=floor(342,182,.7,offset=(i*107,i*63))
        out.paste(patch,(x+9,y+39))
        d.text((x+16,y+6),f"{i+1:02d} {p['labelZh']}",font=font(20),fill="#e3e8eb")
        old=OLD[p["key"]]
        anchored(out,Image.open(REPO/old["src"]).convert("RGBA"),x+62,y+150,old["size"]*.7,old["originY"])
        anchored(out,SPRITES[p["key"]],x+180,y+150,s["proposedSize"]*.7)
        anchored(out,SPRITES[p["key"]],x+296,y+150,s["proposedSize"]*.8)
        for xx,text in [(x+22,"正式 ×0.7"),(x+140,"位面 ×0.7"),(x+256,"地牢 ×0.8")]:
            d.text((xx,y+224),text,font=font(15),fill="#aab6bf")
    d.text((26,919),"位面：zoom 0.7 / sizeScale 1；地牢：zoom 1 / sizeScale 0.8。仅尺寸展示，背景统一便于对照。",font=font(17),fill="#9eafbc")
    out.save(ROOT/"normal-size-preview.png")


def save_floor(profile_name,zoom):
    profile=CFG["profiles"][profile_name]
    out=Image.new("RGB",(1440,884),"#121a21")
    scene=floor(1440,810,zoom)
    rng=random.Random(126030)
    step=profile["cellSize"]*zoom
    weights=[OLD[p["key"]]["weight"] for p in M["props"]]
    for row in range(int(810/step)+1):
        for col in range(int(1440/step)+1):
            if rng.random()>=profile["density"]:
                continue
            index=rng.choices(range(len(SIZING)),weights=weights)[0]
            s=SIZING[index]
            x=(col+rng.uniform(.18,.82))*step
            y=(row+rng.uniform(.18,.82))*step
            anchored(scene,SPRITES[s["key"]],x,y,s["proposedSize"]*profile["sizeScale"]*zoom*rng.uniform(.88,1.12))
    out.paste(scene,(0,74))
    d=ImageDraw.Draw(out)
    name="矿洞位面" if profile_name=="plane" else "矿洞地牢"
    d.text((23,9),f"{name} · 新材质小物离线组合",font=font(25),fill="#e5ebed")
    d.text((23,43),f"zoom {zoom} / sizeScale {profile['sizeScale']} / 格距 {profile['cellSize']} / 密度 {profile['density']} · 示意散布，无游戏光照/碰撞/遮挡",font=font(17),fill="#9eafbc")
    out.save(ROOT/f"{profile_name}-floor-preview.png")


(ROOT/"candidates").mkdir(exist_ok=True)
for p in M["props"]:
    src=Image.open(ROOT/p["modelRender"]).convert("RGBA")
    im=src.resize((256,256),Image.Resampling.LANCZOS)
    path=ROOT/"candidates"/(p["key"]+".png")
    im.save(path)
    box=bbox(im); longest=max(box[2]-box[0],box[3]-box[1])
    size=round(p["targetVisibleWorldPx"]*256/longest,3)
    SPRITES[p["key"]]=im
    SIZING.append({"key":p["key"],"candidate":str(path.relative_to(ROOT)).replace("\\","/"),"alphaBBox":list(box),"targetVisibleWorldPx":p["targetVisibleWorldPx"],"proposedSize":size,"originX":.5,"originY":.875,"sourceWeight":OLD[p["key"]]["weight"],"runtimeInstalled":False})

save_gallery()
save_normal_sizes()
save_floor("plane",.7)
save_floor("dungeon",1)
(ROOT/"candidate-sizing.json").write_text(json.dumps({"runtimeInstalled":False,"basis":"256px complete frame, alpha >8, visible longest edge","assets":SIZING},ensure_ascii=False,indent=2),encoding="utf-8")
M["candidateExport"]={"size":[256,256],"sizing":"candidate-sizing.json","runtimeInstalled":False}
M["previews"]=["material-review.png","normal-size-preview.png","plane-floor-preview.png","dungeon-floor-preview.png"]
M["previewContract"]={"scope":"offline asset composition; approximate distribution, no game lighting/occlusion, not runtime validation","seed":126030,"planeZoom":.7,"dungeonZoom":1,"profiles":CFG["profiles"],"floorSource":CFG["base"]["src"],"textureScaleY":CFG["base"]["textureScaleY"],"randomFlips":False,"weights":"existing weights restricted to the 12 candidate keys; no runtime change"}
M["composer"]=str(Path(__file__).relative_to(REPO)).replace("\\","/")
(ROOT/"manifest.json").write_text(json.dumps(M,ensure_ascii=False,indent=2),encoding="utf-8")
(ROOT/"README.md").write_text("\n".join([
    "# 矿洞小物 Blender 材质制作源", "", "12件同模型同相机材质输出，没有AI出图。本命令只重建制作源，不更新正式资源；上次安装与当前尺寸见 ../_mine_visual_finish_v3_20260830/manifest.json。", "",
    "- `mine_props_curated.blend`：可编辑模型、程序材质和原固定相机。",
    "- `model-renders/`与`body-depth/`：12组1024px材质渲染与16bit深度图。",
    "- `candidates/`：12张256px透明候选。`candidate-sizing.json`只记录按Alpha重新计算的建议尺寸。",
    "- `material-review.png`：基础材质/新材质并排；`normal-size-preview.png`：当前正式及两种目标尺度。",
    "- `plane-floor-preview.png`与`dungeon-floor-preview.png`：新地板上的正常尺寸离线组合，不是游戏截图。",
    "- 风格来源：`tools/ai-gen/environment-prop-materials.py`，低饱和宽色块、克制木纹/氧化与粗糙度变化；灯具熄灭。",
    "- 本命令不修改正式PNG、双份配置、地图散布、地板或游戏逻辑；制作源重建不等于再次安装。",
    "- 正式安装沿用明确替换授权；材质若在正常尺寸已够清楚，不追加AI轮次。",
    "- 未运行测试或运行时验证，按约定由用户测试。后续接入重点观察可读性、主体尺寸、地板对比和建筑清除区。", "",
    "生成入口：`build-mine-props-material-review.py`（Blender）；预览/候选导出：`compose-mine-material-review.py`（Python+Pillow）。", ""
]),encoding="utf-8")
print(f"Exported 12 candidate sprites, sizing and four offline previews to {ROOT}")
