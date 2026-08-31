# 蜡面哀祷者：四动作与封蜡诅咒

> Git发布范围：本页描述本地开发版；远端目前只归档素材，未启用游戏接线。见[发布说明](../../../../../docs/animation-publication-2026-08-31.md)。

2026-08-31。先完成刽子手标准复查，再按用户“没问题以后下一个”继续本角色。采用已生成的四段豆包 Seedance 2.0 Mini v01 源片；本轮没有重新提交生成，也没有购买额度。母图为此前用户确认版本。

用户随后回复“可用”，已认可本页四动作最终预览，保留当前正式素材和接入，不再重抽。

制作、游戏接线和离线素材检查完成，游戏验收待用户进行。此记录不代表实机已通过。

## 可直接查看

[四动作正式时钟预览](sprite-build-v01/previews/final/four-actions-overview.gif)

| 动作 | 豆包原片 | 最终GIF | 正式精灵表 | 帧数 | 单格 | 播放周期 |
|---|---|---|---|---:|---|---:|
| 待机 | [MP4](videos/idle-doubao-v01.mp4) | [GIF](sprite-build-v01/previews/final/idle.gif) | [PNG](../../../../../assets/enemies/waxface_mourner/idle.png) | 40 | 108×231 | 3333.333ms，循环 |
| 移动 | [MP4](videos/walking-doubao-v01.mp4) | [GIF](sprite-build-v01/previews/final/walking.gif) | [PNG](../../../../../assets/enemies/waxface_mourner/walk.png) | 50 | 132×240 | 2083.333ms，循环 |
| 施法 | [MP4](videos/attacking-doubao-v01.mp4) | [GIF](sprite-build-v01/previews/final/attacking.gif) | [PNG](../../../../../assets/enemies/waxface_mourner/attack.png) | 79 | 174×231 | 1500ms，单次 |
| 死亡 | [MP4](videos/dying-doubao-v01.mp4) | [GIF](sprite-build-v01/previews/final/dying.gif) | [PNG](../../../../../assets/enemies/waxface_mourner/death.png) | 85 | 270×244 | 3541.667ms，单次 |

GIF按最终时间表约25fps采样并累计10ms量化；角色精灵保留完整254帧。总览为方便查看重复展示，游戏施法/死亡不循环。死亡动画结束停留1000ms，再用300ms淡出。

## 比例、视角与生产

- 同矿工僵尸、刽子手和恐怖地牢普通人形怪：站立身体高度139.515世界像素，排除武器/蜡烛，素材有效身体208px。正常地牢镜头1倍，正常最大1.03倍约143.701px；没有靠加大整张画布补体量。
- 源片每动作只使用一个等比相机校准、固定根点和对称裁框；保留步态、手臂、衣摆和倒地的自然位移，不逐帧贴地、居中或拉直。四动作均保留右向三分之四视角，只有正常步态的轻微肩胯摆动；左右采用镜像。
- BiRefNet分离背景和攻击掌前灰烟；身体贴图不包含地面蜡印。预乘Alpha缩放，仅平滑源片细小色度噪点，不改变Alpha/亮度结构。
- 原始未插帧表保留于`source-sheets`。RIFE只插一次，循环包含首尾接缝，单次动作不插尾到头。生产脚本和RIFE脚本已在本角色`producer`目录固定。
- 正式PNG只在`assets/enemies/waxface_mourner`保存一份。[最终清单](sprite-build-v01/manifest.json)及[预算入口](sprite-budget-manifest.json)包含源片、取帧、根点、布局、时钟、版本和依赖；四张表共44.231MiB，无额外贴图依赖，低于specialist 64MiB目标。
- 默认重建：项目根目录执行 `../ComfyUI/.venv/Scripts/python.exe -X utf8 tools/ai-gen/_horror_elite_mothers_20260831/animations/waxface-mourner/build-sprites.py`。从未插帧表直接生成正式PNG/GIF，不依赖已归档的抠图缓存，也不重新调用AI服务。
- 可再生抠图/RIFE预览缓存移至`tools/.trash-waxface-mourner-20260831`，只移动未删除；路径、字节与原因见[归档清单](sprite-build-v01/review-20260831/archive-manifest.json)。

## 游戏行为

- 恐怖地牢专属精英`waxfaceMourner`，生命560、配置移速115；当前全局0.6倍率下无额外修正的速度基准为69世界像素/秒。仅加入现有8处恐怖地牢候选池，保留波次比例和精英rank门禁。
- 用户要求接入与设计数值/状态机后，补全远程站位：340停步、超过390或失去视线再追击；出生首次冷却900ms，后续4200ms从起手计算，收招后原地等冷却。魔攻基础38，蜡印基础53伤害，最终结果仍走地牢成长和公共伤害管线。完整数值、状态转换和控制规则见[数值与状态机](../../../../../docs/waxface-mourner-combat-2026-08-31.md)。
- 起手锁定目标与左右方向。源片f47对应正式0-based f34，在725ms伸掌时复查目标有效性、地面射程420、背后容差24、遮挡和承载面，成功后固定原目标的脚底落点。
- 900ms地面预警后爆发一次，即起手后1625ms；施法动作1500ms结束，蜡印不随收招消失。预警外圈X/Y半径72/36，与实际地面椭圆使用相同两轴；目标Collider与圈相交才进入命中候选。
- 魔攻×1.4魔法伤害，零额外击退。实际受伤且仍存活的目标减速20%持续2000ms；同名只刷新不叠层，与原通用50%致残分开。玩家/友军读取同一倍率，可被现有圣光及圣域净化，状态免疫拒绝入库。
- 眩晕、冻结、石化、恐惧、冲刺眩晕或死亡取消未释放动作；战斗仍进行时，释放后的蜡印由EffectManager独立推进，施法者死亡不撤销已释放攻击。场景清理、切场或战斗结束进入地图/奖励界面时取消蜡印；暂停/地牢挂起不使用墙钟偷偷结算。
- 原点、落点、表面高度和阻挡豁免在释放时快照；爆发时再次检查墙体与每个目标的表面/遮挡。不追踪、不连爆、不产生持续伤害、召唤或恐惧光环。第一帧只消费跨过释放时点的余量，不重复扣整帧dt。

## 本轮文件与验收边界

新角色类`src/entities/enemy-types/waxface-mourner.js`、独立效果`src/effects/wax-seal-effect.js`、减速入口`src/combat/wax-seal-status.js`；角色导出、Boot加载、地牢工厂和`data/public`配置已接线。玩家及AI移速各增加一次封蜡倍率；状态栏、两处净化名单与状态移除同步该新状态，不改变旧减速数值。

[离线检查报告](sprite-build-v01/review-20260831/asset-review.json)：254帧有效、最小透明留边10px、RIFE原关键帧不变、无空帧/触边/异常插帧回退；四张全帧联系图已目视查看。GIF总时长误差不超过3.334ms，data/public与正式帧表一致。[显存预算报告](sprite-build-v01/review-20260831/budget-report.json)通过。

未运行测试或运行时验证，按约定由用户测试；未构建、未启动游戏、未同步EXE。重点实机确认：与旁边人形怪的体量/脚点、左右与斜向施法、出圈/隔墙/换层躲避、900ms预警、控制打断、施法者死亡后的已释放蜡印，以及减速到期/净化。源片仍含轻微衣物色度波动和自然摆动；只提供左右镜像，不能声称各个方位均为独立方向动画。
