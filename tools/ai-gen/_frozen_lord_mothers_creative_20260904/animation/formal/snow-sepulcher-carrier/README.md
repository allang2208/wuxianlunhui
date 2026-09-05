# 雪冢驮城兽 `plow_prepare` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/01-snow-sepulcher-carrier-plow-windup-h3-v02.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f8..f100`，未插帧源键 47 张。
- 一次性非回绕 RIFE 2x 后 93 帧，原生键保留在偶数索引。
- 单格 `480x256`，8 列 x 12 行，脚点 `(240,240)`。
- 动作墙钟 3833ms，所有事件帧为 0-based：`{"fullyBracedFrame": 60, "fullyBracedConsumerFrameIfOneBased": 61, "sourceFullyBracedFrame": 68}`。
- 当前单表解码 RGBA 约 45.0000 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：plow_charge_and_impact, collider_translation, damage。
