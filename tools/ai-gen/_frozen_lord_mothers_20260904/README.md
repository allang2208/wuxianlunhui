# 雪原五领主母图候选（2026-09-04）

## 当前状态

- 本批只完成五张白底母图候选与战斗/状态机设计。
- `futurePlanOnly: true`
- `runtimeIntegrationActive: false`
- 尚未获得用户选稿批准；不得据此制作动画、精灵表、改怪物池或宣称实机通过。
- 五只领主分别沿用雪原现有五条“普通怪物 -> 精英怪物”生态链，不把旧 `blackWolf` 强行升格为新领主。

## 当前雪原怪物基线

雪原地牢当前仍保留旧 `blackWolf`，并已正式接入五只普通怪物与五只对应精英：

| 生态链 | 普通 | 精英 | 本批领主候选 |
| --- | --- | --- | --- |
| 猞猁 | `snowManeLynx` 雪鬃猞猁 | `iceCrownLynx` 冰冠猞猁 | `rimeMoonHuntKing` 凛月狩王 |
| 麝牛 | `frostbackMuskOx` 霜背麝牛 | `glacierbackWarOx` 冰脊战牛 | `glacierBastionKing` 冰川壁垒王 |
| 裂晶兽 | `abyssRimeBeast` 寒渊棘兽 | `abyssCrystalRavager` 寒渊裂晶兽 | `abyssRiftSovereign` 寒渊裂界王 |
| 霜缚军 | `frostboundSpearman` 霜缚矛卒 | `frostboundCenturion` 霜缚百夫长 | `frostboundHighWarlord` 霜缚大统领 |
| 极夜教团 | `polarNightCantor` 极夜祷徒 | `polarNightHighPriest` 极夜大司祭 | `polarNightAstralHierophant` 极夜司天祭主 |

当前 `frozenDungeonBeginner`、`frozenDungeonMid`、`frozenDungeon`（高级）的池中没有雪原专属 `rank: "lord"`，现有 `bossEncounter` 也没有 `lord` 槽位。本批没有改变这一点。

## 母图候选

1. `mother/01-rime-moon-hunt-king-v01.png`：凛月狩王，月蚀冠鬃与冰晶猎王轮廓。
2. `mother/02-glacier-bastion-king-v01.png`：冰川壁垒王，城垛额甲与六片背部冰垒。
3. `mother/03-abyss-rift-sovereign-v01.png`：寒渊裂界王，楔形头甲与八根主晶棘。
4. `mother/04-frostbound-high-warlord-v01.png`：霜缚大统领，重甲、覆面盔与单柄长戟。
5. `mother/05-polar-night-astral-hierophant-v01.png`：极夜司天祭主，日蚀仪环、法杖与祭钟。

共同画面契约：低饱和寒地 PBR、写实游戏怪物概念母图、白底、全身、面向画面右侧、3/4 侧视、足底完整、无文字、无边框、无场景地面、无多余角色。提示词归档见 `prompts.md`，战斗设计见 `design/frozen-lord-combat-and-state-machines.md`。

## 后续批准门槛

用户选定母图后，下一阶段才进行：方向复核 -> 动作关键帧设计 -> 动画视频/精灵表 -> 运行时配置与雪原地牢池接入。若进入动画阶段，必须重新执行项目动画前置规则，不能直接把本批身份母图当作移动方向参考。
