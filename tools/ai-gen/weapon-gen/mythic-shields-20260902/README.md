# 神话盾牌正式素材包（2026-09-02）

本目录保存“天柱回天壁”和“归墟吞星镜”的完整生产素材链。身份母图和后续视图均由
Codex 内置`image_gen`生成；后续外正面防御、近正面、背面和改造图标只引用本包身份母图、
已生成同身份视图及项目自有冷钢图标框，不使用外部版权素材。

- `concept/heaven-pillar-returning-bulwark-concept-v01.png`：天柱回天壁，左外正面、右背部结构。
- `concept/abyss-return-star-devouring-mirror-concept-v01.png`：归墟吞星镜，左外正面、右背部结构。
- `source/`：六张1254px生成原稿（两盾各防御外正面、近正面、背面）。
- `icons/`：两张3×3改造图标原表。
- 透明1024px图、背面参考副本、背包母图、改造切片和128px检查件均由统一脚本按需重建，不在素材包内重复归档。
- `formal/view-contact-sheet.png`：两盾六视图联系图。
- `prepare-assets.ps1`：棋盘底去除、Alpha清边、尺寸归一、图标裁切与正式入库脚本。
- `prompts.md`：完整生成提示词；`manifest.json`：来源、路径、测量和接入状态。

当前状态为`runtimeIntegrationActive`。正式装备为`weapon62/63`，1024px外正面防御图、
1024px近正面装备图、128px背包图、512px Phaser副本和18枚改造图标均已入库。
背部视图仍只作为握柄、臂托、承带和背面虚线端点依据，不绑定任何运行时纹理字段。

归档采用最小可重建链：保留身份概念、防御/正面/背面原图、图标母表、提示词、统一脚本、manifest和最终六视图联系图；阶段性去底、切片和缩略件不入库。
