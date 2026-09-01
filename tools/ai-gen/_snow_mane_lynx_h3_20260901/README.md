# 雪鬃猞猁 MiniMax H3 四动作与运行时接入

雪鬃猞猁已完成待机、奔跑、扑爪攻击、死亡四套 MiniMax H3 视频，经过原片方向复核、BiRefNet 抠图、固定比例标准化、一次 RIFE 插帧和资产级色度修复，正式精灵表已复制到 `assets/enemies/snow_mane_lynx/` 并接入雪原地牢普通怪池。

## 方向与视觉契约

- 身份母图：`../_frozen_normal_mothers_20260901/mother/01-snow-mane-lynx-v01.png`。
- 动物参考：`assets/enemies/black_wolf_walk.png` 的 0/5/10/15 帧，以及 `assets/enemies/brown_bear/walking.png` 的 0/7/14/21 帧。
- 相机为轻微俯视、侧面主导的低三分之四游戏视角；头、胸、胯、膝和迈步轴均朝屏幕右侧。
- 运行时只存右向图集，朝左由水平镜像提供。四套原视频和最终联系图均已离线检查方向、身份、四肢拓扑和根点。

## H3 源视频

四条源片统一为 1024×576、5.17 秒、124 帧、20 步、无音频：

| 动作 | 模式 | seed | 源视频 | 动态预览 |
|---|---|---:|---|---|
| 待机 | loop | 1677342101 | `videos/snow-mane-lynx-idle-h3-v01.mp4` | `videos/snow-mane-lynx-idle-h3-v01_preview.gif` |
| 奔跑 | loop | 1575805680 | `videos/snow-mane-lynx-running-h3-v01.mp4` | `videos/snow-mane-lynx-running-h3-v01_preview.gif` |
| 攻击 | recover | 1729645037 | `videos/snow-mane-lynx-attacking-h3-v01.mp4` | `videos/snow-mane-lynx-attacking-h3-v01_preview.gif` |
| 死亡 | one-way | 1816204973 | `videos/snow-mane-lynx-dying-h3-v01.mp4` | `videos/snow-mane-lynx-dying-h3-v01_preview.gif` |

奔跑从原片选取 f21→f49 的自然完整步态周期，重复端点 f50 不入表。死亡为不可逆倒地并保留尸体终帧。攻击只保留原片 f18→f42 的第一次完整扑爪，按 24fps 原始墙钟正好 1000ms；后续重复挥爪 f43→f53、f62→f70 与长恢复段均不入表。

## 正式图集

| 动作 | 格尺寸 | 布局 | 帧数 | 时序 | GIF 预览 |
|---|---:|---:|---:|---:|---|
| 待机 | 320×240 | 4×4 | 16 | 5170ms loop | `previews/sprites/formal-final/idle/snow-mane-lynx-idle.gif` |
| 奔跑 | 384×240 | 6×5 | 30 | 24fps / 1250ms loop | `previews/sprites/formal-final/running/snow-mane-lynx-running.gif` |
| 攻击 | 640×224 | 1×17 | 17 | 1000ms，接触 f10，生效 f9–f11 | `previews/sprites/formal-final/attack/snow-mane-lynx-attack.gif` |
| 死亡 | 448×240 | 6×3 | 17 | 1800ms one-shot | `previews/sprites/formal-final/death/snow-mane-lynx-death.gif` |

四动作保持同一运行时身份比例，动作内固定裁框与脚线。攻击专用安全框中的主体原本只有中立帧体长的 75.5%，正式表按 `278/210` 做一次动作级 X/Y 等比恢复；没有逐帧追高或非等比拉伸。RIFE 只执行一次；攻击快速挥爪段的生成帧 f5/f7/f9/f11/f13 分别改用同一原片的唯一原生半步姿势 f26/f29/f32/f35/f38，不再用相邻关键帧停帧，最终 17 帧无精确重复。死亡重复的 f9 已由同一 H3 原片的唯一原生 f40 替换，并对整卷做统一整数根点修正。离线检查为空帧 0、碰边帧 0、透明区非零 RGB 0。

2026-09-01 复核发现旧 GIF/联系图曾把所有格子强制缩放到 384×240，导致攻击横向压至 80%、死亡横向压至约 85.7%，该问题只存在于预览导出。现已改为每个动作使用正式运行时格尺寸等比输出，并重新生成全部预览；H3 源视频始终为正确的 1024×576 等比画面。

正式生产信息见 `sprite-sheet-manifest.json`，运行时预算输入见 `sprite-budget-manifest.json`。四张实际 PNG 的 RGBA 纹理闭包为 31.914 MiB，低于 `crowd` 档 32 MiB 目标和 64 MiB 硬上限；预算按真实 PNG 宽高计入死亡图集的 1 个容量空槽。

## 接入范围

- `SnowManeLynxEnemy` 复用四足近战、命中时钟、死亡保尸和运行时水平镜像契约。
- `data/enemy-config.json` 与 `public/data/enemy-config.json` 注册普通级、动物/自然词条、无技能、四动作布局和近战接触帧。
- `data/dungeon-config.json` 与 `public/data/dungeon-config.json` 将其加入雪原 beginner/mid/final 的 normal、elite 和 boss `poolKeys`；未扩展到入侵池。
- 本任务只做离线资产、图集、清单和 JSON 静态核对；未构建、未启动游戏、未运行浏览器探针，运行时验收留给用户。
