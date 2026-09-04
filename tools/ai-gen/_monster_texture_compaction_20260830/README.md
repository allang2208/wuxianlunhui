# 狼人王 / 岩芯钻虫纹理压缩交付

制作于2026-08-30，接入记录2026-08-31。范围仅为 `werewolfKing`（狼人王，不是红狼）与 `coreDrillWorm` 的12套动画贴图及配套几何配置。已替换开发版正式素材；未更新固定EXE。

## 为什么占用大

基础解码量按 **整张PNG宽 × 高 × 4字节** 累加，包含透明留白和末行空格。这不是PNG磁盘文件大小，也不是实测GPU峰值；浏览器解码副本、GPU格式、额外纹理与同场资源会影响实际占用。同种怪物通常共享纹理，不能直接按实例数重复乘整套贴图大小。

两种怪物各6套动作；动作数量与帧数会累积成本，但此次主要浪费是过大的帧格及透明区域。例如原钻虫待机每格896×640，而非透明内容集中在约243px高的区域；狼人王飞扑原整表8064×5760，单张基础RGBA约177.19MiB。只调PNG压缩等级无法降低这些解码像素。

| 对象 | 基础RGBA：原版 → 压缩版 | 降幅 | PNG磁盘：原版 → 压缩版 | 有效帧 |
| --- | ---: | ---: | ---: | ---: |
| 狼人王 | 645.94 → 199.43MiB | 69.1% | 40.68 → 24.98MiB | 276 → 276 |
| 岩芯钻虫 | 655.00 → 107.70MiB | 83.6% | 52.40 → 23.94MiB | 292 → 292 |
| 合计 | 1300.94 → 307.12MiB | 76.4% | 93.08 → 48.92MiB | 568 → 568 |

12张正式表最长边4056px，均在4096以内。狼人王/钻虫分别低于第16卷的256/128MiB复核线，仍高于128/64MiB目标值；没有为追求最低数字进一步牺牲细节。低于预算不代表实机不卡顿，本次没有测量帧率、GPU显存或加载耗时。

## 方法与保持不变的内容

1. 保存压缩前正式PNG和两个对象的配置快照。从既有2倍RIFE表提取偶数位原生关键帧，不将旧中间帧再次作为原生帧插值。
2. 狼人王所有动作统一缩至75%像素边长，钻虫统一62.5%；使用预乘Alpha的Lanczos缩图，再重新计算RIFE中间帧。没有重生成视频，也没有按不同动作分别缩放主体。
3. 保留狼人王待机f47、飞扑f19/f35/f37的既有定格修补。随后每个角色使用跨动作相同的纵向裁框，每个动作使用固定且关于原中心对称的横向裁框，最后紧凑重排。未逐帧重定主体位置。
4. 配套改变分格、参考像素尺寸和脚偏移。世界坐标下体型、脚点、碰撞、移动速度、攻击判定、帧数、帧序及播放时长不改。

这是**有损空间降采样**。原生关键姿态保留，中间插帧重新计算，不能称为逐像素无损；例如狼人王飞扑f21的新旧运动模糊形态存在差别，见[过渡帧对照](previews/werewolf_king/pounce-transition-comparison.png)。放大镜头下毛发/甲片等细节可能更软，最终观感待用户实机确认。

## 正式布局

狼人王统一 `frameHeight=410`、`footY=382.5`、`textures.referenceCell=600`，`render.spriteSize=400`不变。

| 动作 | 帧数 | 单格 | 列×行 | 整表 |
| --- | ---: | --- | --- | --- |
| idle | 48 | 242×410 | 8×6 | 1936×2460 |
| running | 32 | 334×410 | 8×4 | 2672×1640 |
| attack | 49 | 552×410 | 7×7 | 3864×2870 |
| pounce | 49 | 676×410 | 6×9 | 4056×3690 |
| howl | 61 | 284×410 | 9×7 | 2556×2870 |
| dying | 37 | 594×410 | 5×8 | 2970×3280 |

钻虫统一 `frameHeight=205`、`footY=192.75`、`render.referenceCell=560`，`render.spriteSize=360`不变；初始 `footOffsetY=58.017857142857146`。

