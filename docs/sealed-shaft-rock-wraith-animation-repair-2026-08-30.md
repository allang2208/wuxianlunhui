# 封井岩魇六动作修复与素材优化（2026-08-30）

对应用户所称“封井岩魔”，配置键为 `sealedShaftRockWraith`。

> 后续战斗调参已将晶臂砸击/岩脉震荡改为2130/2400ms，只压缩接触帧后的收势，约836/1043ms的命中时刻保留；提前停止的旋冲跳过未用冲锋时间，再完成1000ms收势。最新参数见[逐项调整记录](monster-individual-combat-review-2026-08-30.md)。下文时长、素材manifest与GIF是本次素材交付快照，不代表后续调参的播放速度；正式PNG/帧序未改。本轮仅补齐重建入口保留`frameDurations`及预览导出器读取它的能力，未运行重建或重新导出GIF。

**已完成移动/死亡v02重制、六张正式图集替换、播放与状态中断修复，以及双份配置和来源清单同步。尚未进行游戏运行验证，由用户验收。未同步EXE。**

## 根因与处理

Phaser现有显示使用相同X/Y缩放系数。横向拉伸来自移动/死亡v01把方形母图直接用于1024×576视频，源视频已经变形；移动末段还存在脚趾触边。旧脚本逐帧归一身体高度，会进一步把姿态变化表现为宽度变化。

本轮经用户明确授权，仅向指定局域网H3服务发送既有等比安全参考图和移动/死亡两份提示词，生成v02视频。新源固定镜头、保持全身安全边界；透明帧使用固定比例和固定参考脚点，保留自然抬脚、身体起伏及倒地轨迹，不逐帧拉伸或归一高度。

- 移动：v02源第0—120帧每5帧取样，25关键帧→50帧循环；首尾锁定，维持12fps。
- 死亡：v02源第24—84帧每3帧取样，去掉开头约1秒静止等待；21关键帧→41帧一次性动作，总时长仍为3417ms。第28帧已稳定倒地；第19张插帧钻头崩塌，改用同源第52帧，保持相同缩放和根位置。
- 待机及三套攻击：沿用已制作的原生关键帧与动作轨迹，未重新设计动作；从未插帧原表统一缩放后重新RIFE，不对已插帧成品二次插值。
- 仅对明确异常的奇数插帧做局部回退：移动21/23/31，砸击19，旋冲15/17/21/27/31/33/39/41/43/51。自动修复记录保留在逐动作报告；偶数原生关键帧未替换。

所有帧号均为0-based。AI视频的细节稳定性和动作观感仍需用户结合游戏画面验收，离线预览不能替代游戏验证。

## 六动作与状态机

| 动作 | 修复后行为 |
|---|---|
| 待机 idle | 50帧、12fps，切状态立即同步脚点，停止移动后回待机 |
| 移动 walking | 新的固定比例50帧循环，保留自然步态；移速145不变 |
| 晶臂砸击 crystalArmSmash | 接触帧30→20，对齐落臂；61帧按当前2550ms播放，接触约836ms |
| 岩脉震荡 borequake | 61帧、第24帧释放、当前总时长2650ms，受控取消后不补释放 |
| 钻头旋冲 drillRush | 0—17帧蓄势900ms，18—49帧覆盖实际冲锋1100ms，50—60帧收势1000ms；当前总时长3000ms |
| 死亡 dying | 新素材完整倒地3417ms→停尸1600ms→淡出300ms，再允许通用尸体删除 |

六动作统一使用实体时钟手动选帧，关闭Phaser自动写帧；晚加载或重新入镜后恢复当前动作进度，不从攻击开头或站立尸体重新播放。

眩晕、冻结、石化、恐惧和冲刺眩晕会取消当前攻击。石化保持当前姿态与脚点，解控不补打；冻结/石化中死亡解除渲染定格。基类持续伤害致死后不继续活体更新；弹反/反伤回调取消或杀死施放者后，不继续结算余下目标或覆盖死亡状态。

冲锋命中、撞墙、到达距离或时间上限后立即停位移并进入收势，提前停止仍保留原动作锁定总时长，不返还冷却。碰撞豁免只恢复本次冲锋自己持有的状态。尸体时钟按倒地、停尸、淡出顺序消费dt，淡出透明度保存在实体选项中，支持离屏再入镜。

本轮素材修复保留碰撞124×235、主体显示高度260、移速145、伤害及技能范围。**砸击接触时机提前是明确的战斗时序改变，需重点体验。**

收尾时并行任务将三个攻击总时长从5083ms调整为2550/2650/3000ms，旋冲蓄势1500→900ms，砸击冷却5200→3400ms。本轮保留这些当前战斗参数，已同步正式manifest、布局时序和GIF；重建脚本从当前配置读取时钟，不再用制作初期的固定时长覆盖并行调参。其余攻击冷却仍为12000/15000ms。

## 正式资源与预算

素材有效主体460→390像素，显示端系数同步改为260/390，世界中的主体高度仍为260像素；在1倍镜头下提供1.5倍主体采样。没有通过降低怪物显示大小、压缩X轴或删帧节省预算。更高镜头倍率的清晰度未实测。

六张图采用逐动作固定、左右对称的透明紧裁，脚点X位于帧中央；整动作共享同一比例，翻转不改变地面锚点。布局只减少留白和无效格，显式限定endFrame，保留全部324帧。

