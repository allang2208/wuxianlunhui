# 恐怖地牢四款普通怪交付

状态：代码与正式素材已接入；未运行测试或运行时验证，按约定由用户测试。

| 怪物 | 配置键 | HP | 移速 | 主动作 |
|---|---|---:|---:|---|
| 棺板卫尸 | coffinWard | 240 | 90 | 棺板近战 |
| 裹尸囚徒 | shroudThrall | 170 | 125 | 近战抓击 |
| 掷骨殓徒 | ossuaryCaster | 120 | 135 | 蓄力转肩投骨镖 |
| 缚钟侍者 | knellAttendant | 190 | 105 | 近距离钟震 |

四者均为4级普通僵尸，以同级现有六维公式结算伤害，专属白名单限制在恐怖地牢高级/初级/中级既有8处池配置；不修改原波数、首领和rank筛选。主体以矿工僵尸139.515px可见身高对齐，碰撞沿用参照口径，不能用整张表的长宽比较体型。

## 正式素材与来源

| 怪物 | 正式动作表 | 已选视频/提示词及帧清单 | 配置时钟预览 |
|---|---|---|---|
| 棺板卫尸 | [coffin_ward](../assets/enemies/coffin_ward/) | [request](../tools/ai-gen/_horror_normal_mothers_20260830/animations/coffin-ward/request.json) | [GIF](../tools/ai-gen/_horror_normal_mothers_20260830/animations/coffin-ward/runtime/config-clock-preview.gif) |
| 裹尸囚徒 | [shroud_thrall](../assets/enemies/shroud_thrall/) | [帧清单](../tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/shroud-thrall/sprite-manifest.json) | [三怪GIF](../tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/delivery/three-monsters-runtime-clock.gif) |
| 掷骨殓徒 | [ossuary_caster](../assets/enemies/ossuary_caster/) | [帧清单](../tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/ossuary-caster/sprite-manifest.json) | 同上 |
| 缚钟侍者 | [knell_attendant](../assets/enemies/knell_attendant/) | [帧清单](../tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/knell-attendant/sprite-manifest.json) | 同上 |

- [统一母图与编辑链](../tools/ai-gen/_horror_normal_mothers_20260830/manifest.json)、[三怪选定视频目录](../tools/ai-gen/_horror_normal_mothers_20260830/animations/current-video-candidates.json)、[攻击版本选择](../tools/ai-gen/_horror_normal_mothers_20260830/animations/ATTACK_SELECTION.json)。
- [骨镖provenance](../tools/ai-gen/_horror_normal_mothers_20260830/projectile/ossuary-caster/projectile-manifest.json)：向右主轴、透明PNG，显示画布24px，碰撞半径3px；速度560，射程520，无追踪、无穿透。
- [体型对照图](../tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/delivery/size-reference.png)、[最终接入清单](../tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/runtime-manifest.json)。

## 可重建归档边界

保留6张母图/编辑祖先、16条选定源视频及生成元数据/提示词、16张当前未插帧源表、16张正式动作PNG与骨镖PNG、最终GIF与数值/帧布局/预算记录。淘汰视频、逐帧抠图、旧插帧表和重复生产预览不提交；历史生成记录里的日志、旧预览及废案路径只用于溯源，不是当前输入。

当前重建入口为 [tools/ai-gen/_horror_normal_mothers_20260830/animations/rebuild-runtime.py](../tools/ai-gen/_horror_normal_mothers_20260830/animations/rebuild-runtime.py)，从源表按原RIFE参数重建正式PNG和单动作GIF，不重新生成视频/抠图、不覆盖数值配置或接入状态。调用会运行GPU插帧，需显式发起素材重建；本次Git整理没有执行。早期build/install脚本为生产过程记录，仍保留已接入防覆盖门禁。

## 行为与限制

- 变时长帧数组驱动动作和命中/出手时点，不以统一平均帧率覆盖快速释放段。保留已批准的蓄力、转肩和手部换边。
- 修复切动作首帧脚点同步，死亡动画→留尸→淡出均保留显示、排序与资源驻留。骨镖显示/碰撞独立，对象池重置新字段。
- 掷骨殓徒H3源f43–44举手触顶，源裁切仍存在，不能宣称修复。RGBA估算棺板56.84、囚徒50.51、殓徒55.55、侍者41.21MiB，均低于本批64MiB准入但高于32MiB目标；四怪同场合计约204.11MiB，最终性能由实机确认。
- 用户重点验证：三档地牢出怪、左右朝向出手、伤害/格挡/恐惧和硬控中断、切动作脚点、死亡完整淡出及大量同场时表现。未运行任何测试、构建或游戏验证。
