# 雪原三领主运行时接入静态审计（2026-09-05）

## 结论

雪冢驮城兽、极光织命母、白寂鸣钟鹿已完成配置、正式动作资源、实体状态机、攻击几何、统一敌人工厂、Boot 预载/动画注册和高级雪原终局领主槽接入。永冻地渊喉、冻日核骸仍因上游方向/拓扑门禁冻结，不进入任何运行时池。

本记录是静态合同审计，不是实机验收；未启动游戏、构建、测试或浏览器探针。

## 数值与身份

| key | rank | HP | STR/DEX/CON/INT/WIS/LUCK | 正式动作数 |
| --- | --- | ---: | --- | ---: |
| `snowSepulcherCarrier` | lord | 2600 | 82/12/86/26/34/10 | 4 |
| `auroraFateWeaver` | lord | 1850 | 48/38/58/82/74/18 | 6 |
| `whiteSilenceBellHart` | lord | 2150 | 68/34/70/78/66/16 | 6 |

双份 `data/public` 怪物配置对应对象一致，三者均声明 `entityClass`、`rank: lord`、`poolWhitelistOnly: true`、六维、碰撞半径、移动速度、攻击技能和完整纹理帧表。物攻、魔攻、防御、魔防、暴击与抗暴继续由项目统一六维公式派生。

## 动画与攻击合同

- 16 张运行时 PNG 与正式 `formal-final` 源文件 SHA-256 逐字节一致；图集宽高均等于 `columns × frameWidth` / `rows × frameHeight`，且 `endFrame = frameCount - 1`。
- 按 `frameWidth × frameHeight × frameCount × 4` 估算，三套解码体积依次约 175.8 / 200.9 / 137.5 MiB，分别低于领主单族 256 MiB 硬门；雪冢驮城兽没有再次有损压缩，旧观感问题来自 GIF 预览链而非正式 PNG。
- BootScene 为 16 张图分别使用独立帧宽、帧高和末帧注册；实体以正式动作 `duration` 和零基事件帧手动取帧，不另开 Phaser 伤害时钟。
- 正式右向母图只在运行时按锁定朝向水平镜像；`footX/footY` 继续作为每张表的根点，不按单帧内容重算中心。
- 起手冻结目标、方向或落点；释放帧重新检查承载面、实际攻击几何与墙体视线。后撤、隔墙、换层均允许空挥。
- 三点坠塔、三角三边、旧步多段、四蹄多段都在单次施法实例内共享命中计数上限；控制、死亡或销毁会取消尚未释放的帧事件、警示与第三回声。
- 犁雪迁城只按 `WallSystem.resolve` 后的实际轨迹移动与命中，Collider 位移和本体图不重复叠加根运动；撞墙、束缚或达到最大距离后进入正式恢复段。
- `六足定城` 没有另造或重定时未审核动作，而是复用已批准的 `tower_drop_body` 深蹲承力段和正式 `f64/f72/f80` 三事件来驱动三道外部冰脊；因此运行时选择 5083ms 正式墙钟，不采用旧提案的 3.2 秒占位时长。
- 双重钟鸣按 190–360 环带结算，警示同时标明外环和白色安全内核；长音、扇角、践踏、冰脊、历史矩形与三角边的警示几何和实际命中几何同口径。

## 状态机与池链

- 雪冢驮城兽：`advance → trample/tower/plow_prepare→plow_move→plow_recover/fortify→exposed`；65%和30%生命阈值各一次。
- 极光织命母：`seek_band → cut/triangle/oldstep/tether/reweave`；旧步只在目标持续移动时优先，50%生命完成一次重织。
- 白寂鸣钟鹿：`stride → antler/double_toll/hoof_sequence/long_tone/rhythm_shift`；45%生命换拍后，每第二次双响调度第三回声。
- `enemy-registry.js` 通过 `enemy-types.js` 导出的三个构造器自动生成地牢工厂；`ZOMBIE_FACTORY_MAP` 已扩展注册工厂，无需重复手写工厂。
- 只修改 `frozenDungeon.bossEncounter`：第三波固定 `{ lord: 1, normal: 4 }`，领主槽从三者中随机；`frozenDungeonBeginner` 和 `frozenDungeonMid` 均未加入新领主。
- 地牢预载解析器会收集 Boss 白名单，再由每只领主配置的全部 `assets/enemies/...` 路径闭包发现完整动作族。

## 已执行静态核对

- 三个 JavaScript 文件通过 `node --check`。
- 四份 JSON 可解析；三只怪物对象和高级雪原配置的 `data/public` 对应部分一致。
- 每个技能映射到存在的正式视觉状态，所有事件帧均位于对应 `frameCount` 范围内。
- 16 张运行时图与正式源文件哈希一致，尺寸、帧数和末帧合同一致。
- 高级雪原第三波能解析出 `lord: 1, normal: 4`，中级雪原不包含三只新领主。

## 实机重点

按项目约定由用户在开发端重点检查：首次切入高级雪原时的资源峰值、三只领主随机生成、左右朝向镜像、足底锚点、墙边冲锋截断、环形安全内核、多人目标的命中上限，以及控制打断后是否没有迟到伤害。
