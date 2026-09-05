# 白寂鸣钟鹿 `stride` 正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/03-white-silence-bell-hart-stride-h3-v01.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f40..f92，同相位端点 f93 排除`，唯一源键 27 张。
- 一次回绕 RIFE 2x 后 54 帧，映射位置逐像素保留对应原生键。
- 单格 `256x256`，6 列 x 9 行，脚点 `(128,240)`。
- 动作墙钟 2208ms，所有事件帧为 0-based：`{}`。
- 当前单表解码 RGBA 约 13.5000 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：stride_navigation, world_translation_and_velocity, collision_motion, runtime_state_machine。
