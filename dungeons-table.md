# 地牢要素一览表

> 由 `scripts/generate-dungeons-table.mjs` 生成，数据源 `data/dungeon-config.json`（+ `data/agent-invasion.json`）。新增/修改地牢后重新运行脚本更新本表。

| 地牢 | 等级 | 房间数 | 起始路线 | 战斗/事件 | 精英战斗 | 最短路径战斗 | 主通道强制战斗 | 到Boss最少房间 | 宝箱岔路 | 普通战斗构成 | 精英战斗构成 | Boss | 精英宝箱 | 时空特工入侵 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| ☠ 僵尸地牢高级 | D | 45~50 | 4 条 | 50% / 50% | 35% | 5 场 | 全部列 | 7 间 | 6 条（2~3 节点，1 战斗 50% 精英，尽头宝箱） | 3 波×5（normal 100%） | 3 波×5（elite×1+normal×5） | 专属 Boss（BossRewardSystem 集合体） | — | 25% 起，每 2 回合 +5%，特工×1 |
| ☠ 僵尸地牢-初级 | F | 22~27 | 3 条 | 40% / 60% | 0% | 4 场 | 3 列 | 6 间 | 2 条（2~3 节点，1 战斗 50% 精英，尽头宝箱） | 3 波×5（normal 100%） | —（不刷） | 独立遭遇（elite×1 + normal×5） | — | — |
| ☠ 僵尸地牢-中级 | E | 30~35 | 3 条 | 50% / 50% | 40% | 4 场 | 全部列 | 6 间 | 4 条（2~3 节点，1 战斗 50% 精英，尽头宝箱） | 3 波×5（normal 100%） | 1 波×6（elite×1+normal×5） | 独立遭遇（lord×1），限定僵尸类 | — | — |
| ☠ 沼泽地-高级 | C | 55~60 | — | 50% | — | — 场 | 全部列 | 2 间 | 8 条（2~3 节点，1 战斗 50% 精英，尽头宝箱） | 3 波×5（normal 80% / elite 20%） | 1 波×6（elite×1+normal×5） | 专属 Boss（BossRewardSystem 集合体） | — | 25% 起，每 2 回合 +5%，特工×2 |

## 等级公共要素（按地牢 grade 自动获得）

| 等级 | 出征门槛祭品 | 祭品掉落封顶 | 普通怪祭品掉率 | 限定事件池（±1 级） |
|---|---|---|---|---|
| F | 普通及以上 | 稀有 | 2% | collapsedArchway(F)、undeadScholarNotes(E)、mistyCrossroad(E)、poisonMushroomCircle(F) |
| E | 优质及以上 | 史诗 | 2.5% | collapsedArchway(F)、undeadScholarNotes(E)、bloodAltar(D)、mistyCrossroad(E)、cursedArmor(D)、poisonMushroomCircle(F)、blessedFountain(D) |
| D | 稀有及以上 | 传说 | 3% | undeadScholarNotes(E)、bloodAltar(D)、mistyCrossroad(E)、cursedArmor(D)、abyssalGambler(C)、blessedFountain(D)、lockedArmory(C) |
| C | 史诗及以上 | 传说 | 3.5% | bloodAltar(D)、cursedArmor(D)、abyssalGambler(C)、blessedFountain(D)、lockedArmory(C)、phantomMirror(B) |
| B | 神话及以上 | 传说 | 4% | abyssalGambler(C)、lockedArmory(C)、phantomMirror(B) |
| A | 传说及以上 | 传说 | 4.5% | phantomMirror(B) |

## 说明

- **房间数**：含起点/战斗/事件/Boss/奖励节点，不含宝箱岔路（岔路另计）；`min~max` 为生成浮动区间。
- **最短路径战斗**：主通道强制战斗节点数（shortestCombatPath）。
- **主通道强制战斗**：mainRowMinCombat，主通道随机 N 列强制战斗；缺省=全部列（向后兼容）。
- **到 Boss 最少房间**：minRoomsToBoss，最短路径房间数下限（= 中间列 + 2），不足时扩展中间列。
- **宝箱岔路**：独立于主线，尽头固定宝箱事件；条数缺省按等级 F=2、每级 +2。
- **时空特工入侵**：详见 `data/agent-invasion.json`；仅 D 级及以上触发，追击追上后按节点类型触发三种入侵战斗（4096 场地）。
- **等级公共要素**：出征门槛（等级↔稀有度一一对应）、祭品掉落（`combat-formulas.json tributes.dropTables`，精英/领主/首领必掉）、限定事件池（`dungeon-event-definitions.js RESTRICTED_EVENT_META`，通用事件 30%/限定 70%，事件等级在地牢等级 ±1 内）。
