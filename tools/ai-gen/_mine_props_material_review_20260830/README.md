# 矿洞小物 Blender 材质候选

12件模型沿用上一轮结构，仅改材质，没有AI出图。已由v3显式安装；当前安装与尺寸记录见`../_mine_visual_finish_v3_20260830/manifest.json`。以下候选说明保留制作阶段语境。

- `mine_props_curated.blend`：可编辑模型、程序材质和原固定相机。
- `model-renders/`与`body-depth/`：12组1024px材质渲染与16bit深度图。
- `candidates/`：12张256px透明候选。`candidate-sizing.json`只记录按Alpha重新计算的建议尺寸。
- `material-review.png`：基础材质/新材质并排；`normal-size-preview.png`：当前正式及两种目标尺度。
- `plane-floor-preview.png`与`dungeon-floor-preview.png`：新地板上的正常尺寸离线组合，不是游戏截图。
- 风格来源：`tools/ai-gen/environment-prop-materials.py`，低饱和宽色块、克制木纹/氧化与粗糙度变化；灯具熄灭。
- 旧18件正式PNG、双份配置、地图散布、地板和游戏逻辑保持不变；退出新版组的6件仍未从游戏删除。
- 下一步按当前会话的选择/替换授权晋级；材质若在正常尺寸已够清楚，不追加AI轮次。
- 未运行测试或运行时验证，按约定由用户测试。后续接入重点观察可读性、主体尺寸、地板对比和建筑清除区。

生成入口：`build-mine-props-material-review.py`（Blender）；预览/候选导出：`compose-mine-material-review.py`（Python+Pillow）。
