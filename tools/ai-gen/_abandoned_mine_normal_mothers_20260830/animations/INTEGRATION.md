# 废弃矿洞两只普通怪：运行时接入

用户已要求统一体型、优化插帧、接入游戏并完善动作状态机。本次使用已批准的母图/豆包视频及原始透明关键帧；没有重新请求视频生成，也没有修改精英钻虫、矿石蜘蛛或矿石领主。

## 体量与播放

![同尺度对比](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/size-comparison.png)

图中按配置的同一世界比例放大2倍展示，并非游戏截图。幼钻虫以躯干粗细为口径（约40px），碎矿石怪以不含背刺的主体为口径（约80px）；保留扁长与矮壮的区别，不强行将两个不同体态拉成相同外框。每只怪物四个动作共用像素比例 `8/15`、画布与脚点；不逐帧重新缩放/居中，也不消除原动作的前探、转体或碎块落地。

- 幼钻虫：320×256单格，8列，脚点216；主体碰撞展示124×40，地面半径28。
- 碎矿石怪：448×256单格，8列，脚点224；主体碰撞展示84×80，地面半径27。单臂、单根背刺与紫色晶石保留。
- `textures.referenceCell=256`，`render.spriteSize=136.5333333333`；实体按单格最长边换算显示大小。脚点同步 `footOffsetY`，HUD走胶囊锚点，弹道命中框不含长背刺或死亡碎块。

![四动作运行时素材预览](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/runtime-overview.gif)

这是2倍比例、40fps采样的离线素材总览。待命/移动循环，攻击单次停末帧供观察，死亡包含末帧停留和淡出；整张GIF重复仅为预览，游戏中攻击结束返回待命/追击，死亡不会重播。单动作GIF在下表，供观察原生帧节奏。

## 插帧与资源

先将批准的未插帧关键帧统一减半，裁去攻击前后冗余停顿，再执行RGB/Alpha分离RIFE 2倍插帧。没有对已插帧结果再次插帧，没有几何拉直运动轨迹，也没有对紫色矿石去紫/去蓝。八张运行时表共422个有效帧，尾行空格由 `endFrame=frameCount-1` 排除。

- 幼钻虫攻击：原视频f24–96，每4源帧取一帧，再补中间帧；37帧/1.2s，接触f18（原视频f60，约584ms）。
- 碎矿石怪攻击：原视频f12–112，每4源帧取一帧；51帧/1.6s，接触f28（原视频f68，约878ms）。
- 两只死亡：原视频f0–120，每4源帧取一帧，61帧；保留原视频最后一帧尸体。时长分别1.6/1.8s，随后停留1s、淡出0.3s。
- 移动循环的标准周期均为1s；游戏内随实际速度调整动画相位推进，开始/停止有速度阈值，避免低速抖动时来回切状态。

| 资源 | 有效帧 / endFrame | 标准播放 | 正式表 | 预览 | 来源 |
|---|---:|---|---|---|---|
| 岩芯幼钻虫·待命 | 66 / 65 | 2.750s，循环 | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/core_drill_larva/idle.png) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/core-drill-larva/previews/idle.gif) | [原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/core-drill-larva/videos/idle-doubao-v01.mp4) |
| 岩芯幼钻虫·移动 | 38 / 37 | 1.000s，循环 | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/core_drill_larva/walk.png) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/core-drill-larva/previews/walk.gif) | [原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/core-drill-larva/videos/walking-doubao-v01.mp4) |
| 岩芯幼钻虫·攻击 | 37 / 36 | 1.200s，单次 | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/core_drill_larva/attack.png) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/core-drill-larva/previews/attack.gif) | [原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/core-drill-larva/videos/attacking-doubao-v01.mp4) |
| 岩芯幼钻虫·死亡 | 61 / 60 | 1.600s，单次 | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/core_drill_larva/death.png) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/core-drill-larva/previews/death.gif) | [原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/core-drill-larva/videos/dying-doubao-v01.mp4) |
| 碎矿石怪·待命 | 50 / 49 | 2.083s，循环 | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/ore_shardling/idle.png) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/ore-shardling/previews/idle.gif) | [原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/ore-shardling/videos/idle-doubao-v01.mp4) |
| 碎矿石怪·移动 | 58 / 57 | 1.000s，循环 | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/ore_shardling/walk.png) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/ore-shardling/previews/walk.gif) | [原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/ore-shardling/videos/walking-doubao-v01.mp4) |
| 碎矿石怪·攻击 | 51 / 50 | 1.600s，单次 | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/ore_shardling/attack.png) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/ore-shardling/previews/attack.gif) | [原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/ore-shardling/videos/attacking-doubao-v01.mp4) |
| 碎矿石怪·死亡 | 61 / 60 | 1.800s，单次 | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/ore_shardling/death.png) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/ore-shardling/previews/death.gif) | [原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/ore-shardling/videos/dying-doubao-v01.mp4) |

制作阶段的RIFE报告记录八张表均无空帧/触边，透明像素RGB残留为0，源关键帧保留在偶数输出位置，没有整帧退回源帧的替代。此为离线素材生产记录，不是游戏运行验证。每张表的来源帧、时长和制作报告见 [runtime-manifest.json](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/runtime-build/runtime-manifest.json)。原视频与当前插帧前透明输入保留；旧全分辨率成品和重复缓存已可恢复清理。

## 数值设计

以矿工僵尸（4级普通，150生命）作同级基准；保持统一六维派生攻防。下表为出生基础值，不包含地牢成长、难度倍率、装备、暴击或目标减伤。伤害一栏为送入伤害管线前的普通非暴击值。

