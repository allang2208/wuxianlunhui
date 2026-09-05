# 极光织命母 `triangle_weave_body` 正式素材包

用户于 2026-09-05 接受 MiniMax H3 v02，并把极光膜的消失与回归定义为“抽膜—释放—重织”。本目录只收口本体动作，不包含运行时三角织点、极光线、伤害与 AI 接入。

## 真源与布局

- 源视频：`../../videos/02-aurora-fate-weaver-body-cast-h3-v02.mp4`，24 FPS / 124 帧。
- 有效动作窗：源 `f0..f80`；`f81..f123` 是长收势停留，不入表。
- 未插帧源：`source-sheets-pre-rife/triangle-weave-body.png`，取 `f0,2,...,80` 共 41 张。
- 正式表：`formal-final/triangle-weave-body.png`，一次性非回绕 RIFE 2× 后 81 帧；原生键在偶数索引。
- 单格 `352×256`，9 列 × 9 行，`endFrame=80`，脚点 `(176,240)`，完整解码 RGBA 约 27.8438 MiB，按 `boss` 档管理。

## 动作与事件

总墙钟 3333ms，约 24.302 FPS，单次播放且完成后停在末帧等待状态切换：

`gather 0..30 -> extract 31..40 -> released 41..54 -> reweave 55..64 -> recover 65..80`

释放事件为正式 0-based `f48`；如果将来某个消费者使用 1-based 帧号，则写第 49 帧。进入技能时先锁定三个织点，`f48` 只允许触发一次外部 VFX/命中线。角色根点不随此表移动。

## 边界

- 已做：BiRefNet 透明抠图、固定比例与脚线、一次非回绕 RIFE、直接可看的最终 GIF/联系表、帧与容量清单。`sprite-budget-manifest.json` 只登记当前已完成的这一张动作表，不代表整套领主动画预算已闭合。
- 未做：`enemy-config`、纹理预载、动画注册、技能状态机、外部三角 VFX、伤害与游戏内测试。
- 其他动作 `cut / oldstep / tether / reweave` 仍冻结；本动作通过不替它们解锁素材生产。
