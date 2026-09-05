# 主神空间组件化构造检查点（v11）

本目录只保留下一轮继续开发所需的最小可编辑链。当前运行检查点保留原 `hub_brick` 大理石地砖、山顶远景背景，以及立柱/拱廊、台阶/坐凳基座和灯台组件；Blender 整片地面已从运行层移除，后沿由独立碰撞代理限制通行。

## 当前状态

- `runtime_delivery_v10/main_hub_runtime_master_v10.blend` 是可编辑几何真源；相机、物件世界变换与左右布局均在此文件中。
- `runtime_delivery_v10/main_hub_v10_runtime_beauty.png` 与 `main_hub_v10_runtime_semantic_id.png` 是 v11 分层脚本的直接输入。
- `compose-main-hub-v11-components-only.py` 只导出组件层，不导出建模地面；正式地面继续由 `scenes.mainHub.floor.tiles=["hub_brick"]` 提供。
- `layout_reference_v13_summit_backdrop/prompt.txt` 与 `manifest.json` 记录当前正式背景的生成来源；唯一成品位于 `assets/scenes/main_hub_summit_backdrop_v01.png`。
- 当前 v11 是跨会话检查点，不是视觉定稿。用户已判定本轮独立组件材质候选为错误视角，因此候选、Depth 裁片和联系图全部删除，下一轮必须先修正组件相机合同再生图。

## 下一轮强制入口

1. 在完整 v10 母场景中锁定游戏使用的正交相机、`orthoScale`、对象世界变换与画布原点。
2. 组件图必须先在完整母场景中以该相机渲染，再按屏幕包围框裁切；不得为单个组件重新居中、重新取景或改成正立面相机。
3. 先把原始 Blender 组件渲染按真实世界坐标合回地砖与背景预览，确认柱顶/台基顶面/拱廊侧面具有一致可见量；视觉门禁未通过时不得进入 AI 材质精修。
4. AI 仅负责材质，不得改变透视、构件数量、轮廓、位置、光向或阴影。任何结构或视角错误都返回 Blender 修正。

## 清理范围

`cleanup-manifest.json` 记录本次删除类别。旧整景方案、未选候选、Alps 未批准背景候选、组件正立面候选、`.blend1`、缓存和一次性预览均不再是活动来源。
