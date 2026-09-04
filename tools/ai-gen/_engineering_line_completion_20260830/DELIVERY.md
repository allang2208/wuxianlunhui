# 工程器械支线接入与收尾交付（2026-08-30）

**三个等级的建筑及三个等级的兵种均已接入当前开发源码，榴弹炮取弹衔接也已完成。尚未运行游戏验收，固定EXE没有同步。**

| 建筑 | 兵种 | 科研点 | 生命 / 伤害 | 射程 / 最小射程 | 攻击间隔 | 招募秒 / 食物 / 能源 |
|---|---|---:|---|---|---|---|
| 工程师营地 | 仓鼠投石组 | 270 | 360 / 180 | 850 / 190 | 6.5秒 | 75 / 240 / 90 |
| 工程工坊 | 仓鼠野战炮组 | 1560 | 480 / 280 | 1000 / 220 | 8秒 | 95 / 360 / 170 |
| 载具工厂 | 仓鼠榴弹炮组 | 4140 | 620 / 420 | 1150 / 250 | 10秒 | 120 / 480 / 260 |

- 每组两名仓鼠与一台器械，作为一个单位共享生命/指令，占2军事人口。科技换代只影响后续招募，已有低级部队保留。
- 位于军事指挥→工程器械独立支线，lane3、column1→3→6。载具工厂要求工程工坊、黑火药、蒸汽工业标准化、现代机械制造全部完成；不改科研价格、建筑逻辑占格或三级材质。
- 补齐野战炮实体、按需纹理加载、招募工厂、人口、兵线、升级、兵种识别、存档实体恢复及前后台战斗档案。三档均复用炮口定时出弹、最小射程后撤、逐段墙体碰撞和范围物理伤害。后台为DPS估算，不是实战模拟。
- 投石组和野战炮补齐独立UI图标；由已确认待机图集首帧裁出，保留双人和完整器械。野战炮铁弹为本地编写的64×64 SVG球形金属弹丸，不借用其他单位图像。
- 野战炮62/62/85/97帧，四动作各5.1667秒；源55帧/2.2917秒在成品32帧触发唯一炮弹。所有已确认动作与统一身体尺度保留。
- 两级火炮只对炮口外侧烟焰Alpha作柔和消散，去掉触碰原画布边缘的硬切；不补画外部像素、不改变开火时刻、人物、炮车或死亡轨迹。由未插帧源关键帧重新执行2×RIFE，没有对成品重复插帧。
- 声音仅从实际采用的正式视频提取。野战炮有炮击和短移动音；榴弹炮有炮击、退壳、装填音。枪声随成功出膛，退壳3.96秒、装填6.08秒单次触发，改令/硬控/死亡不会继续触发未到时点的声音。源音轨的持续移动底声被排除。音轨包络与裁切来源见audio-cues.json；未做听感验收。

## 资源与重建

| 单位 | 完整RGBA容量 | 动作帧数（待机/移动/攻击/死亡） |
|---|---:|---|
| hamster_catapult_crew | 61.498 MiB | 62/62/77/81 |
| hamster_field_cannon_crew | 53.066 MiB | 62/62/85/97 |
| hamster_howitzer_crew | 63.603 MiB | 62/62/197/147 |

三种器械全部驻留的纹理像素容量约178.167 MiB（含各自弹丸，不含其他建筑/单位）。每族低于64MiB准入线，但超过32MiB目标；此处是图集容量计算，不是实测显存或性能承诺。UI图标不额外进入Phaser。
当前榴弹炮攻击重建入口为`resupply_sprites.py`，具体阶段见下文及RESUPPLY-DELIVERY.md；不再执行旧的整线refine_muzzle入口。原8秒攻击关键帧与新取弹视频均保留，所有步骤只处理本地素材。
代码文件：`src/entities/hamster-field-cannon-crew.js`、`src/ai/hamster-catapult-crew-ai.js`、`src/phaser/assets/friendly-unit-assets.js`、`src/world/{producer-building-system,unit-upgrade-store,world122-sim,troop-line-system,technology-system}.js`、`src/config/{hamster-unit-icons,hamster-unit-categories}.js`。数据文件：`data/{hamster-field-cannon-crew-config,hamster-howitzer-crew-config,producer-buildings,technology-tree,military-population-costs,building-upgrades,audio-config}.json`。
正式资产位于`assets/companions/hamster_field_cannon_crew/`、榴弹炮`attacking.png`、`assets/ui/unit-icons/hamster-{catapult,field-cannon}-crew.png`和`assets/sounds/friendly/hamster_{field_cannon,howitzer}_crew_*_video.mp3`。

## 取弹衔接已完成

用户明确同意本批两帧与提示词外发后完成H3生成，保留原8秒攻击并追加自然取弹回待机；原出膛/退壳/装填时点、其他动作、尺度和碰撞不变。完整攻击时长及其实际射击周期下限见[衔接交付](RESUPPLY-DELIVERY.md)。本表10秒为未修改的基础冷却参数，实际周期取冷却与完整动画时长的较大值，前后台均按此计算。

当前重建最终一步执行`resupply_sprites.py keys`、`interpolate`、`package`、`import`；保持`before-resupply/`原生攻击关键帧及原片不变，不对成品重复插帧。插帧用`.venv-sprites`，其余用ComfyUI Python；均为本地素材制作。

## 验收边界

仅查看本次差异、必要局部接线和制作预览；未运行测试、lint、构建、浏览器/CDP、游戏或运行时验证，按约定由用户测试。重点：三级科研与黑火药门槛、已有科技旧档招募换代、2人口和扣费、左右炮口/弹道/范围伤害、近身后撤、升级、死亡完整播放、切场和读档。
未提交Git或发布，固定EXE未更新。

## 本次攻击精灵图预览

### 仓鼠野战炮组

[原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/attack-v01.mp4) · [正式精灵图](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/companions/hamster_field_cannon_crew/attacking.png)

![按原时长的攻击GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/previews/attack-transparent-edge-refined.gif)

### 仓鼠榴弹炮组

[原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_howitzer_animations_20260830/videos/attack-v02.mp4) · [正式精灵图](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/companions/hamster_howitzer_crew/attacking.png)

![按原时长的攻击GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_howitzer_animations_20260830/previews/attack-resupplied.gif)
