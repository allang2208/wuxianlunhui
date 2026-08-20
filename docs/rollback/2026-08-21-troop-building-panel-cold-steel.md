# 出兵建筑面板冷钢字体调整回退记录

- 日期：2026-08-21
- 范围：只调整仓鼠兵营与配置型出兵建筑详情面板的文字颜色、字号层级和普通控件外观。
- 计划修改：`ui/panel-theme-backpack.css`、`src/world/producer-building-system.js`、`src/world/hamster-barracks-system.js`、`src/ui/panels/building-detail-header.js`、`src/ui/panels/building-upgrade-card.js`、`CHANGELOG.md`、`skill/07-world122-defense.md`。
- 新增文件：本回退记录。
- 回退方法：按本轮最终差异反向移除上述文件中标记为 `troop-panel-*`、`building-upgrade-card-*`、`world122-building-detail-*`、`is-troop-producer` 的改动及对应变更记录，并删除本文件；不得回退同文件中其他会话已有修改。
