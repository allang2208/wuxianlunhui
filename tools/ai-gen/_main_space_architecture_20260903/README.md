# 主神空间 R21/R22 正式归档

当前使用 R21 分层白石建筑/连续铺装、R19 NPC 站位、R16 真实砖地/露台通行范围及 R22 昼暮夜环境。旧 v11 组件检查点和首版布局不再作为当前入口。

## 保留的最小重建输入

- `structure_review_v12_20260905/delivery_r21/main-hub-r21-stone.blend`：材质纹理已 packed 的最终可编辑模型；相机、几何和最终石材均在此文件。
- 同目录 `layer-manifest.json` / `paving-manifest.json` / `asset-manifest.json`：对象归属、紧裁坐标、周期铺装与来源；`delivery_r21/camera-manifest.json` 提供锁定相机投影。
- `material_unify_r14/stone-albedo-raw.png`、`stone-generation.json` 及参考拼图/组成图：被 R20/R21 实际采用的 5080 石纹和直接输入。旧材质版本没有自动晋级。
- 正式 PNG 在 `assets/terrain/main_hub_v21/`、`assets/scenes/main_hub_summit_backdrop_v01.png`、`assets/scenes/main_hub_atmosphere_r22/`；R22 未做像素处理，正式图即唯一可携带的选中原图。生成工具、原文件名与约束见 R22 manifest，个人 generated_images 路径只是历史出处。

## 继续工作

1. 修改最终 packed blend；用 Blender 执行 `rebuild-delivery-r21.py` 导出分层和铺装，再用 Python 执行 `package-delivery-r21.py` 紧裁/安装。不要重跑历史 R04—R20 look-development 安装器。
2. `package-atmosphere-r22.py` 默认复用已存在的正式背景，只更新本任务双份配置；不重新生图、不依赖个人目录即可重建已入库版本。
3. `compose-atmosphere-r22.py` 可离线生成当前三时段预览。`preview-context-r22.py`、`preview-paving-r22.py` 提供当前相机、NPC 真实站位和铺装组合；不再依赖旧稿预览或旧布局文件。

代码真源为 main-hub-architecture.js、walkable-area.js、main-hub-atmosphere.js，以及 GameScene/BootScene、scene-manager、WallSystem 和地板裁切入口。视觉脚点、遮挡、实心障碍、地形范围分别登记；双份 game-config.json 一起发布。

## 清理与交付边界

R22 清理仅删除 6 张已否决首版布局的展示图，清单在 `delivery_r22/cleanup-manifest.json`。原模型、Depth、后续编辑直接输入仍保留本地；最新整场预览保留供用户查看。Git 只收入当前正式资产、最终模型、必要输入与脚本，旧阶段模型/渲染缓存/临时预览不整批上传。

本地开发源与隔离发布分支存在并行项目差异，发布只迁移主神空间代码块，保留远端其他系统。未运行测试或运行时验证，按约定由用户测试；未同步 EXE。离线组合预览不包含实机动态阴影或运行验收。
