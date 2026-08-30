# 冷钢鼠标正式来源

- `normal-pointer-source.png` 与 `elevated-climb-source.png` 是当前正式 RGBA 母图；对应运行时 PNG 在 `assets/ui/cursors/`。
- `*-before-alpha.png` 是实际用于背景提取的直接编辑输入，保留造型来源，不用于运行时。`elevated-climb-original-reference.png` 是冷钢改图的原箭头参考，旧亮绿风格不再用于运行时。
- 两张箭头的提示词与热点分别记录在上级目录的 `normal-pointer-cold-steel-imagegen-20260830.json` 和 `elevated-climb-cursor-cold-steel-imagegen-20260830.json`；历史参考记录在 `elevated-climb-cursor-imagegen-20260829.json`。
- `export.ps1` 归档原有裁切/缩放流程：普通箭头48×48、热点(3,2)；登高箭头192×256，显示高度92px，锚定解析后的目标承载面。归档时不重跑、不改正式PNG。
- 三态手型母图、背景提取源、完整提示词、44px可见长边/热点参数和PNG+CSS联动导出在 `../hand-cursors-cold-steel-20260830/`。
- 六类语义指针由 `../../generate-cold-steel-command-cursors.ps1` 确定性生成。所有运行时图只保留当前版本；默认生成目录的重复副本可在归档后移入回收站。
