# 僵尸工头 H3 v04 攻击导入

2026-08-31：用户确认“可用，按动画标准工作流导入”，并在获知438.25MiB依赖组合超额后明确回复“允许”。**v04攻击已正式接入开发版**，两份配置已切换，预算例外及接入状态记录于 [runtime-import.json](../tools/ai-gen/_foreman_h3_redo_20260831/runtime-import.json)。这不是实机验收通过，也未同步固定EXE。

## 本轮范围

只接入获准的 attack-v04，不重生、不再次插帧、不重画鞭子。现有 walking.png 的15帧/1500ms移动保持原样；H3 walk-v01仍是未确认候选。待机、号召、死亡、碰撞体、矿洞生成和召唤规则均不改。

- [获准透明预览](../tools/ai-gen/_foreman_h3_redo_20260831/previews/attack-v04-candidate-1500ms.gif)
- [39帧联系图](../tools/ai-gen/_foreman_h3_redo_20260831/previews/attack-v04-candidate-frames.png)
- [最终透明PNG](../tools/ai-gen/_foreman_h3_redo_20260831/sheets/attack-v04-rife.png)
- [MiniMax源视频](../tools/ai-gen/_foreman_h3_redo_20260831/videos/attack-v04.mp4)及[provenance](../tools/ai-gen/_foreman_h3_redo_20260831/videos/attack-v04.mp4.json)
- [本次导入的配置差异记录](../tools/ai-gen/_foreman_h3_redo_20260831/planned-config.patch)
- [正式运行时PNG](../assets/enemies/foreman_zombie/attacking_h3.png)

## 导入规格

| 项目 | 正式接入值 |
| --- | --- |
| 表/格/有效帧 | 3456×4000；864×400；4列10行，39帧，endFrame=38，末格不播放 |
| 内容 | 完整身体与原生鞭身；30个真实源姿态＋9个RIFE半步 |
| 统一脚点 | footX=432、footY=360，所有帧相同，不逐帧居中或消除身体起伏 |
| 身体比例 | 固定源缩放0.9889298893；referenceCell512、displaySize480，世界缩放0.9375；中性主体约268px→251.25世界像素 |
| 根点 | 延用colliderOffsetX=6、colliderOffsetY=-20；镜像脚点补偿保持现有逻辑 |
| 动作节奏 | 原39项frameDurations逐项保留；450ms蓄力、180ms快速下抽，总1500ms |
| 命中 | 从0计第21帧起点596.25ms；一次阈值跨越结算 |
| 音效 | 第8帧起点450ms；沿用现有音频，提前命中146.25ms，与旧版约145ms的提前量一致 |
| 判定与数值 | 320范围、26宽、物攻×2、1层流血、4500ms冷却；起手锁向/锁目标，命中仍核对目标、地表和障碍 |
| 正式目标路径 | assets/enemies/foreman_zombie/attacking_h3.png，纹理键仍为enemy_foreman_attack |
| 旧鞭层 | textures.attackWhipMode=baked后跳过旧曲线层，避免双鞭；保留石化冻结帧记录 |

`ForemanZombie`的动画、音效、命中已经共用同一动作时钟；本轮沿用，不创建第二个Tween或计时器。`BootScene`按配置切帧，实战由manualFrame取精确帧；本地Phaser的自定义帧duration也是绝对时长。石化按冻结时实际贴图/帧保持脚点，解除控制清理攻击快照；号召和死亡不改。

命中帧的离线参考：第21帧右侧鞭梢相对脚点约为(+331.88,-21.09)世界像素，已进入低位下抽；原320范围保持不扩张。该侧视源图只支持左右镜像，**上下/斜向仍沿用游戏锁向判定，图中鞭梢不能证明八方向逐像素对齐**。不为掩盖该限制拉伸身体、扩大伤害区或重新叠加程序鞭子；这也是用户后续需重点看的行为。

## 已批准的预算例外

按项目 `skill/16-character-sprite-production.md` 的boss档，目标128MiB、超过256MiB需要明确批准资产级例外。整套必须包含同时必需的召唤/伴生贴图，不只统计新攻击。以下为实际PNG宽×高×4的基础RGBA口径，按纹理键计数，非运行时显存实测。

