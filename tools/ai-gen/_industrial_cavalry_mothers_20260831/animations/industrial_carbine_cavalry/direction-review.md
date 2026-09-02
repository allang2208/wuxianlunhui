# 近代骑枪兵动画方向说明

- 前置已重读 `SKILL.md` 索引、`skill/16b-animation-alignment-and-timing.md` 1.1节和 `tools/ai-gen/WORKFLOW.md` 3.6节。
- 身份母图：`../../mother/industrial_carbine_cavalry-mother-v02-cavalry-camera.png`；固定金橙仓鼠骑手、橘猫、软军帽、木托骑枪、弹带、鞍包、卷毯和收鞘军刀。
- 实际动作参考：`data/hamster-scout-rifle-skirmisher-config.json`，联系图来自共享方向目录。已查看idle 0/6/13/19/25、walk 0/5/10/15/19、attack 0/7/14/21/28、dying 0/12/24/36/48帧。
- 骑手与猫的头、胸胯、膝爪和移动轴保持略俯视三分之四右向；猫尾、四爪、鞍具、骑枪和军刀不得缺失或复制。
- `running-keyframe-v01.png` 是右向伸展步态；`attacking-keyframe-v01.png` 是猫四爪种地、骑手停稳后右向举枪。均已离线核对身份、方向和完整边距。
- H3合同：idle、running真循环；attacking必须停车后只开一枪并恢复，禁止移动射击；dying为骑手与坐骑共同向右侧倒地并保持。
