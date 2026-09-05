# 极光织命母 `oldstep_body` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/02-aurora-fate-weaver-oldstep-body-doubao-v01.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f0..f84`，未插帧源键 43 张。
- 一次性非回绕 RIFE 2x 后 85 帧，原生键保留在偶数索引。
- 单格 `320x256`，8 列 x 11 行，脚点 `(160,240)`。
- 动作墙钟 3500ms，所有事件帧为 0-based：`{"oldestHistoryStrikeFrame": 24, "oldestHistoryStrikeConsumerFrameIfOneBased": 25, "middleHistoryStrikeFrame": 50, "middleHistoryStrikeConsumerFrameIfOneBased": 51, "newestHistoryStrikeFrame": 66, "newestHistoryStrikeConsumerFrameIfOneBased": 67, "sourceStrikeFrames": [24, 50, 66]}`。
- 当前单表解码 RGBA 约 27.5000 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：oldstep_history_snapshot, oldstep_strike_zones_and_damage, runtime_state_machine。
