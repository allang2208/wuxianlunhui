# 近代炮兵工坊 · 48步透明候选

已完成：选48步01，透明PNG `cutout/transparent.png` 为875×688 RGBA。仅为候选，未替换游戏资源。

来源：原模型及Depth → 标准12步B01-03 → 同一Depth、标准48步、denoise0.30 → 48步01 → 透明处理。未使用局部生成修图。三张12步和两张48步完整原图均已查看，选稿理由在两阶段manifest及`selection.json`中。

保留双采光窗、开放装配门、左钢吊架及轮轴料件、短装配导轨、右工具台和挂具。48步02的桌面道具更像炮管，故保留01。生成图的石砌墙脚比模型更突出，属于待用户确认的材质表现；未改变源模型或运行时几何。

抠图key=(41,231,6)，soft60/115，距Alpha边缘5px内去绿；7处主体材质采样保持不透明。深色门内空间作为主体保留，不抠除、不填洞，也不用旧Depth参与Alpha。原像素紧裁，四周4px透明边。

预览为`cutout/preview.png`和`cutout/background_alpha_preview.png`；参数与命令见`cutout/config.json`、`cutout/production-record.json`。未运行测试或运行时验证，按约定由用户测试；未接入游戏或标定游戏内显示尺寸。
