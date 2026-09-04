# 蘑菇农场：模型、贴图与游戏接入

2026-08-31。用户按建议选择右侧精修2号并继续接入；正式透明贴图、4×4建造、门侧道路、岗位物流、独立升级与前后台位面产量倍率已接线。当前交付与制作命令见 `accepted_20260831/README.md`。未运行测试或运行时验证，按约定由用户测试；下文保留此前建模/候选阶段记录。

## 模型内容

左上栅栏绿幕已按用户反馈定点返修：当前正式透明源为`accepted_20260831/mushroom_farm_fence_fixed.png`，局部对照见该目录的`fence-before.png`与`fence-after.png`。棚布、模型、贴图尺寸及玩法配置不变。

- 六组低矮堆肥菌床，中央通道连接正门与后侧横向通道。
- 后侧遮光育菌棚含两层育菌架；另一侧为小型分拣屋，屋面带独立蘑菇徽记。
- 木围栏、收获台与水桶保持小型农业生产设施的尺度；没有人物、外部道路或发光蘑菇。
- 蘑菇菌盖、菌柄、菌床、屋体、屋顶及设施均为独立可编辑部件。现有颜色属于模型预览材质，不代表正式贴图已完成。

## 与参考农场的规格对应

| 项目 | 奶酪农场 | 玉米农场 | 本候选 |
| --- | --- | --- | --- |
| 逻辑占地 | 4×4 | 4×4 | 已接入4×4 |
| 游戏地面映射 | 512×256 | 512×256 | 沿用512×256目标 |
| Blender地面尺寸 | 820×680×14 | 820×680×14 | 820×680×14 |
| 正式PNG源图 | 899×513 | 908×565 | 895×544，RGBA |
| 游戏显示尺寸 | 512×292 | 512×319 | 512×311，footOffsetY=153 |

模型预览画布1024×1024，正交相机仰角30°、建筑根节点旋转44.8°，沿用共用场景与灯光。预览光照只服务于材质/结构展示，不定义游戏中的阳光属性。

已沿用 `front_road`：只在正门一侧生成4格道路，其他三侧不环绕铺路，不向16格主体占地内填充道路；镜像时门侧随现有规则换边，蘑菇农场物流入口同步镜像。模型只包含院内通道，不把外部道路烘焙进图。

## 文件与来源

- `mushroom_farm_model.blend`：可编辑源模型。
- `mushroom_farm_model_approval_preview.png`：供用户确认布局的预览。
- `mushroom_farm_model_preview.png`：模型原始渲染。
- `mushroom_farm_depth.png` / `mushroom_farm_body_depth.png`：同机位完整/排除地基的深度图，供确认后的材质制作使用。
- 生成器：`tools/ai-gen/settlement-building-pack-blender.py` 的 `build_mushroom_farm` 与 `mushroom_farm_cluster`。
- 参数：`tools/ai-gen/_settlement_building_pack_20260821/manifest.json` 的 `buildings.mushroom_farm`。
- 结构说明：`tools/ai-gen/_settlement_building_pack_20260821/prompts/mushroom_farm.txt`；部件登记：`skill/references/world122-building-components.md`。

在仓库根目录重建（Blender 5.1）：

```powershell
& 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --python tools/ai-gen/settlement-building-pack-blender.py -- tools/ai-gen/_settlement_building_pack_20260821/manifest.json mushroom_farm tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/mushroom_farm_model.blend tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/mushroom_farm_model_preview.png tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/mushroom_farm_depth.png tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/mushroom_farm_body_depth.png
```

## 定稿来源与废案收口

当前正式透明源是`accepted_20260831/mushroom_farm_fence_fixed.png`，完整导出命令见该目录README。保留原模型/Depth、首批v02 raw、局部v02的生成raw/蒙版/合成raw、标准48步v02 raw、对应提示/元数据，以及最终body/透明源与围栏前后对照。它们构成真实直接输入链，不能只留最后一张raw。

