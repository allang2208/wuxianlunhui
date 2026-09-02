# 优质盾牌改造图标候选（2026-09-02）

本目录保存锻钢拳盾与橡木卫戍盾各 9 枚改造图标候选。两张 3×3 母表由内置 `image_gen` 生成，使用现有盾牌图确定材质身份，并以 `assets/icons/craft-cold-steel/alloy_grip.png` 约束冷兵器改造框风格。

- `sources/`：模型原始 1254×1254 RGB 母表；外圈棋盘格是生成图中的实色背景。
- 418px切片和128px检查件由脚本按需重建；正式128px面板图仅保存在 `assets/icons/craft-shields/`。
- `shield-craft-icons-preview.png`：上三行为锻钢拳盾、下三行为橡木卫戍盾，行列顺序与设计文档一致。
- `manifest.json`：图标 ID、格位、文件和候选状态。
- `crop-icon-atlases.ps1`：可重复的裁切、去背景、缩放与总览生成脚本。

本批图标状态是 `approved_installed_static_runtime_unverified`。正式128px图标、双份 `craft-config.json`、九键消费端与布局已经接入；候选与静态接线仍不能代替游戏运行时验收。

归档只保留原始母表、提示词、裁切脚本、manifest和最终总览；可再生成的逐格切片不入库。