| 动作 | 帧数 | 单格 | 列×行 | 整表 |
| --- | ---: | --- | --- | --- |
| idle | 60 | 478×205 | 5×12 | 2390×2460 |
| crawling | 60 | 482×205 | 5×12 | 2410×2460 |
| grinderAttack | 61 | 576×205 | 7×9 | 4032×1845 |
| burrowEnter | 31 | 368×205 | 4×8 | 1472×1640 |
| burrowExit | 19 | 394×205 | 1×19 | 394×3895 |
| death | 61 | 390×205 | 7×9 | 2730×1845 |

出土动画采用1列19行以消除空格，并保持最长边小于4096；读取端按配置和有效帧数消费，不要求固定8列。

## 来源、正式PNG与全部对照GIF

GIF左侧为压缩前，右侧为压缩后；两侧按正常世界尺寸和同一脚线绘制。GIF按当前配置时钟导出，飞扑按准备/冲刺两段时钟播放；循环展示一次性动作仅为方便观看，不改变游戏中的repeat。GIF有10ms时长量化和调色板限制，画质以RGBA PNG为准。

| 狼人王 | 原视频 | 正式PNG | 对照GIF |
| --- | --- | --- | --- |
| 待机 | [视频](../_werewolf_king_20260828/videos/idle-doubao-v01.mp4) | [PNG](../../../assets/enemies/werewolf_king/idle.png) | [GIF](previews/werewolf_king/idle.gif) |
| 跑动 | [视频](../_werewolf_king_20260828/videos/running-doubao-v01.mp4) | [PNG](../../../assets/enemies/werewolf_king/running.png) | [GIF](previews/werewolf_king/running.gif) |
| 攻击 | [视频](../_werewolf_king_20260828/videos/attacking-doubao-v01.mp4) | [PNG](../../../assets/enemies/werewolf_king/attack.png) | [GIF](previews/werewolf_king/attack.gif) |
| 飞扑 | [视频](../_werewolf_king_20260828/videos/pounce-doubao-v02-side-plane-lock.mp4) | [PNG](../../../assets/enemies/werewolf_king/pounce.png) | [GIF](previews/werewolf_king/pounce.gif) |
| 狼嚎 | [视频](../_werewolf_king_20260828/videos/howl-doubao-v01.mp4) | [PNG](../../../assets/enemies/werewolf_king/howl.png) | [GIF](previews/werewolf_king/howl.gif) |
| 死亡 | [视频](../_werewolf_king_20260828/videos/dying-doubao-v02-fixed-scale.mp4) | [PNG](../../../assets/enemies/werewolf_king/dying.png) | [GIF](previews/werewolf_king/dying.gif) |

| 岩芯钻虫 | 原视频 | 正式PNG | 对照GIF |
| --- | --- | --- | --- |
| 待机 | [视频](../_core_drill_worm_20260829/videos/idle-doubao-v01.mp4) | [PNG](../../../assets/enemies/core_drill_worm/idle.png) | [GIF](previews/core_drill_worm/idle.gif) |
| 爬行 | [视频](../_core_drill_worm_20260829/videos/crawling-doubao-v01.mp4) | [PNG](../../../assets/enemies/core_drill_worm/crawling.png) | [GIF](previews/core_drill_worm/crawling.gif) |
| 研磨攻击 | [视频](../_core_drill_worm_20260829/videos/grinder-attack-doubao-v02-fixed-mouth.mp4) | [PNG](../../../assets/enemies/core_drill_worm/grinder_attack.png) | [GIF](previews/core_drill_worm/grinderAttack.gif) |
| 入土 | [视频](../_core_drill_worm_20260829/videos/burrow-ambush-doubao-v01.mp4) | [PNG](../../../assets/enemies/core_drill_worm/burrow_enter.png) | [GIF](previews/core_drill_worm/burrowEnter.gif) |
| 出土 | [视频](../_core_drill_worm_20260829/videos/burrow-ambush-doubao-v01.mp4) | [PNG](../../../assets/enemies/core_drill_worm/burrow_exit.png) | [GIF](previews/core_drill_worm/burrowExit.gif) |
| 死亡 | [视频](../_core_drill_worm_20260829/videos/dying-doubao-v01.mp4) | [PNG](../../../assets/enemies/core_drill_worm/dying.png) | [GIF](previews/core_drill_worm/death.gif) |

源视频到旧原生帧的选段依据保留在[狼人王原索引](../_werewolf_king_20260828/spritesheet-index.json)和[钻虫原清单](../_core_drill_worm_20260829/spritesheet-manifest.json)。它们记录原始交付，不代表当前运行时的帧格或播放速度；当前压缩数据见[runtime-manifest.json](runtime-manifest.json)，最新战斗时钟以双份enemy-config为准。

