# game-dev 知识库索引

本文件只负责定位。协作、授权、测试和发布边界见 [AGENTS.md](AGENTS.md)；了解进展看最近 5 条 `git log` 与 `CHANGELOG.md` 顶部相关条目。

## 按任务读取

先定位下表相关小节，不全文加载大卷。新增内容或重做先读 [任务工作流](skill/00-workflows.md) 对应类别；局部修复直接读相关合同。

| 任务 | 入口与按需参考 |
|---|---|
| 动画新制、重抽、视频转表 | 先读 [动画工作流](skill/00-workflows.md#动画) 定动作与阶段，再按需读 [16b 动画合同](skill/16b-animation-alignment-and-timing.md) §1.1 朝向、§4 插帧、§5 时钟；[16 生产规格](skill/16-character-sprite-production.md)；视频后端操作见 [WORKFLOW](tools/ai-gen/WORKFLOW.md) §3.6 |
| 动画去绿、Alpha、脚点局部修复 | [任务工作流](skill/00-workflows.md)“局部修补”；16b 对应小节，不重走新制流程 |
| 敌人、NPC | [09](skill/09-monsters-npc.md)：攻击类型、单时钟、配置消费者、NPC 添加；素材复用16/16b |
| 友军、工人、侍从 | [任务工作流](skill/00-workflows.md)“友军”；[09](skill/09-monsters-npc.md) 生命周期/驻留登记；[07](skill/07-world122-defense.md) 生产/人口/后台；[10b](skill/10b-companion-ai.md) 侍从AI |
| 建筑、环境道具、地形素材 | [任务工作流](skill/00-workflows.md)“建筑”；[02](skill/02-ai-asset-pipeline.md) 对应资产类别；[组件参考](skill/references/world122-building-components.md)；生成参数见 WORKFLOW §1.5 |
| 建筑放置、经济、科技、后台结算 | [07](skill/07-world122-defense.md) 按系统标题检索；寻路/碰撞见 [08](skill/08-pathfinding-movement.md) |
| 武器、盾牌、装备、祭品 | [任务工作流](skill/00-workflows.md)“装备”；[04](skill/04-weapons-equipment.md) 对应品类；盾牌细则见 [盾牌工作流](docs/shield-development-workflow.md) |
| 玩家动画、掌点、武器挂点 | [03](skill/03-player-weapon-anim.md)；角色动画共用16b |
| 技能、伤害、Buff、施法 | [05](skill/05-skills-combat.md)；具体旧故障按需查 [lessons 索引](.agents/skills/game-dev-lessons/SKILL.md) |
| 地牢、房间、门墙、教程 | [06](skill/06-dungeon-scene.md)；进度/位面见07；UI见10 |
| UI、面板、组队 | [10](skill/10-ui-party.md) 对应小节 |
| 音效 | [11](skill/11-audio.md) |
| 移动、寻路、碰撞 | [08](skill/08-pathfinding-movement.md)；启停/平民动画见 [08b](skill/08b-animation-smoothing.md) |
| 故障定位 / 用户授权的性能分析 | [12](skill/12-pitfalls-debug.md) / [14](skill/14-performance-optimization.md) |
| 提交、worktree、EXE发布 | [15](skill/15-git-workflow.md) / [EXE发布](docs/exe-test-release.md)，执行授权仍见AGENTS |
| 旧案例精确定位 | [历史主题表](skill/references/topic-index-legacy.md)、[13历史附录](skill/13-history-appendix.md)，不作为新任务步骤 |

## 维护规则

- 每项公共规则只维护一处：协作在AGENTS，任务分流在00，生产预算在16，动画几何/时钟在16b，后端命令在WORKFLOW。其他文档链接引用。
- 分卷保留系统契约与实现入口；历史参数先确认当前消费者，不按旧案例复制。测试命令只是授权后的选项，不能覆盖AGENTS。
- 新条目写适用条件、结论和真源，不追加过程流水；进度进CHANGELOG，未实施事项进TODO。
- 索引只增加任务路由，不增加单资产案例。长内容按独立任务拆成参考页；移动内容保留入口链接，避免旧链接失效。现有大卷按小节检索，不全文注入。
- 模型和reasoning由实际任务设置/配置管理，不在知识库写死代理型号；工程建议见AGENTS。
