# 雪原五精英动画开工方向记录（2026-09-02）

## 统一合同

- 身份源：`../mother/` 下五张用户已批准精英母图；身份/材质参考与动作方向参考分开登记。
- 相机：略高、近正交、侧面占主导的低三分之四游戏镜头；不把武器、角或头部单独朝右当作身体朝向证据。
- 目标朝向：屏幕右。四足检查鼻端、胸腔、骨盆、膝/肘、足尖与步轴；人形检查头罩、胸腔、骨盆、双膝、靴尖与步轴。
- 根点：待机固定足底支撑中点；移动做原地步态、逻辑位移交给游戏；攻击保留动作自身的短促重心位移；死亡保留一次性自然倒地。
- 运行时左向未来只允许水平镜像，不为左向另造一套视频。
- 豆包参数：Seedance 2.0 Mini、5秒、1024×576、每动作1候选；循环动作请求 loop，攻击恢复中立，死亡单向停尸。

## 冰冠猞猁

- 身份源：`../mother/01-ice-crown-lynx-v01.png`。
- 同类动作参考：`../../_snow_mane_lynx_h3_20260901/videos/snow-mane-lynx-running-h3-v01_contact.png` 与 `snow-mane-lynx-attacking-h3-v01_contact.png`；核对 running f0/f11/f21/f32，attack f18/f31/f42。
- 方向结论：参考与母图均为清楚右向侧轴；精英关键帧必须保留四腿、短尾、黑耳尖、冰冠鬃与霜爪。
- 动作：原地快速跑；一次短促右前爪扑击，单次接触后收势。

## 冰脊战牛

- 身份源：`../mother/02-glacierback-war-ox-v01.png`。
- 同类动作参考：`../../_frostback_musk_ox_h3_20260901/videos/frostback-musk-ox-running-h3-v01_contact.png` 与 `frostback-musk-ox-attacking-h3-v01_contact.png`；核对 running f0/f16/f32/f48，attack f16/f21/f32。
- 方向结论：右向侧轴明确；关键帧必须保留四腿、两角、连续额甲和四片背部冰甲。
- 动作：原地沉重冲刺步态；一次低头顶撞，角端形成唯一接触峰值。

## 寒渊裂晶兽

- 身份源：`../mother/03-abyss-crystal-ravager-v02-six-spines.png`。
- 同类动作参考：`../../_abyss_rime_beast_h3_20260901/videos/abyss-rime-beast-running-h3-v01_contact.png` 与 `abyss-rime-beast-attacking-h3-v01_contact.png`；核对 running f0/f21/f43/f64，attack f80/f86/f96。
- 方向结论：楔形头、躯干和尾部主轴为右向；每个关键帧必须有四腿、一头、一尾和恰好六根可数主棘。
- 动作：原地低姿奔跑；一次右向张颌咬合，闭合后收势。

## 霜缚百夫长

- 身份源：`../mother/04-frostbound-centurion-v01.png`。
- 同类动作参考：`../../_frostbound_spearman_h3_20260901/videos/frostbound-spearman-running-h3-v01_contact.png` 与 `frostbound-spearman-attacking-h3-v01_contact.png`；核对 running f0/f16/f32/f48，attack f16/f27/f43/f64。
- 方向结论：母图为右向低三分之四展示姿态，不能直接以矛尖替代胸胯证据；移动/攻击都先用同身份右向关键帧。关键帧保留两臂两手两腿两靴和一支完整重矛。
- 动作：持矛原地跑；一次双手重矛直刺，唯一接触峰值后完整收势。
- v01 视频离线结论：`idle-doubao-v01.mp4` 与 `running-doubao-v01.mp4` 均因胸腔、骨盆和步轴转向镜头而拒绝；长矛继续指右不能抵消身体正面化。
- v02 方向修正：`frostbound-centurion-idle-keyframe-v02-source.png`、`running-keyframe-v02-source.png` 与 `attacking-keyframe-v02-source.png` 以面甲、胸腔、骨盆、双膝和双靴尖共同右向为放行条件；靴尖反向的中间稿已单点修正，最终三张均保留两臂两手两腿两靴和唯一一支完整长矛。
- 攻击时机：v02 攻击关键帧的矛头最远右向位置是唯一接触峰值；视频提示词将其固定在约 1.9 秒，禁止第二刺或横扫。

