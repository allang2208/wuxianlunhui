# 断索狱监六动作主体与攻击动画修复（2026-08-30）

先修复攻击水平位移，再按用户“全面检查这个单位的动画、专注主体”的要求，逐格查看待机48帧、行走38帧、横扫55帧、投钩53帧、砸笼55帧、死亡41帧，共290帧。检查依据是正式表、原视频与本地制作预览，没有启动游戏。没有更换怪物设计或攻击动作。

## 追加更正：上排第三个「断链横扫」钩索淡出

用户明确指的是六动作总览中上排从左往右第三个`chainSweep`，不是下排第一个`hookWinch`。上一轮误加的投钩淡出已从`hook-winch-before-fade.png`原样恢复；移除其效果登记和错误预览入口，保留更早的主体锚点与原生帧修复。旧`fade-hook.py`入口已停用，不会再次覆盖投钩。

横扫正式表的f20左端及f22—24右端存在硬截断。现在只处理`chain_sweep.png`的钩索远端Alpha：704×384原帧格内，左侧从x=200向x=90逐渐透明；右侧从x=520向x=650逐渐透明，右侧效果在y=175—210平滑退出，保护下方囚笼。淡出带避开手臂和躯干，收势进入保留区域时自然恢复；镜像随原精灵翻转。没有重新生图，不缩放、不位移、不重抽帧；55帧/4583ms、碰撞和伤害均不变。这是素材边缘渐隐，不是摄像机屏幕边缘遮罩。

- [横扫完整前后对比GIF](../tools/ai-gen/_broken_cable_gaoler_sweep_fade_20260830/sweep-fade-comparison.gif)（上排原图，下排淡出）
- [横扫淡出成品GIF](../tools/ai-gen/_broken_cable_gaoler_sweep_fade_20260830/sweep-fade-final.gif) · [正式PNG](../assets/enemies/broken_cable_gaoler/chain_sweep.png) · [保留的原视频](../tools/ai-gen/_abandoned_mine_lords_20260829/broken_cable_gaoler/candidates/chain-sweep-doubao-v01.mp4)
- `runtime-alpha-effects.json`仅给`chainSweep`登记效果；正式生产脚本在原生帧覆盖后应用淡出，重建不会恢复误加的投钩淡出。`fade-sweep.py`从`chain-sweep-before-fade.png`副本生成，避免重复叠乘；更换底图时须重新取底图制作。
- 本轮恢复投钩PNG、调整横扫PNG、生产脚本/参数及来源清单，没有修改运行时战斗代码或双份敌人配置。未运行测试或运行时验证，按约定由用户测试横扫两侧远端、收势和左右镜像；未同步EXE。GIF为素材制作预览。

## 上一轮主体收口

- **比例保留，不逐帧缩放。** 六套首帧按当前显示比例对照，主体体量基本一致。沿用260px主体标准及374/300/260px制作基准，每动作只使用一个固定像素比例；铁钩、锁链、囚笼、肩背卷扬机不用于测量人物尺寸。转身、下蹲与倒地不按全Alpha高度重新放大。
- **行走改用腰胯水平根。** 原下身居中随迈腿使腰带标记横移约39.13世界像素。使用腰带区域的局部光流标定38帧水平锚点，保持首帧原位置，并消除跟踪首尾积累误差。只补偿整帧水平平移，腿部轨迹和垂直起伏保持原样；待机保持原锚点，死亡用首帧支撑靴确定固定根，保留后续自然倒地位移。
- **五张主体破碎帧回到原视频。** 横扫f17/f19、投钩f5/f7/f15存在头部、肩臂或腿部破碎。尝试对齐支撑脚后重新RIFE仍有破碎，结果未入库。最终分别从横扫原片f34/f38、投钩原片f10/f14/f30抽取真实中点，沿用原BiRefNet抠图与制作固定比例，再独立标定支撑靴。仅替换两张正式PNG中的这五格；原偶数关键帧、帧数、时长、命中时点均不变。源视频无需重生成。
- **六动作同一选帧口径。** 待机/行走按24fps实体时钟选帧；三种攻击继续读取原技能时钟；死亡按原3417ms死亡时钟选择并保持末帧。选帧与主体锚点同步，冻结时不推进循环计时。石化仍冻结实际贴图帧，额外保留该帧的X/Y显示锚点，避免场景重置位置后瞬移；场景只增加一个可选钩子，目前仅该单位实现，不改变其他怪物的行为。
- **来源可重建。** `body-calibration.json`与生产`runtime-anchors.json`记录全部六动作锚点及五个原生帧覆盖来源；生产重排脚本支持覆盖帧，避免重建时恢复坏帧。正式图集尺寸、纹理键、碰撞和纹理预算不变；未运行预算检查。

