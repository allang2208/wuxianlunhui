# 恐怖地牢两款精英：定稿素材归档

两只精英均已完成母图、四动作源视频、透明精灵、RIFE、比例/脚点标定及本地游戏接入；等待用户实机验收。刽子手行走采用已确认的v06，v05直接编辑祖先及其他母图参考一并保留。

- [缝面刽子手](animations/stitchface-headsman/SPRITE_DELIVERY.md)：238帧；攻击1500ms，第40帧约833ms接触，前伸70、宽36。
- [蜡面哀祷者](animations/waxface-mourner/SPRITE_DELIVERY.md)：254帧；攻击1500ms，第34帧725ms释放，固定蜡印预警900ms后爆发。
- [全部动作与来源](animations/DELIVERY.md)、[全动作对齐记录](../../../docs/horror-elites-animation-review-2026-08-31.md)。

本次Git交付仅归档正式PNG、母图及编辑链、已用MP4、提示词/provenance、未插帧source-sheets、实际生产器、最终GIF与报告。运行时配置快照是本地接入记录，不意味着远端已启用。共享怪物基类、控制及动画接口尚未合入远端，因此不夹带其代码；见[发布范围](../../../docs/animation-publication-2026-08-31.md)。

原片重复GIF和滤色实验已可恢复回收，记录见[清理清单](cleanup-manifest.json)。更早的刽子手废片已由既有archive-manifest登记回收，不重复删除。历史评审中的未接入/候选状态仅说明当时阶段。

重建从各角色sprite-build-v01/source-sheets出发，沿角色build-sprites.py及冻结producer执行一次RIFE；源片重抠图属于显式重新制作。安装器依赖尚未发布的共享基类配置，勿在仅含素材归档的远端树直接安装。源到世界固定比例、自然离散轨迹、帧停留和脚点均保留。

未运行测试或运行时验证，按约定由用户测试；未同步EXE。
