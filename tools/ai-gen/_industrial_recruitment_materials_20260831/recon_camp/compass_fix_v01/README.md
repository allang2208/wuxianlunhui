# 近代侦察营地：48步01罗盘局部修正

**后续已定稿：** 用户反馈阴影明显后，已另存 [减影版与前后对照](../shadow_soften_v01/README.md)，并获用户“可以用”确认。本目录继续作为直接编辑祖先保留，不覆盖；当前美术定稿为该减影版。

用户“按你推荐继续”承接48步01的推荐。本轮使用内置imagegen做罗盘局部编辑：请求缩到原直径约65%、去掉挂环与挂表式附加件、收敛黄铜亮度，保留48步01的其余布局与材质。实际结果为更小、更简洁的罗盘；挂环和周边凸件已去除，不宣称精确达到65%。此前两张48步未成功完成该局部纠正，原图继续保留为直接祖先。

唯一编辑源：`../refine_s48_v03_b01/candidates/recon_camp_industrial/recon_camp_industrial_refine_v01_raw.png`（seed831761）。完整指令见 `edit-prompt.txt`。这是内置imagegen局部编辑，不是另一批FLUX48步。

当前状态：修正版、透明PNG和离线预览已完成，新派生图待用户评阅。来源链为12步03 → 48步01 → imagegen罗盘修正版 → 项目建筑专用抠图。本目录为候选素材，不接入游戏，也不更改模型、科技、兵种、逻辑占格、碰撞、寻路或存档。

## 交付文件

- [透明PNG，1089×903](cutout/recon_camp_industrial_cutout.png) / [棋盘背景预览](recon_camp_industrial_transparent_preview.png)
- [罗盘修改前后对照](compass_before_after.png)
- [修正后的1254×1254完整绿底原图](recon_camp_industrial_s48_v01_compass_fix.png)
- [栏杆与塔架局部对照](cutout/railing_and_base_detail.png) / [黑、灰、白底及Alpha预览](cutout/black_gray_white_alpha_review.png)
- [编辑来源记录](edit-record.json) / [抠图生产记录](cutout/cutout-record.json) / [裁切记录](cutout/crop-metadata.json)

## 处理边界

直接输入为1024²，imagegen原生输出1254²，不能宣称其余像素与输入逐像素一致。对照图仅为展示将编辑图归一到1024²；交付的透明PNG保留1254²原始输出的像素尺度，只做透明处理与紧裁，不缩放。

抠图先测得绿幕RGB为(51,190,32)，使用项目 `key-world122-building-body.py` 的RGB距离软键，阈值60/110。左侧地台外围绿幕阴影使用限定多边形处理，两处明确背景区域再清理高饱和残绿；最后只修正轮廓3像素范围和左栏杆窄区域的RGB溢色，透明通道保持不变。未使用旧Depth硬切或回填Alpha，也没有全图移除绿色；屋面、旗帜和暗绿材质均保留。

保留13处封闭透明开口，包括栏杆与塔架孔隙，没有通用补洞。裁切框为 `[84,220,1173,1123]`，裁切前后对应Alpha未变化，全透明像素RGB为零。Alpha>16含主体及塔架接点的一处1像素分量，未盲目抹掉细构件接点。九处指定材质采样区域没有Alpha削减或RGB改色；这些是局部离线像素记录，不代表游戏内验收。

`cutout/build_cutout.py` 保存抠图参数，`compose_delivery.py` 保存预览制作方法。游戏内显示大小、落点与占格尚未标定，导出元数据中的显示宽度不视为已完成摆放标定。

未运行测试或运行时验证，按约定由用户测试；仅执行素材生产及必要离线产物查看。