未选版本、失败整图修正、无用Edge、联系表和可重建keyed/边缘中间图已移到不进Git的恢复目录；逐文件清单见`tools/ai-gen/building-assets-cleanup-20260831.json`。`repair-selected-v02.py compose`只合成保留的v02。以下阶段记录仅追溯生成与拒稿依据；已清理的预览/候选路径不再作为活动入口，重建从本节保留来源或accepted目录完整命令开始。

## 生图阶段记录

### 已批准的生图阶段

本次使用项目指定的FLUX.2 Dev + Blender Depth管线，不是内置ImageGen自由出图。结构候选采用公共`world122-building-v5`，1024²、12步、Depth 0.78、CFG 3.5、Euler/simple，三张种子依次为130830、130831、130832。

候选目录：`structure_12step_20260830/mushroom_farm/`；每张保留`*_raw.png`和`*_generation.json`，完整提示词为同目录`mushroom_farm_structure_prompt.txt`。模型完整Depth同时含低矮土基，未用排除土基的Body Depth替代它。本阶段先交付完整绿底raw供选稿，不做正式Alpha、尺寸标定或运行时替换。

```powershell
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/generate-world122-building-candidates.py --stage structure --only mushroom_farm --seed 130830 --raw-only --out tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/structure_12step_20260830
```

蘑菇农场拥有独立提示词分支，避免继承农业默认分支中的奶酪主厅/牛棚/牧场语义；奶酪和玉米农场分支保持不变。选定结构图后，才按同一Depth和选中raw继续标准48步、低重绘的精修候选。

### 本批查看结果与选稿边界

完整原图联系表：`structure_12step_20260830/contact_raw/page_01.png`，左上v01、右上v02、左下v03。三张均保留六组菌床与主体占地，但**本批未通过完整结构门禁**，不能直接进入48步或正式入库。

| 候选 | 已保留 | 需要修正的可见偏差 |
| --- | --- | --- |
| v01 / 130830 | 六组菌床、两侧作业区 | 院门关闭；屋顶增加前向山墙；徽记出现醒目红金边；棚架增层 |
| v02 / 130831 | 六组菌床、通畅院门、连续主屋顶 | 徽记过大且带圆框；棚架三层而非两层；分拣屋门窗位置漂移；主体外有投影 |
| v03 / 130832 | 六组菌床、连续主屋顶 | 院门关闭；棚架增层；储水桶重复；徽记移到门面；主体外有投影 |

首批交付时，v02仅作为材质方向参考，尚未被用户选择或作为结构接受。用户随后明确“按你的建议继续”，授权沿v02材质方向修正门窗、两层棚架和小型蘑菇徽记；这不等于接受旧图中的错件。

### 结构修正版（2026-08-30）

原`.blend`与完整Depth保持不变，仅把原先容易被误读的部件关系明确为：育菌架只保留上、下两块层板和中间大空隙；分拣屋长立面中央双门、左右各一扇小方窗，短侧墙不设门窗；门上方保留小型无边框蘑菇轮廓，不生成圆牌或金边。继续保留六组菌床、开放院门、单桶和分拣台。

修正批次目录：`structure_correction_12step_20260830/mushroom_farm/`，仍走标准12步/Depth 0.78/CFG 3.5，种子130831～130833，完整prompt和每张generation元数据分别归档。第一张沿用首批v02的种子，v02作为人工材质参照而非img2img输入；没有把未通过的原图冒充已确认结构。结构查看通过前不以48步掩盖错件。

三张整图修正已生成：门窗和无边框徽记有所改善，但仍出现关闭院门、加砌围栏矮墙或重复桶等连带变化，因此没有晋级。停止继续整图抽图，回到用户认可材质方向的首批v02，使用项目现有局部Depth返修方式。

### 2号局部结构返修

入口：`repair-selected-v02.py prepare` 生成三处蒙版、保护区和隔离的候选manifest；公共生成器仍为 `generate-world122-building-candidates.py`，没有更换模型或公共画风。

