# 白寂鸣钟鹿 `antler_body` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/03-white-silence-bell-hart-antler-body-h3-v04.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f0..f100`，唯一源键 51 张。
- 一次性非回绕 RIFE 2x 后 101 帧，映射位置逐像素保留对应原生键。
- 单格 `352x256`，8 列 x 13 行，脚点 `(176,240)`。
- 动作墙钟 4167ms，所有事件帧为 0-based：`{"antlerContactFrame": 60, "antlerContactConsumerFrameIfOneBased": 61, "sourceAntlerContactFrame": 60}`。
- 当前单表解码 RGBA 约 35.7500 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：antler_forward_230_sector, antler_damage_1_25x, antler_limp_debuff_1s, antler_hit_resolution, runtime_state_machine。