| 资源 | 尺寸/帧数 | MiB |
| --- | --- | ---: |
| 工头待机 | 512×512 / 1帧 | 1.0000 |
| 工头移动 | 4096×2048 / 15帧 | 32.0000 |
| 工头号召 | 4096×2048 / 24帧 | 32.0000 |
| 工头死亡 | 4096×2048 / 14帧 | 32.0000 |
| 新攻击 | 3456×4000 / 39帧 | 52.7344 |
| **工头自身** | 五张表 | **149.7344** |
| 矿洞 | 400×320 / 静态 | 0.4883 |
| 普通矿工 | 4张4096×2048；1/14/24/13帧 | 128.0000 |
| 提灯矿工 | 5张4096×2048；1/18/30/22/15帧 | 160.0000 |
| 矿灯投射物 | 91×88 / 静态 | 0.0305 |
| **完整依赖组合** | 工头→矿洞→普通/提灯矿工＋矿灯 | **438.2532** |

替换前同组合约412.5891MiB，本次增量25.6641MiB。旧资源已经超额；两种矿工的9张大表、以及工头其余3张大表是主要占用，尤其矿工待机各只用1/32格。源图和运行时副本不会同时加载进同一纹理键，不重复计入运行时预算。

这一组合距512MiB受管理纹理稳态目标仅余约73.75MiB，距640MiB过渡目标约201.75MiB；仍需容纳其他敌人、友军、建筑和过渡重叠。共享烟雾/火焰等核心纹理、mipmap、渲染目标和驱动开销未计入，不能据此承诺目标设备性能。没有抬高全局纹理预算。

预算明细在 [budget/inventory.json](../tools/ai-gen/_foreman_h3_redo_20260831/budget/inventory.json)，以及同目录的四份依赖清单。旧矿工脚点按现有render参数登记，未做新视觉标定。用户已允许本次约438.25MiB既有依赖组合例外，标记为`exception_approved`，不是普通达标；未抬高全局限制，也未擅自降低其他角色画质。未运行预算检查器或性能验证。

## 正式接线与来源归档

运行时涉及`assets/enemies/foreman_zombie/attacking_h3.png`、`data/enemy-config.json`、`public/data/enemy-config.json`、`src/entities/enemy-types/foreman-zombie.js`（命中默认帧同步）、`src/effects/foreman-whip-visual.js`（旧鞭层开关）和`src/phaser/scenes/BootScene.js`（配置驱动注释，原加载链复用）；制作和来源记录位于`tools/ai-gen/_foreman_h3_redo_20260831/`。未修改通用战斗/召唤实现。

1. 两份配置均已启用`attackWhipMode=baked`，关闭旧曲线鞭层。实体仍保存石化冻结时的实际帧；动画、音效与伤害沿用同一逻辑时钟。
2. `install-approved-attack.py`已原样复制获准PNG，逐项修改两份enemy-config的工头攻击字段，保留其余内容、紧凑格式和并行编辑；不重采样、不改旧移动配置。导入前的工头配置单独保留于`before-h3-integration/`，没有保存其他角色的无关快照。
3. 已执行`--apply-runtime --budget-exception-note`并写入用户实际授权；正式清单为`assetOnly:false`、`runtimeIntegrationActive:true`。安装器后续准备清单不会把正式状态降回候选，也不会覆盖已保存的导入差异。例外只记录本资产组合，不扩权至其他角色或全局预算。
4. 旧豆包安装/交付脚本已加H3启用后的防覆盖门槛；获准源图的重建/色彩修复脚本禁止覆写该版本。重新制作必须另开版本。预览脚本保留正式状态，安装入口可再次从获准PNG恢复正式副本。
5. v01/v02/v03已否决的大文件（MP4、GIF、联系图、v02透明表及缓存）共18个具名文件/目录已可恢复移至仓库根`_tmp_foreman_h3_rejected_20260831/`，由现有忽略规则排除。活动目录保留提示词、provenance与拒绝原因；索引为`rejected_archived_metadata_only`，不再指向废案预览。获准v04的母图、视频、插帧前源表、原生中间帧直接输入、最终表/预览及制作脚本保留。H3移动候选未丢弃。

未运行测试或运行时验证，按约定由用户测试；未启动游戏/浏览器、构建、同步EXE或提交。用户重点查看：待机/走路切到攻击的脚点与体量、完整鞭身、下抽命中和音效、左右镜像及上下/斜向读感、石化冻结与解除、攻击中死亡、墙后目标和画面边缘。
