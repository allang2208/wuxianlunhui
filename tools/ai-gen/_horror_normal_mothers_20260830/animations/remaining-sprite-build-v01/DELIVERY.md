# 恐怖地牢三款普通怪：正式接入交付

本轮按用户明确要求完成统一体型、优化插帧、游戏接入及状态机。棺板卫尸原有素材和数值不改。所有实机验证均未运行，按约定由用户测试。

代码审查后的收尾已完成：四款切动作时立即同步脚点，避免新帧表套用旧偏移一帧；渲染器的可见性、动画同步和深度统一使用Game.isPreservedCorpse，资源管理也保留fadeTimer阶段，接通停尸后的0.3秒渐隐。棺板卫尸仅同步这两项修复，原素材/数值/攻击时钟不变；未运行实机验证。

![同尺度脚线参考](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/delivery/size-reference.png)

![正式素材和配置时钟离线预览](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/delivery/three-monsters-runtime-clock.gif)

以上是读取正式PNG和配置制作的离线素材预览，不是运行游戏或截图比对。展示倍率1.5，不是额外运行时缩放。

| 怪物 | 基础HP | 配置移速 | 六维 力/敏/体/智/感/运 | 攻击 | 起手冷却 |
|---|---:|---:|---|---|---:|
| 裹尸囚徒 | 170 | 125 | 18/9/18/3/4/3 | 物理（单体拍击） ×1.1 | 5.6s |
| 掷骨殓徒 | 120 | 135 | 16/14/12/6/8/4 | 物理（骨镖投射物） ×1.2 | 5.8s |
| 缚钟侍者 | 190 | 105 | 10/7/19/16/10/3 | 魔法（近距离声震） ×0.85 | 6.5s |

数值参考普通僵尸120HP、矿工僵尸150HP、胖子僵尸200HP和棺板卫尸240HP；六维仍由现有 enemy-base-stats 公式派生物攻/魔攻/防御，未新建伤害公式。移速继续应用项目全局倍率。

- 共同可见身高基准约139.515世界像素，制作主体208px；按各源相机首帧固定换算，禁止逐帧fit或拉伸。地面半径36.3、躯干57.5×158.8及HUD基准沿用矿工僵尸，各动作裁框分别换算脚线。
- 每动作独立紧裁排表。待机6fps关键帧→12fps，行走12→24fps；攻击蓄力/收招8→16fps，源38–56帧快速段保留24fps关键帧→48fps。死亡6→12fps并保留原末帧。最终以frameDurations为唯一时钟，总时长未压缩。
- 循环动作插回绕；攻击/死亡不回绕。RIFE v4.6分离RGB/Alpha，原关键帧位于偶数索引；异常中间帧可退回源姿态。没有再次插已插帧的表。
- 裹尸囚徒拍击锁定目标与方向，使用公共近战快照/时间轴、接触窗口和DamagePipeline；攻击期间停步，不追加隐形突刺。
- 掷骨殓徒按源44帧（正式38帧，1.833秒）释放一枚骨镖；在真实发射点预判原目标，绕到背后或失去视线不换目标补射。独立碰撞半径3、显示画布24、速度560、最长射程520，不追踪、不穿透。弹体按速度方向转向，其他显式球形贴图默认不变；对象池重置两个新增显示字段。
- 缚钟侍者按敲钟帧结算一次130半径地面椭圆魔法伤害；逐目标同地表/LOS复查，短时声震圈仅为视觉，无持续伤害、召唤或硬控。
- 共用待机/追击/前摇/生效/收招/死亡/停尸/淡出生命周期。眩晕、冻结、石化、恐惧、冲刺眩晕均取消未释放攻击且保留冷却；恐惧不每帧重置行走。死亡奖励一次，保留末帧1秒、淡出0.3秒。已飞骨镖不随施法者死亡撤销。
- 三款以rank normal加入恐怖地牢主配置、初级和中级共8个既有白名单；poolWhitelistOnly保留，不扩大到矿洞/通用随机池，不改波数、等级配比或强制怪。

