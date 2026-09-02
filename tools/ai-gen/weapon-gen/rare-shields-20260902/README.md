# 两款稀有盾牌设计素材包（2026-09-02）

本目录保存月银折光盾（`weapon58`）与玄铁城垒盾（`weapon59`）的生成源、候选与派生记录。全部图像由 Codex 内置 `image_gen` 生成；获批版本已完成静态游戏接入，尚未进行运行时验收。

## 目录

- `concept/sources/`：模型原始正面与背侧输出；背侧仅用于确认握柄、臂垫和承带结构。
- `craft-mods/sources/`：两张1254×1254、3×3改造图标原始母表。
- 1024px去底候选、418px切片和128px检查件由`prepare-assets.ps1`按需重建，不入库。
- `rare-shields-concept-preview.png`：第一行月银正面/背侧，第二行玄铁正面/背侧。
- `rare-shields-craft-icons-preview.png`：上三行月银、下三行玄铁；每行从左到右与设计表一致。
- `prepare-assets.ps1`：边缘连通浅色背景转Alpha、主体归一、图标裁切与总览脚本。
- `prompts/generation-prompts.md`：本批六次内置生成的完整提示词与参考图角色。
- `manifest.json`：设计ID、文件、基础数值、图标格位和候选状态。

月银原始正面/背侧与两张图标母表由模型生成了实色浅灰棋盘格，脚本仅将与画布边缘连通的中性浅色区转为透明；玄铁两张概念图原生带Alpha。后处理没有重绘、拉伸或改变盾牌结构。

当前状态是 `approved_installed_static_runtime_unverified`。正式盾牌图标位于 `assets/icons/shields/`；`assets/weapons/` 及其512px Phaser镜像使用玩家可见的外侧正面，背侧图不进入运行时。36枚四盾共用改造图标位于 `assets/icons/craft-shields/`；装备与craft配置已登记，游戏内位置和机制仍待用户验收。

归档采用最小可重建链：保留原始概念图、图标母表、提示词、统一脚本、manifest和两张最终总览；删除所有可由这些真源重建的阶段资产。
