# 仓鼠野战炮组：四动作 H3 视频候选

用户已回复“可用”，确认四个 v01 源动作；保留当前动作轨迹与约5.167秒时长。后续透明精灵图与RIFE插帧现已完成，见 [SPRITES-DELIVERY.md](SPRITES-DELIVERY.md)；本页保留已确认的源视频/GIF，尚未导入游戏。

全部动作沿用同一获准母图、1024×576固定画布与等比留边。GIF保留全部源姿态，并以10ms累计量化保留原动作时长。

| 动作 | 源帧数 | 源帧率 | 源时长 | 动作语义 |
|---|---:|---:|---:|---|
| 待机 | 124 | 24fps | 5.1667s | loop |
| 移动 | 124 | 24fps | 5.1667s | loop |
| 攻击 | 124 | 24fps | 5.1667s | recover |
| 死亡 | 124 | 24fps | 5.1667s | one-way |

GIF全部设置循环，便于反复查看；死亡源动作仍为一次性倒下，GIF重新播放不表示游戏中复活。

## 候选边界

- 攻击：炮口火焰比要求更长，伸至画面右边缘，尚未作为正式战斗特效采用。
- 死亡：两名炮手倒地并保持末姿；右侧炮手部分身体被炮架遮挡。
- 其他动作表现与用户验收状态见 `candidate-review-notes.json`；火焰长度和炮架遮挡观察作为制作记录保留，不否定本次源动画验收，也不等于游戏运行时验收。
- 未修改游戏招募、战斗、科技树、数值或正式资产。未运行测试或运行时验证，按约定由用户测试。
- 制作预算为crowd，32MiB目标/64MiB准入上限；透明图集容量见 `spritesheet-manifest.json`，不等于游戏运行时预算或性能已验收。

## 视频与 GIF

### 待机

[H3 原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/idle-v01.mp4) · [来源记录](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/idle-v01.mp4.json)

待机（历史预览已归档；当前输出见 spritesheet-manifest.json 或 runtime/runtime-index.json）

### 移动

[H3 原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/run-v01.mp4) · [来源记录](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/run-v01.mp4.json)

移动（历史预览已归档；当前输出见 spritesheet-manifest.json 或 runtime/runtime-index.json）

### 攻击

[H3 原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/attack-v01.mp4) · [来源记录](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/attack-v01.mp4.json)

攻击（历史预览已归档；当前输出见 spritesheet-manifest.json 或 runtime/runtime-index.json）

### 死亡

[H3 原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/die-v01.mp4) · [来源记录](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_field_cannon_animations_20260830/videos/die-v01.mp4.json)

死亡（历史预览已归档；当前输出见 spritesheet-manifest.json 或 runtime/runtime-index.json）
