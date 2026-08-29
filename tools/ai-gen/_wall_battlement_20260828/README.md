# World-122 城垛女墙资源包

## 已采用合同

- 单件逻辑占地为 `64 × 64`，即标准 `128 × 128` 城墙格面积的四分之一。
- 每条标准墙外沿分成两个半槽，高段 `220`、低段 `196`，都高于普通墙的 `160`。
- 女墙是不可通行、不可站立的软掩体；墙顶单位可向外射击，外侧来弹命中墙后单位时由女墙承担减免的 50% 最终伤害。
- 五级材质与方块墙科技同步，运行图位于 `assets/terrain/wall_battlement_{high|low}_{tier}.png`。
- 运行时脚线按四分之一格菱形前顶点接地；不能用整张 PNG 底边作为实体锚点。

## 最小复现链

- `manifest.json`：尺寸、相机、材质与结构合同。
- `wall_battlement_model.blend`：可编辑高/低白模。
- `wall_battlement_model_preview_approval.png`：采用模型预览。
- `wall_battlement_depth.png`：同相机深度图。
- `tier_renders/wall_battlement_textured_tiers.blend`：五级材质场景。
- `tier_renders/*_raw.png`：十张采用的原始分级渲染。
- `tier_renders/runtime_metadata/*.json`：运行裁切与占地元数据。
- 生成脚本：`blender-wall-battlement.py`、`render-wall-battlement-tiers.py`、`finalize-wall-battlement-tiers.mjs`。

重复 staged 成品、组合候选、拼版评审图与重复预览不纳入仓库。
