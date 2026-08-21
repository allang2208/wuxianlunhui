# 研究项目详细浮窗层级修复回退记录

- 日期：2026-08-21
- 范围：只修复研究院、铁匠铺及出兵模块共用升级详细浮窗被右侧栏目遮挡的问题。
- 计划修改：`src/ui/panels/building-upgrade-tooltip.js`、`CHANGELOG.md`。
- 新增文件：本回退记录。
- 回退方法：移除共用浮窗对 `getRightSidebarPanelLayer` 的引用及重新挂载逻辑，删除对应变更日志和本文件；不得回退同文件中的其他会话改动。
