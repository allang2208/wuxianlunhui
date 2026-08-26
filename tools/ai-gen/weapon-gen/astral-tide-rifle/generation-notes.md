# 星潮协议贴图生成记录

- 生成方式：Codex 内置 ImageGen 生成原创整枪原稿；未输入第三方参考图。
- 设计提示摘要：横向右朝向的未来相位自动步枪，完整枪身与枪口均在画面内；石墨黑、磨损象牙白装甲、少量黄铜结构，机匣上方三段青色相位电容与枪管侧面蓝金能量通道；轮廓、枪托、弹匣、护木与分叉枪口均为原创，不含文字、商标、编号、阵营标记、人物、弹丸或枪口火焰；纯色背景，适合游戏装备贴图抠图。
- 原始输出：`astral-tide-rifle-imagegen-raw.png`。
- 透明化：`finalize-assets.py` 调用项目 BiRefNet 抠图入口，保留软透明边缘并清理背景。
- 透明中间稿：`astral-tide-rifle-imagegen-alpha.png`。
- 运行时装备图：`assets/weapons/astral-tide-rifle-equip.png`，2048×2048 RGBA，横向构图。
- 装备栏/背包图：`assets/icons/firearms/astral-tide-rifle.png`，1536×1536 RGBA，斜置构图并加神话青金轮廓光。
- 版式参数与武器数值真源草案：`tools/ai-gen/weapon-specs/astral-tide-rifle.json`。
