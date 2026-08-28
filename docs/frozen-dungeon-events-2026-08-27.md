# 雪原地牢 C/B/A 随机事件设计（2026-08-27）

## 等级与抽取契约

- 雪原地牢按 C → B → A 三档成长，本批限定事件每档 5 个，统一使用 `scope: 'frozen'`。
- 继续遵守“当前地牢等级 ±1”限定事件筛选，以及通用事件 30% / 地牢限定事件 70% 的两段抽取规则；本批没有修改抽取器。
- 每个事件提供 4 个选项：3 个与现场行为直接相关的属性判定，以及 1 个无判定叙事选项。每档5个事件中有4个末项会付出生命/魔力/三场减益代价或直接进入战斗，1个末项安全离开或因善意获得小型确定奖励。
- 15个雪原事件权重均为1；C、B、A各自保持4:1，因此单档和“当前等级±1”混合池中，末项均为80%非安全、20%安全或奖励，而不是只在全表总数上满足比例。
- 雪原三级已按 `frozenBeginner`（C）→ `frozenMid`（B）→ `frozen`（A）登记并逐级解锁。C级池可抽C/B事件，B级池可抽C/B/A全部事件，A级池可抽B/A事件。

## 地牢基本生成配置

| 层级 | type / 配置块 | 路线节点 | 战斗/事件 | 最短战斗路径 / Boss前最少房间 | 竞技场 | 通关基础金币 |
| --- | --- | ---: | ---: | ---: | --- | ---: |
| 初级 C | `frozenBeginner` / `frozenDungeonBeginner` | 55—60 | 50% / 50% | 5 / 7 | 沿用C级规则：普通3房、精英5房 | 8000 |
| 中级 B | `frozenMid` / `frozenDungeonMid` | 60—65 | 50% / 50% | 6 / 8 | 普通与精英均为5房、2行蛇形 | 13000 |
| 高级 A | `frozen` / `frozenDungeon` | 65—70 | 50% / 50% | 7 / 9 | 普通与精英均为5房、2行蛇形 | 20000 |

B/A的竞技场显式覆盖 `normalRoomCount=5` 与 `eliteRoomCount=5`；实际波次、末房宝箱、门控和出口继续读取 `arena.rooms.length`。奖励不在地牢配置重复硬编码结算值，实际清剿奖、Boss奖、通关奖、宝箱及事件倍率统一按 `combat-formulas.json#dungeonRewards[B/A]` 与对应宝箱表读取。

本阶段不登记雪原正式怪物或Boss。B/A普通、精英与Boss遭遇暂时全部用已经登记的 `blackWolf` 工厂作可运行占位，且不启用阶级匹配；它只用于验证路线生成、五房竞技场、门控、宝箱与Boss节点流程，后续雪原怪物完成后必须整体替换，不能把黑狼占位视为正式生态。

## 事件清单

| 档位 | 事件键 | 标题 | 三个判定方向 | 背景图 |
| --- | --- | --- | --- | --- |
| C | `frozenWaystone` | 冰封路标石 | 听霜辨路 / 转动石柱 / 无痕雪径取供物 | `frozen-waystone.png` |
| C | `snowboundSupplySled` | 雪埋补给橇 | 掘出货橇 / 检查冻裂补给 / 卸下制动销 | `snowbound-supply-sled.png` |
| C | `singingIceBridge` | 鸣冰桥 | 踏音过桥 / 测绘冰裂 / 迎风伏渡 | `singing-ice-bridge.png` |
| C | `lostExpeditionCamp` | 失温远征营地 | 重建拖痕 / 修复石炉 / 搜索队长箱 | `lost-expedition-camp.png` |
| C | `frostberryHollow` | 霜莓冰窟 | 辨认药莓 / 体质试果 / 躲避冰锥采摘 | `frostberry-hollow.png` |
| B | `trappedWhiteStag` | 冰索白鹿 | 安抚白鹿 / 扯断猎索 / 寻找猎人护符 | `trapped-white-stag.png` |
| B | `auroraIceLanterns` | 极光冰灯阵 | 同步灯阵 / 校正折射镜 / 接取光晶 | `aurora-ice-lanterns.png` |
| B | `avalancheWatchtower` | 雪崩瞭望塔 | 分段泄雪 / 登塔修标 / 重置警铃配重 | `avalanche-watchtower.png` |
| B | `frostboundCaravan` | 冰封商旅 | 撬开货箱 / 控温融封 / 探查车底暗格 | `frostbound-caravan.png` |
| B | `whisperingGlacierCrevasse` | 低语冰隙 | 分离回声 / 垂降取箱 / 顶住寒雾探路 | `whispering-glacier-crevasse.png` |
| A | `frozenChapel` | 冻结祈祷堂 | 回应守护意志 / 还原冻结壁画 / 击碎圣物锁链 | `frozen-chapel.png` |
| A | `iceFisherHole` | 无底冰钓孔 | 判断冰下水流 / 绞盘收链 / 投放发光诱饵 | `ice-fisher-hole.png` |
| A | `blizzardSignalBrazier` | 暴雪烽火盆 | 配制风暴燃料 / 守住火种 / 修复高速风板 | `blizzard-signal-brazier.png` |
| A | `crystalPrison` | 寒晶囚笼 | 与寒灵沟通 / 剥离外层晶体 / 导出封印溢能 | `crystal-prison.png` |
| A | `ancientIceObservatory` | 古冰观星台 | 校准星环 / 读取极光征兆 / 选择坠入锁匣的星辉 | `ancient-ice-observatory.png` |

