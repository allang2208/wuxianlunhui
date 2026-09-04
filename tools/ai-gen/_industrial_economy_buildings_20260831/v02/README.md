# 燃油发电厂与罐头加工厂 v02

最新进展（2026-09-01）：用户“按你建议继续”选定燃油48步02/罐头48步01，已完成[透明定稿、预览与来源记录](transparent_final_20260901/README.md)，爬梯实体衬底、管线及立体罐头门标保留，现已正式接入游戏。以下模型、12步及准入状态为历史来源记录，最新状态以透明manifest为准。

2026-08-31，依据用户对首版的直接反馈重做。用户随后回复“可用，进行12步生图”，确认两栋v02模型并授权结构候选生成。贸易公司未改动；未修改正式assets、科技、产出、占格、存档或EXE。

12步候选、实际提示词和参数记录于 `candidates_dev_s12/`，参数真源为 `candidate-manifest.json`；[本批选稿说明](candidates_dev_s12/README.md)保留历史结论。完整对照与未选raw已在最终归档时清理，可由保留脚本重建排版。

用户随后同意以两栋01继续修正，并要求楼梯尽量不与绿幕重叠。[本次12步局部修正](corrections_01_dev_s12/README.md)保留原01、新蒙版、参数与独立输出；燃油模型仅将爬梯转到实体烟囱正面并重出完整Depth，原v02和罐头模型均不覆盖。执行状态及选稿结果以该目录manifest/review为准，不代表进入48步。

## 燃油发电厂

- 主体改为两层：一层机组车间、二层控制层。逐层独立承重壳，宽深与轴线一致，楼层分界和两排窗清楚可见。
- 原两根短排气管替换为一根高烟囱。筒体有真实内壁，顶部是环形敞口，不用实心盖或黑圆片假装排放口；烟囱侧面开孔并由中空烟道连接厂房。梯子、箍带和冠口独立可编辑。
- 保留两只卧式油罐与供油管，入口使用油滴＋闪电无文字徽记。不在模型或Depth里烘焙烟云，也不添加排放/污染玩法。
- [模型预览](oil_power_plant/oil_power_plant_model_approval_preview.png)、[Blender模型](oil_power_plant/oil_power_plant_model.blend)、[完整Depth](oil_power_plant/oil_power_plant_body_depth.png)。

## 罐头加工厂

- 放弃首版普通锯齿屋顶，改为弧形金属拱顶与大窗加工车间，墙面用暖灰、砖红和灰绿作大块材质区分。
- 侧后方设置罐形原料塔，带卷边、红色标带和蔬果徽记；它是工艺设备，不算新增建筑楼层。
- 正门接外露辊轮输送线、连续罐头与封罐压机，侧面是带锁紧舱门/手轮/压力表的卧式杀菌釜，前方另有大型罐头标识和原料/成品箱。
- 输送线与设备均为静态模型，不代表已经实现动画、生产数值或新罐头资源。
- [模型预览](cannery/cannery_model_approval_preview.png)、[Blender模型](cannery/cannery_model.blend)、[完整Depth](cannery/cannery_body_depth.png)。

## 来源和重建

尺寸、相机与色板见 `manifest.json`；装配入口为 `build-models.py`，依赖上一层 `build-models.py` 中的 `Model` 辅助类、公共 `building-component-kit.py` 和 `settlement-building-pack-blender.py`。新增通用件仅为 `open_tapered_tube` 与 `roller_conveyor`，同步登记在 `skill/references/world122-building-components.md`；旧组件行为不变。

两栋均保留完整800×800×28石质地台，30°正交相机、44.8°根旋转、1024×1024获准预览与同模型Depth。每栋子目录保存来源元数据；渲染日志和字节相同的重复预览已清理。

在仓库根目录运行以下PowerShell命令，可重建v02两栋，不会覆盖首版或贸易公司：

```powershell
$taskModelRoot = 'tools/ai-gen/_industrial_economy_buildings_20260831/v02'
foreach ($taskAsset in @('oil_power_plant', 'cannery')) {
    $taskModelDir = Join-Path $taskModelRoot $taskAsset
    New-Item -ItemType Directory -Force -Path $taskModelDir | Out-Null
    & 'E:/Program Files/Blender Foundation/Blender 5.1/blender.exe' --background --factory-startup --threads 8 --python "$taskModelRoot/build-models.py" -- "$taskModelRoot/manifest.json" $taskAsset "$taskModelDir/${taskAsset}_model.blend" "$taskModelDir/${taskAsset}_model_preview.png" "$taskModelDir/${taskAsset}_body_depth.png" *> "$taskModelDir/render.log"
    if ($LASTEXITCODE -ne 0) { break }
}
```

已查看两栋原生模型预览，当前模型选定以用户“可用，进行12步生图”为准。后续依据12步完整原图另行选稿，不自动进入48步。未运行测试或运行时验证，按约定由用户测试；未构建、同步EXE、提交或推送。
