# 制式步枪兵动画方向说明

- 前置已重读 `SKILL.md` 索引、`skill/16b-animation-alignment-and-timing.md` 1.1节和 `tools/ai-gen/WORKFLOW.md` 3.6节。
- 身份母图：`../../mother/service_rifleman-mother-v01.png`；固定金橙毛、红星钢盔、卡其军服和SVT-40风格木托步枪。
- 实际动作参考：`data/hamster-assault-config.json`，联系图来自 `tools/ai-gen/_industrial_four_units_20260902/direction-references/service_rifleman-*-contact.png`。已查看idle 0/6/12/18/23、walk 0/5/10/15/19、attack 0/10/22/30/40、dying 0/8/15/23/30帧。
- 目标始终为略俯视三分之四右向：鼻尖、胸、胯、膝、脚尖及步轴朝屏幕右侧；步枪不换手、不翻面、不增生。
- `running-keyframe-v01.png` 为同角色右向跨步；`attacking-keyframe-v01.png` 为双脚种地、枪托抵肩的右向单发起姿。两张均通过离线身份、朝向、完整边距检查。
- idle与dying从同角色批准姿势起步；死亡目标参考最后三帧，单向倒向屏幕右侧并保持，不恢复。母图/关键帧只等比缩放和白底补边到1024×576，记录见共享 `video-reference-report.json`。
- H3合同：idle、running为真循环；attacking只射一发并恢复；dying为单向死亡。原视频方向或身份失败时不得进入抠图与RIFE。