## 无检定末项的风险分布

| 档位 | 安全/奖励事件 | 付出代价 | 进入战斗 |
| --- | --- | --- | --- |
| C | 冰封路标石：沿原路安全离开 | 雪埋补给橇：10%生命；鸣冰桥：10%生命与三场移速-10% | 失温远征营地：普通；霜莓冰窟：普通 |
| B | 冰索白鹿：获得三场防御/移速+10%的“白鹿善意” | 极光冰灯阵：10%生命、15%魔力与三场魔攻-10%；低语冰隙：15%生命与三场移速-15% | 雪崩瞭望塔：普通；冰封商旅：精英 |
| A | 冻结祈祷堂：合掌安全离开 | 寒晶囚笼：15%生命、20%魔力与三场魔攻-15%；古冰观星台：20%生命与三场防御-15% | 无底冰钓孔：精英；暴雪烽火盆：普通 |

这些末项仍然不进行属性检定，结果由事件本身确定。战斗项不写 `forceMonsters`，继续按当前雪原地牢和战斗等级的怪物池抽取，避免绕过题材池；危险均由场景中已有的不稳定机关、踪迹、阴影或封印提供叙事铺垫。

## 概率与奖励曲线

实际成功率继续走全局公式 `baseRate + 属性值 × attrMultiplier`，并应用 5%—95% 软上下限。下表是每档三个判定选项的基础值，不是最终成功率。

| 档位 | 三个基础判定值 | 成功奖励定位 | 失败代价定位 |
| --- | --- | --- | --- |
| C | 35% / 30% / 25% | 实得约 300—720 金币、1 枚强化石或 1 张改造券、50 魔尘、15% 级三场增益、路线揭示和基础补给 | 15%—25% 当前生命伤害、15%—20% 魔力损失、小型三场减益，少量分支触发 5 只黑狼 |
| B | 30% / 25% / 20% | 实得约 600—1080 金币、2 枚强化石或 2 张改造券、75 魔尘、15%—20% 三场增益、较深路线揭示 | 20%—30% 当前生命伤害、更明显三场减益，少量分支触发 6 只黑狼 |
| A | 25% / 20% / 15% | 实得约 720—1560 金币、2—3 枚强化石、2—3 张改造券、75—100 魔尘、20% 级三场增益、强恢复和深层揭图 | 25%—35% 当前生命伤害、20%—30% 魔力损失或 20% 级三场减益；无检定末项另按本档4危险:1安全结构结算 |

设计目的：C 档让均衡成长角色能稳定参与探索；B 档要求开始依赖擅长属性；A 档的高价值分支基础值最低，但属性成长仍可持续提高概率，并受全局软上限约束而不会必定成功。

金币范围是按实际地牢等级结算后的数值：雪原 C/B/A 当前均使用 6 倍限定事件金币倍率；配置中的小范围仍作为事件内部高低价值关系的作者基础值。

## 背景图生成合同与提示词集

15 张背景均使用 Codex 内置 ImageGen 独立生成，保存为 1536×1024、3:2 PNG。共同提示词合同为：`dark realistic painterly fantasy game event background, frozen tundra dungeon, cold blue-gray palette, cinematic natural lighting, one clear midground event subject, environmental storytelling, no characters dominating the frame, bottom 25 percent kept quiet and low-detail for decision UI, no text, no logo, no watermark, 3:2 composition`。

逐图主体提示词如下；每条均与上述共同合同组合使用：

1. `three frost-covered rotating waystones at a blizzard crossroads, distorted direction grooves, old offering pouch, distant wolf silhouettes`
2. `half-buried wooden supply sled on an icy slope, broken tow bar, sealed cargo boxes, taut brake pin above a crevasse`
3. `natural blue ice bridge over a deep glacier chasm, resonating cracks, frozen ropes and test holes visible inside the ice`
4. `abandoned hypothermia expedition camp, collapsed tents around a dead stone stove, frozen maps and confusing drag marks, no bodies`
5. `sheltered ice cave filled with luminous deep-blue frostberries, hanging icicles, apothecary spoon and bottles, suspicious spotted berries`
6. `silver-white stag trapped by frozen hunter cable among ice-coated fir trees, aurora fragments on antlers, approaching wolf tracks`
7. `seven transparent carved ice lanterns reflecting an aurora, adjustable lenses and a frozen bronze axis forming a ritual light array`
8. `half-buried timber and stone avalanche watchtower, ridge snow fences, depth gauge, spinning wind vane and failing alarm counterweight`
9. `three merchant wagons and pack-animal remains frozen inside solid blue ice at a mountain bend, guild seals and circling wolf tracks`
10. `deep blue-black glacier crevasse with layered whispering ice walls, old rappel rope, metallic explorer cache and rising cold mist`
11. `small stone chapel completely entombed in clear ancient ice, frozen pews and silver lamps, altar emblem and chained reliquary`
12. `perfectly round bottomless ice-fishing hole, black water, heavy silver chain and frozen winch, luminous bait box, huge shadow below`
13. `monumental bronze signal brazier on a blizzard mountain pass, wet fuel, whale-oil jars, frozen wind shutters and distant beacon line`
14. `six giant blue crystal pillars forming a prison around a suspended beast-shaped frost spirit, glowing seals and crystal deposits`
15. `ancient circular observatory atop a glacier, rotating bronze star rings around an upward-facing ice mirror, aurora scales and meteor fragments`

所有图片最终路径均为 `assets/scenes/dungeon-events/<背景图文件名>`，并由 `EVENT_BG_IMAGES` 显式登记。
