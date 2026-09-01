# 原01的12步局部修正

后续确认（2026-09-01）：用户“可用继续”接受燃油C/罐头B，已进入并完成[标准48步候选](../refinement_dev_s48_20260901/README.md)。本页以下“未进入48步/待选”表述保留为12步阶段的历史记录；本页源图与模型仍是必要编辑祖先，不覆盖、不删除。

用户：“按你建议继续，但是考虑到抠图，尽量不要把楼梯跟绿幕重叠，记住这个”。本批以两栋原01为直接编辑源，分别生成A/B两张，属于有界局部修正实验，未进入48步精修，未接入游戏。贸易公司不改。

已完成并查看**5张**：首轮油A/B、罐头A/B，另因爬梯没有移位，以油B为直接输入补做一张仅烟囱区域的C。**推荐燃油C、罐头B**：C的爬梯已置于实体烟囱正面、梯顶在筒口下方；罐头B恢复了立体罐头门标。油罐仍偏亮、旧徽记有浅痕、小罐标签及外部阴影仍待收口，未直接通过48步准入，详见`review.json`。

## 修改范围

- 燃油厂：先复制已确认v02模型，仅将烟囱爬梯转到相机可见正面，使横档后有实体烟囱壁；厂房、敞口、烟道、门窗、地台、相机不变。以新完整Depth控制原01的局部img2img，要求替换旧边缘爬梯、油罐改哑光低饱和赭黄漆、合并油滴闪电门标、减少密集材质噪点和地台外投影。
- 罐头厂：模型与Depth不改。局部修正立体罐头门标、去假文字、银灰金属与暗砖红配色，保留拱顶、原料塔、卧式杀菌釜、入口和输送线。不新增与绿幕重叠的外露楼梯。
- 原01不覆盖；蒙版只是生成编辑区域，不是抠图Alpha。输出raw未抠图、未改色，也未用Depth裁掉结构问题。

## 参数与来源

- 统一入口：`generate-world122-building-candidates.py`；FLUX.2 Dev+Depth，`world122-building-v5`，1024²，CFG3.5，Euler/simple。
- 显式12步修正实验：`--stage refine --steps 12 --denoise 0.65 --allow-nonstandard --raw-only`，Depth0.75，每栋2张；种子燃油133141/133142、罐头133151/133152。
- 油C是另一次有界、单张烟囱局部修正：12步、denoise0.95、Depth0.95、种子133161；来源链为原01→油B→油C。保留`ladder_fix/manifest.json`、蒙版、提示/Depth、日志、真实参数及raw；该分支不改变未蒙版的厂房、门标、油罐或地台。
- `refine`是现有脚本的img2img入口和文件前缀，**不表示本批执行了48步**；实际参数见每张`*_generation.json`。
- 只向既有授权目的地`http://192.168.3.142:8188`发送本批必需原图、Depth、蒙版、提示词和参数。不抢占/清空共享队列、不自动无限重抽。
- 唯一直接图像源：上级`candidates_dev_s12/oil_power_plant/oil_power_plant_structure_v01_raw.png`与`candidates_dev_s12/cannery/cannery_structure_v01_raw.png`。
- 原始模型祖先为上级两栋v02 `.blend`；燃油爬梯分支模型、预览和完整Depth在`model/oil_power_plant/`。

## 文件索引

- 批次对照页、局部放大图和未选A稿已在最终归档时清理；`review.json`保留判退结论，`present-corrections.py`可从现存直接祖先重建比较排版。
- [修正模型预览](model/oil_power_plant/oil_power_plant_model_approval_preview.png)、[模型元数据](model/oil_power_plant/model-metadata.json)。
- `correction-manifest.json`：用户指令、来源、具体提示、蒙版区域、实际阶段；`review.json`：离线查看后的结果和剩余问题，以此判断是否选稿。
- 两栋目录保留`source01_edit_mask.png`、获选直接祖先raw、全部`*_generation.json`、实际提示词和Depth副本；红色蒙版预览、日志与未选raw已清理。
- `adjust-oil-model.py`仅重定位原模型的爬梯；`prepare-corrections.py`生成蒙版和本批manifest；`present-corrections.py`只将完整raw排版，并提供原像素局部放大。
- `prepare-ladder-fix.py`准备油C的单张局部返修；`update-index.py`仅在图像已完成并查看后同步本批来源和选稿索引。燃油主对照显示原01/B/C，油A原图仍保留并在HTML内单独链接；罐头对照显示原01/A/B。

## 重建命令（不是自动续跑）

从仓库根目录运行。原始模型和原01为必要祖先，不得清理；现有生成结果存在时标准入口会复用，不应把重建命令作为盲目重复提交依据。

```powershell
$taskCorrection='tools/ai-gen/_industrial_economy_buildings_20260831/v02/corrections_01_dev_s12'
& 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --threads 8 --python "$taskCorrection/adjust-oil-model.py"
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' "$taskCorrection/prepare-corrections.py"
foreach ($taskAsset in @('oil_power_plant','cannery')) {
    $taskSeed=if($taskAsset -eq 'oil_power_plant'){133141}else{133151}
    & 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -u tools/ai-gen/generate-world122-building-candidates.py --manifest "$taskCorrection/correction-manifest.json" --stage refine --only $taskAsset --init-image "$taskCorrection/../candidates_dev_s12/$taskAsset/${taskAsset}_structure_v01_raw.png" --mask-image "$taskCorrection/$taskAsset/source01_edit_mask.png" --mask-channel red --steps 12 --denoise 0.65 --variants 2 --seed $taskSeed --allow-nonstandard --raw-only
    if ($LASTEXITCODE -ne 0) { break }
}
```

油C的单独重建入口（不重复提交已有结果）：

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' "$taskCorrection/prepare-ladder-fix.py"
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -u tools/ai-gen/generate-world122-building-candidates.py --manifest "$taskCorrection/ladder_fix/manifest.json" --stage refine --only oil_power_plant --init-image "$taskCorrection/oil_power_plant/oil_power_plant_refine_v02_raw.png" --mask-image "$taskCorrection/ladder_fix/chimney_ladder_mask.png" --mask-channel red --steps 12 --denoise 0.95 --variants 1 --seed 133161 --allow-nonstandard --raw-only
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' "$taskCorrection/present-corrections.py"
```

“楼梯尽量有实体衬底、避免缝隙透绿”已记录到项目`skill/02-ai-asset-pipeline.md`和用户明确要求的长期记忆增补。本批只产出候选素材；未运行测试或运行时验证，按约定由用户测试。没有修改正式assets、科技、经济结算、逻辑占格/碰撞、存档或EXE。
