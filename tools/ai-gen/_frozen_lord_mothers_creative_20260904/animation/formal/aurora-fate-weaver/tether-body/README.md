# 极光织命母 `tether_body` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/02-aurora-fate-weaver-tether-body-doubao-v01.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f0..f104`，未插帧源键 53 张。
- 一次性非回绕 RIFE 2x 后 105 帧，原生键保留在偶数索引。
- 单格 `384x256`，7 列 x 15 行，脚点 `(192,240)`。
- 动作墙钟 4333ms，所有事件帧为 0-based：`{"tetherLinesFrame": 32, "tetherLinesConsumerFrameIfOneBased": 33, "sourceTetherLinesFrame": 32, "tetherPullFrame": 58, "tetherPullConsumerFrameIfOneBased": 59, "sourceTetherPullFrame": 58, "lineToPullMs": 1083}`。
- 当前单表解码 RGBA 约 39.3750 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：tether_target_selection_and_los, tether_line_vfx, tether_pull_displacement, runtime_state_machine。
