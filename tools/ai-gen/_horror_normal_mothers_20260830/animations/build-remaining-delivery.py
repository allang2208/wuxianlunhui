"""Offline presentation from installed assets/configs, never launches the game."""
from pathlib import Path
import json
import math
import numpy as np
from PIL import Image,ImageDraw,ImageFont

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
BUILD=ROOT/"remaining-sprite-build-v01"
cfg=json.loads((REPO/"data/enemy-config.json").read_text(encoding="utf-8"))
runtime=json.loads((BUILD/"runtime-manifest.json").read_text(encoding="utf-8"))
keys=["shroudThrall","ossuaryCaster","knellAttendant"]
font=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",18)
small=ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",14)
out=BUILD/"delivery"
out.mkdir(parents=True,exist_ok=True)
cache={}
for key in ["coffinWard"]+keys:
    for state,layout in cfg[key]["textures"]["frameLayouts"].items():
        sheet=Image.open(REPO/cfg[key]["textures"][state]).convert("RGBA")
        w,h,c=layout["frameWidth"],layout["frameHeight"],layout["columns"]
        cells=[]
        scale=cfg[key]["render"]["spriteSize"]/cfg[key]["textures"]["referenceCell"]*1.5
        for i in range(layout["frameCount"]):
            cell=sheet.crop((i%c*w,i//c*h,i%c*w+w,i//c*h+h))
            cells.append(cell.convert("RGBa").resize((round(w*scale),round(h*scale)),Image.Resampling.LANCZOS).convert("RGBA"))
        cache[key,state]=(cells,layout["footX"]*scale,layout["footY"]*scale,np.cumsum([0]+layout["frameDurations"][:-1]))


def paste_actor(panel,key,state,elapsed,x,ground,opacity=1):
    cells,fx,fy,starts=cache[key,state]
    layout=cfg[key]["textures"]["frameLayouts"][state]
    if layout["repeat"]==-1: elapsed%=layout["duration"]
    index=max(0,min(len(cells)-1,int(np.searchsorted(starts,elapsed,side="right")-1)))
    cell=cells[index]
    if opacity<1:
        cell=cell.copy()
        cell.putalpha(cell.getchannel("A").point(lambda a:round(a*max(0,opacity))))
    panel.paste(cell,(round(x-fx),round(ground-fy)),cell)


comparison=Image.new("RGB",(1200,340),(31,35,42));draw=ImageDraw.Draw(comparison)
draw.line((15,290,1185,290),fill=(129,157,142),width=1)
for i,key in enumerate(["minerZombie","coffinWard"]+keys):
    x=120+i*240
    draw.text((x-95,15),cfg[key]["name"],font=font,fill="white")
    if key=="minerZombie":
        scale=cfg[key]["render"]["spriteSize"]/512*1.5
        cell=Image.open(REPO/cfg[key]["textures"]["idle"]).convert("RGBA").crop((0,0,512,512))
        cell=cell.resize((round(512*scale),round(512*scale)),Image.Resampling.LANCZOS)
        foot_y=(256+cfg[key]["render"]["footOffsetY"]/(scale/1.5))*scale
        comparison.paste(cell,(round(x-256*scale),round(290-foot_y)),cell)
    else:
        paste_actor(comparison,key,"idle",0,x,290)
    draw.text((x-96,310),"共同逻辑脚线 / 1.5倍展示",font=small,fill=(188,200,194))
comparison.save(out/"size-reference.png")

panels=[]
duration=4000+max(cfg[k]["textures"]["frameLayouts"]["attack"]["duration"]+cfg[k]["textures"]["frameLayouts"]["death"]["duration"]+1300 for k in keys)
count=math.ceil(duration/1000*24)
for frame in range(count):
    t=frame/24*1000
    panel=Image.new("RGB",(1050,430),(31,35,42));draw=ImageDraw.Draw(panel)
    draw.text((20,12),"正式素材 + 配置时钟 · 离线预览（非游戏实测）",font=font,fill="white")
    for i,key in enumerate(keys):
        attack=cfg[key]["textures"]["frameLayouts"]["attack"]["duration"]
        death=cfg[key]["textures"]["frameLayouts"]["death"]["duration"]
        opacity=1
        if t<2000: state,elapsed,label="idle",t,"待机"
        elif t<4000: state,elapsed,label="walk",t-2000,"行走"
        elif t<4000+attack: state,elapsed,label="attack",t-4000,"攻击"
        else:
            state,elapsed="death",t-4000-attack
            label="死亡" if elapsed<death else "停尸" if elapsed<death+1000 else "淡出"
            if elapsed>=death+1000: opacity=max(0,1-(elapsed-death-1000)/300)
        x=175+i*350
        draw.text((i*350+18,48),cfg[key]["name"]+" · "+label,font=font,fill="white")
        draw.line((i*350+12,370,i*350+338,370),fill=(105,136,120),width=1)
        paste_actor(panel,key,state,elapsed,x,370,opacity)
    panels.append(panel)
times=[round(i*1000/24/10)*10 for i in range(count+1)]
panels[0].save(out/"three-monsters-runtime-clock.gif",save_all=True,append_images=panels[1:],
    duration=[b-a for a,b in zip(times,times[1:])],loop=0,disposal=2,optimize=False)

lines=["# 恐怖地牢三款普通怪：正式接入交付", "",
       "本轮按用户明确要求完成统一体型、优化插帧、游戏接入及状态机。棺板卫尸原有素材和数值不改。所有实机验证均未运行，按约定由用户测试。", "",
       "代码审查后的收尾已完成：四款切动作时立即同步脚点，避免新帧表套用旧偏移一帧；渲染器的可见性、动画同步和深度统一使用Game.isPreservedCorpse，资源管理也保留fadeTimer阶段，接通停尸后的0.3秒渐隐。棺板卫尸仅同步这两项修复，原素材/数值/攻击时钟不变；未运行实机验证。", "",
       f"![同尺度脚线参考]({(out/'size-reference.png').resolve().as_posix()})", "",
       f"![正式素材和配置时钟离线预览]({(out/'three-monsters-runtime-clock.gif').resolve().as_posix()})", "",
       "以上是读取正式PNG和配置制作的离线素材预览，不是运行游戏或截图比对。展示倍率1.5，不是额外运行时缩放。", "",
       "| 怪物 | 基础HP | 配置移速 | 六维 力/敏/体/智/感/运 | 攻击 | 起手冷却 |",
       "|---|---:|---:|---|---|---:|"]
for key in keys:
    c=cfg[key];s=c["attackSkills"]["primary"]
    lines.append(f"| {c['name']} | {c['hp']} | {c['speed']} | {'/'.join(str(c[k]) for k in ('str','dex','con','int','wis','luck'))} | {c['attackType']} ×{s['damageMul']} | {s['cooldown']/1000:g}s |")
lines += ["", "数值参考普通僵尸120HP、矿工僵尸150HP、胖子僵尸200HP和棺板卫尸240HP；六维仍由现有 enemy-base-stats 公式派生物攻/魔攻/防御，未新建伤害公式。移速继续应用项目全局倍率。", "",
          "- 共同可见身高基准约139.515世界像素，制作主体208px；按各源相机首帧固定换算，禁止逐帧fit或拉伸。地面半径36.3、躯干57.5×158.8及HUD基准沿用矿工僵尸，各动作裁框分别换算脚线。",
          "- 每动作独立紧裁排表。待机6fps关键帧→12fps，行走12→24fps；攻击蓄力/收招8→16fps，源38–56帧快速段保留24fps关键帧→48fps。死亡6→12fps并保留原末帧。最终以frameDurations为唯一时钟，总时长未压缩。",
          "- 循环动作插回绕；攻击/死亡不回绕。RIFE v4.6分离RGB/Alpha，原关键帧位于偶数索引；异常中间帧可退回源姿态。没有再次插已插帧的表。",
          "- 裹尸囚徒拍击锁定目标与方向，使用公共近战快照/时间轴、接触窗口和DamagePipeline；攻击期间停步，不追加隐形突刺。",
          "- 掷骨殓徒按源44帧（正式38帧，1.833秒）释放一枚骨镖；在真实发射点预判原目标，绕到背后或失去视线不换目标补射。独立碰撞半径3、显示画布24、速度560、最长射程520，不追踪、不穿透。弹体按速度方向转向，其他显式球形贴图默认不变；对象池重置两个新增显示字段。",
          "- 缚钟侍者按敲钟帧结算一次130半径地面椭圆魔法伤害；逐目标同地表/LOS复查，短时声震圈仅为视觉，无持续伤害、召唤或硬控。",
          "- 共用待机/追击/前摇/生效/收招/死亡/停尸/淡出生命周期。眩晕、冻结、石化、恐惧、冲刺眩晕均取消未释放攻击且保留冷却；恐惧不每帧重置行走。死亡奖励一次，保留末帧1秒、淡出0.3秒。已飞骨镖不随施法者死亡撤销。",
          "- 三款以rank normal加入恐怖地牢主配置、初级和中级共8个既有白名单；poolWhitelistOnly保留，不扩大到矿洞/通用随机池，不改波数、等级配比或强制怪。",
          "", "| 怪物 | 动作 | 正式精灵表 | 原片 | GIF | 帧数 | 单帧格 | 时长 | RGBA MiB |", "|---|---|---|---|---|---:|---|---:|---:|"]
for actor in runtime["actors"]:
    m=json.loads((ROOT/actor["manifest"]).read_text(encoding="utf-8"))
    for r in m["actions"]:
        png=(REPO/r["runtimeSheet"]).as_posix()
        video=(ROOT/r["video"]).as_posix();gif=(ROOT/r["gif"]).as_posix()
        lines.append(f"| {actor['name']} | {r['action']} | [PNG]({png}) | [MP4]({video}) | [GIF]({gif}) | {r['frameCount']} | {r['frameWidth']}×{r['frameHeight']} | {r['durationMs']/1000:.3f}s | {r['rgbaMiB']:.2f} |")
lines += ["", "三款整套基础RGBA估算分别50.51 / 55.55 / 41.21MiB（骨镖已计入掷骨殓徒），高于32MiB目标但低于64MiB准入线。保留完整5秒一次性动作及208px主体是主要占用；未抬高全局预算。这不是整场显存或性能实测。", "",
          "三款同场唯一纹理合计约147.27MiB；加此前棺板卫尸约56.84MiB，四款合计约204.11MiB，与同种实例数无关。切场若旧场景纹理仍驻留，本轮新增部分最多再占约147.27MiB；实际过渡峰值还包含旧场景、其他怪物、地形、UI及GPU开销，未进行整场预算检查或性能实测，不能据此声称整场达标。", "",
          "已知源片边界：掷骨殓徒抬手的43–44帧原始顶部裁切仍保留，没有声称补回缺失指尖；换边和发力按用户认可保留。死亡落地骨镖保留在尸体动画，不生成第二枚战斗弹体。裹尸囚徒拍地手部的源角标只做局部RGB清理，Alpha与姿态不变。未新增独立声音文件。", "",
          "文件范围：三款enemy-types及_shared/horror-normal-enemy；实体导出、zombie-dungeon工厂、BootScene资源登记；双份enemy-config/dungeon-config；ProjectileFactory和Projectile的可选朝向/显示大小字段；assets/enemies三目录及本制作目录。审查后追加coffin-ward.js脚点同步、GameScene.js尸体显示门禁和runtime-asset-manager.js淡出保活修复。未改棺板卫尸或其他怪物的参数。", "",
          "用户重点测试：三款普通槽出怪、同屏体量/脚线与左右翻转；拍击空挥和弹反；骨镖出手位置/上下层弹道/墙体阻挡/对象池复用；钟震范围和隔墙；控制打断、长帧跨生效窗、死亡奖励一次、停尸淡出与切场清理。", "",
          "已按用户要求完成四款限定范围代码审查，并修复两项确定问题。未运行测试、lint、类型检查、构建、服务器或浏览器/游戏运行时验证，也未单独运行预算检查脚本；按约定由用户测试。素材处理报告和离线GIF不等同游戏测试，原片指尖裁切仍为已披露的素材限制。", ""]
(BUILD/"DELIVERY.md").write_text("\n".join(lines),encoding="utf-8")
print("Wrote offline size reference, configuration-clock GIF and delivery report.")
