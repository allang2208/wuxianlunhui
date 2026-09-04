# 军营 V2：近现代帐篷与瞭望塔

2026-08-31。用户进一步要求军营近现代化、参考现有现代军营改进帐篷与塔楼。本版替代上一轮石砌双塔材质稿的军营方向；侦察营地、靶场以及现有现代军营不变。

状态：用户于 2026-08-31 回复“可用”，本版模型设计已确认。**现已完成48步01透明候选**，详见 [交付与来源](refine_s48_b02/README.md)。尚未接入游戏；助手选稿不伪记为用户逐张验收，不自动授权替换正式素材。

后续进度：依据“继续，做完以后下一个”，助手选择12步B02-03进行局部修正，去掉短端多余门窗和桶组、缩小电台，保留长边中央入口和开放瞭望台。派生图第一次48步上传被安全审查拦截；用户本轮明确补充许可后，从原入口完成两张48步，选择01做透明候选。栏杆、交叉撑和梯级3处局部残绿已修复，保留Alpha和细构件。[修正版及来源](structure_local_fix/README.md)、历史[48步前透明草稿](structure_local_fix/transparent_draft/preview.png)继续保留；具体记录见 [连续制作记录](../CONTINUATION.md)。

## 交付

- [当前48步透明PNG](refine_s48_b02/cutout/transparent.png) / [预览](refine_s48_b02/cutout/preview.png)
- `industrial_barracks_design_board.png`：本次近代中间态与现有现代白模的同视角对照。
- `industrial_barracks_model_approval_preview.png`：直接查看的模型预览。
- `industrial_barracks_model.blend`：独立可编辑模型，122 个网格对象、7 条绑带/拉绳曲线。
- `industrial_barracks_depth.png`：同模型、同相机、含地台的 Depth；已用于上述12步批次。
- `design.json` / `model-manifest.json`：尺寸、参考来源、变更范围与未批准状态。

## 造型

复用公共 `build_hamster_barracks_lv3` 的完整帐篷、单塔、沙袋和三组补给区域，仅在本目录的生成脚本中派生新方案，不修改公共建模器或已接受的现代模型。

- 主体改为单座卡其帆布帐篷；布顶增加柔和下垂、三条绑带，四角拉绳固定在原地台以内。薄壁围绕门洞分段建模，保留内退暗部、系束门帘、卷帘窗与木地板。
- 塔楼主承重高度从现代参考的 210 调整为 176，平面从 104×104 调整为 116×110，采用粗木柱、钢制脚座/交叉撑与木平台。梯子扶手延伸到平台上方，正面护栏为登塔留出缺口，棚柱与帆布檐口相接。
- 帐篷与塔楼之间改为落地木步道；箱体以木质和哑光扣件呈现，电台面板使用机械旋钮。保留低矮沙袋，不增车辆、雷达、第二塔或新的玩法功能。
- 主体完整地台保持现代参考的 480×392×16 模型单位。保留 30° 正交视角与 44.8° 根旋转；模型单位不等于逻辑占格，未修改游戏配置。

本版是为新插入时代设计的原生模型草稿。当前现代正式贴图的 AI 精修细节不能当作白模逐像素几何依据；对照图右侧明确使用现有现代白模。

## 重建

在项目根目录执行：

```powershell
& 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --python tools/ai-gen/_industrial_recruitment_materials_20260831/infantry_barracks_tent_v2/build_model.py
& 'C:/Users/allan/AppData/Local/Programs/Python/Python311/python.exe' tools/ai-gen/_industrial_recruitment_materials_20260831/infantry_barracks_tent_v2/compose_preview.py
```

只运行模型/预览生产工具并查看离线产物。未运行测试或运行时验证，按约定由用户测试；未修改正式素材、科技、募兵、碰撞、寻路、存档或 EXE。
