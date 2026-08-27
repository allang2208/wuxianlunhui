# 技能配置 / 运行时 / 详情 / 经验静态对照（2026-08-25）

本次对照以 `data/skills.json` / `public/data/skills.json` 的 `effectFormula` 与 `expRewards` 为配置入口，逐项核对运行时系统的 `skill.getEffect(level)` 消费、`SkillManager.renderSkillDetail()` 展示及修炼经验入口。两份技能配置内容一致。此文档是静态证据，不代替游戏运行时验收。

| 技能 | 运行时结算入口 | 详情 / 经验结论 |
|---|---|---|
| 剑精通 | `attack.js`、`attack-formula.js` | 读取当前 `effect`；命中、多目标、击杀奖励与配置一致 |
| 冲刺攻击 / 火 / 突刺 | `dash-system.js` | 三变体保留各自效果，等级经验共享；详情按当前变体公式与真实范围显示 |
| 风车 | `whirlwind-system.js` | 伤害与范围读取共享效果；修正 `stunDuration`、剑类/锻造范围及击杀经验 |
| 推击 | `push-strike-system.js`、`skill-formulas.js` | 战斗与详情共用固定值加力量纯函数；命中、多目标、击杀经验一致 |
| 暴击 | `damageable-entity.js` | 暴击率/伤害链与详情读取当前效果；暴击和暴击击杀奖励一致 |
| 机枪 / 步枪 / 手枪 / 霰弹枪 / 弓精通 | `attack-formula.js`、`damageable-entity.js` | 属性、百分比与武器分类读取当前效果；各自击杀/暴击/命中奖励与配置一致 |
| 冰锥 / 火球 | `bolt-skill-system.js` | 基础值、魔攻、智力、数量/范围/冷却/MP 与详情同源；多目标/多击杀奖励一致 |
| 持盾防御 | `shield-system.js` | 防御加成、额外减伤、弹反硬直读取当前效果；详情区分承伤比例与额外减伤，明确远程不眩晕、近战反制 |
| 夜与火之剑 | `special-attack-system.js` | 光束、持续伤害、MP/冷却读取当前效果；命中/击杀奖励一致 |
| 闪电 / 雷暴领域 / 贯穿雷枪 | 对应 `lightning-strike`、`storm-domain`、`thunder-lance` 系统 | 伤害、传导、感电、蓄力、资源与详情读取当前效果；经验入口与配置一致 |
| 圣光 / 圣辉领域 / 圣光审判 | 对应 `holy-light`、`sanctuary-domain`、`holy-judgment` 系统 | 伤害、治疗、僵尸倍率、蓄力与净化读取当前效果；命中/治疗/击杀奖励一致 |
| 冰墙 / 暴风雪 | 对应 `ice-wall`、`blizzard` 系统 | 伤害、段数/范围、持续、寒冷、MP/冷却读取当前效果；经验入口与配置一致 |
| 无人机 | `drone-system.js`、`skill-formulas.js`、`damageable-entity.js` | 部署与详情共用快照纯函数；补齐 MP、冷却、两级范围、全队易伤/暴击、离圈残留和击杀经验 |
| 陨星坠落 / 灼锋焰甲 | 对应 `meteor`、`flame-armor` 系统 | 爆炸/熔岩与附伤/光环公式读取当前效果；命中、多目标、多击杀奖励与配置一致 |

## 本轮消除的漂移

- 风车详情不再误读不存在的 `stunMs`；实际范围通过 `getWhirlwindRadius()` 与运行时共用。
- 推击的伤害、冷却、体力、距离、击退、硬直及时间点全部通过 `getPushStrikeValues()` 共用。
- 无人机持续、资源、速度、侦察圈、标记圈、易伤与暴击通过 `getDroneValues()` 在部署时快照，详情读取同一函数。
- 下一级行在渲染后与当前同名值比较；数值未变化的行不显示。
