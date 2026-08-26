# 零点仲裁贴图生成记录

- 生成方式：Codex 内置 ImageGen 生成原创整枪母图；未输入或描摹第三方参考图。
- 原创方向：深海军蓝陶瓷、暗钛骨架、洋红悬浮棱镜与琥珀校准灯；分叉骨架枪托、长护木和棱镜笼均为原创组合，不含商标、编号、文字、人物、导弹或榴弹结构。
- 原始输出：`zero-point-arbitrator-imagegen-raw.png`，ImageGen 已提供透明 Alpha。
- 处理脚本：`finalize-assets.py` 读取原生透明边缘，完成 Alpha 包围盒裁切、运行时方形画布、背包斜置构图、神话洋红轮廓光以及防御塔枪管裁切。
- 运行时装备图：`assets/weapons/zero-point-arbitrator-equip.png`，2048×2048 RGBA。
- 装备栏/背包图：`assets/icons/firearms/zero-point-arbitrator.png`，1536×1536 RGBA。
- 防御塔枪管图：`assets/terrain/tower_barrel_weapon28.png`，625×300 RGBA。
