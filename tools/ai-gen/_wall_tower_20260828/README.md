# World-122 城墙塔资源包

## 已采用合同

- 逻辑占地固定为 `2 × 2` 标准建筑格，塔顶拆成四个虚拟 `wall_walk` 节点。
- 塔顶封闭且可移动，与四向相邻方块墙无缝连通；墙↔塔高度切换保持 XY 并瞬时完成。
- 塔楼没有地面入口判定，单位只能通过已连接且可由楼梯到达的城墙网络登塔。
- 塔顶单位获得 2 倍无阻挡高空视野；普通墙顶倍率不与塔顶倍率叠乘。
- 主体与前景城垛分层渲染，五级材质、耐久、防御与方块墙科技同步。
- 运行图位于 `assets/terrain/wall_tower_{tier}.png` 与 `wall_tower_{tier}_foreground.png`。

## 最小复现链

- `manifest.json`：结构、相机与五级材质合同。
- `wall_tower_model.blend`：可编辑模型。
- `wall_tower_model_approval_preview.png`：采用模型预览。
- `wall_tower_depth.png`：同相机深度图。
- `tier_renders/wall_tower_textured_tiers.blend`：五级材质场景。
- `tier_renders/*_raw.png` 与 `*_foreground_mask_raw.png`：采用的主体/前景原始渲染。
- `tier_renders/*_runtime.json`：运行裁切、显示尺寸与前景元数据。
- 生成脚本：`blender-wall-tower.py`、`render-wall-tower-tiers.py`、`finalize-wall-tower-tiers.mjs`。

重复预览、深度副本、评审拼版和 Blender 自动备份不纳入仓库。