- 目录：`local_structure_repair_20260830/`，输入是首批v02原图 + 原完整Depth + 局部蒙版。
- 只重绘棚架、两面墙的门窗、屋面徽记。储水桶和前景菌簇另设保护区；屋顶主体、六组菌床、开放院门、围栏、地面和背景位于蒙版外的像素从原图直接保留。
- 采用48步蒙版编辑、Depth 0.75、局部`denoise=0.70`与`--allow-nonstandard`，两张种子130841/130842。这是**已标记的局部结构返修**，不是标准`denoise=0.30`精修通过的声明；原12步输出没有被覆盖。
- `repair-selected-v02.py compose` 仅将蒙版内生成结果合回原图；`*_local_raw.png`为待查看交付图，旁边JSON保留原图、生成raw、生成参数、蒙版和合成操作。蒙版为0的位置直接取原始像素，避免VAE解码改变整个主体。

```powershell
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/repair-selected-v02.py prepare
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/generate-world122-building-candidates.py --manifest tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/local_structure_repair_20260830/candidate-manifest.json --stage refine --only mushroom_farm --seed 130841 --init-image tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/structure_12step_20260830/mushroom_farm/mushroom_farm_structure_v02_raw.png --mask-image tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/local_structure_repair_20260830/mushroom_farm_repair_mask.png --mask-channel red --denoise 0.70 --allow-nonstandard --raw-only
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/repair-selected-v02.py compose
```

局部结果：v01保留了多余侧窗；v02已去掉侧墙开口，恢复两层育菌架、中央门两侧小窗与无边框蘑菇徽记。按用户“按建议继续”的指令，以`local_structure_repair_20260830/mushroom_farm/mushroom_farm_refine_v02_local_raw.png`为后续低重绘输入；没有把v01或整图返修中的新增围墙/重复桶带入。

### 标准低重绘精修

目录：`refine_48step_corrected_20260830/mushroom_farm/`。两张种子130851/130852，标准48步、Depth 0.75、`denoise=0.30`、CFG 3.5，完整公共V5画风与原模型Depth保持。每张`*_generation.json`记录真实局部修正输入，并区分前一阶段的非标准结构返修；最终图仍待用户定稿。

```powershell
& '../ComfyUI/.venv/Scripts/python.exe' tools/ai-gen/generate-world122-building-candidates.py --stage refine --only mushroom_farm --seed 130851 --init-image tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/local_structure_repair_20260830/mushroom_farm/mushroom_farm_refine_v02_local_raw.png --raw-only --out tools/ai-gen/_settlement_building_pack_20260821/mushroom_farm/refine_48step_corrected_20260830
```

两张精修均已生成。并排预览：`refine_48step_corrected_20260830/contact_raw/page_01.png`，左侧v01 / 130851，右侧v02 / 130852。两张都保留了两层育菌架、中央门及两侧小窗、无开口短侧墙、开放院门和六组菌床；v01屋面标识带斑点，v02为更简洁的浅色蘑菇形，建议以右侧v02供用户定稿。这是候选推荐，不代表用户已经接受最终贴图。

交付原图仍是1024²绿底raw，主体外投影尚在；正式透明背景、去除外投影、贴图裁切和脚点/视觉占地标定都留到用户最终选稿后。可编辑模型与原完整Depth未改动，没有将候选写入`assets/`。

### 生产与游戏接入（2026-08-31已实现，待用户实机验收）

作为奶酪/玉米农场同级别的食物来源：4500能源、3600耐久、10岗位、20秒/批、基础180食物，使用同档四项独立升级。地牢、矿洞等无阳光位面产量×1.5，有阳光位面产量×0.5；`farm-production-profile.js`读取位面`hasSunlight`，前台、后台和面板共用，不随地表昼夜切换。保留粮食天气、酒馆、工坊、祭品、仓容、道路及岗位规则。

正式源为精修v02 / seed130852。贴图高度、脚点和`visualFootprint`按最终成品独立标定，派生清单映射为512×256；新增稳定资源键`mushroom_farm`并复用配置驱动加载。菌农暂复用通用农夫步态，不新增蘑菇搬筐动画，也不使用玉米/奶酪货物图冒充。未运行测试或运行时验证，未更新固定EXE。
