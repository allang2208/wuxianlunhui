# 玩家剑类三段普攻：抓握、轨迹与收势

本轮只优化三段普通攻击的显示。沿用已确认的“身体源帧、剑柄、掌部遮挡同帧绑定”做法，保留原生腿部、身体轨迹与动画时钟；不修改伤害、命中扇形/帧、音效帧、连段窗口、位移和体力。没有重生人物或视频。

## 修正内容

- 三段分别按当前实际人物帧读取12/12/16组掌心，而非用均匀进度选武器帧；第三段源帧9、10各100ms时，手、剑和盾一起停留。命中停顿期间也跟随当前身体帧。
- 四把剑分别使用现有 `textureGrips`，不再共用40像素握把偏移。身体下层、剑中层、原生握拳掌部上层的顺序，使剑柄穿入掌心；攻击身体本身保留原像素，只另取紧贴主手的前景层。
- 修正第一段前期落到肘部的握点，重标第二段挥击末端的掌心。第三段源帧14/15原绑定落到另一只手，本轮保持主手连续，盾牌同步到真正副手。
- 重新设计蓄力、挥击、收势的剑角度，去掉旧轨迹的大角度反折。第一段末与第二段首同为148°，第二段末与第三段首同为100°；第三段保持前刺方向后再放低。默认拉伸统一1，保留1.5装备缩放；模糊峰值从旧10收窄为3。
- 三段分别提供13帧显示收势映射：一、二段从自己的末姿开始，复用已有攻击收回姿态接入recover；第三段直接接recover。recover使用已确认的待机/步行握拳切片关闭旧手指。剑与盾读取同一映射姿态，收势仍由原recover时钟结束，不新增状态或计时器。

原时序不变：

| 段 | 攻击源帧 | 自然时长 | 连段定格 | 收势 |
| --- | --- | --- | --- | --- |
| 1 | 12 | 600ms | 500ms | recover自然330.2ms |
| 2 | 12 | 600ms | 200ms | 300ms |
| 3 | 16 | 900ms | 0ms | 400ms |

以上来自现有 `player-anim-config.json` 与 `combat-config.json.meleeCombo`，不是新平衡数值；攻击速度缩放、命中停顿及取消规则仍由原系统处理。

## 文件与边界

- `data/player-sword-combo-grip.json`：53个姿态的原生512坐标、图集索引、主/副手绑定、收势映射与调试面板重置默认值。直接JS导入，无public副本。
- `assets/player/sword-combo-grip/combo-0.png/json`、`combo-1.png/json`：106个身体/掌部帧，紧裁页1958×1703、2027×1720，RGBA约26.02MiB。
- `data/weapon-anim-config.json`、`public/data/weapon-anim-config.json`：只新增 `sword.attackGrip/attack2Grip/attack3Grip`。旧 `attack/attack2/attack3` 保留，避免改变战斗读取和法杖、夜与火特殊技共享轨迹。
- `src/phaser/player-sword-shield-motion.js`：沿现有物理同步后的入口替换普通剑攻击显示，下帧恢复原纹理/缩放和原手层可见性；保持原动画推进。排除冲刺、突击、旋风斩、推击、特殊攻击、死亡和翻滚。
- `src/combat/weapon-transform.js`：新增显示专用 `getSwordGripFramePose`，以具体剑贴图的握把原点计算位置、尺寸和角度。
- `src/phaser/scenes/BootScene.js`：预载两页图集；原生动画注册不变。
- `src/ui/dev-tool.js`：三段使用相同身体/掌层、源帧时钟、握把和独立配置块；重置返回12/12/16帧默认标定。保存沿现有全量配置接口，不走会把未知动画名回退为旧attack的逐帧导出接口；三段不生成 `weapon-frames/latest.js`。命中/音效标记仍读旧战斗块。
- `tools/animation/player-sword-combo-grip-20260901/`：来源标定、制作脚本和离线预览。

此前已确认的待机、步行、奔跑、举盾和冲刺/突击动作未调整；GameScene、动画源图、combat-config和player-anim-config本轮未修改。现有Canvas兼容路径不接管，新增效果在Phaser显示路径生效。

## 离线预览与交付限制

- `combo-chain-four-swords.gif`：四剑×双朝向，连续1→2→3→第三段收势→待机。
- `attack-with-recover.gif`、`attack2-with-recover.gif`、`attack3-with-recover.gif`：分别演示停止续段后的既有定格、各自收势和待机。
- `attack-contact.png`、`attack2-contact.png`、`attack3-contact.png`：逐帧剑轨迹；`recover-grip-detail.png`：13帧收势握拳局部。

预览是离线合成，保留源帧时长，GIF按10ms量化；不模拟命中停顿、碰撞、游戏根位移、运行时模糊滤镜或盾牌贴图。三段之间的人体姿态仍采用离散源帧，未凭空插帧，不能据此宣称实机完全无跳动。

已查看本次真实diff、必要的局部调用链及制作中的离线素材。未运行测试或运行时验证，按约定由用户测试。重点体验四剑左右朝向、连续123、只打一/二段后回待机、携盾收势及攻击中断/换装备；若仍有突跳，请提供具体段和时刻再做局部调整。未构建、同步EXE、提交或推送。
