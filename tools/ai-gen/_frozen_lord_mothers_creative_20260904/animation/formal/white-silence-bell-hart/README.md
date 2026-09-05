# 白寂鸣钟鹿 `double_toll_body` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/03-white-silence-bell-hart-double-toll-h3-v01.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f12..f84`，未插帧源键 37 张。
- 一次性非回绕 RIFE 2x 后 73 帧，原生键保留在偶数索引。
- 单格 `192x256`，15 列 x 5 行，脚点 `(96,240)`。
- 动作墙钟 3000ms，所有事件帧为 0-based：`{"warningRingFrame": 24, "warningRingConsumerFrameIfOneBased": 25, "sourceWarningRingFrame": 36, "damageRingFrame": 50, "damageRingConsumerFrameIfOneBased": 51, "sourceDamageRingFrame": 62, "warningToDamageMs": 1083, "futureThirdEchoOffsetMs": 750}`。
- 当前单表解码 RGBA 约 14.0625 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：warning_ring_vfx, damage_ring_vfx_and_damage, third_echo, runtime_state_machine。