| 动作 | 帧格 / 帧数 | 固定显示像素比例 | 时长 / 循环 | 最新主体GIF |
|---|---|---|---|---|
| 待机 | 640×448 / 48 | 260/374 | 2000ms，循环 | [GIF](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/idle-body-final.gif) |
| 行走 | 640×448 / 38 | 260/374 | 1583.33ms，循环 | [GIF](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/walking-body-final.gif) |
| 横扫 | 704×384 / 55 | 260/300 | 4583ms，单次 | [GIF](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/chainSweep-body-final.gif) |
| 投钩 | 1504×320 / 53 | 1 | 4417ms，单次 | [GIF](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/hookWinch-body-final.gif) |
| 砸笼 | 1024×512 / 55 | 260/374 | 4583ms，单次 | [GIF](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/cageSlam-body-final.gif) |
| 死亡 | 672×448 / 41 | 260/374 | 3417ms，单次后定格 | [GIF](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/dying-body-final.gif) |

[六动作主体总览](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/all-six-body-final.gif) · [行走前后对比](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/walking-body-comparison.gif) · [五张原生帧替换对照](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/body-native-comparison.png)

这些预览聚焦主体，画面边缘可能不展示远端钩索；正式PNG没有按预览窗口裁掉装备。单动作GIF按实际帧表/时长制作，GIF容器为查看方便重复播放，游戏里的攻击和死亡仍是单次。总览也重复展示攻击，死亡尾段保持末帧。预览不代表运行时验收通过。

待机、行走和死亡原片分别见 [待机](../tools/ai-gen/_abandoned_mine_lords_20260829/broken_cable_gaoler/candidates/idle-doubao-v01.mp4)、[行走](../tools/ai-gen/_abandoned_mine_lords_20260829/broken_cable_gaoler/candidates/walking-doubao-v02.mp4)、[死亡](../tools/ai-gen/_abandoned_mine_lords_20260829/broken_cable_gaoler/candidates/dying-minimax-h3-v02.mp4)。三种攻击来源见下表。

## 前一轮攻击定位与修改

1. **人物被切图锚点拖动。** 原制作脚本逐帧用 `lower-body` 估算中心；该估算先取躯干Alpha中位数，再随姿态划下身窗口，遇到转身、伸出的铁钩及升降囚笼时会改变取样范围。原视频的支撑脚基本固定，正式表却把整个人物平移。按既有游戏显示比例，支撑脚的横向范围分别为横扫76.70px、投钩82.00px、砸笼109.14px。
2. **囚笼底边被当作脚底。** 砸笼落地时，装备最低点低于靴底，原统一Alpha底边对齐使角色出现悬脚。现在三种攻击各自逐帧标定支撑靴的鞋底中心和底边，排除锁链、铁钩及囚笼；通过 `anchorXByFrame/footYByFrame` 映射回待机首帧的世界脚位。只平移显示锚点，不移动Collider，不改变身体的转动、屈膝、挥击及装备轨迹，不逐帧缩放。
3. **逻辑与贴图是两个时钟。** 命中读取 `_actionTimer`，画面此前由Phaser独立播放；离屏恢复、动画重建或暂停时可能不同步。三种攻击现由同一动作时钟输出 `frame + manualFrame`，不再启动第二套播放时钟；帧数与命中阈值共同读取正式布局，动作总时长和接触帧保持原值。
4. **切动作时脚线晚一帧。** 场景先定位Sprite再调用选帧接口；原脚线只在选帧接口更新，导致起手/收势读取上一个动作的偏移。现在切状态和推进动作时立即同步脚线。
5. **中断与死亡残留。** 接入公共控制取消钩子及石化专用更新。石化保留定格姿态、取消未完成攻击，解除后不补打；眩晕/冻结回待机。基类DOT致死及命中回调造成死亡/中断后，不再覆盖死亡动画或继续结算后续目标与拉回。