## 极夜大司祭

- 身份/材质源：`../mother/05-polar-night-high-priest-v02-elite-crown-candidate.png`；只继承缝合黑袍、裂冰金属肩甲、背部祭仪鳍冠、右手月牙晶杖与左手圣物铃，不继承该图的正面展示镜头。旧 `v01` 仅作历史记录。
- 同类动作方向参考：`../../_polar_night_cantor_doubao_20260902/previews/polar-night-cantor-running-doubao-v02-contact.png` 与 `polar-night-cantor-attacking-doubao-v01-contact.png`；核对 running f0/f31/f62/f93，attack 的有效右向段 f47/f57/f73/f93（f0-f46 的正面过渡明确排除）。同系动作关键帧 `../../_polar_night_cantor_doubao_20260902/references/polar-night-cantor-running-keyframe-v02-source.png` 与 `polar-night-cantor-attacking-keyframe-v01-source.png` 仅提供镜头、身体轴和道具分离方式。
- 项目人形怪角度复核：配置取 `data/enemy-config.json` 的 `polarNightCantor`、`frostboundSpearman`、`bombZombie` 与 `foremanZombie`。实际入库帧分别核对极夜祷徒 idle f0/f8/f14、running f0/f6/f12/f18/f24；霜缚矛卒 idle f0/f8/f14、running f0/f8/f16/f24/f31；炸弹僵尸 idle f0/f16/f32/f48、walk f0/f8/f16/f21；僵尸工头 walk 源 f0/f16/f32/f48/f64/f80/f96/f112。共同视觉不是标准纯侧身，而是略高的右向三分之四：可见一部分胸腹正面、近远肩和两腿前侧，同时头部、步轴与总体运动意图仍清楚朝右。
- 母图相机/姿态主参考：同族 `../../_polar_night_cantor_doubao_20260902/references/polar-night-cantor-v03-video-safe-1024x576.png`；辅助参考 `../../_bomb_zombie_20260829/mother/bomb-zombie-mother-v02-empty-hand.png` 与 `../../../assets/enemies/foreman_zombie/idle_single.png`。只参考略高右向三分之四的正侧比例和双腿分离，不继承普通祷徒、僵尸或矿工身份。
- v02 方向判退：法杖朝右，但头罩以下的胸腔、骨盆和双膝仍主要朝镜头，双靴尖向左右分开，属于“武器朝右替代身体朝向”的错误；眼平英雄展示镜头也不适合作为动画母图。
- v03 重调合同：略高、近正交、低三分之四游戏镜头，右向侧面占主导；头罩视缝、胸腔平面、骨盆、双膝与两只靴尖必须共享屏幕右向水平轴。中立站姿允许一脚略前一脚略后，但两脚尖都朝右；根点取双脚支撑中点。背部鳍冠、杖与铃彼此分离并完整留边。
- v03 用户判退：`../mother/05-polar-night-high-priest-v03-right-profile-candidate.png` 虽然解决了反向靴尖与正面步轴，但被修成接近纯侧身，胸腹、肩宽和精英冠饰的前侧信息损失过多，不符合游戏现有人形怪的右向三分之四视觉。该图保留作过度侧身边界，不再作为当前候选。
- v04 重调合同：以同族极夜祷徒母图为主，相机保持略高、近正交；身体为右向三分之四，侧面占主导但明确保留约三分之一胸腹正面。近侧肩完整、远侧肩较窄，腰带和骨盆形成右向斜面；两腿前后分离，两只靴尖总体朝右但允许看到靴面，不压成纯侧面剪影。背冠、单杖、单铃完整分离，根点仍取双脚支撑中点。
- v04 离线结论：`../mother/05-polar-night-high-priest-v04-project-three-quarter-candidate.png` 与同族极夜祷徒的正侧比例一致：头罩明确朝右，胸腹与前襟保留三分之四可读面，远肩收窄，骨盆形成右向斜面，两腿前后分开且靴面可见；没有退回 v02 的正面站姿，也没有越过 v03 的纯侧身边界。背冠、单杖、单铃完整且分离。第一稿 `exec-c5db8ce3-00fb-4a37-8b4b-777ed8be4817.png` 因仍偏正面判退，当前候选来自 `exec-5faea88f-f256-4b77-97d2-30c5f566e0cf.png`。
- v04 审批：用户已明确回复“可用，继续出视频”，`v04` 已转为批准母图；该批准仅放行动画制作，不替代动作方向核对。
- 动作关键帧：`references/polar-night-high-priest-running-keyframe-v01-source.png`（`exec-b6d82833-b1c9-4e3e-a558-b21b662d8cfc.png`）保留右向三分之四胸面、右向双靴步轴、唯一背冠/长杖/方铃；`references/polar-night-high-priest-attacking-keyframe-v01-source.png`（`exec-e4855ea6-b368-4424-8f79-1faea4e4d381.png`）保留同一角度并形成杖前指、铃抬胸侧的单一释放峰值。两张均通过离线结构、方向与留边核对后才提交豆包。
- 已通过源视频：`idle-doubao-v01.mp4` 根点和占框稳定；`running-doubao-v01.mp4` 完成多次左右脚交替且逻辑根点原地；`attacking-doubao-v01.mp4` 只有一次杖前指与铃抬起，约 1.3 秒进入完整释放姿态、约 3.3 秒开始收势，复用为三款初级魔法的攻击/施法动作。三条均未见错误缩放、持续横移、垂直根点跳变、正面化或纯侧身化，冠/杖/铃和双靴全程在框内。
- 死亡阻断：`dying-doubao-v01` 仅提交一次，原对话 `chrome://doubao-chat/chat/38439804399159810`。等待 1800 秒后只读检查确认豆包明确提示“今日视频生成免费额度已用完，本次将消耗付费额度”；未点击付费确认、未重复提交。需用户切换有免费额度的账号，或明确授权使用付费额度后，才可恢复同一任务。
- H3 切换：用户随后明确要求“换成minimaxH3做完”，因此豆包付费确认保持未点击，剩余死亡源视频改走 MiniMax H3。身份首帧继续使用 `references/polar-night-high-priest-mother-video-safe-1024x576.png`；相机与动作阶段参考已认可的 `../../_frostbound_spearman_h3_20260901/videos/frostbound-spearman-dying-h3-v01_contact.png`（f0/f32/f48/f59/f75/f96/f123）。目标仍为略高的右向三分之四、原地根点开始、一次下沉侧倒、约2.8秒后形成稳定末姿；模式 `one-way`，5.17秒/124帧/20步/单候选。
- H3 死亡验收：`videos/polar-night-high-priest/dying-h3-v01.mp4`（seed 902054，SHA-256 `e77307620bdc0cd422ac4c1ccaf50a00b794f1bc3a24ff578d7ecda221f7542f`）完成一次屈膝向右侧倒，f75 后进入低姿，f80-f123 无复起或第二次倒下；背冠、完整长杖和方铃随身体落地且未出框。尺寸抽样为 f0 238×473、f15 239×470、f31 238×453，开场无错误放大；最终 f93 474×198/中心(447.5,469.5)，f123 475×197/中心(447.0,469.0)，末姿稳定且所有抽样 `edge=False`。正式整段 GIF 与联系图位于 `previews/polar-night-high-priest/dying-h3-v01-preview.gif` 和 `dying-h3-v01-contact.png`。

上述母图和十张同角色动作关键帧须先离线核对身份、朝向、结构与安全留边，再允许提交豆包。用户批准母图和授权继续视频，不等于源视频自动通过；原视频仍需联系图与GIF逐段核对。
