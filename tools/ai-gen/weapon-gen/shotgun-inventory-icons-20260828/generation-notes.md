# 霰弹枪斜向物品图标生成记录（2026-08-28）

## 目标

- 覆盖 `weapon12/13/39—48` 共12把霰弹枪。
- 用于装备栏、背包和地面掉落；玩家持枪与防御塔继续使用侧视主体图。
- 枪托位于左下，枪口斜向右上约30度，完整枪身，方形画布，透明背景。

## 生成方式

- 工具：Codex 内置 `imagegen` 精确参考图编辑。
- 每把枪仅使用自身正式 `equipImage`（Super90/SAIGA 使用既有持枪主体图）作为参考。
- 核心提示：保持原枪的枪托、机匣、枪管数量与长度、弹匣/管仓、材料、配色、雕刻、能量纹样和附件；只改变为右上斜向三分之四视角；单枪完整居中；禁止人物、手、文字、品质框、平台、阴影、弹药、重复武器和裁切。
- 生成服务输出为 `1254×1254` 烘焙棋盘格 RGB，未作为正式资产直接使用。正式图经 `tools/ai-gen/strip-checkerboard-alpha.py` 自动识别两种棋盘底色、提取最大主体、边缘去污染并归一化为 `512×512` RGBA。

## 源与正式输出

| 武器 | 参考图 | imagegen 输出 ID | 正式图标 |
| --- | --- | --- | --- |
| Super90 | `assets/icons/M4s90_icon.png` | `exec-675ce467-e96a-4db4-8e9c-c32db9320a45` | `assets/icons/shotguns/super90.png` |
| SAIGA-12K | `assets/icons/S12k-icon.png` | `exec-966efc56-2ead-4a0b-8b62-c6dd93133641` | `assets/icons/shotguns/saiga12k.png` |
| S686 | `assets/weapons/s686-equip.png` | `exec-ada44e3a-eb65-43b0-b02e-4d2ed161c99c` | `assets/icons/shotguns/s686.png` |
| M870 短管型 | `assets/weapons/m870-breacher-equip.png` | `exec-044df2c2-8a2a-472d-a7fd-70ac70490886` | `assets/icons/shotguns/m870-breacher.png` |
| KSG-12 | `assets/weapons/ksg12-equip.png` | `exec-4e0823f8-b225-48f3-90a4-cee9e4986190` | `assets/icons/shotguns/ksg12.png` |
| SPAS-12 | `assets/weapons/spas12-equip.png` | `exec-6f368ae2-0c6d-4cd7-a0e2-7f463c57744b` | `assets/icons/shotguns/spas12.png` |
| AA-12 | `assets/weapons/aa12-equip.png` | `exec-c9832f07-5d93-4b28-a26b-8a47825c948f` | `assets/icons/shotguns/aa12.png` |
| Winchester 1887 | `assets/weapons/winchester1887-equip.png` | `exec-5a1b956d-706f-46b0-8aaf-62d3e0263040` | `assets/icons/shotguns/winchester1887.png` |
| 末日钟摆 | `assets/weapons/terminus-pendulum-equip.png` | `exec-89020e6c-82ba-4bd9-b11e-b681938b82e3` | `assets/icons/shotguns/terminus-pendulum.png` |
| 虚空葬潮 | `assets/weapons/void-funeral-tide-equip.png` | `exec-7b30ede9-065b-4c8b-b48d-00f5b3fca0e6` | `assets/icons/shotguns/void-funeral-tide.png` |
| 黑日圣裁 | `assets/weapons/black-sun-verdict-equip.png` | `exec-83f4bf87-4ec5-4e42-b66f-08fa1f77a67c` | `assets/icons/shotguns/black-sun-verdict.png` |
| 王猎终局 | `assets/weapons/royal-hunt-finale-equip.png` | `exec-8803d4e1-fd81-4198-9654-cfe348011d86` | `assets/icons/shotguns/royal-hunt-finale.png` |

原始 imagegen 输出仍可由上表 ID 在本任务的 Codex generated_images 目录追溯；仓库不重复保留烘焙棋盘格 `raw/`，正式运行时资产以 `assets/icons/shotguns/` 为准。BiRefNet 会把烘焙棋盘格误认作主体外缘，其失败对照未入库。

黑日圣裁原持枪图的渐变光晕与枪身 Alpha 连在一起，不能直接裁成塔载枪管；另以同一参考生成水平侧视源 `exec-b2e23e15-a8d3-40ce-bb4d-9eb1f2dc5c3d`，去除棋盘底后保存为 `black-sun-tower-side.png`，只用于生成 `assets/terrain/tower_barrel_weapon47.png`，不替换玩家持枪主体。