| 项目 | 矿工僵尸（参考，不修改） | 岩芯幼钻虫 | 碎矿石怪 |
|---|---:|---:|---:|
| 等级 / 品阶 | 4 / 普通 | 4 / 普通 | 4 / 普通 |
| 生命 | 150 | 125 | 190 |
| 配置移速 | 140 | 165 | 115 |
| 全局0.75移速倍率后 | 105 | 123.75 | 86.25 |
| STR / DEX / CON | 16 / 13 / 18 | 14 / 18 / 13 | 20 / 8 / 22 |
| INT / WIS / LUCK | 3 / 4 / 5 | 3 / 4 / 5 | 2 / 6 / 4 |
| 派生攻击 / 防御 | 15 / 31 | 16 / 23 | 14 / 39 |
| 本次单击管线输入 | 原机制保持 | 14（0.85倍率） | 16（1.15倍率） |
| 攻击总时长 / 冷却 | 1.5s / 4s | 1.2s / 2.4s | 1.6s / 3s |
| 起手 / 命中前伸 | 原机制160 | 70 / 70 | 60 / 60 |
| 击退 | 75 | 12 | 22 |

幼钻虫定位为短距离、较灵活但较脆弱的近战；碎矿石怪偏耐打、移动慢、拳击前摇更长。两者都不附加召唤、范围伤害、钻地或额外控制。

## 状态与战斗契约

`待命/追击 → 起手 → 单次命中 → 收招 → 待命/追击`。死亡优先转入 `死亡动画 → 尸体末帧 → 淡出销毁`。

- 感知、选敌、寻路继续使用公共系统。两只新怪只自管技能计时；通用近战调度被关闭，避免同时出现隐形第二击。
- 起手锁定原目标和方向，整个攻击期间停步；目标死亡/离开不会将剩余攻击转给旁边的新目标。
- 动画帧与命中使用同一累计dt时钟，跨过接触帧也只复查一次。命中复用公共方向矩形、同地表与视线规则，经过DamagePipeline保留减伤、格挡/招架等处理。
- 眩晕、冻结、石化、冲刺眩晕、恐惧取消未结算命中并保留冷却；恐惧逃跑仍由公共移动系统驱动。石化有专门的最小更新入口，解控后不会补放旧攻击。
- 受伤沿用公共闪烁/状态效果；未添加不存在的受伤动画。死亡仍调用基类奖励、掉落与清理，只在子类完成尸体展示生命周期。

## 接入范围与涉及文件

- [mine-small-monsters.js](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types/mine-small-monsters.js)：两只实体与公共四动作时钟。
- [enemy-types.js](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/entities/enemy-types.js)、[zombie-dungeon.js](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/world/zombie-dungeon.js)：导出与工厂登记。
- [BootScene.js](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/src/phaser/scenes/BootScene.js)：八张纹理及动画登记；配置纹理路径同时供现有按需资源族加载使用。
- [enemy-config.json](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/data/enemy-config.json) 与 [public镜像](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/public/data/enemy-config.json)：数值、碰撞、脚点、精灵布局、命中时序。
- [dungeon-config.json](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/data/dungeon-config.json) 与 [public镜像](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/public/data/dungeon-config.json)：三档矿洞的normal/elite/boss房候选池共9处新增两个normal键。沿用rank配额与回退机制，不改变波数、精英/领主、固定主题模板或其他地牢；`poolWhitelistOnly`防止泄漏到全局默认池。
- [CHANGELOG.md](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/CHANGELOG.md)：本次记录。
- 八张运行时PNG见上表；[制作脚本](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/build-runtime-sprites.py)、[任务索引](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/task-index.json)、[旧版说明](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/animations/SPRITES.md) 保留来源/版本关系。`build-sprites.py`仅补充重跑旧表时保留已接入状态，避免覆盖新阶段记录。

## 仓库收口与重建

本任务515个过期/可再生文件（约495.87MiB）移入仓库忽略目录 `tools/.trash-mine-small-monsters-20260830/`，可按相对路径恢复；未永久删除，未触碰其他任务。矿石v01母图作为v02直接编辑源保留，两个外部材质参考另存本任务references，原文件不动。清单见 [archive-manifest.json](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_abandoned_mine_normal_mothers_20260830/archive-manifest.json)。

正常重建：使用项目ComfyUI Python运行 `animations/build-runtime-sprites.py build`，随后运行同脚本 `previews`。它直接读取已保留的八张 `runtime-build/*/source/*.png`，无需重新生视频/抠图，也不会再次重采样已批准关键帧；缺失输入时明确报错。历史全分辨率源可按需由 `build-sprites.py prepare/cutouts/compose` 重建，但不再覆盖当前任务索引中的正式路径。

## 尚未测试

未运行测试、lint、类型检查、构建、服务器、浏览器/CDP或游戏运行时验证，按项目约定由用户测试。本轮仅完成素材生产、局部真实差异与必要调用链核对。

重点请在游戏内确认：三档矿洞能刷出两只怪且不占精英/领主名额；首次加载没有占位闪烁；体型与脚点切换稳定；左右/斜向近战命中、躲避与隔墙未命中；控制打断无延迟伤害；死亡只结算一次且尸体按时消失。幼钻虫原视频爬行幅度较小、矿石怪拳击带转体，这些已批准的动作特征保留，最终战斗辨识度与数值平衡仍需实机反馈。
