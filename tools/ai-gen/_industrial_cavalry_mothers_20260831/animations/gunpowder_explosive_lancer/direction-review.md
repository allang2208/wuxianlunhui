# 近代重骑兵动画方向说明

- 前置已重读 `SKILL.md` 索引、`skill/16b-animation-alignment-and-timing.md` 1.1节和 `tools/ai-gen/WORKFLOW.md` 3.6节。
- 稳定内部键保留 `gunpowder_explosive_lancer` 以延续母图来源；正式身份是传统长矛近代重骑兵，无爆炸或动力装置。
- 身份母图：`../../mother/gunpowder_explosive_lancer-mother-v03-cavalry-camera.png`；固定装甲仓鼠、银灰虎斑装甲猫、红鞍毯和刻纹钢矛尖/铜箍/木杆/皮革握段。
- 实际动作参考：`data/hamster-winged-hussar-config.json`，联系图来自共享方向目录。已查看idle 0/12/24/36/47、walk 0/4/9/13/17、attack 0/10/21/30/38、dying 0/10/20/30/38帧。
- 骑手、猫和长矛全程保持略俯视三分之四右向；不得出现翼架、火箭、炸药、爆炸、烟火或参考图旗帜。
- `running-keyframe-v01.png` 为右向重骑步态；`attacking-keyframe-v01.png` 为猫右向承重、骑手压低传统长矛的突刺/冲锋起姿。均已离线核对身份、方向和完整边距。
- H3合同：idle、running真循环；attacking为一次传统突刺后恢复；charging为一次右向加速冲锋并保持长矛压低，无爆炸；dying为骑手与坐骑共同向右倒地并保持。
