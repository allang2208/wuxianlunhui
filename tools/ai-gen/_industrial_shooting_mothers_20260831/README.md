# 近代射击学校 · 第3批已确认母图

2026-08-31用户“通过继续骑兵的生图，可以参考经典游戏战地一的骑兵单位”：当前制式步枪兵v01、单人BAR双肩包v06均通过。仅更新批准状态，两张图和原有来源链不变。

用户希望将硬质弹药箱改为斜挎包或双肩包。本轮选择帆布双肩弹药背包，以v05为直接输入生成v06，保留肩胸弹链；BAR、站姿、原计划射手及IV级重机枪均不动。

| 单位 | 当前母图 | 状态 |
|---|---|---|
| 制式步枪兵 service_rifleman | [SVT-40 v01](mother/service_rifleman-mother-v01.png) | 原计划射手不变 |
| 原阵地机枪组 emplaced_machine_gun_crew | [单人BAR双肩包版v06](mother/emplaced_machine_gun_crew-mother-v06-backpack.png) | 帆布双肩弹药背包、翻盖/皮扣/侧袋与肩胸弹链；仍为一名苏式仓鼠双手持BAR |
| IV级重机枪兵 heavy_machine_gunner | [原IV级母图](references/heavyMachineIV.png) | 保持原图；撤销误改的IV级BAR稿 |

[当前对照页](comparison.html)中间III级列为制式步枪兵v01和单人BAR双肩包版v06；右侧IV级重机枪恢复原现代弹链机枪。不要再将IV级重机枪列为本次换枪对象。

当前两张III级母图均为accepted=true、futurePlanOnly=true、runtimeIntegrationActive=false，处于mother_approved_awaiting_animation。单位键和正式名称尚未改变。单人BAR替换双人画面，不代表游戏人口数值已调整；正式开发时再同步原“架设机枪”占位说明以及移动/射击/换弹动作。

## 来源与保留文件

制式步枪兵沿用此前内置image_gen原图；本轮同工具生成单人BAR双肩包版v06，原样复制入母图目录，不另行编辑像素。实际提示词为[制式步枪兵v01](prompts/service_rifleman-v01.txt)和[双肩包版BAR v06](prompts/emplaced_machine_gun_crew-v06-backpack.txt)。[task-index.json](task-index.json)是当前选图与来源索引。

编辑链为双人马克沁v01→单人BAR v02→v03→电台v04→硬箱v05→帆布双肩包v06。v05是v06唯一直接图像输入；当前图无硬质金属箱或通讯设备。所有直接编辑祖先与提示词保留，当前活动机枪图只有v06。IV级BAR误改目录已标记rejected_wrong_target、active=false，不用于后续制作或活动对照；原IV级正式母图及运行时四动作一直未改。

references/保留实际生成输入，不能用新选图覆盖历史参考。火枪兵对照仍是原idle图集第0帧（512×512、8列3行），仅CSS显示单格，不重绘/提取图片，不用于生成。

BAR外观文字依据沿用此前[勃朗宁官方历史](https://www.browning.com/news/articles/historical/inside-story-bar-john-m-browning-automatic-rifle.html)；SVT-40参考[皇家军械博物馆馆藏介绍](https://royalarmouries.org/objects-and-stories/stories/gendering-the-armouries)。网页未作为生图输入，枪械仅作游戏美术表达，具体部件不声称工程精确复刻。

## 开发边界

未制作新动画，未改正式assets、AI、战斗数值、人口、生产或存档。后续使用crowd档（整套目标32MiB、准入64MiB），身体按仓鼠牧师基准，武器与双肩背包不计入身体有效高度，后续不得直接按整图Alpha包围盒缩放人物。背包和弹链仅为携行装备外观；弹链不连接BAR，不改成弹链供弹，也不新增容量、补给或战斗技能。后续动画需处理帆布背包/肩带/弹链的随动及持枪遮挡。未做像素、预算或运行时尺度验证。第4批两种骑兵已生成首版候选，见[骑兵对照](../_industrial_cavalry_mothers_20260831/comparison.html)；仅近代炮兵组母图尚未制作。

未运行测试或运行时验证，按约定由用户测试；未构建、启动游戏、运行浏览器/CDP、同步EXE、提交或推送。
