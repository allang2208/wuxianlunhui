# 矮堆3号：五种蓝色矿脉分布

基准为用户明确选定的[矮堆3号原图](../candidates_dev_s12_low/energy_rubble_pile/energy_rubble_pile_structure_v03_raw.png)。**五张已全部获准接入，正常/枯竭贴图由`../export-runtime.py`导出，运行时来源见[manifest](../runtime/manifest.json)。**

五种主矿脉分布已经可以区分，部分版本还保留少量次要蓝色碎点，不能将方向标签理解为严格只有四个矿点。每张完整生成raw和局部合成图均已查看；石堆外轮廓、底边和高度保持所选3号。本目录保留绿底制作源，正式透明图优先于旧16帧拼接图集。

## 制作方法

标准48步、denoise 0.30直接使用旧分布作为init时，首张只改变了纹理。随后denoise 0.70的两个局部尝试仍过多沿用旧矿点，并出现圆形矿窝，均不计入此次五张交付。

本批先制作明确的矿脉位置引导图：仅在原矿物蓝色区域恢复灰石底色，再将同一3号的矿物样本放置到目标石面。引导图不是最终出图；五张均继续通过标准建筑入口，执行FLUX.2 Dev + 原模型Depth的48步局部材质精修。实际denoise为0.55、Depth 0.75、CFG 3.5、1024×1024，完整注入一次建筑v5画风；显式登记`--allow-nonstandard`。没有替换模型或生图引擎。

原图外轮廓和底边不在重绘蒙版内。交付PNG采用局部生成结果与选定3号合成，蒙版以外直接保留原始像素；石堆不拉伸、不增高、不重排。生成raw也完整保留，未使用旧Depth裁切成图来掩盖差异。

## 五种分布

| 编号 | 方向 | 交付图片 |
|---|---|---|
| 1 | 左侧集中 | [1号](01_left/mineral_distribution_local_raw.png) |
| 2 | 右侧集中 | [2号](02_right/mineral_distribution_local_raw.png) |
| 3 | 中部串联 | [3号](03_center/mineral_distribution_local_raw.png) |
| 4 | 前沿散点 | [4号](04_front/mineral_distribution_local_raw.png) |
| 5 | 对角分布 | [5号](05_diagonal/mineral_distribution_local_raw.png) |

[五张与基准的联系图](mineral-distribution-candidates.png)使用同一裁窗，仅去掉绿底空白，石堆完整且等比展示。注意本批“3号”是中部串联变体，基准原图单独放在第六格。

各编号目录保留位置引导图、目标区域、局部蒙版、独立候选配置、实际提示词、生成参数、Depth、未经合成的Dev raw与`local-composition.json`。`mineral_distribution_local_raw.png`是交付用局部合成图，不能当作未经处理的模型输出。

## 复现

```powershell
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/_energy_rubble_pile_20260831/vein-variations.py prepare --batch vein_variations_v3 --denoise 0.55 --guided
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/_energy_rubble_pile_20260831/vein-variations.py run --batch vein_variations_v3 --only 1 2 3 4 5 --jobs 5
& 'E:/无尽轮回/长期备份/2026-7-13-1/ComfyUI/.venv/Scripts/python.exe' -B tools/ai-gen/_energy_rubble_pile_20260831/vein-variations.py present --batch vein_variations_v3
```

所有任务使用同一已授权ComfyUI地址，独立提交后按服务器队列执行；未抢占、取消或清空其他任务。

后续接入已修改运行时选图和矿簇生成，具体边界见`docs/energy-rubble-clusters-2026-08-31.md`；模型、逻辑占格、碰撞、采集与储量未改。未运行测试、构建、游戏或运行时验证，按约定由用户测试。
