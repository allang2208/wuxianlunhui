# 仓鼠投石组动画交付

4套透明动画已获用户确认并导入源码游戏，工程师营地开放投石组招募。运行时配置由 `import_runtime.py` 从manifest派生；入口、数值与待测边界见 [接入说明](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/docs/hamster-catapult-crew.md)。未运行测试或运行时验证，按约定由用户测试；未同步固定EXE。

| 动作 | 有效帧 | 每格尺寸 | 图集尺寸 | RGBA MiB | 时长 | 脚点 x/y |
|---|---:|---|---|---:|---:|---|
| 待机 | 62 | 254×137 | 1778×1233 | 8.36 | 5.167s | 127/131.00 |
| 移动 | 62 | 258×137 | 1806×1233 | 8.49 | 5.167s | 129/131.00 |
| 攻击 | 77 | 442×237 | 3094×2607 | 30.77 | 5.167s | 221/228.50 |
| 死亡 | 81 | 316×142 | 2844×1278 | 13.87 | 5.167s | 158/132.00 |

当前正式图集合计 **61.50 MiB**。crowd 目标 32 MiB、准入上限 64 MiB。
双人、宽器械及完整摆臂/倒地范围使本组高于 32 MiB 目标；该数值是图集 RGBA 像素容量，不是 PNG 文件体积或实机性能结果。
运行时仍需按最终弹体实现确认依赖闭包；本轮没有运行正式预算检查或同场压力测试。

## 文件

- `spritesheet-manifest.json`：最终动作表、源帧映射、逐帧时长、裁框、脚点和来源。
- `sprite-budget-manifest.json`：正式资源族预算清单，纹理键已登记到按需加载入口。
- `source-sheets/`：未插帧透明关键帧；`final/`：RIFE 成品表与生成报告。
- `prompts/`、`reference/`、视频同名 `.json`：不可变提示词、参考图和 H3 provenance。

## 预览与源视频

### 待机

[H3 原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/videos/idle-v01.mp4) · [透明图集](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/final/idle.png)

![待机](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/previews/idle-final.gif)

### 移动

[H3 原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/videos/run-v01.mp4) · [透明图集](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/final/run.png)

![移动](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/previews/run-final.gif)

### 攻击

[H3 原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/videos/attack-v02.mp4) · [透明图集](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/final/attack.png)

![攻击](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/previews/attack-final.gif)

石弹已独立拆分；含石弹的原视频 GIF 演示（历史预览已归档；当前输出见 spritesheet-manifest.json 或 runtime/runtime-index.json）。

### 死亡

[H3 原视频](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/videos/die-v01.mp4) · [透明图集](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/final/die.png)

![死亡循环预览](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_hamster_catapult_animations_20260830/previews/die-preview-loop-v02.gif)

## 制作与接入边界

- 两只仓鼠及器械全程保留；不使用单一最大连通域清理。白底污染只做局部边缘 RGB 修复，不侵蚀 Alpha。
- 同一母图的有效制作比例为 0.35；攻击 v02 的参考缩小 0.7 倍后，通过已知变换恢复该比例，未逐帧自适应缩放。较早期 0.375 候选统一缩小约 7%，保持全套低于 64 MiB 准入上限，未删帧或改变时长。
- 播放时钟以 manifest 的 `frameDurationsMs` 为准，保留 124 帧@24fps 的 5.1667 秒源时长；GIF 采用 10ms 累计量化，约 5.17 秒。不要使用 cache 内 RIFE 工具的统一帧率预览作为最终时钟。
- 待机/移动插首尾回绕；攻击/死亡只在相邻帧间插值。攻击和死亡 GIF 循环预览方便观察，实际动作元数据仍为一次性。死亡循环预览只添加播放重复标记，不修改帧或时长；旧单次预览已归档，当前循环预览保留原动作时钟。
- 攻击 v01 因摆臂越出源画布判废，活动版本由 `action-specs.json` 指定。
- 离勺石弹已拆为 `final/stone.png`；攻击透明表只保留装填和摆臂。原视频第42帧对应输出第32帧，已接入游戏发射事件与抛射落点伤害。四动作统一运行时比例0.675，并读取各自固定脚点；下一轮切待机恢复备弹姿态，未另制取弹过渡动作。
- 未运行测试或运行时验证，按约定由用户测试；生成、抠图、插帧、预览与源码接入不等于实机验收。
