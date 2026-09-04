"""Write the engineering line delivery from current production manifests/configs."""
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[2]
def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))

units=[('catapult','工程师营地',270,75,240,90),('field_cannon','工程工坊',1560,95,360,170),('howitzer','载具工厂',4140,120,480,260)]
resupplied=read(ROOT.parent/'_hamster_howitzer_animations_20260830/spritesheet-manifest.json').get('resupplyCompleted',False)
lines=['# 工程器械支线接入与收尾交付（2026-08-30）','',
    ('**三个等级的建筑及三个等级的兵种均已接入当前开发源码，榴弹炮取弹衔接也已完成。尚未运行游戏验收，固定EXE没有同步。**' if resupplied else '**三个等级的建筑及三个等级的兵种均已接入当前开发源码。尚未运行游戏验收，固定EXE没有同步。榴弹炮取弹衔接尚未接入。**'),' ',
    '| 建筑 | 兵种 | 科研点 | 生命 / 伤害 | 射程 / 最小射程 | 攻击间隔 | 招募秒 / 食物 / 能源 |',
    '|---|---|---:|---|---|---|---|']
manifests=[]
for key,building,points,seconds,food,energy in units:
    cfg=read(REPO/f'data/hamster-{key.replace("_","-")}-crew-config.json')
    ai=cfg['ai']
    manifest=read(ROOT.parent/f'_hamster_{key}_animations_20260830/spritesheet-manifest.json')
    manifests.append((key,manifest))
    lines.append(f'| {building} | {cfg["name"]} | {points} | {cfg["baseMaxHp"]} / {ai["attackDamage"]} | '
        f'{ai["attackRange"]} / {ai["minimumRange"]} | {ai["attackInterval"]/1000:g}秒 | {seconds} / {food} / {energy} |')
lines += ['',
    '- 每组两名仓鼠与一台器械，作为一个单位共享生命/指令，占2军事人口。科技换代只影响后续招募，已有低级部队保留。',
    '- 位于军事指挥→工程器械独立支线，lane3、column1→3→6。载具工厂要求工程工坊、黑火药、蒸汽工业标准化、现代机械制造全部完成；不改科研价格、建筑逻辑占格或三级材质。',
    '- 补齐野战炮实体、按需纹理加载、招募工厂、人口、兵线、升级、兵种识别、存档实体恢复及前后台战斗档案。三档均复用炮口定时出弹、最小射程后撤、逐段墙体碰撞和范围物理伤害。后台为DPS估算，不是实战模拟。',
    '- 投石组和野战炮补齐独立UI图标；由已确认待机图集首帧裁出，保留双人和完整器械。野战炮铁弹为本地编写的64×64 SVG球形金属弹丸，不借用其他单位图像。',
    '- 野战炮62/62/85/97帧，四动作各5.1667秒；源55帧/2.2917秒在成品32帧触发唯一炮弹。所有已确认动作与统一身体尺度保留。',
    '- 两级火炮只对炮口外侧烟焰Alpha作柔和消散，去掉触碰原画布边缘的硬切；不补画外部像素、不改变开火时刻、人物、炮车或死亡轨迹。由未插帧源关键帧重新执行2×RIFE，没有对成品重复插帧。',
    '- 声音仅从实际采用的正式视频提取。野战炮有炮击和短移动音；榴弹炮有炮击、退壳、装填音。枪声随成功出膛，退壳3.96秒、装填6.08秒单次触发，改令/硬控/死亡不会继续触发未到时点的声音。源音轨的持续移动底声被排除。音轨包络与裁切来源见audio-cues.json；未做听感验收。','',
    '## 资源与重建','',
    '| 单位 | 完整RGBA容量 | 动作帧数（待机/移动/攻击/死亡） |',
    '|---|---:|---|']
for key,m in manifests:
    counts='/'.join(str(m['actions'][k]['frameCount']) for k in ['idle','run','attack','die'])
    lines.append(f'| {m["unitKey"]} | {m["decodedMiB"]:.3f} MiB | {counts} |')
