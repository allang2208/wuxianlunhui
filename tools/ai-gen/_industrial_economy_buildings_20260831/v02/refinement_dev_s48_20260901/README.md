# 燃油C、罐头B：标准48步精修

后续进展（2026-09-01）：用户“按你建议继续”已选定推荐燃油02/罐头01，[透明定稿已交付](../transparent_final_20260901/README.md)，未接入游戏。下文选稿观察和待确认措辞是生成阶段的历史记录，完整raw保持不变；最新选择见本目录manifest/review。

2026-09-01用户回复“可用继续”，确认上一轮展示的燃油厂C和罐头厂B，继续标准48步。本次仅精修两栋，每栋2张，保留先前原图、模型和修改祖先；贸易公司不变。未授权本轮候选直接入库或玩法接线。

**四张已完成并逐张查看，推荐燃油02、罐头01。** 燃油02旧徽记残痕更干净，爬梯保持实体衬底；罐头01保住立体门标和杀菌釜锁紧细节，原料塔没有02新增的明显白色伪字。推荐图仍有细颗粒、亮油罐、少量小标签纹样和地台外投影，需在用户选定后收口，不等于已经透明定稿。

## 输入与不变项

- 燃油：`../corrections_01_dev_s12/ladder_fix/oil_power_plant/oil_power_plant_refine_v01_raw.png`，即上一轮C；沿用该分支正面爬梯模型的完整Depth。两层厂房、敞口烟囱、正面贴墙爬梯、双油罐、门窗、门标、相机和全地台不改。
- 罐头：`../corrections_01_dev_s12/cannery/cannery_refine_v02_raw.png`，即上一轮B；沿用已确认v02完整Depth。拱顶、原料塔、立体罐头门标、杀菌釜、输送线及地台不改。
- 楼梯、爬梯尽量有实体衬底，不越出轮廓形成透绿缝隙。提示词保留同一结构，只要求更平静的PBR材质面、克制的金属高光、无文字标签与纯绿背景。
- 用户最新确认覆盖上一轮“仅修正参考”状态。旧的油罐亮度、细颗粒、标签和背景阴影观察保留在历史review，不擅自把用户已确认结构再推翻。

## 参数与来源

统一从`generate-world122-building-candidates.py --stage refine`调用Dev+Depth；`world122-building-v5`，1024²，48步，denoise0.30，Depth0.75，CFG3.5，Euler/simple，每栋2张。不使用旧局部蒙版、不用`--allow-nonstandard`，不继承上一轮12步强重绘参数。

预定种子：燃油133201/133202，罐头133211/133212。实际值以各图`*_generation.json`为准。只向既有授权目的地`http://192.168.3.142:8188`发送本批必要原图、Depth、提示和参数，不抢占或清空队列。

- 批次完整对照与未选48步raw已在最终归档时清理；燃油02、罐头01及其直接输入继续保留，`review.json`保存选稿理由，`present-refinement.py`可重建排版。
- `manifest.json`：用户确认、准确输入、模型路径、结构不变项和精修提示；`review.json`：完成后逐张查看的记录。
- 两栋子目录保留完整`*_raw.png`、实际`*_prompt.txt`、`*_generation.json`、Depth副本和派生边缘参考；边缘图没有参与双路控制。
- `prepare-refinement.py`用于准备本批清单、记录上轮C/B确认；`present-refinement.py`只做原图等比排版。
- `update-index.py`在生成完成、原图查看和review记录后，同步本批manifest及上层来源索引，不修改正式assets或运行时配置。

## 重建命令

从仓库根目录执行。参数均取manifest，不重写为手工ComfyUI工作流；已有raw由标准入口复用，不盲目重复提交。重新准备manifest会重置本批状态，只在确实重建时执行。

```powershell
$taskS48='tools/ai-gen/_industrial_economy_buildings_20260831/v02/refinement_dev_s48_20260901'
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' "$taskS48/prepare-refinement.py"
$taskManifest=Get-Content -LiteralPath "$taskS48/manifest.json" -Raw | ConvertFrom-Json
foreach ($taskAsset in $taskManifest.assets) {
    & 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -u tools/ai-gen/generate-world122-building-candidates.py --manifest "$taskS48/manifest.json" --stage refine --only $taskAsset.id --init-image $taskAsset.acceptedRefinementInput --raw-only
    if ($LASTEXITCODE -ne 0) { break }
}
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' "$taskS48/present-refinement.py"
```

未改正式assets、科技、经济结算、逻辑占格/碰撞或存档。未运行测试或运行时验证，按约定由用户测试；未构建、同步EXE、提交或推送。48步新候选仍待用户选定，再进行透明定稿及正式接入。
