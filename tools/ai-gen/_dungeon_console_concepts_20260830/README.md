# 地牢探索台素材归档

当前exploration v10已接入，用户反馈基本达到预期。此目录是制作来源，不是运行时UI或实机截图。

## 保留内容

- 最终概念：02-dark-exploration-hybrid-v9.png，用于分别生成正式古堡横幅和门厅图。
- 第二版到v9的各张图均为下一步实际编辑参考，按直接祖先保留，不是未选废案。
- 每份JSON保留原始完整提示词/生成路径，新增closureStatus标记当前归档状态；历史scope/limitations记录的是制作当时行为。
- 正式图片只放在assets/scenes/dungeon-exploration-horror-v9.png及assets/ui/dungeon-map/exploration-doorway-v9.png，不复制generated_images原图。

保留的编辑链：

- 02-black-background-v5.png
- 02-blue-cyan-planning-v4.png
- 02-center-enter-v7.png
- 02-cold-steel-icons-type-v3.png
- 02-dark-exploration-hybrid-v9.png
- 02-frosted-black-v8.png
- 02-inset-console-v6.png
- 02-integrated-planning-console-v2.png
- 02-map-and-dossier-refined.png
- 02-map-and-dossier.png

## 已清理

第1版01-map-first.png、第3版03-next-choice.png未入选且未参与最终编辑链，只留prompts.json中的提示词与cleanup-manifest.json中的来源/清理记录。两个实施目录的before整文件备份及重复CSS片段一并移除，由正式Git差异承担版本回退；不能整文件覆盖有并行修改的公共源码。

## 当前实现

布局和路由以docs/dungeon-exploration-console-v9.md的v10节与skill/10-ui-party.md为准：固定row网格、完整contain背景、紧凑按钮栏。概念图里的样例数值、模拟路线和旧按钮比例不是配置真源。未运行测试或运行时验证，按约定由用户测试。
