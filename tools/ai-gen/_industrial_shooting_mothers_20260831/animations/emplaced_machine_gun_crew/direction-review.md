# BAR自动步枪兵动画方向说明

- 前置已重读 `SKILL.md` 索引、`skill/16b-animation-alignment-and-timing.md` 1.1节和 `tools/ai-gen/WORKFLOW.md` 3.6节。
- 稳定内部键仍为 `emplaced_machine_gun_crew`，正式身份是单人BAR自动步枪兵，不是双人阵地机枪组。
- 身份母图：`../../mother/emplaced_machine_gun_crew-mother-v06-backpack.png`；固定单人金橙毛、红星钢盔、BAR、帆布双肩弹药包及肩胸携行弹链。弹链不接枪，无电台、天线或硬箱。
- 实际动作参考：`data/hamster-heavy-machine-gunner-config.json`，联系图来自共享方向目录。已查看idle 0/6/12/18/25、walk 0/5/11/16/21、attack 0/15/23/39/60、dying 0/9/17/26/34帧。
- 鼻尖、胸胯、膝脚和移动轴全程朝屏幕右侧；背包双肩带、弹链与BAR不得换边、断开或复制。
- `running-keyframe-v01.png` 为同角色负重右向跨步；`attacking-keyframe-v01.png` 为双脚种地、BAR抵肩的右向三发点射起姿。均已离线核对身份、方向及边距。
- H3合同：idle、running真循环；attacking只做三发点射并完全恢复；dying单向倒向右侧并保持。视频不合格不得进入后处理。
