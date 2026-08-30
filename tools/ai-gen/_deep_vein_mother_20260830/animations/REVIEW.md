# 深脉之母：七种豆包源视频已通过

> 归档更新：下文保留源片验收时的历史描述，当前仅保留七段定稿MP4；两段淘汰视频只保留提示词/provenance/失败原因。链接已更新为正式配置速度GIF，不再表示源视频速度。当前接入与资产状态以 INTEGRATION.md 和 runtime-build/manifest.json 为准。

七类动作源视频现已出齐，共保存 **9段 MP4**：7段用户已确认源片，另有重踏与喷矿的2段淘汰首版。此前两段待机、行走未重做；用户表示“已切换账号，继续”后补齐五类动作，并对重踏、喷矿各定向返工一次。没有确认付费或切换视频后端。用户随后确认“没问题，都可以用”，当前七段全部按现状通过；下方视觉观察保留为历史记录，不再作为源片返工阻断。

原账号曾被“近7天的额度用完”阻断；恢复授权与旧阻断记录均保存在 task-index.json。当前批次已退出，无待提交任务。

已确认来源：`../deep-vein-mother-v03-asymmetric-mine-fusion.png`。
本批仅生成角色动作视频、源速度 GIF 和 24 点联系图；不抠图、不切正式精灵表、不接入游戏。
使用 `ai-asset.py video generate --provider doubao`，每种动作单独新建对话、先回读提示词、再提交一条候选。
未授权确认付费额度；若页面阻断或状态不明，停止提交，不自动重试或切换后端。

## 动作合同

| 动作 | 请求时长 | 动作要求 |
|---|---:|---|
| 待机 | 5秒 | 原地微动，四脚接地，附件不改形 |
| 行走 | 6秒 | 原地四拍重步，四条矿石腿依次承重 |
| 矿足重踏 | 5秒 | 一条前腿抬起、一次落脚、收势 |
| 高压喷矿 | 5秒 | 蓄力、三次本体后坐、恢复，不烘焙碎矿弹体 |
| 绞盘震脉 | 5秒 | 四脚撑稳、原绞盘转动、一次下压释放，不烘焙地裂 |
| 矿压泄尽 | 6秒 | 低伏张开原晶核缝、保持3秒、闭合恢复 |
| 死亡 | 6秒 | 单次不可逆倒地、保持完整静止尸体 |

具体返回时长、帧数、画幅与 GIF 时钟见各动作 `previews/*-preview.json`。请求的 1024×1024 用于方形画幅选择，不代表豆包实际返回像素尺寸。
GIF 是完整源片约12fps的审阅副本；播放器反复播放不代表攻击或死亡应在游戏内循环。总览中较短视频结束后停在末帧并标明“源片已结束”。

## 验收前观察记录（用户已接受这些差异）

- 待机：24点联系图中主体及升降架、管道、矿镐保持可见；晶核出现额外亮度起伏，首帧与后续帧体量略有变化。未确认自然循环截取窗口。
- 行走：24点联系图可见四条紫色矿石腿交替抬落，小矿工手脚未参与承重，背架和管道仍附着；源片带有地面灰影。具体自然循环窗口及四拍顺序尚未逐帧确认。
- 矿足重踏 v02：定向返工后，可见单条近侧矿石腿小幅抬落、其余腿支撑及收势，升降架保持入画，原双腿直立问题消失；动作幅度克制，具体接触帧仍待选定。v01 因双腿抬起、主体后仰及顶部出框被淘汰，原片与提示词留存。
- 高压喷矿 v02：已定向返工，暗场、持续激光与大幅运镜消失，浅色背景下有克制的收身与复位，主体完整入画；三次后坐节奏较弱，联系图不足以确认三个清晰发射节点，仍需重点审阅。v01 因暗场、激光与运镜被淘汰，原片与提示词留存。
- 绞盘震脉 v01：已生成，浅色背景、主体轮廓与附件保持入画，可见下沉蓄力、晶缝亮度变化及恢复；未出现外部地裂或弹体。顶部绞盘的明确转动与一次释放节点不够易读，尚未逐帧确认。
- 矿压泄尽 v01：已生成，可见低伏、前侧原晶缝开口露核、约三秒保持，再闭合恢复；主体完整入画，无外部喷射。开口幅度比母图窄缝大，带管道的前侧岩壳随之张开，需用户判断是否接受该幅度；精确保持窗口尚未逐帧确定。
- 死亡 v01：已生成，完成单次沉降倒伏并保持尸体，没有起身复活；末段升降笼贴近左边缘，局部有裁边风险，且带少量额外碎屑和落地尘土。保留供动作方向审阅，不视为完整轮廓合同已通过；正式切帧前需解决边缘与尘土问题。

当前七段源视频全部已选定；重踏与喷矿采用 v02，其余五段采用 v01，两段淘汰首版不恢复使用。源片保留豆包平台水印，部分浅色背景偏灰、部分帧可见色边；本轮没有抹水印或修饰源片。联系图观察不等于逐帧动画验收或运行时验证；正式动画还需按所选源片完成自然窗口、身份、脚线与同尺度处理。死亡边缘与尘土、喷矿和绞盘动作偏弱等已披露差异已由用户接受，不再要求重生成；这不表示源片像素经过修复。后续处理应保留所选源片的自然动作轨迹。

未运行测试或游戏运行时验证，按约定由用户测试。改动仅位于本候选任务目录，未修改游戏代码、配置或正式资产。

## 逐段文件

| 动作 | 当前源视频 | GIF预览 | 验收状态 |
|---|---|---|---|
| 待机 | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/videos/idle-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/runtime-build/previews/idle.gif) | v01 · 用户已通过 |
| 行走 | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/videos/walking-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/runtime-build/previews/walking.gif) | v01 · 用户已通过 |
| 矿足重踏 | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/videos/stomp-doubao-v02-single-foot.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/runtime-build/previews/stomp.gif) | v02 · 用户已通过 |
| 高压喷矿 | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/videos/pipe_blast-doubao-v02-three-recoils.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/runtime-build/previews/pipe_blast.gif) | v02 · 用户已通过 |
| 绞盘震脉 | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/videos/vein_resonance-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/runtime-build/previews/vein_resonance.gif) | v01 · 用户已通过 |
| 矿压泄尽 | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/videos/pressure_release-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/runtime-build/previews/pressure_release.gif) | v01 · 用户已通过 |
| 死亡 | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/videos/dying-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/runtime-build/previews/dying.gif) | v01 · 用户已通过 |

[七动作总览](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/runtime-build/previews/runtime-overview.gif)

## 本次确认

- 用户原话：没问题，都可以用。
- 验收范围：当前七段源视频；不包含两段已淘汰首版。
- 本轮只更新两级任务索引与本文档；视频、GIF、母图均未改动。总览 GIF 内提示为验收前快照，以本文档和任务索引中的最新验收状态为准。
- 尚未抠图、切正式精灵表或接入游戏。未运行测试或运行时验证，按约定由用户测试。

## 后续精灵表交付

用户继续后，已完成七张透明表与RIFE插帧，源片已通过状态保留；尚未接入游戏。上面的“未切表”说明属于源片验收当时的历史阶段。最新交付见 [SPRITES.md](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_deep_vein_mother_20260830/animations/SPRITES.md)。