## 重建和回退

制作入口为[compact.py](compact.py)。本版本快照固定，后续若更换视频/选帧或主体校准，须建立新版本来源，不能沿用本目录旧缓存覆盖新美术。

在仓库根目录使用项目ComfyUI Python，依次执行 `compact.py prepare`、`render`、`finish`、`publish`。`prepare`复用归档的原生关键帧；`render --only werewolfKing/pounce`可限制到一个动作。`prepare/render/finish`只写本目录，`publish`才替换两个正式素材目录及双份配置中的对应几何字段。改变参数后不得把旧缓存当成新输出。本次整理未重新执行这些制作或验证步骤。

- `approved-runtime-input/`：压缩前12张正式PNG已移至本机忽略目录`tools/.trash-monster-cleanup-20260831/approved-runtime-input/`，只用于可恢复回退和重生成历史对照；不进入新提交。恢复到原位置后才会重新生成对照预览。
- `source-snapshot.json`：压缩前两个对象的配置；回退只恢复帧格、referenceCell和钻虫footOffsetY，不要覆盖之后的战斗数值调整。
- `native-keys/`：实际RIFE输入，必须保留；`rife/`保留必要JSON报告，整表、日志和源时钟预览为已清理的可再生产物。
- `runtime/`：可再生发布暂存目录，已清理；正式输出在`assets/enemies/`。`previews/`保留制作时钟的12套对照GIF与飞扑过渡说明图，重复联系图已清理。
- `baseline-metrics.json`：压缩前每张PNG的基础RGBA与磁盘容量，默认重建不再要求旧成品存在。历史对照GIF不属于制作输入；没有旧对照源时`finish`保留现有GIF，不伪造对照。
- 两份 `*-budget.json`：按整张表计算预算的清单；没有额外运行预算检查器或游戏测试。

回退时必须成套恢复对应PNG与几何配置，再将清单的接入状态同步回退；禁止只回退其中一侧。旧狼人王飞扑导出器检测到紧凑版本激活时只重建旧来源产物，不再覆盖游戏里的新宽格。

## 独立Git发布范围

历史发布状态（2026-08-31）：当时Git推送仅包含知识与清理记录，**没有包含本压缩目录、正式PNG或几何配置**，因为远端共享RIFE工具尚缺`--repair-magenta-middle`。原决策及当时的依赖边界见[发布范围](../../../docs/monster-cleanup-and-publication-2026-08-31.md)。

恢复发布状态（2026-09-05）：共享`rife-spritesheet-interpolate.py`已在提交`c74188c6`补齐精确半步采样、`--repair-magenta-middle`及去蓝后的二次门禁，并与本目录制作所用生产快照一致，因此本目录的脚本、原生关键帧、报告和预览现可独立归档。本次恢复发布仍**不包含12张运行时PNG或双份几何配置**；这些运行时变更须从最新远端基线另批核对，不能用制作快照覆盖后续战斗参数。

`source-snapshot.json`及对照GIF记录制作时本地动作时钟，不代表远端分支的播放速度；运行时仍以所在分支的enemy-config为准。压缩重建仅发布几何字段，不用制作快照覆盖战斗参数。第16卷生产标准尚未进入当时远端基线，压缩与归档要点同步归入已有第02卷；本地完整知识归档另保留第16卷对应条目。

## 改动范围与验收边界

正式变更为 `assets/enemies/werewolf_king/`、`assets/enemies/core_drill_worm/` 各6张PNG；`data/enemy-config.json`与`public/data/enemy-config.json`仅改这两个对象的帧格、参考像素尺寸、脚偏移。BootScene只更新说明注释；没有改AI、状态机、伤害、移动、控制、死亡生命周期或其他怪物。

已查看本次配置差异和局部消费路径，并查看攻击/飞扑的离线新旧联系图。未逐个动作进行实机视觉验收；没有把本次压缩当作此前审计其他缺陷的修复。

**未运行测试或运行时验证，按约定由用户测试。** 未运行lint、构建、开发服务器、浏览器/CDP或游戏，未同步EXE。请重点观察正常与放大镜头的清晰度、跑动/爬行循环接缝、狼人王飞扑过渡及钻虫入土/出土的衔接和脚点。