| 动作 | 帧数 | 单帧 | 列×行 | 正式PNG | 脚点X,Y | RGBA MiB |
|---|---:|---|---|---|---|---:|
| 待机 | 50 | 254×412 | 10×5 | 2540×2060 | 127, 406 | 19.96 |
| 移动 | 50 | 302×450 | 10×5 | 3020×2250 | 151, 434 | 25.92 |
| 晶臂砸击 | 61 | 370×440 | 9×7 | 3330×3080 | 185, 433 | 39.13 |
| 岩脉震荡 | 61 | 358×436 | 9×7 | 3222×3052 | 179, 429 | 37.51 |
| 钻头旋冲 | 61 | 340×436 | 9×7 | 3060×3052 | 170, 429 | 35.63 |
| 死亡 | 41 | 612×468 | 6×7 | 3672×3276 | 306, 428 | 45.89 |

按图集宽×高×4计算，直接RGBA基础量 **373.01→204.03MiB（减少45.3%）**，伴生/召唤依赖为0MiB。`boss`档建议目标128MiB，本家为保留六动作324帧和完整倒地轮廓使用204.03MiB，低于256MiB准入上限；最长边3672px，均低于4096px。未修改全局预算。

同类多个实例共享这六个纹理键，不按怪物数量重复计算一套图集。与其他怪物同场的键并集、切场过渡及显存峰值未测；若旧版与新版完整资源在过渡时同时留存，单本家理论合计为577.04MiB，不能把稳态204.03MiB当作峰值。上述值不包含驱动/解码/预览缓存开销，不是显存实测，也未运行独立预算检查器。

## 六动作离线预览

GIF读取本轮正式PNG并使用当前代码的动作时钟；循环播放仅便于观察，游戏内攻击/死亡仍为一次性。GIF每帧10ms量化，整段误差不超过5ms。旋冲预览未模拟撞墙/命中提前收势，死亡预览未附加停尸/淡出段。

| 动作 | GIF | 源视频 | 正式图集 |
|---|---|---|---|
| 待机 | [GIF](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/previews/runtime-20260830/idle.gif) | [MP4](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/videos/idle-minimax-h3-v01.mp4) | [PNG](../assets/enemies/sealed_shaft_rock_wraith/idle.png) |
| 移动 | [GIF](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/previews/runtime-20260830/walking.gif) | [MP4](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/videos/walking-minimax-h3-v02.mp4) | [PNG](../assets/enemies/sealed_shaft_rock_wraith/walking.png) |
| 晶臂砸击 | [GIF](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/previews/runtime-20260830/crystalArmSmash.gif) | [MP4](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/videos/crystal-arm-smash-minimax-h3-v02.mp4) | [PNG](../assets/enemies/sealed_shaft_rock_wraith/crystal_arm_smash.png) |
| 岩脉震荡 | [GIF](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/previews/runtime-20260830/borequake.gif) | [MP4](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/videos/borequake-minimax-h3-v02.mp4) | [PNG](../assets/enemies/sealed_shaft_rock_wraith/borequake.png) |
| 钻头旋冲 | [GIF](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/previews/runtime-20260830/drillRush.gif) | [MP4](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/videos/drill-rush-minimax-h3-v03.mp4) | [PNG](../assets/enemies/sealed_shaft_rock_wraith/drill_rush.png) |
| 死亡 | [GIF](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/previews/runtime-20260830/dying.gif) | [MP4](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/videos/dying-minimax-h3-v02.mp4) | [PNG](../assets/enemies/sealed_shaft_rock_wraith/dying.png) |

- [移动前后对照GIF](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/previews/runtime-20260830/walking-before-after.gif)
- [死亡前后对照GIF](../tools/ai-gen/_abandoned_mine_lords_20260829/sealed_shaft_rock_wraith/previews/runtime-20260830/dying-before-after.gif)

## 重建链与涉及文件

- `src/entities/enemy-types/sealed-shaft-rock-wraith.js`：动作时钟、控制中断、冲锋收势、死亡生命周期与当前素材尺寸回退。
- `data/enemy-config.json`、`public/data/enemy-config.json`：本怪物六动作布局、脚点、时序字段与相关说明。
- `src/phaser/scenes/BootScene.js`：仅本怪物默认帧尺寸和390像素素材说明，按配置加载正式表。
- `assets/enemies/sealed_shaft_rock_wraith/`：六张正式PNG及spritesheet manifest。
- 对应来源目录：v02视频/提示词/生成来源，四动作未插帧归档 `authored-keys-460/`，六动作源表/插帧表/逐动作报告、预算清单、runtime-layouts、task-index、六动作GIF及前后对照。
- 当前制作入口 `rebuild-animations-20260830.py`：`keys`→`interpolate`→`publish`；旧四个入口已转接，不再执行逐帧归一或旧尺寸的异常帧修复。几何/帧数来自制作，动作时钟从当前战斗配置同步；配置使用完整临时文件替换，避免Windows监视中的JSON截断写入失败。
- `build-runtime-previews.py`：正式图集导出GIF与前后对照。重建缓存 `repair-20260830/`、`frames/` 与Python缓存不进入版本管理；原生关键帧、视频和来源记录保留。
- 本说明与 `CHANGELOG.md`。旧v01视频仅作为拒用来源及对照保留，不再进入当前重建链。

用户授权目的地为 `http://192.168.3.142:8188`，授权材料仅为 `references/crystal-bore-video-safe-v02.png` 与 walking/dying v02提示词。未上传源码、存档、账号数据，未改换服务或额外生成其他角色。

## 验收边界

已完成离线素材生产、预览查看、本次差异与必要局部接线核对。**未运行测试或运行时验证，按约定由用户测试；未构建、启动游戏、刷新用户窗口或同步EXE。**

请在重新加载开发版后观察六动作之间的体型与脚线、砸击接触时机、冲锋命中/撞墙后的收势、受控/弹反中断、死亡中离屏再入镜，以及冻结/石化中死亡。PNG网格已变，旧页面持有的纹理需重新加载；固定EXE仍保留原版本。
