# 仓鼠近代炮兵组发布边界

本批次把已获准的`industrial_artillery_crew`母图、四动作源片、GIF预览、透明图集和运行时接线作为一个逻辑提交发布。

## 与当前主线的兼容合并

- 保留当前主线已发布的投石组与野战炮组招募成本，不迁入脏工作区里尚未独立发布的平衡调整。
- 在当前`engineer_camp_level_2`与`engineer_camp_level_3`之间新增`engineer_camp_industrial`。现代载具工厂只依赖该已发布节点，不引用当前主线尚不存在的`blacksmith_level_3`，避免悬空前置；后续铁匠铺批次正式发布时可再补充交叉前置。
- 科技树与`TechnologySystem`版本从49同步升至50，保持单批次单步迁移。
- 近代炮兵工坊运行时贴图直接复制自已发布且哈希一致的来源图：`tools/ai-gen/_industrial_support_buildings_20260831/artillery_workshop_industrial/refine_s48_b01/cutout/transparent.png`。

## 纳入与排除

纳入正式母图及提示词、获准待机v02/跑动v01/攻击v01/死亡v01源视频与来源JSON、对应GIF和接触表、透明关键帧、RIFE正式图集、运行时钟GIF、全帧检查页、生成/检查脚本、预算与来源报告，以及游戏所需PNG、MP3、配置和代码。

不纳入`cache/`、`logs/`、`__pycache__/`以及已标记`source_rejected_action_semantics`的待机v01视频、GIF、接触表、提示词和视频来源JSON。这些内容不是正式交付物；任务manifest仍保留其判废原因和历史记录。

## 验证边界

本发布只执行静态语法、JSON、引用闭合、资源哈希、体积和Git差异检查；没有运行游戏、测试、构建、浏览器/CDP探针或EXE发布，运行时体感由用户验收。
