# 缝面刽子手：四动作与游戏接入

> Git发布范围：本页描述本地开发版；远端目前只归档素材，未启用游戏接线。见[发布说明](../../../../../docs/animation-publication-2026-08-31.md)。

2026-08-31，用户“可用继续”确认移动 v06 后完成。四动作已转为 BiRefNet 透明精灵表，并通过 RIFE v4.6 进行 2 倍插帧，接入恐怖地牢精英池。两只精英均已完成，本页只记录刽子手。

随后按用户要求完成[动画标准复查](WORKFLOW_REVIEW.md)：减轻原片细色噪、改为预乘Alpha缩放、修复GIF短帧停留，并补齐预算与最小来源归档。动作位置、帧数、时钟及战斗参数保持不变。下方GIF为当前修正版，按最终时钟约25fps采样展示。

[四动作总览](sprite-build-v01/previews/final/four-actions-overview.gif)

| 动作 | 采用源片 | 正式精灵表 | 可播放 GIF | 帧数 / 时长 | 单格 |
|---|---|---|---|---|---|
| 待机 | [v01 MP4](videos/idle-doubao-v01.mp4) | [idle.png](../../../../../assets/enemies/stitchface_headsman/idle.png) | [GIF](sprite-build-v01/previews/final/idle.gif) | 28 / 2333.333ms | 128×232 |
| 移动 | [v06 MP4](videos/walking-doubao-v06.mp4) | [walk.png](../../../../../assets/enemies/stitchface_headsman/walk.png) | [GIF](sprite-build-v01/previews/final/walking.gif) | 58 / 2416.667ms | 166×238 |
| 攻击 | [v01 MP4](videos/attacking-doubao-v01.mp4) | [attack.png](../../../../../assets/enemies/stitchface_headsman/attack.png) | [GIF](sprite-build-v01/previews/final/attacking.gif) | 77 / 1500ms | 238×264 |
| 死亡 | [v01 MP4](videos/dying-doubao-v01.mp4) | [death.png](../../../../../assets/enemies/stitchface_headsman/death.png) | [GIF](sprite-build-v01/previews/final/dying.gif) | 75 / 3041.667ms | 248×264 |

GIF 的攻击与死亡重复仅供查看；游戏中各播一次。死亡末帧停留1000ms，再300ms淡出。源片和同名 `.mp4.json` 均保留，未重投视频或改换管线。

## 比例与取帧

- 制作身体高度208px，显示身体高度139.515px；使用矿工僵尸274源像素×260.7/512的身体基准，不计斩刀。碰撞半径36.3、受击宽高57.5×158.8，与现有人形基准一致。
- 攻击源片身体609px，待机/死亡434px，移动444px。分别使用整段固定等比缩放，固定根点与动作裁切；不逐帧居中、不压平抬脚，不改变人体比例，不追加代码冲刺。死亡保留自然倒地位移。
- 待机取源f28至f84前，移动取f50至f108前；不重复循环终点。攻击保留f0至f120，出刀段f49–58逐源帧保留。死亡取f0至f72，去掉后续重复尸体停留。
- 插帧保留全部原始关键帧，关闭垂直脚点修正。四表约49.40MiB，低于精英64MiB制作目标；原图边缘在所有正式格中有留白。此数为RGBA解码估算，不是游戏性能测量。

## 攻击与出现规则

- `stitchfaceHeadsman`，精英，生命780、移速110；六维54/24/38/5/12/8，走共享战斗公式。
- 蓄力斩骨：600ms蓄力、300ms下劈、600ms收招；起手冷却3000ms。锁定原目标和方向，不追踪，不横扫。
- 源f56低位刃口对应正式 **0-based f40 / 833.333ms**。接触窗f40–41，整个动作最多结算一次，物攻×2、击退42。动画与伤害读取同一逐帧时间轴，卡顿跨窗仍只复查一次。
- 起手/命中前伸70，地面宽36。刀尖在源f56约x914，固定根点x615；按139.515/609折算可见前伸约68.50，取整并留约1.5px边缘至70。目标自身占地只由共享解析器计算一次，不再额外加半径。
- 命中时重查原目标、阵营、承载面、遮挡与接触矩形。判定原点可跟随被击退后的脚点，方向不变。受控或死亡取消未释放攻击；伤害走DamagePipeline。
- 仅加入初/中/高级恐怖地牢已有8个白名单；保留`matchPoolRanks`，只参与精英槽，不增加波数、数量或替换领主/首领。`poolWhitelistOnly`阻止进入其他全局随机池。
- 沿用恐怖人形怪自管选帧和尸体生命周期；Boot登记纹理族，由现有驻留管理器按需加载，不增加常驻特效或第二套动画时钟。

## 修改范围与交付边界

- 新增：`src/entities/enemy-types/stitchface-headsman.js`、`assets/enemies/stitchface_headsman/{idle,walk,attack,death}.png`。
- 接入：`src/entities/enemy-types.js`、`src/world/zombie-dungeon.js`、`src/phaser/scenes/BootScene.js`。
- 配置：`data/enemy-config.json`、`data/dungeon-config.json`及对应`public/data`副本；已有怪物条目不变。
- 素材来源、尺寸、逐帧时长和制作报告：[manifest.json](sprite-build-v01/manifest.json)；接入参数：[runtime-installation.json](sprite-build-v01/runtime-installation.json)。

未运行测试或运行时验证，按约定由用户测试。需在游戏中重点确认左右翻转与动作切换、侧移/后撤避刀、控制打断、死亡停留及退场。未构建、未同步EXE；离线素材记录不代表游戏内验收。
