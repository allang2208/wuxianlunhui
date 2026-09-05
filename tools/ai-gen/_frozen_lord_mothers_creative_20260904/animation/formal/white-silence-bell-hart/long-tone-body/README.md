# 白寂鸣钟鹿 `long_tone_body` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/03-white-silence-bell-hart-long-tone-body-h3-v01.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f0..f108`，唯一源键 55 张。
- 一次性非回绕 RIFE 2x 后 109 帧，映射位置逐像素保留对应原生键。
- 单格 `320x256`，10 列 x 11 行，脚点 `(160,240)`。
- 动作墙钟 4500ms，所有事件帧为 0-based：`{"longToneReleaseFrame": 56, "longToneReleaseConsumerFrameIfOneBased": 57, "sourceLongToneReleaseFrame": 56}`。
- 当前单表解码 RGBA 约 34.3750 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：long_tone_forward_620x120_rectangle, long_tone_magic_damage_1_60x, long_tone_stun_0_7s, long_tone_vfx, long_tone_cooldown_12s, runtime_state_machine。
