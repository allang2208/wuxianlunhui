# 工程支线：独立分支发布记录

用户在知悉依赖限制后再次明确要求“提交推送”，本次据此发布独立任务分支 **`codex/engineering-line-20260830`**，不合入main。工程建筑和三个兵种已接入本地开发源码；这不代表远端、固定EXE或实机验收已经包含本支线。

## 已完成的清理

- 按最终manifest和直接编辑输入链，将802个废案/中间文件、合计约409.80 MiB移到忽略目录 `tools/.trash-engineering-20260830/`。这是可恢复归档，没有宣称释放磁盘空间。
- 范围仅为 `tools/ai-gen/` 下本任务的六个目录：`_engineer_branch_20260830`、`_hamster_engineering_mothers_20260830`、`_hamster_catapult_animations_20260830`、`_hamster_field_cannon_animations_20260830`、`_hamster_howitzer_animations_20260830`、`_engineering_line_completion_20260830`。
- 移出未选建筑raw、旧联系图/预览、被否攻击/死亡视频、分割/插帧缓存和旧中间快照。正式视频及provenance、母图编辑链、模型/Depth/蒙版/提示词、当前关键帧/图集/GIF、榴弹炮取弹前原生关键帧均保留。
- 榴弹炮弹丸/头像确实依赖的两张缓存图先提升至 `reference/projectile-source-die-v04-0032.png`、`reference/portrait-source-idle-v01-0000.png`，再修改提取入口与当前来源清单；原攻击快照仍保留历史原文。
- 废案索引保留淘汰记录和历史文件名，活动索引转向当前正式输出。建筑/投石组说明、母图接受状态、当前预览链接及导入器派生索引同步更新。

逐文件恢复清单及安全移动入口：`tools/ai-gen/_engineering_line_completion_20260830/cleanup-plan.json`、`cleanup-engineering.ps1`。建筑直接输入闭包：`tools/ai-gen/_engineer_branch_20260830/accepted-source-chain.json`。恢复时只按清单移动所需文件，不覆盖后来生成的同名文件。

## 知识沉淀

- `SKILL.md`：对应分卷入口。
- `skill/02-ai-asset-pipeline.md`：缓存输入提升、直接母图/修图来源与废案索引。
- `skill/07-world122-defense.md`：军事工程支线、黑火药AND门槛、逐级招募与公共人口协议。
- `skill/11-audio.md`：炮声/退壳/装填单次事件、持续底声拒绝。
- `skill/16-character-sprite-production.md`：双人器械尺度/视角、多源取弹衔接、完整动作墙钟。

## main合并门槛及证据

目标仓库已确认是 `https://github.com/allang2208/wuxianlunhui.git`，已fetch。检查基线为 `origin/main` 的 `5165e9114edaabac80c7b1fe3692f886dd27d602`；共享目录HEAD为 `afc8961b8cb5ee9b9fb500638154874954153b19`，两者不能当作同一状态。

按第15卷在干净工作树检查目标分支，未在共享main切分支、暂存、回滚或提交。前轮空工作树已移除；本轮重新建立同名工作树用于精确提交，其他会话的工作树和修改保留。阻断来自第15卷§15.7“提交会依赖尚未合入的共享协议”：

| 依赖 | 本地工程支线所需 | 远端检查基线 |
|---|---|---|
| 军事人口权重 | 三种工程兵均为2人口；招募、占用统计、兵线与后台使用 `getMilitaryPopulationCost(kind)` | 基线无人口配置；本分支只带三个工程兵的2人口配置，公共消费方未携带，生产系统仍调用 `canRecruitMilitary(1)`；军事人口系统按 `aliveUnitCount()`统计人数 |
| 阶梯移动扩展 | 投石组AI调用 `MovementSystem.continueStairTransit`，两个火炮继承该AI | 目标分支未提供此入口，不能整块夹带并行导航改动 |

人口改动横跨 `src/world/military-population-system.js`、`population-economy-system.js`、`producer-building-system.js`、`troop-line-system.js`、`world122-sim.js` 及共享配置，并涉及其他兵种。此轮只允许整理本任务文件，未取得这些混合改动的独立归属与发布边界；不能把全目录提交作为解决方法，也没有为了发布而把工程兵改回1人口或删掉当前导航能力。

本次仅将下面的工程范围提交至任务分支。公共协议由所属任务先独立合入后，重新fetch并更新该分支，合并人口配置时保留全部已有兵种权重，再评估合入main；当前不能将此分支当作可独立运行的成品。已有推送授权仍有效，不需要再次询问是否允许推送；不得强推或改写共享main历史。

## 本次任务分支提交范围

- 三档建筑正式图、光照图、缩略图及科技图标；三个单位图集/弹丸/图标/正式源音效；上述六个任务目录内保留的直接来源和制作入口（排除恢复区和可再生缓存）。
- 本任务独立实体 `hamster-{catapult,field-cannon,howitzer}-crew.js`、AI `hamster-{catapult,howitzer}-crew-ai.js`、三份单位配置；移动声助手按其明确的调用与归属单独移入。
- 共享文件只取工程相关条目：友军资源登记、生产类/配置工厂、升级kind、兵线、后台DPS、单位分类/图标、GameScene工程动作时钟/脚点/弹体渲染、建筑/科技/升级/光照/占地/音效配置。不得整文件复制共享目录版本。
- 任务分支科技版本由远端44递增至45，并同步系统版本（共享目录56含其他任务，不整份复制）；保留工程支线lane3、column1/3/6、黑火药显式AND与270/1560/4140科研费用，不夹带其他节点改动。
- 本轮SKILL及交付文档只移入新增小节/修订段落；第16卷仅携带本任务条目，未夹带共享目录其他尚未发布的生产标准；CHANGELOG只取工程任务记录，不把其它会话进度纳入提交。

## 验证边界

本轮只进行来源归档与发布范围所必需的文件/调用契约核对。未运行测试、lint、类型检查、构建、游戏或浏览器/CDP等运行时验证，按约定由用户测试；未同步EXE。发布后重点验收2人口计费、旧档与跨位面部队、三级招募/黑火药门禁、攻击/装填/取弹时钟及死亡播放。

Git交付检查：精确暂存561个路径，未包含缓存/恢复区或其他会话文件。原始提示词的末尾空行保留（不改变生成请求真源）；其他本次文件的空白问题已整理。此项仅为Git差异格式检查，不是代码测试。
