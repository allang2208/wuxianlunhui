# 玩家剑盾动画与优质盾牌素材归档

本分支基于最新`origin/main`归档2026-08-31至09-01已确认的玩家持枪/剑盾视觉成果、可重建制作源、两款优质盾牌候选、盾牌数值审计和可复用动画合同，并从共享工作区精确提取对应运行时接线。未携带共享`main`中其他会话的无关改动。

## 已归档内容

- 剑盾低持奔跑与普通冲刺：`assets/player/sword-shield-motion/`、`data/player-sword-shield-motion.json`。
- 已确认突击V3：`assets/player/sword-shield-thrust-v3/`、`data/player-sword-shield-thrust-v3.json`及原生收势掌点表。
- 空副手单剑低持奔跑、待机/步行抓握、三段普攻抓握与普通冲刺抓握：各自 `assets/player/` 图集、`data/player-*.json`元数据和离线制作目录。
- 两款优质盾牌：锻钢拳盾与橡木卫戍盾的真实RGBA手持/栏位图、原始生成祖先、来源、握点候选、预览和改造数值设计。两款仍是候选，没有登记装备、掉落、商店或改造配置。
- 玩家盾牌审计、剑盾动作设计、各状态制作说明，以及 `skill/03-player-weapon-anim.md` 的“原生近战动作同帧握柄覆盖”合同。

## 清理记录

- 删除102个可再生或已淘汰文件，共39,021,641字节（约37.21 MiB）：突击V2输出、Python缓存、粗定位源图、逐腕裁片、早期突击预览和被完整连续预览覆盖的分段GIF。
- 普通冲刺来源包只保留已批准的8条slash序列，身体裁片由229个收敛到104个；未采用的早期thrust序列和对应武器图从该包移除。独立V3批准数据包保持完整，因为正式导出器直接消费它。
- 生成器、rig、实际来源祖先、运行时图集、V3重建依赖、四剑双朝向连续预览和关键帧联系图均保留。相关目录加入局部 `.gitignore`，避免再制作时把诊断图和缓存重新带入提交。

## 随本分支发布的运行时接线

- `PlayerShieldRig`与`PlayerSwordShieldMotion`负责格挡上身、walk腿层、普通行走逐帧副手掌点、剑类body替换入口和同帧`shieldBinding`。
- `BootScene`只增加长枪独立后手/托举臂的预载与托举图集逐帧镜像；`GameScene`只提取持枪双手解算、手枪掌心收口、腿层相位继承、盾牌同步与对应深度/克隆/销毁路径。
- `data/player-anim-config.json`与`public/data/player-anim-config.json`同步；武器握点配置使用`data/weapon-anim-config.json`与`public/data/weapon-anim-config.json`双份同源数据。
- `ShieldSystem`与玩家移动/受击入口同步长按格挡、步行限速、奔跑抑制、弹反计时、换栏/死亡/眩晕退出和当前副手盾装备状态。

共享`GameScene`、`BootScene`、`player/update`和`player/subsystems`均按目标代码块迁移并复核真实diff，没有整文件复制；T面板及其他会话功能不在本分支范围。

## 验证边界

本次发布收口只核对清理清单、归档文件、精确代码块、双份配置与Git差异。枪械目录保留此前运行时截图/机器报告的复现说明，但本次未重新运行测试、构建、lint、浏览器探针、游戏或运行时验证，按约定由用户测试；未构建、同步或启动EXE。
