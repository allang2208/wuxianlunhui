# 近代经济三建筑：建模候选

最新状态：燃油发电厂、罐头加工厂与贸易公司均已完成透明定稿、环境阴影派生、科技/升级图标、数值配置和游戏接入；三类纯视觉员工动画也已接入。贸易公司893×755真实RGBA保留02货仓门、弧形雨棚、两只货箱与确认过的异形招牌字形；旧Depth因门位/旧招牌不一致而未参与Alpha。

2026-09-01按仓库最小可重建规则完成收口：保留每栋获选的12步原图、直接局部编辑祖先、获选48步原图、透明母版、正式图、模型/Depth、提示词和生成元数据；清除未选兄弟raw、重复模型预览、对照页、阈值试片、日志、缓存及本轮临时备份。逐文件记录见[cleanup-manifest.json](cleanup-manifest.json)。历史README/manifest中的已清理路径只代表判退记录，不再作为重建输入。

贸易公司换牌阶段：用户偏好02并要求异形文字，已完成[只改牌面的修订](trading_sign_alien_20260901/README.md)，黑底铜框保留，牌面外像素变化为0。该图已获本轮确认并用作48步输入。下文12步01推荐为历史记录，已被最新02选择覆盖，不主动返修货仓/门廊。

贸易公司12步历史（2026-09-01）：按用户要求沿用首版模型与完整Depth，完成[三张Dev12步结构候选](trading_candidates_dev_s12_20260901/README.md)。当时建议以01局部修正：原货仓门位置更接近模型；02/03入口换侧，三张侧窗缺失、门廊偏亮。随后用户选择02并确认换牌版，现已进入48步，以上观察不构成重新审批门槛。完整原图、实际参数和提示术语更正均归档，未接入游戏。

燃油/罐头进展（2026-09-01）：用户“按你建议继续”选定燃油48步02/罐头48步01，已完成[两栋透明定稿](v02/transparent_final_20260901/README.md)：900×698、891×619真实RGBA，清理绿幕/外部投影与边缘溢色，保留爬梯实体衬底、管线及立体罐头门标。[48步原图与来源](v02/refinement_dev_s48_20260901/README.md)及模型直接祖先保留。现在贸易公司也已透明收口，三栋均未接入游戏；下文为前阶段来源记录。

2026-08-31，按用户“按你的建议开展，先做建模”制作。随后燃油厂与罐头厂v02模型获用户“可用，进行12步生图”确认，进入12步结构选稿；贸易公司保持首版，本批不生图。未进入48步精修或游戏接入。

同日用户要求燃油厂增加明确排放口并改为两层、罐头厂重新设计。**燃油厂与罐头厂当前使用 [v02](v02/README.md)，贸易公司保持首版。** 原两栋首版被此次反馈替代，只留作来源，不视为已通过选定。

最新续作：用户同意两栋01修正，追加“楼梯尽量不要与绿幕重叠”偏好。燃油爬梯朝向分支及两栋12步局部修正位于[v02/corrections_01_dev_s12](v02/corrections_01_dev_s12/README.md)，不覆盖原始模型/原图，不进入48步或运行时。

## 建筑设计

| 建筑 | 模型识别点 | 后续玩法定位（本轮未实现） | 计划中的两项科技 |
|---|---|---|---|
| 燃油发电厂 v02 | 两层对齐厂房、真实敞口高烟囱、相连烟道、两只卧式油罐、油滴闪电徽记 | 近代能源过渡；以金币结算燃料，暂不新增石油资源链 | 燃油动力、燃油机组标准化 |
| 罐头加工厂 v02 | 拱顶车间、罐形原料塔与蔬果徽记、外露封罐线、卧式杀菌釜、大型罐头招牌 | 面包屋与连锁餐馆之间；消耗能源加工食物，罐头只作为视觉身份 | 食品罐藏、罐装生产标准化 |
| 贸易公司 | 三层对齐的办公主体、附属单层货仓、石质腰线、门廊、货箱与外运箭头徽记 | 大商场与证券交易所之间；通过食物外贸产金币，区别于商场与证券建筑 | 近代商贸、贸易标准化 |

每栋拟占 4×4 格，本轮以 800×800×28 的石质地台表达体量。这个尺寸仅用于模型候选，不是已经接入的逻辑占格或碰撞配置。配色是低噪声材质分区，用于判断体块和设备，尚非正式美术定稿。

## 文件与来源

- `manifest.json`：各栋尺寸、色板、时代、相机参数、计划科技及待选状态。
- `build-models.py`：本批装配脚本；结构由独立命名对象构成，可直接在 Blender 中编辑。
- `v02/manifest.json`、`v02/build-models.py`：燃油厂与罐头厂当前尺寸及装配真源；复用首版 `Model` 辅助类和公共组件，首版脚本必须保留。v02模型与PNG在其各自子目录中，不覆盖首版或贸易公司。
- `oil_power_plant/`、`cannery/`、`trading_company/`：每栋保留 `*_model.blend`、`*_model_approval_preview.png`、`*_body_depth.png` 和 `model-metadata.json`；字节相同的普通预览与可重建日志已清理。
- 共用组件：`tools/ai-gen/building-component-kit.py`。本批新增石质地台、真实门洞承重壳、带箍储罐、折线管道和货箱组件；登记在 `skill/references/world122-building-components.md`。
- 共用渲染入口：`tools/ai-gen/settlement-building-pack-blender.py`。相机俯角 30°、建筑 Z 旋转 44.8°、1024×1024；预览与 Depth 使用同一模型与相机，保留完整地台。门洞、门扇、设备和无文字徽记都来自实际几何。
- 设计与几何为本批程序化制作，建模阶段未调用 AI 服务、未使用外部建筑图片；随后AI候选的真实输入、提示词与参数另见v02的候选/修正manifest，不将模型预览当作AI成图。

预览入口：

- [燃油发电厂 v02·爬梯正面修正](v02/corrections_01_dev_s12/model/oil_power_plant/oil_power_plant_model_approval_preview.png)
- [罐头加工厂 v02](v02/cannery/cannery_model_approval_preview.png)
- [贸易公司](trading_company/trading_company_model_approval_preview.png)

## 重建方法

当前燃油厂与罐头厂按 [v02重建说明](v02/README.md) 输出。以下保留首版三栋的历史重建命令，贸易公司仍使用此版本；不得误将重建出的旧燃油厂/罐头厂当作当前候选。命令不触碰正式 assets 或游戏配置：

```powershell
$taskModelRoot = 'tools/ai-gen/_industrial_economy_buildings_20260831'
foreach ($taskAsset in @('oil_power_plant', 'cannery', 'trading_company')) {
    $taskModelDir = "$taskModelRoot/$taskAsset"
    New-Item -ItemType Directory -Force -Path $taskModelDir | Out-Null
    & 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --threads 8 --python "$taskModelRoot/build-models.py" -- "$taskModelRoot/manifest.json" $taskAsset "$taskModelDir/${taskAsset}_model.blend" "$taskModelDir/${taskAsset}_model_preview.png" "$taskModelDir/${taskAsset}_body_depth.png" *> "$taskModelDir/render.log"
}
```

## 本轮边界与后续

三栋已按4×4逻辑占格及各自严格 `visualFootprint` 接入；每栋均落实“建筑解锁＋升级模块解锁”两项科技、四项本栋升级、前后台结算与存档迁移。当前活动素材和直接来源由三份透明定稿manifest及本页清理清单共同界定；历史候选manifest只保留选稿与判退证据。

未运行测试或运行时验证，按约定由用户测试；未构建、同步 EXE。
