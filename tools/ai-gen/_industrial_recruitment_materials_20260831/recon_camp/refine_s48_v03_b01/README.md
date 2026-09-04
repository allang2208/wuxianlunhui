# 近代侦察营地：03的48步精修

用户在推荐03并说明罗盘需缩小后回复“同意继续 48 步”。本批以12步03（seed831753）完整原图为直接输入，原图保留；不重采样、不抠图、不改模型。

当前状态：用户针对本次载荷明确回复“允许”后，原标准入口已完成2/2张48步、exit=0。两张原图都未完成罗盘缩小/去挂环。用户随后回复“按你推荐继续”，选定01作为局部修正底稿；经 [罗盘修正](../compass_fix_v01/README.md) 及减影处理后，已由用户“可以用”确认 [减影版透明图](../shadow_soften_v01/README.md) 为当前美术定稿，未接入游戏。本目录两张48步原图、初次评阅记录及历史许可保持不变。

## 交付

- [03底稿与两张48步对照](recon_camp_industrial_s48_comparison.png)
- [罗盘与锈斑放大对照](recon_camp_industrial_s48_detail.png)
- [48步01原图](candidates/recon_camp_industrial/recon_camp_industrial_refine_v01_raw.png) / [48步02原图](candidates/recon_camp_industrial/recon_camp_industrial_refine_v02_raw.png)
- [实际结果及未达成项](REVIEW.md) / [完整提示词](prepared-prompt.txt)

## 来源与生产参数

- 标准入口：`generate-world122-building-candidates.py --stage refine --raw-only`，由本目录 `generate.py` 调用。
- FLUX.2 Dev + 同一模型Depth，`world122-building-v5`，1024²，48步×2张，Depth 0.75，denoise 0.30，CFG 3.5，Euler/simple，seed831761—831762。
- 主要保留：主厅、单塔、塔舱、塔架、栏杆、梯子、门窗、两面信号旗、补给棚及包裹、完整地台与稀疏金属板缝。
- 局部要求：现有罗盘直径缩到约65%，去挂表式挂环/附加件，仅留一枚克制的小罗盘；黄铜与橙锈收敛。是否达到要求须按实际结果说明，不预先宣称纠正成功。
- 目的地仍为项目既有局域网ComfyUI `http://192.168.3.142:8188`；仅发送本栋03 raw、同一Depth、提示词及参数，不发送blend、源码、存档或其他任务素材。此前12步的许可记录保持不变，本次依据用户最新48步指令执行。
- 完整来源和控制条件见 `manifest.json`，提示词见 `prepared-prompt.txt`，模型级活动选择见 `../selection.json`。已准备后不要重跑 `prepare.py` 覆盖本批状态。
- 本次具体外发已获许可，按原入口运行 `generate.py`，成功后运行 `compose_review.py` 生成03原图与两张48步完整raw的对照。

本批48步原图与对照保持不变，后续局部编辑和抠图独立保存在 `../compass_fix_v01/`。未替换正式素材，未改科技、兵种、逻辑占格、碰撞、寻路或存档。未运行测试或运行时验证，按约定由用户测试；不构建或同步EXE。
