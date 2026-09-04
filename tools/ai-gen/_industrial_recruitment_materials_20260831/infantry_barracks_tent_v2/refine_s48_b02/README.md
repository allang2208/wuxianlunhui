# 军营V2：48步01透明候选

已完成标准48步两张精修，由助手依据“继续，做完以后下一个”的委托选择01并完成透明处理。用户本轮“同意”明确批准军营局部修正版向同一局域网提交；没有将外发许可记作最终图片逐张验收，也没有安装游戏资源。

- [透明PNG，896×744](cutout/transparent.png) / [棋盘预览](cutout/preview.png)
- [黑灰白底及Alpha](cutout/background_alpha_preview.png) / [塔台与梯子细节](cutout/open_structure_detail.png)
- [精修输入和两张48步完整对照](whole_raw_comparison.png)
- [完整提示词](prepared-prompt.txt) / [生成清单](manifest.json)
- [补充上传许可](corrected-init-network-authorization.json)
- [抠图配置](cutout/config.json) / [生产记录](cutout/production-record.json) / [开放结构记录](cutout/open-structure-record.json)

## 选择与来源

两张均保留单帐篷、长边中央入口、短端封闭帆布、双坡塔棚、开放平台、梯子和混凝土地台。选择01是因为电台及油料罐更接近局部修正版，卡其帆布颜色统一；02的电台和罐体有额外材质变化。精修后的细部纹理有生成差异，不宣称逐像素不变。

直接来源链：12步B02-03 → 内置imagegen局部修正版1254² → 以已记录的等比缩放和平移恢复1024²画幅 → 本次48步01原图 → 建筑专用透明处理。直接祖先、编辑提示词、模型和Depth全部保留；1254²透明草稿只是历史结构预览，本目录才是实际48步产物。

使用既定标准入口 `generate-world122-building-candidates.py`：Dev+同一Depth、`world122-building-v5`、1024²、48步、Depth0.75、denoise0.30、CFG3.5、Euler/simple，seed831831/831832。已获许可的修正版确实上传，两张任务均成功完成。先前拒绝记录保留为已解决历史，没有绕过安全审查。

## 透明处理

按当前48步raw实测键色RGB(19,230,12)，软距离60/130。开放塔架内部幕色使用同一RGB距离处理；没有用旧Depth裁切新细节，没有全图HSV去绿，也没有填洞。先限定Alpha边缘6px作RGB去绿，再在3个明确矩形内修复栏杆、交叉撑和梯级上的101个残绿像素，Alpha不变；边缘处理前图留存为 `body_edge_clean.png`。最后冻结Alpha并以原像素紧裁，保留4px留边。

六处帆布、棚顶、沙袋、地台及油料罐采样Alpha完整；键色距离≤60且仍有Alpha的像素为0，距离≥130的像素没有Alpha损失，全透明像素脏RGB为0。已查看完整raw、棋盘、黑灰白底/Alpha和开放结构放大图；栏杆、梯子和拉绳保留，不把屋门内部暗部当作应删除背景。没有额外重绘或强化地台投影。

这些是素材生产与离线查看记录，不是游戏内验证。游戏显示尺寸、脚线和占格尚未标定；未修改原模型、运行时贴图、科技、兵种、碰撞、寻路、存档或EXE。未运行测试或运行时验证，按约定由用户测试。
