# 友军与怪物动画修复（2026-08-30）

本轮按 SKILL.md 索引阅读第09卷的怪物/友军接入、资源驻留及多阶段时钟工作流，第08b卷的平民移动/尺度规则，第16卷的素材生产约束，以及 game-dev-lessons 相关动画条目。已查看近期 git log / CHANGELOG。保留共享工作区已有改动，不发布固定 EXE。

## 逐项结果

| 项目 | 本轮处理 | 仍需确认 |
|---|---|---|
| 1 熊德鲁伊资源未就绪 | `blackBear` 的熊形4张、人形5张、双向变身2张均在当前开发目录，PNG尺寸与配置帧格相符；Boot 与驻留收集已覆盖 `black_bear` / `black_druid`。将资源就绪失败信息细化到具体贴图键和动画键。 | 尚未确定用户现场失败的具体资源。需要完整错误截图及浏览器/固定EXE环境；不能称为已修复。 |
| 2 工坊工程师太快 | 派出/返程速度180→90，闲逛70→35；配置与代码缺省值同步。 | 用户查看派出、维修到达及返程。 |
| 3 狼人王飞扑 | 删除该怪专用残影生成器；以技能累计时钟直接推进49帧，前20帧对应蓄力，后29帧对应飞行/落地；跨阶段dt不丢失。命中/撞墙立即停止位移，剩余落地收势继续播放；移动后同步Collider位置。 | 重点查看近距离命中、远距离扑空、墙前停止、控制打断、死亡及潜行破隐。伤害/冷却/眩晕数值保留，命中后的动作锁延续至原飞扑总时长结束。 |
| 4 钻虫入土烟尘 | 入土阶段每90ms在当前Collider脚点附近生成共享Phaser Graphics扬尘，复用对象池和自动淡出；继承本体遮挡深度。 | 烟尘密度、脚点和墙后遮挡；地下隐藏阶段不发射、不泄露落点。 |
| 5 翼骑兵攻击放大 | 对普通攻击及复用同表的冲锋加入定向显示尺度校正，固定脚线；其他动作、帧表、时间轴、伤害和碰撞不变。 | 重点查看待机→攻击→待机、移动→冲锋、左右朝向和石化冻结帧。观感尚未运行时验收。 |
| 6 螳螂绿色剑气 | 删除横扫技能的 `ReedMantisSweepEffect` 调用及未再使用的导入，保留技能动作、扇形判定与伤害。 | 横扫无额外绿色剑气且伤害正常。 |
| 7 独角仙王蓝色特效 | 后续针对腿部/模糊反馈直接读取正式PNG，确认待机青紫边与冲刺灰紫遮罩残留；插帧前关键帧已污染。未定位独立蓝色特效调用，也未替换正式素材；修复候选因无真Alpha及细节重绘未采用。证据见 `tools/ai-gen/_rotbog_asset_review_20260830/README.md`。 | 素材缺陷已定位，整套透明遮罩仍待修复；用户现场蓝色表现是否完全同源尚未确认。 |
| 8 移动攻击图标 | 指令栏、轮盘的移动攻击图标及选点鼠标统一复用悬停敌人的 `attack-target-cold-steel.png`。 | 保留A键、地面选点、沿途索敌和Shift队列语义；无效位置仍显示禁止游标。 |

## 翼骑兵校正来源与边界

- 正式制作来源为 `tools/ai-gen/_hamster_cavalry_pair_20260827/source-sheets-pre-interpolation/winged_hussar/attacking.png`，20个源关键帧；RIFE后39帧，原关键帧在偶数索引。
- 本轮只读取源表并复用其 `build-source-sheets.py#opened_mounted_body_bbox` 测量定义（输出11px椭圆开运算，排除细长枪杆、缰绳和翼架），没有调用生成、抠图或插帧流程。
- 待机主体参照254px来自该资产的 `source-sheet-report.json`。攻击20个关键帧主体高度为 `[254,258,261,264,276,304,305,305,311,310,311,310,310,311,310,303,302,295,275,275]`，峰值比参照大约22.4%。
- 本次按用户“攻击动画错误放大”反馈，为此兵种记录显示校正：`min(1,254/主体高度)`，中间帧线性插值尺度依据；缩放围绕源脚线375px换算位置。保留全部帧，不逐帧改写PNG，也不重排动作或另换视频。此校正是针对已报告异常的局部处理，不作为新资产默认生产方式。

## 修改文件

- `src/entities/enemy-types.js`：狼人王飞扑、螳螂横扫特效。
- `src/entities/enemy-types/core-drill-worm.js`：入土烟尘。
- `src/entities/hamster-winged-hussar.js`：该兵种的攻击尺度与脚线读取。
- `src/phaser/scenes/GameScene.js`：显式自管帧动作停止旧Phaser自播；友军可选尺度/脚线接入；移动攻击游标。
- `src/phaser/assets/runtime-asset-manager.js`：资源未就绪的具体错误信息，未放宽准入门禁。
- `src/world/workshop-economy-system.js`、`data/population-economy.json`：工程师减速。该配置直接被模块导入，当前不存在 `public/data/population-economy.json`，本轮不新增重复数据源。
- `data/enemy-config.json`、`public/data/enemy-config.json`：狼人王蓄力帧段与删除残影间隔。
- `data/hamster-winged-hussar-config.json`、`public/data/hamster-winged-hussar-config.json`：翼骑兵尺度标定数据。
- `src/ui/rts-command-presentation.js`：移动攻击图标覆盖入口。
- 本文与 `CHANGELOG.md`。

只查看本轮真实差异、必要局部调用链和源素材信息；未运行测试、lint、类型检查、构建或运行时验证，按约定由用户测试。未同步固定EXE；已发布EXE仍是原有独立快照。
