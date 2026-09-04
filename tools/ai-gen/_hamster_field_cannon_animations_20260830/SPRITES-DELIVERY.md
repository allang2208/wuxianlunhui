# 仓鼠野战炮组透明动画交付

> 本文为导入前的历史生产记录。当前四动作已接入游戏，攻击烟焰裁边已修整、图集容量随之更新；以[RUNTIME-DELIVERY.md](RUNTIME-DELIVERY.md)和`spritesheet-manifest.json`为当前状态。未运行游戏测试，固定EXE未更新。

四套透明关键帧、2× RIFE 精灵图和按原时长播放的 GIF 已制作；尚未导入游戏。

| 动作 | 关键帧 → 成品帧 | 每格尺寸 | 图集尺寸 | RGBA MiB | 脚点 x/y |
|---|---:|---|---|---:|---|
| 待机 | 31 → 62 | 240×134 | 1680×1206 | 7.73 | 120/128.5 |
| 移动 | 31 → 62 | 240×134 | 1680×1206 | 7.73 | 120/128.5 |
| 攻击 | 43 → 85 | 364×208 | 1820×3536 | 24.55 | 182/160.5 |
| 死亡 | 49 → 97 | 344×134 | 2408×1876 | 17.23 | 172/128.5 |

四动作图集合计 **57.24 MiB**，crowd目标32MiB、准入上限64MiB。宽炮车、双人倒地和炮口烟火扩大了动作裁框；该数值仅为RGBA像素容量，不是实测显存或完整游戏依赖预算。

所有动作保留124帧@24fps的约5.1667秒源跨度，以manifest的逐帧时长为准；GIF量化后约5.17秒。
慢动作按step4取关键帧，射击52–66、倒地36–58保留全部原生姿态；RIFE只补相邻关键帧之间的中间姿态。
固定制作比例0.35、原画布脚点(512,450)，不逐帧拉直、缩放或抬脚；不同动作仅使用不同的固定紧裁框。
死亡GIF循环仅用于查看；实际动作不插末→首，末姿保持原片倒地状态。

## 事件和接入边界

- 炮口首次闪光为源第55帧（约2.292秒），对应输出第32帧。事件只登记视觉时间，未写入战斗逻辑。
- 攻击原片烟火触及右边缘的限制保留记录，不擅自重生或重写用户确认的动作。
- 自动分割遗漏的炮口外侧烟火，在源画布x≥760、55–100帧内按白底反推透明度；火焰内部白芯由原有暖色边缘限定。未重画人物、炮车或画面外内容。
- 原视频验收已保留；透明抠图和插帧成品尚待用户查看。没有新增招募、科技、伤害、弹道或正式纹理注册。
- 未运行测试、独立预算检查或运行时验证，按约定由用户测试。RIFE日志/报告是本次生成器自身的产物。

## 文件与预览

`spritesheet-manifest.json` 为图集、时长、源帧和事件真源；`sprite-budget-manifest.json` 为派生候选预算清单；`source-sheets/` 为未插帧关键帧；`final/` 为成品及RIFE报告。

### 待机

[原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/idle-v01.mp4) · [透明精灵图](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/final/idle.png)

![待机](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/previews/idle-transparent-loop-v01.gif)

### 移动

[原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/run-v01.mp4) · [透明精灵图](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/final/run.png)

![移动](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/previews/run-transparent-loop-v01.gif)

### 攻击

[原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/attack-v01.mp4) · [透明精灵图](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/final/attack.png)

攻击（历史预览已归档；当前输出见 spritesheet-manifest.json 或 runtime/runtime-index.json）

### 死亡

[原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/die-v01.mp4) · [透明精灵图](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/final/die.png)

![死亡](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/previews/die-transparent-loop-v01.gif)
