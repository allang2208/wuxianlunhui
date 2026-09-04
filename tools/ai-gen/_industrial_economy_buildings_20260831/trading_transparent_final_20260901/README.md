# 贸易公司：精修01透明定稿

2026-09-01，用户“继续”确认上一轮推荐的精修01，完成透明抠图与边缘去绿。成品保留02阶段选定的货仓宽面入口、弧形雨棚、两只货箱，以及之后确认的四组异形招牌字形；没有重新生图、改色或替换结构。

- [透明成品 PNG](trading_company/trading_company.png)：893×755，真实RGBA，紧裁后不缩放。
- [白底、深色底、透明棋盘预览](preview.png)
- [招牌、雨棚、货仓门、货箱与地台边局部](details-preview.png)
- [完整来源及处理参数](trading_company/provenance.json) / [导出尺寸元数据](trading_company/export-metadata.json)

## Alpha处理

正式源是上一阶段的 `trading_company_refine_v01_sign_preserved.png`。它是48步01的建筑主体加上用户已确认招牌字形的明确合成衍生图；未经修改的48步raw、生成参数、牌面蒙版与合成来源全部保留在 `../trading_refinement_dev_s48_20260901/`。

旧完整Depth包含已被用户选择覆盖的窄端货仓门和旧招牌图标，与当前造型不一致，因此本轮只把它作为“不得用于Alpha”的结构记录，没有通过Depth裁切、膨胀或恢复像素。正式Alpha从成图四角实测绿幕RGB中位数 `(56,198,39)`，使用建筑专用 `key-world122-building-body.py` 的画布边缘连通RGB抠绿。离线比较60/80/100/120四档后选用阈值100，阈值试片已作为可重建评审产物清理；没有启用全图HSV去绿、`removeAllGreen`或封闭键色清理，所以青绿色窗户不会被挖空。

抠图后仅在Alpha边界两像素内修复90个绿色主导RGB像素，Alpha改变为0。最终通过 `finalize-building-runtime.py --preserve-alpha-exact --nearest-opaque-edge-rgb` 紧裁：

- 裁切框：`[65,184,958,939]`
- 文件尺寸：893×755
- Alpha范围：0–255；`alpha>=16`时只有一个主体连通域，共392984像素
- 透明像素脏RGB：0；紧裁导出改变Alpha像素：0
- 名义显示宽高512×433、脚点偏移214仅作后续标定参考；没有运行时校准，也未缩放PNG

仓库开口和办公楼暗门是原图中的不透明深色内部，不被当成绿幕孔洞。成图没有独立外投影需要额外多边形裁除；台阶、柱脚与地台保持连接。

## 复现

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/_industrial_economy_buildings_20260831/trading_transparent_final_20260901/finish.py
```

脚本只读取已确认的精修01并重建本目录的透明成品、元数据和预览，不调用AI、不修改正式assets。燃油发电厂与罐头加工厂透明定稿保持不变。

该成品现已接入游戏并完成逻辑占格、`visualFootprint`、科技、经济、存档、光照图与缩略图配置；未生成或同步EXE。未运行测试或运行时验证，按约定由用户测试。
