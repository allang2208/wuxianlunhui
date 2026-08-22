# 探险家与赏金猎人图标导入回退记录

- 日期：2026-08-22
- 范围：将用户确认的“望远镜＋T柄铲子”探险家图标和“现有冷钢底图＋六发左轮”赏金猎人图标接入统一仓鼠兵种 UI 映射。
- 新增文件：`assets/ui/unit-icons/hamster-explorer.png`、`assets/ui/unit-icons/hamster-bounty-hunter.png`、本回退记录。
- 修改文件：`src/config/hamster-unit-icons.js`、`CHANGELOG.md`。
- 回退方法：只删除上述两张图片及映射中的 `explorer`、`bounty_hunter` 两项，并移除对应变更日志和本记录；不得回退同文件中其他会话已有修改。
