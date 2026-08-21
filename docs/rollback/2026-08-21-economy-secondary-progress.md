# 经济岗位第二进度条修复回退说明（2026-08-21）

本轮只调整 `src/world/producer-building-system.js` 中经济岗位面板第二进度条的数据映射，并同步更新 `skill/10-ui-party.md` 与 `CHANGELOG.md`。

如需回退：

1. 删除 `_getEconomySecondaryProgress`。
2. 在 `_tickProgress` 中恢复用 `_economyTickMs / tickMs` 直接更新 `pbEconomyProductionBar` 与 `pbEconomyProductionPct`。
3. 在 `_renderWorkforceControls` 中恢复固定标签“本轮生产”以及初始 `0%`。
4. 删除对应技能规则与变更日志条目。

不涉及经济结算公式、岗位人数、建筑升级、动画或素材文件。