| 怪物 | 动作 | 正式精灵表 | 原片 | GIF | 帧数 | 单帧格 | 时长 | RGBA MiB |
|---|---|---|---|---|---:|---|---:|---:|
| 裹尸囚徒 | idle | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/shroud_thrall/idle.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/shroud-thrall/videos/idle-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/shroud-thrall/previews/final/idle.gif) | 34 | 118×226 | 2.833s | 3.46 |
| 裹尸囚徒 | walking | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/shroud_thrall/walk.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/shroud-thrall/videos/walking-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/shroud-thrall/previews/final/walking.gif) | 60 | 158×235 | 2.500s | 8.50 |
| 裹尸囚徒 | attacking | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/shroud_thrall/attack.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/shroud-thrall/videos/attacking-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/shroud-thrall/previews/final/attacking.gif) | 107 | 250×234 | 5.042s | 24.10 |
| 裹尸囚徒 | dying | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/shroud_thrall/death.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/shroud-thrall/videos/dying-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/shroud-thrall/previews/final/dying.gif) | 61 | 258×233 | 5.042s | 14.45 |
| 掷骨殓徒 | idle | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/ossuary_caster/idle.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/ossuary-caster/videos/idle-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/ossuary-caster/previews/final/idle.gif) | 24 | 128×224 | 2.000s | 2.62 |
| 掷骨殓徒 | walking | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/ossuary_caster/walk.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/ossuary-caster/videos/walking-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/ossuary-caster/previews/final/walking.gif) | 40 | 146×232 | 1.667s | 5.17 |
| 掷骨殓徒 | attacking | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/ossuary_caster/attack.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/h3-attack-power-v02/videos/ossuary-attack-h3-v02.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/ossuary-caster/previews/final/attacking.gif) | 109 | 312×259 | 5.167s | 33.91 |
| 掷骨殓徒 | dying | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/ossuary_caster/death.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/ossuary-caster/videos/dying-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/ossuary-caster/previews/final/dying.gif) | 61 | 246×230 | 5.042s | 13.60 |
| 缚钟侍者 | idle | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/knell_attendant/idle.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/knell-attendant/videos/idle-doubao-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/knell-attendant/previews/final/idle.gif) | 40 | 138×226 | 3.333s | 4.76 |
| 缚钟侍者 | walking | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/knell_attendant/walk.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/h3-completion-v01/videos/knell-walk-h3-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/knell-attendant/previews/final/walking.gif) | 48 | 148×235 | 2.000s | 6.37 |
| 缚钟侍者 | attacking | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/knell_attendant/attack.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/h3-completion-v01/videos/knell-attack-h3-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/knell-attendant/previews/final/attacking.gif) | 109 | 172×226 | 5.167s | 16.31 |
| 缚钟侍者 | dying | [PNG](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/enemies/knell_attendant/death.png) | [MP4](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/h3-completion-v01/videos/knell-death-h3-v01.mp4) | [GIF](E:/无尽轮回/长期备份/2026-7-13-1/game-dev/tools/ai-gen/_horror_normal_mothers_20260830/animations/remaining-sprite-build-v01/knell-attendant/previews/final/dying.gif) | 63 | 246×233 | 5.167s | 13.78 |

三款整套基础RGBA估算分别50.51 / 55.55 / 41.21MiB（骨镖已计入掷骨殓徒），高于32MiB目标但低于64MiB准入线。保留完整5秒一次性动作及208px主体是主要占用；未抬高全局预算。这不是整场显存或性能实测。

三款同场唯一纹理合计约147.27MiB；加此前棺板卫尸约56.84MiB，四款合计约204.11MiB，与同种实例数无关。切场若旧场景纹理仍驻留，本轮新增部分最多再占约147.27MiB；实际过渡峰值还包含旧场景、其他怪物、地形、UI及GPU开销，未进行整场预算检查或性能实测，不能据此声称整场达标。

已知源片边界：掷骨殓徒抬手的43–44帧原始顶部裁切仍保留，没有声称补回缺失指尖；换边和发力按用户认可保留。死亡落地骨镖保留在尸体动画，不生成第二枚战斗弹体。裹尸囚徒拍地手部的源角标只做局部RGB清理，Alpha与姿态不变。未新增独立声音文件。

文件范围：三款enemy-types及_shared/horror-normal-enemy；实体导出、zombie-dungeon工厂、BootScene资源登记；双份enemy-config/dungeon-config；ProjectileFactory和Projectile的可选朝向/显示大小字段；assets/enemies三目录及本制作目录。审查后追加coffin-ward.js脚点同步、GameScene.js尸体显示门禁和runtime-asset-manager.js淡出保活修复。未改棺板卫尸或其他怪物的参数。

用户重点测试：三款普通槽出怪、同屏体量/脚线与左右翻转；拍击空挥和弹反；骨镖出手位置/上下层弹道/墙体阻挡/对象池复用；钟震范围和隔墙；控制打断、长帧跨生效窗、死亡奖励一次、停尸淡出与切场清理。

已按用户要求完成四款限定范围代码审查，并修复两项确定问题。未运行测试、lint、类型检查、构建、服务器或浏览器/游戏运行时验证，也未单独运行预算检查脚本；按约定由用户测试。素材处理报告和离线GIF不等同游戏测试，原片指尖裁切仍为已披露的素材限制。
