"""Assemble offline model review boards; no runtime writes or image generation."""
import json
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

REPO = Path(__file__).resolve().parents[2]
ROOT = REPO / "tools/ai-gen/_mine_props_model_review_20260830"
M = json.loads((ROOT / "manifest.json").read_text(encoding="utf-8"))
FONT = "C:/Windows/Fonts/msyh.ttc"


def font(size):
    return ImageFont.truetype(FONT, size)


def body(path):
    im = Image.open(path).convert("RGBA")
    box = im.getchannel("A").point(lambda a: 255 if a > 8 else 0).getbbox()
    return im.crop(box)


def paste_center(canvas, sprite, center, factor):
    sprite = sprite.resize((max(1, round(sprite.width * factor)), max(1, round(sprite.height * factor))), Image.Resampling.LANCZOS)
    canvas.paste(sprite, (round(center[0] - sprite.width / 2), round(center[1] - sprite.height / 2)), sprite)


def board(compare=False):
    width, header, row = 1560, 112, 254
    canvas = Image.new("RGB", (width, header + 4 * row + 48), "#111a21")
    d = ImageDraw.Draw(canvas)
    title = "矿洞小物 · 旧模型 / 新模型" if compare else "矿洞小物 · 12件新版模型"
    d.text((32, 18), title, font=font(32), fill="#e3e8eb")
    d.text((32, 65), "Blender 模型阶段 | 30°正交 / 根旋转44.8° | 同建模比例展示 | 未接入游戏", font=font(20), fill="#9facb7")
    for i,p in enumerate(M["props"]):
        x=(i%3)*520; y=header+(i//3)*row
        d.rounded_rectangle((x+12,y+7,x+508,y+row-6),radius=10,fill="#25313a")
        d.text((x+28,y+18),f"{i+1:02d}  {p['labelZh']}",font=font(22),fill="#e3e8eb")
        d.text((x+406,y+21),p["decision"],font=font(18),fill="#d6b686")
        new=body(ROOT/p["modelRender"])
        if compare:
            old=body(REPO/"assets/terrain/abandoned-mine-props"/(p["key"]+".png"))
            paste_center(canvas,old,(x+139,y+137),2.0)
            paste_center(canvas,new,(x+382,y+137),.5)
            d.text((x+98,y+209),"旧模型",font=font(17),fill="#909da8")
            d.text((x+339,y+209),"新模型",font=font(17),fill="#d6b686")
        else:
            paste_center(canvas,new,(x+260,y+141),.75)
    d.text((30,canvas.height-34),"基础材质仅辅助看结构；旧源保留。模型图不含地面或方向性投影，不是游戏截图。",font=font(18),fill="#9facb7")
    canvas.save(ROOT/("before-after.png" if compare else "model-review.png"))


board()
board(True)

# Same-frame init/depth atlas: no cropping, recentering, perspective warp or per-prop scale.
cell=256
init=Image.new("RGB",(4*cell,3*cell),(255,0,255))
depth=Image.new("L",init.size,0)
for i,p in enumerate(M["props"]):
    pos=((i%4)*cell,(i//4)*cell)
    src=Image.open(ROOT/p["modelRender"]).convert("RGBA").resize((cell,cell),Image.Resampling.LANCZOS)
    init.paste(src,pos,src)
    # Convert actual 16-bit depth values to 8-bit explicitly (Pillow L would clip).
    dep=Image.open(ROOT/p["bodyDepth"])
    dep=dep.point(lambda v: v/257).convert("L").resize((cell,cell),Image.Resampling.LANCZOS)
    depth.paste(dep,pos)
init.save(ROOT/"model-init-atlas.png")
depth.save(ROOT/"body-depth-atlas.png")

lines=["# 矿洞小物模型阶段取舍（2026-08-30）", "", "本轮评估原有18件，建立12件新版模型候选；6件退出新版通用组。旧Blender、18张正式贴图及运行时配置均保留，不在本阶段物理删除。", "", "## 保留并处理的12件", "", "| 小物 | 处理 | 结构原因与本轮处理 |", "|---|---|---|"]
lines += [f"| {p['labelZh']} | {p['decision']} | {p['reason']} |" for p in M["props"]]
lines += ["", "## 不进入新版通用组的6件", "", "| 小物 | 处理 | 原因 |", "|---|---|---|"]
lines += [f"| {p['labelZh']} | {p['decision']} | {p['reason']} |" for p in M["excluded"]]
lines += ["", "## 交付与边界", "", "- `mine_props_curated.blend`：12个独立集合，保留可编辑网格、曲线、倒角和材质。", "- `model-renders/`与`body-depth/`：12组1024×1024配对输出；相机与锚点完全同源。", "- `model-review.png`：新模型总览。`before-after.png`：原图与模型图按同建模比例并列；只做等比显示，无视角矫正。", "- `model-init-atlas.png`与`body-depth-atlas.png`：4×3、每格256，供下一步模型约束材质细化；从完整画幅等比缩小，不改变主体位置。", "- 统一相机来自道路/雪原源脚本：正交30°、根旋转44.8°、orthoScale 6.4、地面投影Y=0.875；1024源图不改变建模比例。", "- 不创建底板、投影平面、碰撞、实时灯光或发光节点；矿灯和帽灯默认熄灭。", "- 这不是PBR精修成品；棱角、结构连接已建入模型，磨损、木纹、锈蚀细节留给后续受约束材质阶段。", "- `targetVisibleWorldPx`仅记录沿用的展示目标，不是已接入的新size。新模型Alpha范围变化，后续接入必须重新标定，不能直接沿用旧size。", "- 未改全局散布算法、权重、地板、位面解锁、地牢行为或正式18件资产；因此游戏中仍显示旧模型贴图。", "- 只运行建模与离线素材整理。未运行测试或运行时验证，按约定由用户测试。后续重点观察煤/矿石在冷灰地板上的区别、矿镐轮廓、灯具辨识、战斗视野与尺寸。", "", "## 可复现命令", "", "```powershell", "& 'E:\\Program Files\\Blender Foundation\\Blender 5.1\\blender.exe' --background --factory-startup --python tools/ai-gen/build-mine-props-model-review.py", "# 在带Pillow的Python环境运行：", "python tools/ai-gen/compose-mine-model-review.py", "```", ""]
(ROOT/"model-decisions.md").write_text("\n".join(lines),encoding="utf-8")
print(f"Wrote offline model boards, paired atlases and decision report: {ROOT}")
