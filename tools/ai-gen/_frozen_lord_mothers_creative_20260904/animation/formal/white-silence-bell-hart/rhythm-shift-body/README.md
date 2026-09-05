# 白寂鸣钟鹿 `rhythm_shift_body` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/03-white-silence-bell-hart-rhythm-shift-body-h3-v01.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f0..f108`，唯一源键 55 张。
- 一次性非回绕 RIFE 2x 后 109 帧，映射位置逐像素保留对应原生键。
- 单格 `256x256`，10 列 x 11 行，脚点 `(128,240)`。
- 动作墙钟 4500ms，所有事件帧为 0-based：`{"rhythmShiftFrame": 52, "rhythmShiftConsumerFrameIfOneBased": 53, "sourceRhythmShiftFrame": 52}`。
- 当前单表解码 RGBA 约 27.5000 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：rhythm_shift_below_45_percent_one_shot_trigger, third_echo_every_two_double_tolls_counter, third_echo_delay_0_75s, third_echo_narrow_colored_ring_vfx, third_echo_magic_damage_0_90x, runtime_state_machine。
