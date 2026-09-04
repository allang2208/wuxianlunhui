# 近代侦察营地：首批12步候选

**后续进度：** 用户回复“同意继续 48 步”，已按此前推荐锁定03原图，准备两张标准48步精修并处理罗盘/配色；见 [03的48步批次](../refine_s48_v03_b01/README.md)。下文选型说明保留本批交付时记录，不再表示仍未选12步版本。

承接用户“继续”和此前逐步12步生图的方向，在市政大厅透明稿完成后，按原建筑顺序制作侦察营地。市政大厅阳台修正版保持不变。

当前状态：用户回复“同意”明确授权本栋Depth、提示词和参数发送到下述局域网目的地后，标准入口已完成3/3张，进程exit=0。已逐张查看完整raw及生成参数，待用户选型；尚未进入48步。此前自动安全审核在进程启动前拦截的尝试没有上传，历史记录保留在manifest。模型、Depth和材质来源为上级目录；没有重建模型，也不覆盖中世纪或现代正式素材。

## 候选交付

- [三张完整原图对照](recon_camp_industrial_s12_candidates.png)
- [原图01](candidates/recon_camp_industrial/recon_camp_industrial_structure_v01_raw.png)、[原图02](candidates/recon_camp_industrial/recon_camp_industrial_structure_v02_raw.png)、[原图03](candidates/recon_camp_industrial/recon_camp_industrial_structure_v03_raw.png)
- [逐图说明与修改建议](REVIEW.md)、[完整提示词](prepared-prompt.txt)、[生成来源与参数](manifest.json)

建议03作为修改底稿：金属板面更简洁，但罗盘偏大且出现挂表式附加件，不应直接视为结构完全通过。02多出第二枚徽记，01额外增加门前补给包。三张均为绿幕RGB原图，保留可见背景和阴影，不是假透明成品。用户尚未选中任何一张。

## 生产记录

- 入口：`generate.py` 调用项目标准 `generate-world122-building-candidates.py --stage structure --raw-only`。
- 本次目的地/载荷已获明确许可。生成入口为 `generate.py`，成功后运行 `compose_review.py`；不要重复运行 `prepare.py` 覆盖当前状态。现有模型预览已实际打开，完整提示词已查看。
- 参数：FLUX.2 Dev + Depth，`world122-building-v5`，1024²，12步×3张，Depth 0.78，CFG 3.5，Euler/simple，seed 831751—831753。
- 保留：单主厅、单塔、梯子、两条素色信号旗、罗盘、补给棚及原地台。
- 材质：灰米砖墙、灰绿金属屋面、暗钢塔架、卡其补给包；不增加车辆、武器、人员或额外建筑。
- 计划目的地：项目既有局域网ComfyUI `http://192.168.3.142:8188`。载荷仅本栋Depth、`prepared-prompt.txt`和生成参数，不发送blend、源码、存档或其他素材。

12步保持完整绿底raw用于选型，不进行透明后处理，也不自动进入48步。不修改科技、兵种、碰撞、寻路、存档或正式素材。

未运行测试或运行时验证，按约定由用户测试；本批只执行素材生产和离线产物查看，不构建或同步EXE。
