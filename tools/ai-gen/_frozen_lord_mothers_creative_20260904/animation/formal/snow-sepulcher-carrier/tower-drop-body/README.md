# 雪冢驮城兽 `tower_drop_body` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/01-snow-sepulcher-carrier-tower-drop-body-h3-v08.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f0..f122`，唯一源键 62 张。
- 一次性非回绕 RIFE 2x 后 123 帧，映射位置逐像素保留对应原生键。
- 单格 `448x256`，9 列 x 14 行，脚点 `(224,240)`。
- 动作墙钟 5083ms，所有事件帧为 0-based：`{"towerDropFrames": [64, 72, 80], "towerDropConsumerFramesIfOneBased": [65, 73, 81], "sourceFiringHoldFrames": [64, 72, 80], "dropIntervalsFrames": [8, 8], "dropIntervalsMs": [331, 331]}`。
- 当前单表解码 RGBA 约 55.1250 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：tower_drop_prediction_snapshot, falling_blocks_and_telegraphs, tower_drop_120_radius_hit_checks, tower_drop_damage_1_45x, tower_drop_per_target_hit_cap_2, tower_drop_cooldown_11s, runtime_state_machine。
