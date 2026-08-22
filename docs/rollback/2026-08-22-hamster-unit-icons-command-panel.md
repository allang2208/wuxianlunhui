# 仓鼠兵种图标与指挥详情布局回退记录

- 日期：2026-08-22
- 范围：导入 9 张用户确认的仓鼠正规兵种图标，并将其接入出兵建筑面板、RTS 指挥模式右上角单单位详情和多单位数量详情。
- 新增文件：`assets/ui/unit-icons/*.png`、`src/config/hamster-unit-icons.js`、本回退记录。
- 计划修改：`src/world/producer-building-system.js`、`src/world/hamster-barracks-system.js`、`src/ui/rts-command.js`、`ui/panel-theme-backpack.css`、`CHANGELOG.md`。
- 回退方法：只反向移除本轮新增的 `troop-unit-icon`、`rts-up-identity`、`rts-up-multi-*`、`rts-up-producer-unit` 相关结构和样式，删除本轮新增映射与 9 张图标，并移除对应变更日志；不得回退同文件中其他会话已有修改。
