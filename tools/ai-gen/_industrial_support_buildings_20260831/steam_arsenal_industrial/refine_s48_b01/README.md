# 蒸汽军工厂 · 48步透明候选

已完成：选48步01，透明PNG `cutout/transparent.png` 为855×845 RGBA。仅为候选，未替换游戏资源。

来源：原模型revision3及Depth → 12步B01-03 → `../structure_local_correction_b01/correction_01_original.png` → 等比1024输入 → 同一Depth、48步、denoise0.30 → 48步01 → 透明处理。内置image_gen的原始修正、实际提示词和完整来源均保留，不把修正版冒充原12步raw。

局部修正恢复单飞轮及附着小气缸、竖向机械锻锤、材料箱旁小型加工机、宽四格侧窗、内折敞开的装卸门；保留箱上金属坯料和手工具，没有恢复旧桌面/桌腿。炉火收为局部内光。48步两张均已查看，01的齿轮锤徽记形状更接近模型、火光也更克制，故选01。

抠图key=(44,222,3)、soft75/120。右下绿幕阴影使用沿可见石沿外侧描出的有界多边形清除，然后仅在5px Alpha边缘修复RGB。较宽的HSV清除曾损伤个别材质点，已弃用；最终不使用该清除、不全体填洞，也不以旧Depth参与Alpha。11处主体材质采样保持不透明。原像素紧裁，四周4px透明边。

预览为`cutout/preview.png`与`cutout/background_alpha_preview.png`；完整参数见`cutout/config.json`和`cutout/production-record.json`。共享服务排队造成延迟，但两张原任务均正常完成，未取消或修改其他会话任务，未重复提交。

未修改原模型、正式资源、逻辑占格或运行时系统；源图石材表现和小道具间距仍有绘制差异。未运行测试或运行时验证，按约定由用户测试。
