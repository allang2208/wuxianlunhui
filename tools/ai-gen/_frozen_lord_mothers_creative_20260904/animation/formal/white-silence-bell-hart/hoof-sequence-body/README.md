# 白寂鸣钟鹿 `hoof_sequence_body` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/03-white-silence-bell-hart-hoof-sequence-body-h3-v02.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f0..f108`，唯一源键 29 张。
- 一次性非回绕 RIFE 2x 后 57 帧，映射位置逐像素保留对应原生键。
- 单格 `256x256`，6 列 x 10 行，脚点 `(128,240)`。
- 动作墙钟 2333ms，所有事件帧为 0-based：`{"hoofContactFrames": [16, 24, 32, 40], "hoofContactConsumerFramesIfOneBased": [17, 25, 33, 41], "sourceHoofContactFrames": [22, 45, 60, 80], "contactIntervalsFrames": [8, 8, 8], "contactIntervalsMs": [333, 333, 333]}`。
- 当前单表解码 RGBA 约 15.0000 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：hoof_sequence_four_105_radius_circles, hoof_sequence_physical_damage_1_00x, hoof_sequence_per_target_hit_cap_2, hoof_sequence_impact_vfx, hoof_sequence_cooldown_8s, runtime_state_machine。
