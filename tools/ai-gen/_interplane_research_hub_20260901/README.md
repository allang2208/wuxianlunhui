# 跨位面中枢标准建筑全流程

科研 Tier 5 `interplane_research_hub` 已按标准建筑管线完成。`model_v2/`保留用户通过的加高细化模型，未通过的首版模型已经清理；正式生成锁定12步结构v03（seed 129303）与48步精修v02（seed 129312）。`selected/`保存两阶段入选raw、提示词、生成记录和正式Alpha直系来源，`accepted/`保存透明运行图、4×4预览和接地元数据，`icons/`保存四项升级与标准化科技图标的raw、提示词、规范化脚本和运行时元数据。

返修结构采用完整 4×4 近未来预制混凝土地台、中央六层科研协调核心、左右对称五层数据翼、加高居中玻璃入口、扩大后的屋顶十边形协调厅，以及带调节柜、装甲基座、双柱支架、镜头箍环和导能管的五节点协同冠环。五节点用于表达五个位面的科研协同；不复用位面观测阵列的双碟与三环干涉仪，也不使用传送门、通信塔或旧式玻璃办公楼语法。

重建命令：

```powershell
powershell -ExecutionPolicy Bypass -File tools/ai-gen/_interplane_research_hub_20260901/render-model.ps1
```

生成参数与候选门禁见`candidate-manifest.json`和`selection.md`。用户后续要求处理贴图阴影时，imagegen减影稿只作为亮度参考；正式图使用`shadow_soften_v01/tone-shadow.py`在已确认RGBA上做Alpha锁定的14%低频暗面抬升，没有采用会改变地台角度的生成稿。处理前图、最终入选图、提示词、脚本和报告保存在`shadow_soften_v01/`；未选候选和可重建中间层已按`cleanup-manifest-20260901.json`清理。

正式运行图仍为888×914，显示标定517×510，严格映射512×256逻辑投影；运行资产、缩略图、轮廓/投影/高度/法线派生图和去地台主体影根均已入库。玩法闭环、完整数值预算和前后台/存档合同见`docs/interplane-research-hub-standard-flow-2026-09-01.md`。
