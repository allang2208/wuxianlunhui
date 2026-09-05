# 雪冢驮城兽四动作正式素材包

本目录只收口已通过门槛的本体动作，不代表完整领主资源族或运行时状态机已经完成。

- 源视频 `animation/videos/01-snow-sepulcher-carrier-plow-windup-h3-v02.mp4`，24 FPS / 124 帧。
- 有效动作窗 `f8..f100`，唯一源键 47 张。
- 一次性非回绕 RIFE 2x 后 93 帧，映射位置逐像素保留对应原生键。
- 单格 `480x256`，8 列 x 12 行，脚点 `(240,240)`；有效身体高度已与本族其他动作统一为 222px，整段共用源 `f8` 的固定锚 `x317`。
- 动作墙钟 3833ms，所有事件帧为 0-based：`{"fullyBracedFrame": 60, "fullyBracedConsumerFrameIfOneBased": 61, "sourceFullyBracedFrame": 68}`。
- 当前单表解码 RGBA 约 45.0000 MiB；`sprite-budget-manifest.json` 只覆盖这一条动作，不是整套 Boss 预算。
- 未接入运行时：plow_charge_and_impact, collider_translation, damage。
- 四动作同步复核 GIF：`previews/snow-sepulcher-carrier-all-formal-actions.gif`。全量标准审计见上级目录 `../standard-workflow-audit-20260905.md` 与 `../standard-workflow-audit-20260905.json`。
