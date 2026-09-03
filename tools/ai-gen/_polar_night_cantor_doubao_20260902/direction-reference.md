# 极夜祷徒动画开工方向记录

- 身份源：`../_frozen_normal_mothers_20260901/mother/05-polar-night-cantor-v03-structure-fixed.png`。
- 同类动作参考：`assets/enemies/frostbound_spearman/running.png` 与 `attacking.png`；配置为 `data/enemy-config.json` 的 `frostboundSpearman`。
- 已查看的 0-based 阶段：running f0/f10/f20/f30，attack f0/f10/f22/f40；同时查看了正式 running/attack 联系图。
- 相机：略高、正交感、侧面占主导的低三分之四视角；不把右向武器当作身体朝向证据。
- 身体朝向：面罩开口、胸腔、骨盆、双膝和靴尖保持朝屏幕右；运行时左向只做水平镜像。
- 步轴：沿屏幕水平轴向右，running 只做原地步态，逻辑位移由游戏实体提供。
- 根点：双脚支撑中点为站立/移动根；待机固定水平根，攻击只允许动作自身的小幅重心变化，死亡保留自然倒地。
- 身份硬约束：两臂、两手、两腿、两靴、一个手铃、一根短仪式杖；黑灰罩袍、霜蚀短披肩和面罩不重设计。
- 初版关键帧结论：v03 母图具备清晰右向身体轴与完整下肢，安全 16:9 参考只做等比缩放和白底排版。豆包 running v01 虽形成步态，但从首帧起删除短杖，已判退且不进入抠图/RIFE。
- running v02 动作关键帧：`references/polar-night-cantor-running-keyframe-v02-source.png`，由内置 ImageGen 对身份母图做身份保持编辑；`references/polar-night-cantor-running-keyframe-v02-1024x576.png` 仅等比排入白色 16:9。该帧保持面罩/胸胯/膝足右向、两腿交替姿态、左手铃与右手完整短杖，通过离线关键帧核对，作为豆包 v02 的唯一参考。
- 攻击定义：一次普通的短杖前刺/短促正面击打，命中后完整收势；手铃留在左手，不增加法术、光效、召唤或第二次攻击。
- attack v01 动作关键帧：`references/polar-night-cantor-attacking-keyframe-v01-source.png`，由内置 ImageGen 对身份母图做身份保持编辑；`references/polar-night-cantor-attacking-keyframe-v01-1024x576.png` 仅等比排入白色 16:9。关键帧保留右向身体轴、站立双脚、左手铃与右手完整仪式杖，杖端形成唯一前向接触峰值，通过后交给豆包生成起手—单击—收势。
- 正式视频结论：idle v01 保持右向三分之四站姿；running v02 的 f21 与 f49 为同足相端点，正式循环使用 `[21,49)`；attack v01 的 f0-f46 包含正面过渡，明确排除，正式动作从 f47 起保持右向并只完成一次短杖直刺；dying v01 使用 f12-f72，f64 后进入稳定尸体状态且不复起。
- 正式透明图集结论：四动作没有水平/垂直非等比缩放；idle/running/attack 的支撑线保持 y187-188 对齐 `footY=188`，死亡保留自然倒地位移。运行时左向仍只使用水平镜像。