total=sum(m['decodedMiB'] for _,m in manifests)
lines += ['',f'三种器械全部驻留的纹理像素容量约{total:.3f} MiB（含各自弹丸，不含其他建筑/单位）。每族低于64MiB准入线，但超过32MiB目标；此处是图集容量计算，不是实测显存或性能承诺。UI图标不额外进入Phaser。',
    ('当前榴弹炮攻击重建入口为`resupply_sprites.py`，具体阶段见下文及RESUPPLY-DELIVERY.md；不再执行旧的整线refine_muzzle入口。原8秒攻击关键帧与新取弹视频均保留，所有步骤只处理本地素材。' if resupplied else '当前重建顺序：用ComfyUI Python运行`refine_muzzle.py keys`；用`.venv-sprites`分别运行两级炮的`make_sprites.py interpolate --kinds attack`；再用ComfyUI Python运行`refine_muzzle.py package`、`import_line.py`。该流程只处理本地既有源素材，不联网；源视频和原生关键帧保留，可再生缓存缺失时先按各单位原流程恢复。'),
    '代码文件：`src/entities/hamster-field-cannon-crew.js`、`src/ai/hamster-catapult-crew-ai.js`、`src/phaser/assets/friendly-unit-assets.js`、`src/world/{producer-building-system,unit-upgrade-store,world122-sim,troop-line-system,technology-system}.js`、`src/config/{hamster-unit-icons,hamster-unit-categories}.js`。数据文件：`data/{hamster-field-cannon-crew-config,hamster-howitzer-crew-config,producer-buildings,technology-tree,military-population-costs,building-upgrades,audio-config}.json`。',
    '正式资产位于`assets/companions/hamster_field_cannon_crew/`、榴弹炮`attacking.png`、`assets/ui/unit-icons/hamster-{catapult,field-cannon}-crew.png`和`assets/sounds/friendly/hamster_{field_cannon,howitzer}_crew_*_video.mp3`。','',
    '## 未完成：取弹衔接的外发授权','',
    '当前8秒攻击v02在装填完成后以空手姿势结束，而待机首帧持有下一发炮弹，仍有接缝。保留已确认视频，不用补帧变形伪造取弹。',
    '拟向局域网H3服务`http://192.168.3.142:8188`发送以下两张由项目视频提取的PNG与一份新提示词，生成一次3秒、1024×576、20步、seed830907的取弹候选。会向该服务传输未公开项目素材；权限审核明确拒绝，理由是旧H3授权不包含这批新增载荷及用途。目前未上传、未提交成功、未生成新视频；没有绕过限制。','',
    f'[查看拟发送提示词]({(ROOT/"resupply-prompt.txt").as_posix()})','',
    f'![攻击末帧：空手]({(ROOT/"howitzer-end.png").as_posix()})','',
    f'![待机首帧：持弹]({(ROOT/"howitzer-idle.png").as_posix()})','',
    '用户明确批准本批外发后才重试。新片需保持两仓鼠/炮身/视角，无开火，真实取弹后回到待机；接入前制作GIF并计入完整资源预算。','',
    '## 验收边界','',
    '仅查看本次差异、必要局部接线和制作预览；未运行测试、lint、构建、浏览器/CDP、游戏或运行时验证，按约定由用户测试。重点：三级科研与黑火药门槛、已有科技旧档招募换代、2人口和扣费、左右炮口/弹道/范围伤害、近身后撤、升级、死亡完整播放、切场和读档。',
    '未提交Git或发布，固定EXE未更新。','',
    '## 本次攻击精灵图预览','']
for key,m in manifests[1:]:
    folder=ROOT.parent/f'_hamster_{key}_animations_20260830'
    a=m['actions']['attack']
    lines += [f'### {"仓鼠野战炮组" if key=="field_cannon" else "仓鼠榴弹炮组"}','',
        f'[原视频]({(folder/a["video"]).as_posix()}) · [正式精灵图]({(REPO/a["runtimePath"]).as_posix()})','',
        f'![按原时长的攻击GIF]({(folder/a["preview"]).as_posix()})','']
(ROOT/'DELIVERY.md').write_text('\n'.join(lines),encoding='utf-8')
if resupplied:
    text=(ROOT/'DELIVERY.md').read_text(encoding='utf-8')
    lo=text.index('## 未完成：取弹衔接的外发授权')
    hi=text.index('## 验收边界',lo)
    text=text[:lo]+('## 取弹衔接已完成\n\n'
        '用户明确同意本批两帧与提示词外发后完成H3生成，保留原8秒攻击并追加自然取弹回待机；原出膛/退壳/装填时点、其他动作、尺度和碰撞不变。'
        '完整攻击时长及其实际射击周期下限见[衔接交付](RESUPPLY-DELIVERY.md)。'
        '本表10秒为未修改的基础冷却参数，实际周期取冷却与完整动画时长的较大值，前后台均按此计算。\n\n'
        '当前重建最终一步执行`resupply_sprites.py keys`、`interpolate`、`package`、`import`；保持`before-resupply/`原生攻击关键帧及原片不变，不对成品重复插帧。'
        '插帧用`.venv-sprites`，其余用ComfyUI Python；均为本地素材制作。\n\n')+text[hi:]
    (ROOT/'DELIVERY.md').write_text(text,encoding='utf-8')

folder=ROOT.parent/'_hamster_field_cannon_animations_20260830'
m=manifests[1][1]
field=['# 仓鼠野战炮组：已接入游戏开发版','',
    '用户要求继续完成整个工程器械支线后，已导入四套确认过的动画，并补齐招募、科技、人口、战斗、升级、存档实体工厂、纹理和UI图标。固定EXE未同步，未运行测试或运行时验证，按约定由用户测试。',
    f'完整接入记录与待授权项见[工程器械交付]({(ROOT/"DELIVERY.md").as_posix()})。','',
    '二级480HP、280基础物理伤害、1000射程、220最小射程、95范围半径、8秒攻击间隔；2人口、95秒招募、360食物/170能源。工程工坊科研完成后后续招募换代，旧投石组保留。','']
for kind,label in [('idle','待机'),('run','移动'),('attack','攻击'),('die','死亡')]:
    a=m['actions'][kind]
    field += [f'## {label}','',f'{a["frameCount"]}帧，{a["durationMs"]/1000:.4f}秒；每格{a["frameWidth"]}×{a["frameHeight"]}。',
        f'[原视频]({(folder/a["video"]).as_posix()}) · [正式精灵图]({(REPO/a["runtimePath"]).as_posix()})','',
        f'![{label}]({(folder/a["preview"]).as_posix()})','']
(folder/'RUNTIME-DELIVERY.md').write_text('\n'.join(field),encoding='utf-8')
print('Wrote engineering line and field cannon runtime delivery records.')
