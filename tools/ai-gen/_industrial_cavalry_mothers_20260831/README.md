# 近代骑兵学院 · 第4批母图已确认

本轮按用户“看一下现在骑兵单位的视角，还有朝向，再做一下精准调”，只调整两张近代骑兵母图的镜头与朝向。保留已经确定的装备设计：木托骑枪，以及取消爆炸装置后的精致传统长矛。

2026-08-31用户“完成了，然后参考整个条线的士兵，先设计数值”后，当前骑枪兵视角v02、重骑兵视角v03均记为母图通过。数值另见[四时代九条兵线数值调整v4](../../../docs/industrial-unit-balance-design-2026-08-31.md)：2026-09-01按用户反馈回调16种I/II的基础战斗值与招募经济，两种炮兵沿用v3，IV保持不变；优先保证对普通僵尸的基础对抗能力，不再强制每人口效率逐级上升。III传统重骑调整到930生命、160/2.2秒、17秒冲锋384直击，仍无爆炸；两种III骑兵尚未制作动画或接入运行时，母图批准状态不变。

| 升级线 | 当前III级母图 | 保留的身份与装备 |
|---|---|---|
| 仓鼠骑兵 → 近代骑枪兵 → 仓鼠侦察游骑兵 | [骑枪兵视角v02](mother/industrial_carbine_cavalry-mother-v02-cavalry-camera.png) | 橘猫、软军帽、木托骑枪、弹带、鞍包、卷毯及收鞘军刀 |
| 仓鼠翼骑兵 → 近代重骑兵 → 仓鼠动力爆矛重骑兵 | [重骑兵视角v03](mother/gunpowder_explosive_lancer-mother-v03-cavalry-camera.png) | 银灰猫、钢盔胸甲与猫甲、红色鞍毯；刻纹钢矛尖、细铜箍、木杆和皮革握段，无爆炸装置 |

[视角对照：现有参考→修改前→校准稿](camera-comparison.html) · [II→III→IV升级对照](comparison.html) · [当前来源索引](task-index.json)

## 视角依据与边界

已直接查看现有仓鼠轻骑、仓鼠骑兵及翼骑兵的idle图集，源图均朝右。再用既有轻骑/骑士放大单帧控制略俯视的三分之四投影，主要调整帽盔顶、肩背、鞍座可见面、头身朝向及四足前后关系。重骑另以本次轻骑v02作为镜头一致性参考，不复制其橘猫、衣帽或枪械。

原35°/8°仅是旧生图提示词目标，未做相机数值测量；当前不把它们当作校准证据。两张当前母图已由用户确认，但没有通过单张图片精确反求相机角度，也没有完成实机等身高、脚点或碰撞标定。对照页保持源图留白，不以整张图块的高宽宣称人物体量一致。

## 实际输入与提示词

- 轻骑v02：[实际提示词](prompts/industrial_carbine_cavalry-v02-cavalry-camera.txt)。直接编辑源为mother/industrial_carbine_cavalry-mother-v01.png及其prompts/industrial_carbine_cavalry-v01.txt；辅助输入references/light-cavalry-existing-camera.png。
- 重骑v03：[实际提示词](prompts/gunpowder_explosive_lancer-v03-cavalry-camera.txt)。直接编辑源为mother/gunpowder_explosive_lancer-mother-v02-refined-lance.png及其prompts/gunpowder_explosive_lancer-v02-refined-lance.txt；辅助输入references/knight-existing-camera.png和本次轻骑v02母图。
- 两张既有单帧直接复制自旧母图档案references/，未重新裁切/重画。原始路径、生成工具输出路径和输入顺序均记录在索引。II/IV母图与历史提示词保持不变。
- 重骑来源链仍保留：爆矛v01 → 精致传统长矛v02 → 视角v03。爆矛v01仅是编辑祖先，不是当前设计；不恢复爆炸攻击。

使用内置image_gen，模型名称/seed未公开。两次提示词均要求约1254×1254方图；输出原样复制至mother/，未手工变形、重着色、抠图或拼精灵表。原始生成文件保留。

## 设计与后续开发

初版近代方向参考[EA骑兵介绍](https://www.ea.com/es-mx/games/battlefield/news/battlefield-1-horses-overview)与[EA长矛骑兵介绍](https://www.ea.com/games/battlefield/news/ride-with-the-legendary-hussars-in-battlefield-1)的文字，未下载或输入外部截图。本轮只使用本项目图片，不宣称历史装备精确复刻。

两张均为accepted=true，保持futurePlanOnly=true、runtimeIntegrationActive=false。III级重骑兵取消爆炸攻击计划；索引与文件沿用gunpowder_explosive_lancer稳定占位键以对应来源，展示名为“近代重骑兵”。正式开发再同步原占位名称/说明，IV级动力爆矛不在本次修改范围。母图批准不代表数值草案、动画或实机验收通过。

后续仍按crowd档（目标32MiB、准入64MiB）和骑兵179.765625世界像素有效身体基准处理。须按实际动作bodyH/footF重新标定，不套用步兵75.684px，不直接复用旧displaySize，也不按长武器撑大的整图Alpha框定人物高度。本轮没有调整游戏镜像、脚点、碰撞、数值、AI或生产。

上一批制式步枪兵v01、单人BAR双肩包v06已通过，不改图。八种近代步兵/骑兵母图均已通过，仅近代炮兵组母图未制作；九种近代单位动画与运行时仍未开发。新增数值草案参考整条I/II/IV兵线，包含六维、生命、防御、普攻/技能、招募成本、人口和升级适用范围；炮兵只列暂定值。

未运行测试或运行时验证，按约定由用户测试；未构建、启动游戏、运行浏览器/CDP、同步EXE、提交或推送。
