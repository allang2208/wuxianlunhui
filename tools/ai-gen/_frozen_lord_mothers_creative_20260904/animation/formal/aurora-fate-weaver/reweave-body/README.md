# 极光织命母 `reweave_body` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/02-aurora-fate-weaver-reweave-body-doubao-v02.mp4`，24 FPS / 121 帧。
- 有效动作窗 `f0..f120`，未插帧源键 61 张。
- 一次性非回绕 RIFE 2x 后 121 帧，原生键保留在偶数索引。
- 单格 `288x256`，11 列 x 11 行，脚点 `(144,240)`。
- 动作墙钟 5000ms，所有事件帧为 0-based：`{"reweaveCompleteFrame": 84, "reweaveCompleteConsumerFrameIfOneBased": 85, "sourceReweaveCompleteFrame": 84}`。
- 当前单表解码 RGBA 约 34.0312 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：half_health_one_shot_trigger, triangle_cadence_change, oldstep_fourth_history_point, external_reweave_vfx, runtime_state_machine。
