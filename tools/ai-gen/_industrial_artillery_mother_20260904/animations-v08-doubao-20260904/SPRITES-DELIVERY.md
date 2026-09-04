# 仓鼠近代炮兵组透明动画交付

四套用户认可源片已按标准完成透明关键帧、RIFE 2× 精灵图和运行时钟 GIF，并在用户后续明确授权下导入游戏；等待实机验收。

| 动作 | 有效源区间 | 关键帧 → 成品帧 | 每格尺寸 | 图集尺寸 | RGBA MiB | 脚点 x/y |
|---|---|---:|---|---|---:|---|
| 待机 | [19,119) | 25 → 50 | 320×123 | 1600×1230 | 7.51 | 160.00/116.46 |
| 跑动 | [70,118) | 12 → 24 | 338×126 | 1014×1008 | 3.90 | 169.00/117.46 |
| 攻击 | [0,121) | 44 → 87 | 346×135 | 1038×3915 | 15.50 | 173.00/128.46 |
| 死亡 | [0,121) | 57 → 113 | 336×132 | 2016×2508 | 19.29 | 168.00/119.46 |

四动作图集合计 **46.20 MiB**；加入64×64炮弹后运行时闭包为 **46.212 MiB**。crowd 目标 32 MiB、准入上限 64 MiB。

正式预算检查通过准入线，但比32MiB目标高14.212MiB。最大两张为死亡19.288MiB、攻击15.502MiB：前者必须容纳炮车两侧的独立卧姿，后者保留源片火焰和分离烟团；待机、跑动和攻击无尾格，死亡仅1个尾格（约0.88%），四组裁框安全边为5–6px，已没有可通过重排消除的主要空格。继续压缩需缩小约99px高的单个炮手或删减已认可事件姿态；用户已明确授权按当前超目标、准入线内成本正式入库。

统一制作比例为 0.26，固定原画布地面锚点为 (640,571)。动作间只改变固定紧裁框，不逐帧缩放、居中、拉直或抬脚。
待机使用源 19→119 的 4.167 秒稳定环；跑动使用源 70→118 的 2.000 秒自然步态环；攻击和死亡保留完整 121 帧源时长，关键动作段使用原生密集姿态。
RIFE 循环动作按 N→2N 并补末→首中间帧；单次动作按 N→2N-1 且不回插首帧。所有原始关键帧保留在成品偶数索引。
攻击源第34帧为炮口事件，对应成片0-based第24帧；正式配置以攻击逐帧时长前24帧之和1416.667ms触发唯一发射。死亡源第28帧为炮弹完全脱手记录、第72帧起为两人均倒地保持。

## 接入边界

已新增近代科技解锁、招募、伤害/最小射程/范围衰减、低伸弹道、音效和按需正式纹理注册，并复制到`assets/companions/hamster_industrial_artillery_crew/`。完整参数与注册链见`RUNTIME-DELIVERY.md`。
正式预算与离线精灵检查已经通过，记录见 sprite-budget-report.json 与 sprite-validation-report.json：有效帧无空白、透明区RGB为零、原关键帧保留在偶数索引、循环/单次帧数规则正确、最长边不超过4096px。另按 full-frame-review.json 的10张棋盘分页逐帧查看全部274个有效帧，未见奇数RIFE帧黑/紫块、部件丢失、意外反向、可见Alpha裁切或单次动作回绕；火焰/烟团和两条倒地轨迹连续。游戏、测试、构建和运行时验证未运行。

## 文件与预览

spritesheet-manifest.json 是图集、时长、源帧和事件真源；sprite-budget-manifest.json 是正式运行时预算清单；source-sheets/ 保存未插帧关键帧；final/ 保存正式精灵图、炮弹、单位图标与 RIFE 报告。

### 待机

[原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/videos/industrial-artillery-crew-idle-doubao-v02-no-fire.mp4) · [透明精灵图](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/final/idle.png)

![待机](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/previews/idle-transparent-runtime-clock.gif)

### 跑动

[原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/videos/industrial-artillery-crew-running-doubao-v01.mp4) · [透明精灵图](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/final/run.png)

![跑动](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/previews/run-transparent-runtime-clock.gif)

### 攻击

[原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/videos/industrial-artillery-crew-attacking-doubao-v01.mp4) · [透明精灵图](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/final/attack.png)

![攻击](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/previews/attack-transparent-runtime-clock.gif)

### 死亡

[原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/videos/industrial-artillery-crew-dying-doubao-v01.mp4) · [透明精灵图](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/final/die.png)

![死亡](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_industrial_artillery_mother_20260904/animations-v08-doubao-20260904/previews/die-transparent-runtime-clock.gif)
