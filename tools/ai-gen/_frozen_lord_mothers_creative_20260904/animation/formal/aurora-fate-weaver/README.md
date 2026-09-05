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
- `oldstep_body`、`tether_body`、`cut_body`、`reweave_body` 与 `seek_band` 已分别在同目录子包完成正式本体表/移动循环。六张表合计解码 RGBA `202.8750 MiB`，超过 Boss 128 MiB 目标但低于 256 MiB 硬停线，按用户已接受的目标线例外保留。所有表都未接入运行时，彼此通过也不自动解锁寻路、世界位移、碰撞、外部 VFX、伤害或状态机；`reweave_body` 的 5000ms 素材墙钟与原 1.4 秒玩法提案仍需接入前决策。
- 六动作同步复核 GIF：`previews/aurora-fate-weaver-all-formal-actions.gif`。全量标准审计见上级目录 `../standard-workflow-audit-20260905.md` 与 `../standard-workflow-audit-20260905.json`。
