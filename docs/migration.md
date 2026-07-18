# 对话迁移状态
> 生成日期：2026-07-18
> 用途：新对话恢复上下文用（发送"继续开发无限轮回，读取 docs/migration.md 获取上下文"）

## 当前版本状态
- Git：main 与 GitHub 同步，最新提交 `67ad35d`（feat: 集合体打磨/判定根因系列/召唤物体系 + SKILL.md v3.0）
- 工作区干净，无未提交改动
- 文档索引：`SKILL.md`（变更记录至 v3.0）、`CHANGELOG.md`（全部会话记录）、`WORKING-GUIDELINES.md`（原则 1-10）、`docs/work-rules.md`（规则 1-5）

## 工作规则（新对话必须遵守）
1. 能不硬编码就不硬编码（数值/坐标/路径入 `data/*.json` 或常量模块，唯一真相源；改既有数值需用户确认）
2. 开发前排查冲突与钩稽关系（已知链路：`data/` ↔ `public/data/` 双份、enemy-config ↔ 地牢工厂 ↔ 图鉴 ↔ BootScene、判定逻辑 ↔ 调试可视化）
3. 固定显示统一 `bottom: 固定像素`
4. 素材先复制进 `assets/` 子文件夹再开发，禁止项目外路径
5. 修改强绑定全场景生效，禁止单场景补丁
6. 验证三件套：`npm run lint` / `npx vite build` / `node scripts/test-collider.mjs`（改造改动加 `node scripts/test-craft-sync.mjs`）
7. 数值回退用 `??` 不用 `||`；自定义色粒子用白色纹理；Phaser 特效显式 destroy
8. 每次修改后按格式记录 `CHANGELOG.md`

## 已完成的主要工作（本对话）
- 工作规则修订（删除过时内容 + 4 条新规则 + 强绑定规则）
- 战斗/判定：毒液 footprint 45→7.07、胖子 attackDistance 100、近战动画输入锁、怪物 HP 调整（犬100/僵120/毒120/巫师600）
- 地牢：地板 32×32 圆角 2px 缝、15 张事件背景图（cover/1920）、面板全宽、胖子尸体保留、地牢枪口修复
- 数值：升级经验×2、升级回满血蓝、被动技能 expRewards 修复 + public 技能副本同步
- 集合体首领：480px 素材/站桩锁定/BOSS 战 1024 替代大块头/主神空间测试/贴图碰撞×3→270/位移免疫/弹反免疫/音效五触发点/砸地 CD 驱动+冲击波/投掷 AimHelper 预判+警示圈即毁+深黄落点/召唤 15s 黑粒子
- 新地牢「僵尸地牢-初级」：22 节点/3 分支/40% 战斗/0% 精英/boss 精英遭遇副本，出征可选
- 审查修复：地牢 4 高危（Boss 回调/active 卡死/宝箱 items 键/召唤泄漏）+ 中低优先级十余项
- 附魔/改造/强化审查修复：init 接入/粉尘统一/穿甲收集/沉重钩子/强化石顺序/stats 污染移除/G18 死格/PKM 回退/同 id 白扣券/防具强化生效
- 技术债务：craft 配置迁 data/craft-config.json（双份）、registry 三角同步 + test-craft-sync 永久检查、DungeonBuffSystem 死代码删除、存档含装备背包、公式展示收敛、背景图 1920 瘦身
- 召唤物 `_summoned` 统一标签 + 全收益闸门（金币/经验/技能修炼 7 处计数）
- 调试：左下「秒杀」按钮、眩晕双星特效

## 关键技术约定（后续开发沿用）
- 集合体（amalgamZombie）：boss rank、HP 5000、atk 60、matk 0、def 48、mdef 58、speed 0（站桩五通道锁定）、parryImmune、footprint 270/offsetY -100
- 通用机制：`Game.removeEntity`（删除实体必销毁贴图）、`isPreservedCorpse`（胖子尸体保留）、`removeEntitiesByPrefix`（召唤物前缀清理）、`_parryImmune`（弹反免疫）、`_summoned`（召唤物无收益）、`_destroyCustomEffects`（自定义特效统一清理）
- 测试工具：`scripts/test-collider.mjs`、`scripts/test-craft-sync.mjs`、`scripts/json-hooks.mjs`（Node 跑 ESM JSON 导入）、`.venv-sprites/`（隔离 Pillow 环境，已 gitignore）

## 已知遗留
- 「复活后子弹不从枪口射出」——两轮排查未复现，待具体场景线索（哪把枪/哪个场景/子弹位置截图）
- 新 10 事件配置在 `dungeon-event-definitions.js`（JS 模块）而非 JSON，可按需外移
- minor/boss 分类池机制未接入（集合体是写死接入，池未建）
- 无 attackFormula 武器强化为 +1/级（enhanceFlat 1），如需更高倍率需用户确认
- 实机待验证清单：各批 CHANGELOG 条目末尾均附有验证点

## 下一步建议
1. 实机回归验证（重点：集合体战斗全流程、僵尸地牢-初级通关、读档恢复、穿甲/后坐/移速改造手感）
2. 需要时执行用户新需求