## 保留范围

原视频、原偶数关键帧姿态、循环方式、攻击时长、角色260px主体高度、碰撞、冷却、伤害、射程、控制数值及地牢白名单保持不变。正式PNG的横扫/投钩五张破碎补间格替换为原生视频帧，横扫另追加两侧远端Alpha淡出；投钩的误加淡出已恢复，其余四张PNG未改。没有修改红狼或其他矿洞怪；主体偏移继续复用现有 `frameAnchorX` 镜像和 `manualFrame` 接口，新增石化显示锚点可选钩子仅由断索狱监实现。

| 攻击 | 正式帧格 / 帧数 | 总时长 | 事件帧（0-based） |
|---|---|---|---|
| 断链横扫 | 704×384 / 55 | 4583ms | 接触26 |
| 投钩收绞 | 1504×320 / 53 | 4417ms | 投钩18、收索42 |
| 囚笼镇压 | 1024×512 / 55 | 4583ms | 落地38 |

## 素材预览与来源

以下为前一轮攻击定位GIF，尚未包含本轮五格原生帧替换；最新主体结果以上方GIF为准。上排旧定位、下排修正定位；横线是地面，竖线是实体坐标。它们**不是游戏运行截图或运行时通过证明**。完整GIF保留钩索/囚笼范围。

| 动作 | 前后对比GIF | 保留的源视频 | 保留的正式精灵表 |
|---|---|---|---|
| 横扫 | [预览](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/chainSweep-comparison.gif) | [原片](../tools/ai-gen/_abandoned_mine_lords_20260829/broken_cable_gaoler/candidates/chain-sweep-doubao-v01.mp4) | [PNG](../assets/enemies/broken_cable_gaoler/chain_sweep.png) |
| 投钩 | [预览](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/hookWinch-comparison.gif) | [原片](../tools/ai-gen/_abandoned_mine_lords_20260829/broken_cable_gaoler/candidates/hook-winch-doubao-v02.mp4) | [PNG](../assets/enemies/broken_cable_gaoler/hook_winch.png) |
| 砸笼 | [预览](../tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/cageSlam-comparison.gif) | [原片](../tools/ai-gen/_abandoned_mine_lords_20260829/broken_cable_gaoler/candidates/cage-slam-doubao-v01.mp4) | [PNG](../assets/enemies/broken_cable_gaoler/cage_slam.png) |

## 修改文件与重建

- `src/entities/enemy-types/broken-cable-gaoler.js`：动作选帧、锚点消费、即时脚线、受控和死亡中断。
- `data/enemy-config.json`、`public/data/enemy-config.json`：仅该怪物六动作的主体锚点。
- `src/phaser/scenes/GameScene.js`：石化分支增加可选主体锚点同步钩子，只有该单位实现。
- `assets/enemies/broken_cable_gaoler/chain_sweep.png`、`hook_winch.png`：五格原生视频帧替换，其余格和布局保留。
- `tools/ai-gen/_broken_cable_gaoler_attack_fix_20260830/author.py`：素材读取、支撑靴标定、预览和锚点安装；同目录保留本轮前的局部代码/配置快照及标定数据。
- 原生产目录新增 `runtime-anchors.json`，更新 `build-runtime-sheets.py`、`runtime-layouts.json`、`task-index.json`；同步正式资产目录的 `spritesheet-manifest.json`，避免重建丢失校准信息。后续若更换视频或正式布局，须重新标定，不能沿用这组锚点。
- `body-calibration.py`及同目录记录：腰胯标定、未采用的RIFE中点尝试、原片五帧提取、主体锚点安装、六动作预览。两张PNG修改前副本在`before-body-sheets/`；未采用的RIFE输出不属于正式素材。

未运行测试、构建或运行时验证，按约定由用户测试；未启动游戏，未同步固定EXE。重点验收左右朝向的行走循环、行走/待机/三种攻击衔接、石化定格与解除、离屏后回到画面，以及死亡末帧。此次只调整主体显示，原视频的动作姿态、部分原始边缘色噪和装备表现未重绘；不承诺未经实机测试的零缺陷。
