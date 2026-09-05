# 雪冢驮城兽 `advance` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/01-snow-sepulcher-carrier-advance-doubao-v01.mp4`，24 FPS / 121 帧。
- 有效动作窗 `f25..f112，同相位端点 f113 排除`，未插帧源键 44 张。
- 一次回绕 RIFE 2x 后 88 帧，原生键保留在偶数索引。
- 单格 `448x256`，8 列 x 11 行，脚点 `(224,240)`。
- 动作墙钟 3667ms，所有事件帧为 0-based：`{}`。
- 当前单表解码 RGBA 约 38.5000 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：advance_navigation, world_translation_and_velocity, collision_motion, runtime_state_machine。
