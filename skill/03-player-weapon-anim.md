> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：3. 玩家角色与武器动画

## 3. 玩家角色与武器动画

### 玩家角色动画标准工作流（射击/近战新动作一律按此开展，2026-07-26 定稿）

#### 0. 设计原则（先读，违反必返工）
- **分层不烘焙**：武器/装备永远不画进身体帧。AI 只出"空手持握状"的身体动作，武器用程序贴图叠加（枪械 360° 程序旋转已实现）；**不让 AI 画枪，也就永远不用抠枪**。
- **帧数克制**：AI 帧间必抖，帧数越少越稳；对齐前先提高 alpha 阈值区分本体与残影。
- **平面内动作**：侧视朝右、无镜头运动；不做转身/透视缩放/遮挡穿越（AI 一致性崩塌区）。360° 全身瞄准动画是伪需求，禁止走这条路。
- **换装 = 整套皮肤换纹理键**（一套铠甲一整套角色变体），不做单件叠加纸娃娃（无骨骼系统必错位）；头盔/背包/披风类低贴合挂件可单独锚点叠加。

#### 1. 姿态规划（立项先定清单与帧数）
- **优先级**：gun_idle/gun_fire（枪械主力，最急）→ hurt → death → bow_draw/bow_release → reload → 新近战攻击动作。
- **帧数规格表**：

| 姿态 | 帧数 | repeat | 备注 |
|---|---|---|---|
| idle / gun_idle | 1~4 | -1 循环 | 呼吸即可 |
| walk / run | 沿用现有 | -1 循环 | 不重做 |
| attack_sword（已验证） | 8 | 0 | 标杆规格 |
| gun_fire | 2~4 | 0 | 含后坐上跳 |
| hurt | 2~3 | 0 | 受击反馈 |
| death | 6~10 | 0 | 末帧定格 |
| reload / bow_draw | 6~8 | 0 | |

#### 2. AI 素材生成规范
- 固定一张角色基准图；**所有动作从同一首帧 img2video 出发**，保证跨动作一致性。
- 侧视朝右、全身入画、脚底贴底边、画布对齐 512×516、透明/纯色底。
- 提示词写"**无武器、空手呈握持/挥击状**"；干净输出三件套：透明底、无白色描边/辅助线、无水印。
- 同一套动作**一批出齐**，不分开生成（分开必出规格差）。

#### 3. 素材管线（入库前必过）
- 切帧 + 抠图（边界泛洪 / alpha 阈值清零）。
- 标准化：内容高度统一、底部对齐（`tools/sprite-normalizer.py` 或既有切帧脚本；帧尺寸严格 = 帧宽×列×行，不足补透明行）。**尺寸基准（2026-07-26 定稿）：以剑姿态为准——内容高 477px、脚底基线 y=492（512×516 画布）；新姿态一律缩放到该基准**（枪姿态系列已按此放大 1.084，绕髋点缩放 + 逐帧独立处理多帧 sheet）。
- 复制进 `assets/player/` 或 `assets/character/`（原则 9），命名 `player_<动作>.png`。

#### 4. 配置接入（唯一真相源，`data/` ↔ `public/data/` 双份同步）
`data/player-anim-config.json` 加条目：
```json
"gun_fire": {
  "type": "sheet", "src": "assets/player/gun_fire.png",
  "frameWidth": 512, "frameHeight": 516, "cols": 8, "rows": 1,
  "frameCount": 4, "frames": [0, 3], "frameRate": 12, "repeat": 0
}
```
- `repeat`：-1 循环（idle/walk）/ 0 播放一次（attack/hurt/death/gun_fire）。
- `frameDurations`（可选，ms/帧数组，2026-07-27 新增）：逐帧时长覆盖均匀帧率——如攻击末帧定格更久（`"frameDurations": [83,83,83,83,83,83,83,300]`）。总时长=各帧之和，武器轨迹 Tween 经 `animDef.duration` 自动同步，武器 30 点轨迹无需联动改；调节奏只报比例即可（助手换算成 ms 写双份 JSON）。
- `frameWeights`（可选，占比数组，推荐）：按权重分配**原总时长**——总时长锁定（帧数/帧率），只改各帧占比（如 `"frameWeights": [1,1,1,1,1,1,1,3]` 末帧占 3/10），武器轨迹/命中时序零影响。调节奏优先用它；frameDurations 仅用于需要改变总时长的场景。**开发面板预览已同源（2026-07-27）：面板自动读取 weights/durations 并按累计时长窗口定位角色帧，调节奏只改配置即可，无需手动同步面板**；面板 fps 输入框手动输入时仍按均匀帧率预览（调试覆盖语义保留）。**时长陷阱（2026-07-27）**：Phaser `Animation.duration` 只按 frameRate 派生、无视逐帧时长——凡取动画时长必须 `getPlayerAnimDurationMs` 优先（它认识 weights/durations 求和），否则贴图与武器轨迹/命中 Tween 脱节（"慢半拍"根因）。
- 纹理键自动 = `player_<键名>`；BootScene 加载注册、开发面板预览**全部自动生效，无需改代码**。
- **面板登记（2026-08-02 补充）**：新增姿态**不是完全自动**——除 JSON 加条目外，还必须在开发面板登记三处：`src/ui/panels/dev-tools.js` 的 `animOptions`（下拉显示名）+ `src/ui/dev-tool.js` 的 `ANIM_NAME`（状态名）与 `PANEL_ANIM_TO_CONFIG`（面板键→配置键映射）；新增武器同理登记 `weaponOptions` + `WEAPON_MAP`（贴图路径读 `weapon-texture-map.js` 加载清单同源）。漏登记 = 面板看不到该姿态/武器（V0.375 施法动画首漏，已补）。

#### 5. 运行时姿态切换
- **近战攻击（模板已内置）**：`_playSwordAttackTween` → `setPlayerAnimation('attack_sword', tweenDuration)`（timeScale 贴图-Tween 时长同步）；repeat 0 动作播完自动回 idle（配置表通用处理）。
- **持枪姿态（已实现，2026-07-26）**：`GameScene._updatePlayerAnimation`——当前武器为枪械（`isGunWeapon`）且站立时姿态键切 `gun_idle`，移动沿用 walk/run；配置缺失自动回退 idle。首版 `gun_idle` 为低持/腰射单帧（素材库 shooting/2.png 抠底标准化，`tools/archive/prep-gun-idle.py`）；斜上/斜下角度分区姿态与 `gun_fire` 待素材。
- **近距角度平滑（2026-07-27，取代瞄准死区/可调锥）**：死区已废除（冻结手感差）。`twist.aimSmoothRadius`（默认 160 世界 px，0=全距离精准零平滑）+ `aimSmoothTau`（默认 120ms）——任何距离用真实瞄准方向（弹道零误差）；准心进半径后对瞄准角做短弧 EMA，tau×(1−dist/R)（边缘零延迟→中心最强，dt 归一化帧率无关）。姿态/贴图/锚点/**弹道**统一走 `_effectiveAim`（`_frozenAimActive` 标记沿用=平滑激活）。"枪械近战弱"改为用 tau 体现（加大 tau 如 250 更"肉"）。
- **手臂条层（单骨伪 IK，2026-07-26）**：`twist.arm { src, pivotX, pivotY(肩关节), handX, handY }`——双臂整体一条刚体贴图（躯干原位抹臂），`_syncGunArm` 每帧 `rotation = atan2(枪握把 − 肩) − 自然角` 追随握把，肩随躯干扭转绕腰轴旋转，翻转用 `_arm_flip` 烘焙镜像；深度在躯干与枪之间。**纯只读增量层，不改锚点/扭转逻辑**；躯干钳制之外的角度由它补齐（正上/正下不错位）。
- **上半身分层扭转（360° 瞄准定稿，2026-07-26）**：姿态条目配 `twist: { legsSrc, torsoSrc, pivotX, pivotY, maxAngle, angleScale, walkLegs? }`——素材在同一 512×516 画布上按髋关节节线裁腿层/躯干层（轴心=髋关节间脊柱末端）；BootScene 自动加载 `player_<key>_legs/_torso`（及 `_walklegs` 走腿 sheet）；`GameScene._syncGunTwist` 每帧：躯干层原点=轴心、贴腰轴世界点、按瞄准角（面向系相对角，±0.05 翻转死区）×angleScale 钳制 ±maxAngle 旋转、左瞄换 canvas 烘焙的 `_torso_flip` 镜像贴图+镜像原点（不用 flipX）、腿层翻转覆盖；`syncWeapon` 枪锚点绕同一腰轴旋转（手转枪跟），枪旋转仍精确 atan2。**裁腰预览先用 PIL rotate(center=pivot) 离线验证接缝再上引擎**。持枪移动：`_updatePlayerAnimation` 检测 twist.walkLegs 时腿层播走腿动画、躯干保持（冲刺 timeScale 1.5）。**铁律：play() 前必须 setTexture 同源**（扭转腿层残留会卡动画第一帧，"上半身消失+腿不动"根因）；**`anims.stop()` 后 `currentAnim` 引用不清空**——凡按 currentAnim 做状态判断的（如逐帧跟随），必须同时校验 `isPlaying`（"idle 错位"根因）。**走腿裁片流程（定稿）**：躯干裁线取骨盆完整位（295）让大腿顶藏进骨盆下叠合；walk sheet 按节线裁出后做连通域分析**只保留最大的 2 个组件（两条腿）**——脚底对齐/时序过滤会误伤腿顶，禁用；与腿同连通域的手部残片只能人工逐帧修。**走腿与 idle 对齐（2026-07-26 定稿）**：按 idle 基准（髋 X=217 / 脚底 Y=500）逐帧平移烘焙 sheet——walking 与 idle 天然一致，不要用逐帧髋部跟随机制（已废弃移除，`anims.stop()` 后 `currentAnim` 引用不清空的陷阱也随之失效）。`twist.torsoShiftY`（世界 px）为躯干整体下移微调，统一加在腰轴世界 Y（躯干/肩/枪锚点随动）。
- 新姿态切换一律按武器类型/状态从配置表查键，**禁止新增硬编码分支**。

#### 6. 武器贴合调参（左下开发面板）
- **攻击类动作**：面板切"攻击" → 拖帧滑块逐帧摆武器 → 💾保存（写 `attack.frames` perFrame）；▶播放 + `#devToolFps` 输入框预览时长同步观感。新近战动作同一流程。**拆帧无配置时自动播种 30 帧同一基线位置（2026-07-27）**，进入攻击页即可开调；右上角重置键 = 一键把当前动画恢复初始状态（attack=全帧回种子基线，其他=恢复已保存配置；种子只改内存，💾保存才落盘）。
- **朝向翻转（2026-07-27 终极绑定）**：**近战武器朝向一律 = `playerSprite.flipX`**（身体是唯一权威，V0.296 起）——攻击逐帧/定格/收势滑行/idle/walk/副手全部直接读身体 flipX，禁止任何独立的武器朝向判定/捕获；身体 flipX 由 `GameScene._getVisualFacingRight`（|cos(rotation)|>0.05 滞回，存 `player._facingRightVisual`）驱动，攻击/定格/收势期间身体冻结故武器自然冻结。枪械走 twist 面向（±0.05 同源语义）。**近战朝左贴图用 flipX**（关系式 M∘Rot(R)=Rot(−R)∘M；旋转码 π−idleRot 恰等于 −R_r 正确镜像角，补 flipX 构成垂直轴完整镜像——与攻击 perFrame 分支"旋转取反+flipX"同惯例）；位置镜像由 localToWorld 完成。

- **挥砍特效 A+B（2026-07-27 落地，2026-07-29 改残影实现）**：perFrame 帧数据可加 `blurX/blurY` 与 `stretchX/stretchY`（乘 displaySize）——插值/面板输入/保存直写全链路支持；播种用帧间位移推导（峰值帧最强，端点为零）。**游戏内运动模糊 = 残影（afterimage）**：`GameScene._syncWeaponGhosts` 沿 perFrame 轨迹回放 3 道历史姿态武器副本（透明度 0.34/0.23/0.11 递减，步长 0.035~0.085 进度随强度伸缩，强度=max(blurX,blurY) 归一到峰值 12，<1.5 不出残影）——攻击/冲刺两分支共用，攻击结束/弓分支/Tween 分支/地图模式各兜底隐藏。**旧高斯滤镜方案已废弃**：`filters.internal.addBlur` 链路实测"激活但观感失败"——高斯模糊对 3px 宽细剑是能量摊薄，峰值帧剑身近乎消失（CDP 像素级对比取证），且面板大尺寸慢放预览放大了"生效"的错觉。面板预览模糊仍是 canvas filter 近似。
- **📍固定点工具（2026-07-27）**：武器参数区下方按钮——点击进入放置模式后点画布武器即标记（存武器局部坐标，逆变换：平移→反向旋转→÷缩放），红点刚性跟随武器跨帧显示（校准握把/刃尖用）；有标记时点按钮=清除。**面板 DOM 改动注意**：真实面板 DOM 由 `src/ui/panels/dev-tools.js` 程序化构建，`ui/components/dev-tool-panel.html` 是无引用的死文件，勿改。**攻击输入全锁**：`weaponAnim.isAttacking` 期间移动/闪避/新攻击/切武器/冲刺/右键特殊攻击/风车/推击全部无效（注意：闪避不再能取消攻击）。
- **近战连段与收势（2026-07-27；三段已落地 2026-08-13）**：perFrame 攻击 Tween 结束时记 `_lastMeleeAttackEnd` 并设 `_attackHoldUntil`（=连段窗口）——窗口内定格末帧等待连段；窗口内再攻击派生下一段；无输入则播 `recover` 收势动画回 idle；移动立即取消定格/收势。攻击期输入全锁（见 📍固定点工具条目）。**三段连段（挥击×2+突刺×1，2026-08-13）**：stage 1 过顶下劈 `attack_sword`（12帧/600ms）→ 2 肩高快劈 `attack_sword_2`（12帧/600ms）→ 3 弓步突刺 `attack_sword_3`（16帧/800ms，终结段）→ 回 1；段数映射/定格/收势梯度收口 `src/entities/player/anim-state.js`（`MELEE_STAGE_ANIM_KEYS`/`meleeStageCfgKey`/`meleeStageHoldMs`/`meleeStageRecoverMs`，纹理/轨迹块缺失逐级回退 stage3→2→1），时长配置 `data/combat-config.json` `meleeCombo.stageN{HoldMs,RecoverMs}`（500/200/**0** + -/300/400；2026-08-16 用户指定：终结段播完直接收势回 idle，不留定格窗口——三连击严格 1→2→3→收势，无 3→1 回环，想恢复回环改回 300）；武器轨迹块 `sword.attack/attack2/attack3`（12/12/16 点，attack3=rect 判定 damageMul 2.0，初始种子值待 DevTool 逐帧精调）。新 sheet 格 512×512（管线 `tools/prep-melee3-sheets.py`，色偏中性化+留档），frameWeights 口径已退役统一 frameDurations。

- **逐帧导出交接（2026-07-27 改为直写）**：💾保存 = 内存生效 + **直接合并进 `public/data/weapon-anim-config.json`**（保留 attack 下 trail 等字段，写前滚动备份 `weapon-frames/weapon-anim-config.backup.json`）+ 覆盖写 `weapon-frames/latest.js`（仅记录/回滚参考）+ 剪贴板。**保存即永久生效，无需通知助手合并**；Vite 走 `/__save-weapon-frames` 中间件（改中间件需重启 dev server），Electron 走 `save-weapon-frames` IPC。需回滚时用 backup.json 还原或叫助手处理。**多段轨迹（2026-07-27）**：`attack`/`attack2` 块各存一段轨迹，面板切对应动画页调整即按块保存；运行时连段按 `_meleeComboStage` 选块；`WeaponTransform.getInterpolatedPerFramePosition(..., cfgKey)` 支持选块。
- **静态姿态**（gun_idle 等）：面板拖武器到手上 → 💾保存（每状态 `holdOffsetX/Y + idleRotation/idleScale`）。
- **枪械握把轴心（2026-07-26）**：`WeaponAnimConfig[wt].grip {x, y}`（贴图内握把点 0~1 分数，缺省中心）——游戏内/面板统一以握把为旋转轴与锚点（360 瞄准不滑手）；扭转激活时锚点在躯干空间计算（禁止 localToWorld 按 player.rotation 公转，否则与扭转轨道叠加成双重旋转）。
- **冲刺攻击 Lerp 模式（2026-08-12）**：`sword.dashLerp { type:'lerp', grip:{x,y},
  from:{x,y,rotation}, to:{x,y,rotation}, scale, stretchX/Y, blurPeak }`——剑柄锚手 +
  起始/结束双端点线性插值（位置 + 角度），替代 30 帧 perFrame 手调。铁律：
  ① 角度**字面线性**（不做短弧解卷绕——端点 -100°→115° 是大扫意图，解卷绕会反向扫）；
  ② `origin = grip`（翻转时 X 镜像 1−x）→ 旋转绕剑柄 → 剑柄钉在插值位置、剑身绕手转；
  ③ **非冲刺路径必须复位 origin 0.5**（`_syncSpecialWeaponAnim` 只在 isSpecialAnim 调用，
  普通攻击路径自行复位，否则残留绕剑柄旋转）；④ 旧 `dash` perFrame 数据保留可回退。
  调参只动 from/to（起止剑柄位置+剑身角）与 grip（剑柄贴图内分数位置）。单测
  `scripts/test-dash-lerp.mjs`、实机探针 `tools/cdp-dash-lerp.mjs`。

#### 7. 验证
- JSON 双份一致；lint / vite build / test-collider。
- **实机清单**：姿态切换（站立/移动/攻击）、左右镜像 flipX、贴图与武器轨迹时长同步、repeat 0 播完回 idle、面板预览与游戏一致、**主神空间+地牢双场景**（原则 10 全场景生效）。

---

### 阶段性进度总结（2026-07-26 深夜：手枪姿态系 + 跑步系 + 瞄准死区）

#### 本次完成：三姿态体系 / 跑步腿层与体感 / 瞄准死区可调锥（实机达标）
1. **三姿态自动切换**：`gun_idle`（长枪低持）/ `gun_idle_pistol`（单持前伸）/ `gun_idle_dual`（双持双臂前伸）——`_resolveGunPose()` 按主/副手武器类型解析，移动中换武器也能正确重建分层（姿态键变化即 setPlayerAnimation 修复）。用户 AI 出图（纯黑底）→ 阈值抠图+暗邻域轮廓还原 → 477/492 基准化+髋部对齐 217 → 裁躯干/手臂条 → 描边膨胀加粗统一旧骷髅线条。
2. **跑步腿层**：`gun_run_legs`（running.png 裁下半身+top2 连通域+逐帧对齐 217/492+出帧钳制）；走/跑自动切换（原生帧率，弃 timeScale hack）。
3. **体感系统**：`bodyBobY`（走/跑逐帧头顶 Y 起伏）+ `bodyBobX`（逐帧髋 X 前后摆，bobXScale 默认 0.5；run/walk 全覆盖）——数据驱动自原动画，isPlaying 防御 stop() 残留。
4. **瞄准死区+可调锥（枪械近战弱设定落地）**：`aimDeadZone`(160px) + `aimDeadZoneCone`(20°)——死区内以进入时自由角为基准仅 ±cone 可调；姿态/贴图/锚点/**弹道**四通道统一 `_effectiveAim`，贴身扫射沿基准散开，近战武器获得空间。
5. **副手同口径**：`_computeGunAnchor` 提取主副手共用；副手补 grip 轴心（flipY 补偿）；`WEAPON_TRANSFORM_CONFIG.pistol.offBase` 改 (-23,19) 锚定双持低手位。
6. **后坐上身**：`twist.recoilTorsoScale`(默认 0.3) 开火时 recoil 反向作用于腰轴。
7. **微调配置族**：`torsoShiftX/Y`（躯干整体微调，翻转镜像）；手枪类贴图 idleScale 0.6 + holdOffset 多轮微调（面板→助手合并流）。

#### 关键改动文件
- `src/phaser/scenes/GameScene.js`（_resolveGunPose/_syncGunTwist/_syncGunArm/_computeGunAnchor/死区逻辑）
- `src/phaser/scenes/BootScene.js`（walkLegs/runLegs 循环加载注册 + torso/arm 镜像烘焙）
- `src/entities/player/subsystems.js`（弹道死区改写）、`src/combat/weapon-transform.js`（pistol offBase）
- `assets/player/gun_idle_pistol*.png`、`gun_idle_dual*.png`、`gun_run_legs.png`
- `data/player-anim-config.json`（双份）、`public/data/weapon-anim-config.json`

#### 验证状态
- `npm run lint` ✅（0 error）、`npx vite build` ✅、`test-collider` ✅、`test-craft-sync` ✅
- 实机用户确认：双持/双手武器贴图动画"接近预期标准"

---

### 阶段性进度总结（2026-07-26 晚间：持枪瞄准体系全套落地）

#### 本次完成：姿态层 + 分层扭转 + 手臂条 + 锚定体系（ROADMAP 任务1 主体收官）
1. **姿态层**：`gun_idle` 低持姿态（素材库 shooting/2.png 重管线）；`player-anim-config.json` 驱动，`isGunWeapon && 站立` 自动切换。
2. **上半身分层扭转（360° 瞄准）**：`twist { legsSrc, torsoSrc, pivotX, pivotY, maxAngle, angleScale, walkLegs, arm, torsoShiftY }`——腿层站死、躯干绕腰轴 ±40°、左瞄 canvas 烘焙 `_torso_flip` 镜像贴图（不用 flipX）；走腿 sheet 按 idle 基准（髋 217/脚 492）逐帧烘焙对齐，walking=idle 天然一致。
3. **手臂条层（单骨伪 IK）**：双臂整体一条（躯干原位抹臂），`_syncGunArm` 每帧 `rotation = atan2(枪握把 − 肩) − 自然角`；锚点连续化模型——钳制内腰轴轨道、超出角以肩为支点旋转钳制点（圆过钳制点，边界零跳变）。
4. **锚定体系**：`grip {x,y}` 握把旋转轴心（滑手修复，flipY 时 gcy 取反保持左右镜像）；扭转激活时锚点在躯干空间计算（禁 localToWorld 公转=双重旋转）；攻击/奔跑等未配置状态回退=全局 holdOffset（AKM 全局对齐防跳变）。
5. **双手枪开火禁跑**：`isGunWeapon && isTwoHanded && leftDown` → sprint 解除退回 walking（PKM 系保留 50% 减速语义）。
6. **尺寸基准统一**：新姿态一律内容高 477/脚底 y=492（剑基准）；枪姿态系列绕髋点 ×1.084 放大并逐帧处理多帧 sheet。
7. **面板**：WEAPON_MAP 与 `getWeaponTextureLoadList()` 同源；image 型姿态预览；持枪移动分层合成预览；枪械握把锚点绘制；walk 保存写状态子块；逐帧导出 `weapon-frames/latest.js` 交接流首航。
8. **排障沉淀**：play() 前必须 setTexture 同源；`anims.stop()` 后 currentAnim 引用不清空（判断动画状态必须并查 isPlaying）；`getAmmoConfig` 消费端回退（无法开枪排查手册）。

#### 关键改动文件
- `src/phaser/scenes/GameScene.js`（setPlayerAnimation/_syncGunTwist/_syncGunArm/syncWeapon 锚点链）
- `src/phaser/scenes/BootScene.js`（配置驱动加载 + 镜像烘焙）、`src/config/player-anim.js`（新增）
- `src/entities/player/weapon-anim.js`（tweenDuration 贴图同步）、`src/entities/player/update.js`（双手枪禁跑）、`src/entities/player/subsystems.js`（弹药回退）
- `src/ui/dev-tool.js`、`src/ui/panels/dev-tools.js`、`vite.config.js`、`electron/main.js`、`electron/preload.js`
- `assets/player/gun_idle*.png`、`data/player-anim-config.json`（双份）、`public/data/weapon-anim-config.json`

#### 验证状态
- `npm run lint` ✅（0 error）、`npx vite build` ✅、`test-collider` ✅、`test-craft-sync` ✅
- 实机用户确认：idle/walking/360° 瞄准/左右镜像/开火/禁跑/尺寸统一 全部通过（"完全成功"）

---

### 阶段性进度总结（2026-07-26 玩家动画体系）

#### 本次完成：玩家动画配置化 + 开发面板姿态层 + 攻击时长同步（ROADMAP 任务1 方向1/2/3）
1. **配置表 `data/player-anim-config.json`**（双份 public/）+ `src/config/player-anim.js`：纹理键约定 `player_<动画键>`；BootScene 加载/注册、GameScene `setPlayerAnimation` 全走配置表。**新增玩家姿态 = 素材入库 + JSON 加条目**（type=image 单帧 / sheet 配 frames 区间+frameRate+repeat），运行时与开发面板自动生效，无需改代码。
2. **攻击时长同步（根因修复）**：关键帧/默认 Tween 路径 900ms vs 贴图 667ms 各播各的——`setPlayerAnimation(key, targetDurationMs)` 用 `anims.timeScale` 对齐，回 idle/循环动画归 1；`_playSwordAttackTween` 只主手触发贴图动画。
3. **开发面板**：角色帧加载改读配置表（`PANEL_ANIM_TO_CONFIG` 映射 running→run/attack→attack_sword），帧裁剪支持 `firstFrame` 偏移；播放帧率读配置 frameRate + 面板 `#devToolFps` 可覆盖。
4. **挂载点+关键帧系统删除（同日二轮）**：handAnchors/gripOffset 与 keyframes 生产配置零使用、单点锚无法帧间跟手（perFrame 已全覆盖）——dev-tool.js -755 行、weapon-transform.js -147 行、weapon-anim.js/GameScene.js/panels/dev-tools.js/dev-tool-panel.html 同步清理。最终模型：**攻击=perFrame 逐帧（无配置走默认三段 Tween 链），静态姿态=每状态 holdOffset**。
5. **待办**：拉弓/持枪/受击/死亡姿态素材由用户备料，到位后 JSON 加条目即可。

#### 关键改动文件
- `src/config/player-anim.js`（新增）、`data/player-anim-config.json`（双份）
- `src/phaser/scenes/BootScene.js`、`src/phaser/scenes/GameScene.js`、`src/entities/player/weapon-anim.js`、`src/ui/dev-tool.js`

#### 验证状态
- `npm run lint` ✅（0 error）
- `npx vite build` ✅
- `node scripts/test-collider.mjs` / `test-craft-sync.mjs` ✅

---

### 阶段性进度总结（2026-07-27：腰射⇄瞄准 aimFrames 帧动画重做落地 + 实机达标）

#### 本次完成：AI 视频驱动 14 帧抬枪动画（V0.251 失败复盘后重做，V0.253~263 实机调优达标）
1. **机制**：`twist.aimFrames { src, frameCount:14, transitionMs:250, hands[14], liftAdjustX, liftAdjustY }`（gun_idle，全体双手枪械共享）——长按右键 `_aimEase` 0→1 **线性**推进（指数趋近回程拖 1s 尾巴变形，已废弃），手臂条按帧播放（腰前(366,210)→肩高(338,110)），锚点 = 肩 + R(世界瞄准角−帧自然角)×(帧手−肩) + (liftAdjustX 翻转镜像, liftAdjustY) 按 ease 与旧链 blend。
2. **三根因教训（写死防再犯）**：①aimEase 推进条件**不得**引用表现配置（`twist.aimFrames || twist.aimLift` 任一存在即推进——V0.251 因推进条件引用被删的 aimLift 导致 ease 恒 0"无动画"）；②帧分支**只在 `_aimEase>0` 接管**，ease=0 必须逐像素等价旧路径（V0.251 无条件接管 + pivot 低 39px 导致 idle 错乱）；③视频提取**禁用模板减法**（`tools/aim-frames-extract.py`：色度键控+模板互相关配准+三路并集分离；旧脚本卷积核翻转 bug 使配准全顶裁剪边界）。
3. **渲染/素材坑**：`textures.addCanvas` 的镜像 sheet 需手动 `tex.add(i,0,x,y,w,h)` 补帧才能 setFrame；canvas mirror 烘焙 translate 的 Y 分量必须为 0（误写 i*fw → 帧 1~13 全画出画布外，朝左瞄准手臂消失）；提取后逐帧扫"邻帧独有连通域"（帧 11 曾泄漏 446px 头部碎片，清理已固化进脚本幂等）。
4. **双手枪冲刺开火（V0.262/263）**：开火=非奔跑——`_twoHandedGunFiring` 从 `_isSprinting` 与烟尘门排除（腿回 walklegs、武器回 walking 位、不出烟尘）；**注意第二道闸**：枪开火 `weaponAnim.state='attacking'` 会触发 `_updatePlayerAnimation` 的"攻击不覆盖"early-return 冻结腿层——已加枪械放行（近战守卫不变；枪攻击动画在武器层，playerSprite 只载腿/躯干）。
5. **武器位置基准（AKM 标准，六双手枪械已逐字段同步）**：holdOffsetX −64 / holdOffsetY −4（top/idle/walk 全状态块）、grip (0.29,0.54)、idleScale/idleRotation 统一；**合理保留的 per-weapon 差异**：muzzle（按各自贴图枪管实测）、recoilAmount/timingMul/renderParams（手感参数）。手枪类基准=沙漠之鹰（另一族，不混）。
6. **回退路径**：删配置里 aimFrames 节即自动回 Tier1 aimLift 抬升（配置保留休眠）；完整回退点 `backup/2026-07-27-aimanim/`（纯 aimLift）与 `backup/2026-07-27-aimanim-v2/`（重做前快照）。

---

### 阶段性进度总结（2026-07-28：近战连段体系 + 攻击范围重构 + 挥砍特效 + 贴图标准化）

#### 本次完成（V0.291~V0.302）
1. **近战连段体系**：一段（attack_sword 8帧）→ 定格 0.5s（连段窗口）→ 二段（attack_sword_2 30帧/1.5s）→ recover 收势（13帧/0.33s）→ idle。攻击期输入全锁（移动/闪避/新攻击/切武器/冲刺/特殊攻击）；移动立即取消定格/收势。
2. **朝向硬绑定（结构级）**：近战武器朝向一律 = `playerSprite.flipX`（身体是唯一权威）——攻击逐帧/定格/收势滑行/idle/副手全部直接读身体 flipX，独立朝向判定已删除。教训：setPlayerAnimation 曾用 _facingDir（45° 边界）与武器的 ±0.05 滞回（87° 边界）冲突；`_attackHoldFacingRight` 捕获在连段时泄漏（二段沿用一段朝向）——双重教训后统一为身体 flipX 单源。
3. **攻击范围重构（配置驱动）**：`sword.attack.hitCheck { frame:22, shape:'rect', knockback:50 }`（一段矩形：宽恒定、长=武器 attack.range、第 22 帧判定）/`sword.attack2.hitCheck { frame:15, shape:'sector', arcDeg:120, knockback:75, damageMul:1.5 }`（二段扇形：footprint 相交、击退 75px、伤害×1.5、第 15 帧判定）。攻击方向固定玩家左右两侧（鼠标只选左右）。
4. **挥砍特效 A+B**：perFrame 帧字段 `blurX/blurY`（**V0.307 起改为残影实现**——高斯滤镜对细长武器是"摊薄消失"，实机像素级取证峰值帧剑身近乎不可见，已废弃；现由 GameScene 沿轨迹回放 3 道历史姿态残影，blurX/blurY 驱动残影长度/浓度）+ `stretchX/stretchY`（拉伸）；面板四输入可调，播种=帧间位移推导。面板预览 canvas filter 近似。
5. **贴图标准化管线**：武器贴图统一"内容宽比 + 中心分数"归一（AKM 基准 0.915/(0.500,0.543)，PKM 0.907/(0.496,0.543)）——AKM/201/Super90 已重制替换，枪口 muzzle 配置对齐；归一后尺寸=显示缩放×内容占比，"和 AKM 一样大"即同分母同占比。
6. **冲刺攻击动画**：`dash_attack` 17 帧 sheet（素材 attack-2.png 归一），trigger 时播放（timeScale 拉伸到技能 totalMs）；位移窗口帧驱动（前 12 帧位移、13~17 静止，`effect.moveFrames` 可覆盖）。
7. **其他**：挥砍音效起手播放（块配置 sound 字段）；弹壳落地留存 3s；子弹胶囊化（短粗椭圆+提亮）；双持副手开火位 offhandOffsetY 配置；右键瞄准打断奔跑（与开火同口径）；`spriteOffsetX/Y` 贴图独立偏移（只动贴图不动手臂/弹道）；人物+武器整体 +20%（spriteSize 144 / WEAPON_ANIM.size 126，碰撞与偏移不变）。

#### 关键改动文件
- `src/combat/attack.js`（checkStageHit/扇形/击退/固定左右）、`src/entities/player/weapon-anim.js`（连段/音效/hitCheck 触发）、`src/phaser/scenes/GameScene.js`（朝向绑定/收势滑行/模糊滤镜/spriteOffset/深度帧）
- `src/entities/components/dash-system.js`（冲刺动画+位移帧窗口）、`src/combat/projectile.js`（胶囊弹）、`src/phaser/scenes/BootScene.js`（胶囊贴图）
- `src/ui/dev-tool.js` + `panels/dev-tools.js`（模糊拉伸输入/固定点/attack2 页/直写保存/zoom 坐标）
- `public/data/weapon-anim-config.json`（hitCheck/特效帧字段/击退/offhand/spriteOffset）、`data|public/data/player-anim-config.json`（attack_sword_2/recover/dash_attack）

#### 验证状态
- lint 0 error、vite build、test-collider、test-craft-sync 持续全过
- 实机已确认：朝向绑定（facelog 取证）、攻击范围帧判定；挥砍模糊 V0.307 改残影后实机截图确认（此前"fxlog 取证"只证明滤镜激活，未验证观感——高斯方案已废弃）
- 未提交批次：V0.291~V0.302 全部在本提交

#### 后续计划
- **即梦 API 接入**（⚠ 截至 2026-08-04 未实施的计划，`tools/jimeng-gen.py` 尚不存在，勿当已有能力；用户已确认排期）：火山引擎视觉服务（jimeng_t2i_v40）文生图脚本 `tools/jimeng-gen.py`——提示词用本文件工作流标准模板；密钥由用户自建 `tools/.secrets/jimeng.json`（不入库、需加 .gitignore），不贴对话。接入后 AI 出图→标准化管线→入库全自动化；视频生成接口（动作动画截帧路线）作为二期。

---

### 武器动画调试基准（2026-07-26 定稿）

**两大基准武器**：手枪类 = **沙漠之鹰（deagle）**、双手枪械类 = **AKM**。所有贴图位置/动画调整先以这两把为基底标准，验证后同步到同类武器：
- **手枪类（单手持枪）**：pistol（G18）、deagle（沙鹰）、p4040——贴图位置/旋转/缩放/grip/muzzle/bobWeaponScale/dualOffsetX 以沙鹰实测值为模板同步。
- **双手枪械类（步枪/机枪）**：akm、pkm、qbz191、qjb201、shotgun、energy_lmg——以 AKM 实测值为模板同步。
- **贴图尺寸布局基准（2026-07-26 定稿）**：新武器贴图入库一律按类归一——步枪类：内容宽 0.915 / 中心 (0.500, 0.543) / 画布 2048²（AKM 布局）；手枪类：内容宽 0.862 / 中心 (0.487, 0.524) / 画布 2048²（沙鹰布局）。归一后必须重测 muzzle 分数坐标写入配置。
- 调参入口：`public/data/weapon-anim-config.json`（仅此单份）；开发面板调试→💾→助手合并的流程不变。
- **基准统一（2026-08-02 修复，防再犯）**：
  - **武器尺寸基准 = `WEAPON_ANIM.size`（126）**，禁止硬编码 105（2026-07-28 105→126 后 dev-tool 曾残留 7 处 105，导致面板预览小 30.6%、反复保存把 idleScale 越缩越小）。dev-tool 一律引用 `WEAPON_ANIM.size`。
  - **面板武器键 ≠ 配置键**：dev-tool `WEAPON_MAP` 的键只是选择器（super90/saiga12k 都映射 `configKey: 'shotgun'`；staff→sword；其余同名），传给 `WeaponTransform` / 读 `WeaponAnimConfig` 必须走 `_configKeyOf(type)`（游戏侧 `wt = animConfigKey || weaponType`）。**漏映射 = 回退到 sword 配置，散弹枪等面板调整全部无效**。
  - **面板姿态键 ≠ 游戏读取键**：持枪待机（gun_idle/gun_idle_pistol/gun_idle_dual）与施法（cast/staff_cast）在游戏里武器按 `animState='idle'` 读取（`cfg.idle` 子块优先），面板预览/保存必须走 `_stateKeyOf(anim)` 映射到 idle，否则保存写顶层而游戏读 idle 子块 → 不生效。
- **保存落盘**：Electron 走 `saveWeaponConfig` IPC；纯浏览器 dev 走 vite `/__save-weapon-config` 中间件（`_persistWeaponConfig` fetch 回退，防"只复制剪贴板刷新丢失"）。

---

### 行走逐帧武器轨迹（walkFrames，2026-08-02）

让剑类武器握把在 walking 时跟随右手摆动：`WeaponAnimConfig[wt].walkFrames`（`type:'perFrame'`，帧数与 walk 动画帧区间一一对应，如 sword 21 帧）。
- **生成**：`tools/` 像素分析脚本从 `assets/character/walk.png` 提取每帧右手（列直方图定位右侧手部凸起 → 质心），按显示缩放（长边 144/516）换算 local offset；以现有 walk holdOffset 实际位置为基准对齐（平均手位 + 恒定 shift 保持原位附近）；`rotation` = 最终旋转角（baseRotation + idleRotation，sword=90°+20°=110°），`scale` = walk idleScale。
- **游戏侧**：`GameScene.syncWeapon` walk 状态读 `walkFrames`，按 `playerSprite.anims.getProgress()` 插值；朝向同攻击分支（位置镜像 + 旋转取反 + flipX）。
- **面板**：`_perFrameCfgKey('walk')`→`walkFrames`，存在配置时 walk 页即逐帧编辑；保存白名单含 walkFrames。
- 新近战武器要加：复制 sword.walkFrames 结构，用同款脚本重测该武器贴图的手位/握把偏移。

---

### 手部分层（handLayer，2026-08-02）

让 walk 等循环姿态的手部贴图叠在武器之上（视觉"手握剑"）：
- `player-anim-config.json` 姿态条目加 `handLayer: { body, hand }`（两张同网格 sheet：身体层挖手 / 手层只留手）；合成严格无损（逐像素 alpha+颜色等于原图）。
- BootScene 自动加载 body/hand 贴图并注册 `player_<key>_body` 动画；GameScene 创建 `playerHandSprite` 每帧跟随身体（位置/flipX/帧号），深度 = 身体 + 3（武器 +2），攻击/施法等一次性动作自动隐藏手层。
- dev-tool 面板 walk 预览同分层（身体 → 武器 → 手）。
- **生成方法（2026-08-02 实测定稿，踩过坑）**：
  1. **先确认哪只手**：角色侧视朝右时，画面右侧 = 近镜头手（持剑手通常在这侧），画面左侧 = 另一只手。**先用 ASCII 渲染完整帧确认角色朝向和手在画面的左右侧，再定检测方向**——本作最终需求是"另一只手"（画面左侧 x≈175~259），不要默认截"最右凸起"。
  2. **检测带必须收紧为手臂/手高度带 y∈[180,280]**：不要用 y∈[160,330]——帧 4~9 手收进身体后"最右凸起"会退化到大腿，质心抓到腿、矩形把腿部像素切进 hand 层（实机表现"截到腿"）。
  3. **拳头矩形半宽 34/半高 38，y 上限硬性 clamp ≤300**（大腿从 y≈300 开始）；腿区（y>300）逐帧断言必须全 0。
  4. **合成无损验证**：逐像素 body+hand 的 alpha/颜色 = 原图（0 不匹配），每帧 bbox 必须在目标手区域。
  5. **恢复方法**：删掉 `handLayer` 配置即回退原贴图（代码已判空兼容），无需改代码。
- **坑：改播放键会断武器轨迹**——walk 播 body 动画后，`syncWeapon` walkFrames 分支判断 `curAnim.key === playerTextureKey('walk')` 匹配不上（实际 key 是 `player_walk_body`），walkProgress 恒 0 → 武器卡第一帧。凡按动画 key 做分支判断处都要兼容 `player_<key>_body`。
- 新姿态要加手层：复制 walk 的脚本流程（确认左右手 → 收紧检测带 → 拳头矩形 clamp → 合成验证），配置加 handLayer 即可。

#### 法杖施法手层（staff_cast，2026-08-03 落地）

施法动画（staff_cast 9 帧）同机制：手层独立 → 法杖握把绑定手部 → 共同运动。
- **素材**：`assets/player/staff_cast_body.png`（挖手身体层）+ `staff_cast_hand.png`（只手层），生成脚本
  `tools/prep-staff-cast-hand.py`（逐帧拳头窗口 + 无损合成验证）。
- **配置**：`player-anim-config.json`（双份）staff_cast 条目加 `handLayer { body, hand }`；
  `weapon-anim-config.json` sword 块 `staffCastFrames`。
- **代码**：`startPlayerCast` / `setPlayerAnimation` 一次性动作分支支持 handLayer——播
  `player_<key>_body` 动画 + 显示手 sprite（帧/位置/翻转由 `_syncPlayerHandLayer` 每帧跟随）；
  `_updatePlayerAnimation` 施法守卫兼容 body key（`cur !== player_<key>_body` 才算施法中断）。
- **实机验证**：CDP 工具 `tools/cdp-staff-cast-verify.mjs` / `cdp-staff-walk-check.mjs`
  （装备学徒长杖→采样 idle/施法逐帧武器/手 sprite + 截图）；lint/build/npm test 全绿。

#### 法杖施法最终方案（2026-08-03 用户验收通过）

**idle 绑左手（参考行走位置）+ 施法 f0→f8 设计插值轨迹（全程不换手、无跳变）：**
- `staffIdle`：左手拳位置——holdOffsetX **−84.7** → local (−11.4, 0.6)，与行走同侧（行走 X −12~−34）。
  **⚠ 反推公式**：`getWeaponLocalOffset` 的 afterX = `WEAPON_ANIM.size(126)×0.75×0.85 = 80.325`
  （不是 66.94）——按 66.94 反推 holdOffsetX 会整体偏右 ~13px（本次踩坑）。
- `staffCastFrames`：**设计插值**，不逐帧抠手：
  - f0 = idle (−11.4, 0.6, rotation **105**) —— idle↔f0 零跳变；
  - f8 = 前伸手举杖 (45.6, −43.9, rotation **20**，用户拍板)；
  - f1~f7 逐帧线性插值位置与角度（105°→20°）——法杖从左手腰侧平滑扫到右手举杖位。
- **为什么握把终点是「前伸手」**：施法手势是双手抬起后右手前推发力（f5~f8 右手从腰侧 x325
  前伸到 x418、上抬到 y100）；杆身 rotation 110°→20°（竖举指向右上，横杖不像举杖）。
  竖杖跟前伸手全帧 0 盖脸；跟远侧手（贴下巴的手）时 f3~f8 杆身直穿头部（盖脸 500px+），不可用。
- **坑（本次沉淀）**：
  1. 拳头中心用**手层内容质心**（像素级可复现），不用左边缘+半宽估算（会偏到手臂）。
  2. 抬举帧拳头比腰侧帧大得多（x≈231~300, y94~112），窗口右缘止于近侧手 x300 前，避免裁进另一只手。
  3. **GLM-4.6V（deepseek-vision-skill）定位手不可靠**：坐标误差 50~150px、同图两次回答矛盾，
     只配做粗验收（"法杖是否握在手里"），像素级修正一律用像素分析。
- **GLM-4.6V（deepseek-vision-skill）定位手不可靠**（2026-08-03 实测）：对 1024² 图坐标误差
  50~150px，同图两次回答互相矛盾，不能用于像素级修正；只适合粗粒度验收（"法杖是否握在手里"，
  实机截图判定通过）。精确定位仍用手层内容质心（像素级，可复现）。

---

### 复用武器动画独立调参（staff 法杖，2026-08-02 实测定稿）

新武器复用剑配置（`animConfigKey: 'sword'`）时，游戏侧 `wt='sword'` 全走剑数据——要独立握持/轨迹必须**在 sword 块下加独立子块 + 按武器类型分支**，不能直接改 `sword.idle/walk`（会连带影响剑）：
- **walk 逐帧**：`sword.staffWalkFrames`（`type:'perFrame'`，21 帧与 walk 动画对应）；`GameScene.syncWeapon` 按 `currentItem.weaponType === 'staff'` 读 `staffWalkFrames`，dev-tool 面板 `_perFrameCfgKey('walk')` 对 staff 返回 `staffWalkFrames`。
- **idle/walk/running 静态**：`sword.staffIdle { holdOffsetX/Y, idleRotation, idleScale }`；`syncWeapon` 对 staff 传 overrides 覆盖，面板 `_staffStateOverrides()` 三处调用点统一。
- **中段握持 = 贴图中心直接对准手**：法杖中段≈贴图中心，walkFrames/heldOffset 的 local 位置应**直接用手部轨迹**（`(手像素−贴图中心)×显示缩放`），不要从剑轨迹平移（剑柄在贴图中心下方 55px，平移法杖会整体错位）。
- **换手正确姿势：镜像已验证贴手的手轨迹，不要重新检测另一只手**：
  - 直接检测"另一只手"会因检测带/部位不同抓到手臂-胳膊不同段（实机表现"从手-手臂-胳膊垂直移动"，完全违和）；
  - 正确做法：把已贴手的轨迹**水平镜像**（`offsetX` 取反、`offsetY` 保持稳定 2~3.8）——保持"Y 稳定、X 水平摆动"的贴手特性，只是换到另一侧。
- **手位检测必须定位拳头（手臂末端），不是整条手臂质心**：idle 用整臂质心会偏上（法杖浮在手上面）；拳头 = 手臂最下端加宽块（如 idle y≈265~295 区域），idle 拳头 local=(-11.4,5.2) 与 walk 左侧手轨迹一致。
- **枪口点自动烘焙（2026-07-26 定稿，优先于手工配置）**：BootScene 对每把武器贴图扫描"最大连通体（8 邻域、4x 降采样）最右端内容点"（含 1px 细枪管尖）写入 `window.__weaponMuzzlePoints`；`_getMuzzleWorldPosition` 优先级 `muzzle.manual` > 自动烘焙 > 配置 muzzle > 右缘中心。子弹/枪口火焰统一从贴图最前端出生。**教训：别拿"右缘估计"当枪口——Super90 手工估点 (0.96,0.35) 把 1px 发丝杂线当枪管，自动烘焙的 (0.908,0.526) 才是真管口（放大裁切证实）。**
- 玩家碰撞基准（2026-07-26）：`PLAYER_DEFAULTS.physics`——受击矩形 40×60 + colliderOffset (-5,-5)（左拉 10、上移 5）；胶囊体随 collider 偏移。

---

### 普通攻击一段跟手 + 方向性运动模糊（2026-08-03 落地；08-03 二轮复核修正，30 帧全贴手）

#### 跟手：sword.attack 30 点轨迹改为跟随挥剑手
- **挥剑手 = 远侧手**（attack_sword 动画里唯一做大回环的手）：f0~f2 高举头后
  → f3 头顶最高 → f4~f6 挥到前方 → f7 下劈到位（命中帧在 f7，frame 22）。
- 生成脚本 `tools/prep-sword-attack-hand.py`：从 attack_sword.png 8 帧读拳头中心，
  换算 local（`(px-256)×144/516`），30 点插值后只替换 offsetX/offsetY
  （rotation/scale/blur/stretch 保留手动调参）。
- 当前轨迹（握把，即减去剑柄补偿后的手位）：f0 `(25.6,-25.4)` → f8 `(-24.8,-78.5)`
  （蓄力顶）→ f16 `(15.1,-79.1)`（前举）→ f22+ `(87.0,2.7)`（下劈到前伸手收势）。
- **f7/定格必须用「前伸手」**（2026-08-03 实机反馈"最后一帧+定格武器在后方、与手不相交"）：
  f7 全身实测手向前伸（x400-464），拳头中心 **f7=(425,278)→local (47.1,6.1)**，
  不是后手 x275（之前误读后手导致武器落在身后）。生成脚本 HAND_PX f7 已改。
- **HAND_PX 最终值（2026-08-03 三轮复核，贴图真值掩码为准）**：
  f0(213,116) f1(205,116) f2(192,116) f3(150,110) f4(282,115) f5(310,116) f6(330,120) f7(425,278)。
  依据：以贴图 alpha 掩码（BILINEAR 缩放到显示尺寸）判定锚点是否在角色像素上——
  GLM 初版 f0-f3=(196/185/150/128,118/118/115/116) 全部浮空（0~4%，即"前 10 帧脱手"根因）；
  原手调 f0-f3 半贴（27~37%）；复核手臂带顶端后定版（37~100% 全贴）。
- **30 帧阶梯映射（2026-08-03 三轮，关键修复）**：生成脚本从"帧间平滑插值"改为
  **阶梯映射**——手部只有 8 个定格姿势，精灵帧 f 覆盖 p∈[f/10,(f+1)/10)（f7 覆盖 [0.7,1]），
  每帧直接用当前精灵帧锚点。平滑插值会让握把在帧间漂移（f3→f4 跨度 154px 时 cfg11 脱手 122px）。
- **实机复核（冻结逐帧）**：`tools/cdp-sword-hold-frames.mjs` 手动定格 8 帧
  （play+timeScale=0 冻结帧 + 占位 tween 保 attacking 状态机 + 40s 进度时钟反推），
  现支持 30 帧全量定格（进度 i/29，精灵帧按权重同步）；对 30 帧握把落点做贴图真值掩码采样，
  **30/30 全部落在角色像素上（37%~100%）**；GLM-4.6V 逐帧特写复核 30/30 ON-HAND。
- **握把（剑柄）贴手（2026-08-03 修订）**：perFrame 偏移是**贴图中心**，而剑柄在贴图中心下方
  ——中心贴手 = 剑柄悬在手下。修正：按每帧旋转角反推中心 `offsetX = 手X + G·sin(rot)`、
  `offsetY = 手Y − G·cos(rot)`，使剑柄落点=手。
  **G（柄质心距中心）实测**：锈剑 39.2 / 骑士 41.6 / EX 36.1 / 夜火 44.1 display px，
  取 **40**（旧值 55 偏大→握把落柄下端，实机"还有错位"；40 版视觉模型 8 帧判"更准"）。

#### 经验教训（2026-08-03 一段攻击跟手三轮复盘，可迁移）
1. **手部只有离散帧时，武器 perFrame 必须"阶梯映射"，不能帧间平滑插值**：
   30 个武器点 ≠ 手部 8 帧姿势。插值会让握把在精灵帧没动时自己漂移
   （f3→f4 手位跨度 154px，cfg11 曾脱手 122px）。正确做法：按帧权重
   `f = p≥0.7 ? 7 : min(6, int(p*10))` 取当前精灵帧锚点，旋转照常插值。
2. **锚点是否"贴手"用贴图真值掩码验证，勿用场景截图暗像素**：
   将精灵帧 alpha 用 BILINEAR 缩放到显示尺寸（`frame.resize((w,h), BILINEAR)`，
   `alpha>100` 为角色像素），握把落点采 7×7 邻域贴附率，>20% 视为贴手。
   场景截图的暗像素会被背景阴影/杂物误报（曾把 12 帧悬空误判为全贴手）。
3. **GLM-4.6V 的边界**：读绝对坐标不可靠（全图/网格/裁剪多格式都会跑飞）；
   但"红点是否在手"的 ON/OFF 判断在 140px 握把特写（2 倍放大 + 红点标记）上稳定。
   定位用掩码，复核用 GLM，二者交叉。
4. **改 JSON 配置后必须刷新页面**：ESM 静态 import 缓存旧配置，游戏启动时读一次，
   不刷新页面则"改完没生效"（曾导致对着旧配置调参的误判）。
5. **冻结抓取管线（tools/cdp-sword-hold-frames.mjs）**：
   `play + anims.timeScale=0` 冻结精灵帧（满足 GameScene 卡死守卫的 isPlaying 条件），
   `_activeAttackTweens` 塞 60s 占位 tween 保 attacking 状态机，`_playerAttackDuration=40000`
   + 反推 `_playerAttackStartTime` 接管进度。坑：`weaponAnim.timer>5000` 卡死保护会重置状态，
   需每帧清零；`tweens.timeScale` 曾被探针改慢导致攻击 tween 3 秒后才 complete 干扰定格。
6. **手部分层（handLayer）同步只在"显示期"做帧跟随，且 setFrame 前必须校验目标帧存在**
   （2026-08-03 普通攻击/收势告警刷屏复盘）：`_syncPlayerHandLayer` 曾每帧
   `hand.setFrame(身体帧号)`——手层隐藏期（recover/attack/idle）纹理可能只含 `__BASE`
   （如 `player_idle`），或 WebGL context lost 后手层贴图帧被清空，导致 Phaser
   "Texture has no frame" 告警刷屏（GameScene.js:1060 / phaser.esm.js:229893）。
   修复：`if (!hand.visible) return;` + 帧名在 `tex.getFrameNames()` 内才 setFrame。
   教训：跨动画复用 sprite 做帧同步时，"帧存在性"和"显示期"两个前提必须显式守卫，
   否则任何纹理状态异常都会变成每帧告警。

#### 方向性运动模糊（替换各向同性高斯，修"摊薄消失"）
- **根因**：刀身在贴图内沿纵向（逐行质心 x 恒定已验证），旧版 Blur 滤镜 x=y=1 各向同性，
  模糊沿刀身摊薄 → 3px 细剑峰值帧"近乎消失"（SKILL 旧记录因此一度改残影，残影又停用）。
- **升级**：`_applyWeaponBlur` 固定 `f.x=1, f.y=0.08`——只沿**垂直刀身（贴图横向）**拉丝，
  刀身保持清晰、拖影沿挥砍方向；强度仍由 max(blurX,blurY) 驱动（峰值帧最浓）。
  Phaser 4 `filters.internal.addBlur`，`strength = max×1.6`。
- **验证**：CDP 实机采样（`tools/cdp-sword-attack-check.mjs`）确认 blur 峰值帧
  x=1/y=0.08/strength≈14；视觉模型粗验收"剑贴手 + 横向拉丝 + 刀身不糊"。
- 残影（`_syncWeaponGhosts`）为死代码，勿再启用。

---

### 二段攻击（attack_sword_2）双手横挥优化（2026-08-03）

- **动画**：30 帧（50ms/帧），"单手切双手 → 向前横向挥砍"；命中帧 15（sector 扇形）。
- **代码**：`syncWeapon` 近战分支按 `player.n === 2` 读 `attack2` 轨迹块；
  **已移除旧 `weaponUnder` 逻辑**（原 18~24 帧把武器压到人物下方 depth -0.01——
  双手横挥时剑在身前却被身体遮挡 = "涂层遮盖"根因），武器恒在人物前方（+2）。
- **横向挥砍（透视）修正**：F14~F25 剑保持在**胸口高度**（Y ≈ -2~15）且**近水平**
  （rotation 95~120，不再 45~85 上劈姿态），避免剑身盖脸；握把（剑柄）绑定**前伸手**
  （近侧手 ~local (52,-6)，握把校正 G=40 同攻击一段）。F0~F13 蓄力、F26~F29 收势保留。
- **验证**：lint/build/npm test 全绿；预览 `attack2_FINAL.png`（绿圈=握把）。
- **二段收势 0.3s（2026-08-03 用户指定）**：恢复动画共用 `recover`（13 帧×25.4ms=330ms）；
  GameScene 恢复触发处按 `_meleeComboStage === 2` 传 `setPlayerAnimation('recover', 300)`，
  武器滑回 `recDur` 同步 300ms（一段保持自然 330ms）。实机 timeScale=1.1007 ✓。
- **二段末帧定格 0.2s（2026-08-03 用户指定）**：`weapon-anim.js` 定格/连段窗口按段区分——
  二段 `_attackHoldUntil = 攻击结束 + 200ms`（连段回一段的窗口同步 200ms），一段保持 500ms。
  实机采样：一段 holdMs=500、二段 holdMs=200 ✓。

---

### 冲刺攻击（dash_attack）跟手优化（2026-08-03 初版；2026-08-16 dashHand 剑柄锚手定稿）

- **动画**：dash_attack 17 帧（24fps），"从后往前 180° 大回砍"；配置 sword.dash 30 点。
- **手部识别技能适用性结论（2026-08-16）**：
  1. **GLM-4.6V / deepseek-vision-skill 不适合像素级绑手**——坐标误差 50~150px，
     同图两次回答会矛盾，只能做"是否在手上"的粗验收；不要拿它生成 dash 轨迹点。
  2. **`tools/prep-sword-attack-hand.py` 旧 `DASH_HAND_PX` 也不可用**——它检测的是
     "远侧手/非持剑手"，17 帧末帧 (185,180) 仍停在身体左侧，与实机前伸手不符；
     脚本旧 dash 分支因此曾默认拒绝运行。该数据已改名 `DASH_HAND_PX_LEGACY` 留档。
  3. **正确做法 = dashHand 模式**：保留用户实机验收的 `sword.dash` 30 点中心轨迹
     （DevTool 手调值），由 `WeaponTransform.getDashHandPosition` 按
     `握把点 = 中心 − R(rot)·(0, -gripOffset)` 反推手位；GameScene 把
     `weaponSprite.origin` 设为剑柄点（`gripX=0.5`，`gripY=0.5 + gripOffset/显示高`），
     剑柄钉在手上，剑身绕剑柄转。
- **180° 扇形扫击**：`sword.dashHand { type:'gripArc', fromRotation:-90, toRotation:90,
  gripX:0.5 }`——角度按 progress 线性插值，从身后 -90° 扫到身前 +90°，全程 180°；
  位置仍逐帧沿旧中心轨迹反推的握把路径走，因此不是只绑首尾两点。
- **触发链路**：`dashSystem.trigger` 播放 `dash_attack` 并写 `_dashTotalMs`；
  `GameScene._syncSpecialWeaponAnim` 的 dashHand 分支按同一 progress 同步剑柄；
  末帧定格 `_dashRecoverAt` 也停在 progress=1，收势再走近战同款滑回。
- **修改文件**：`src/combat/weapon-transform.js`（getDashHandPosition）、
  `src/phaser/scenes/GameScene.js`（dashHand 分支，优先于旧 dashLerp）、
  `public/data/weapon-anim-config.json`（sword.dashHand）、
  `tools/prep-sword-attack-hand.py`（dash 分支改为生成/校验 dashHand，不再用旧误检点）。
- **旧 dashLerp 保留为回退**：无 `dashHand` 配置时仍走双端点 lerp，端点/角度已同步为
  -90°→+90° 与剑柄 origin（grip 0.5,0.782）；不要删代码。
- **实机验收（2026-08-16 用户确认成功）**：剑柄全程贴手，剑身从后 -90° 扫到前 +90°，
  末帧定格 → dash_recover 收势无跳变。
- **关键经验（可迁移到后续近战动作）**：
  1. 手部定位先分“粗验收”和“像素绑手”两条路：GLM 只判 ON/OFF；绑手一律用
     alpha 掩码/质心，或复用**已经实机验收过的中心轨迹反推握把点**。
  2. 旧轨迹数据不要急着覆盖：把“中心轨迹”和“剑柄 origin”解耦后，只需新增
     `dashHand { fromRotation, toRotation, gripX }`，运行时反推，旧 perFrame/dashLerp
     原样保留可回退。
  3. 收势不是另起一段动画：freeze 末帧是 origin=剑柄，recover 首帧是 origin=中心，
     必须用 `中心 = 握把 + R(rot)·(0,-gripOffset)` 反推 recover 起点，否则剑柄连续但
     剑身会跳回旧轨迹角度（本次已通过 `getDashRecoverStartPosition` 解决）。
  4. 测试守卫只锁配置契约（dashHand 180° / dashLerp 180°），不锁具体轨迹点，
     后续 DevTool 微调不被测试卡死。

---

### 挥砍剑气轨迹（SwordAuraTrail，2026-08-16 垂直剑身书法拖尾）

> **状态（2026-08-16）**：当前剑气效果已按用户要求停用——`sword.aura.enabled = false`。
> 代码与纹理生成逻辑保留在 `src/effects/sword-aura-trail.js`，后续重做时把该开关改回 `true` 即可。

- **用户思路验证：可行**。“生成水墨/墨笔贴图 → 按剑贴图尺寸拉伸覆盖 → 追剑运动轨迹 →
  设置残留时间”在 Phaser 中完全成立，且比粒子发射器更适合表现“剑气沿剑身划过”的形态。
- **参考实现**：`src/effects/sword-aura-trail.js`
  1. `_ensureTexture()` 程序化生成 128×64 纹理：沿剑身方向等距排布多条笔直竖向短线，
       渲染时旋转 `swordRotation + 90°`，让每条线垂直于剑身；
  2. `GameScene` 在近战 perFrame / dashHand / dashLerp / dash perFrame 四条攻击渲染分支
     `_pushSwordAuraPose()` 采样当前剑的视觉中心、rotation、displayWidth/Height
              `_pushSwordAuraPose()` 采样当前剑的视觉中心、rotation、displayWidth/Height；
  3. `SwordAuraTrail.update()` 按 `intervalMs` 保留采样点，残影 Sprite 按
     `widthMul/heightMul/scaleStart/scaleEnd` 拉伸覆盖，按 `lifeMs` 残留淡出。
- **配置**：`public/data/weapon-anim-config.json` 的 `sword.aura`
  （enabled / intervalMs / lifeMs / maxCount / alpha / tint / colorSource / blendMode / widthMul /
  heightMul / trailBackOffset / minMoveDistance / rotateWithWeapon / perpendicularToWeapon / perpendicularStripeCount / perpendicularCoverageLength / perpendicularCoverageWidth / scaleStart / scaleEnd / fadeInRatio / fadeOutRatio /
   glowEnabled / glowAlpha / glowScale / glowTint / glowBlendMode）。**调参只动 JSON。**
- **通用可见性（2026-08-16 世界-122 修复）**：纯 ADD 发光在亮色地面会被洗掉；
  正式做法 = **NORMAL 核心笔触 + ADD 发光层**双通道。核心笔触负责所有场景可见，
  发光层只负责暗场景光感。
- **当前颜色（2026-08-16 用户定）**：`colorSource: "fixed"` + `tint: "0xffffff"`，固定白色；
  取色方法 `getWeaponColor()` 保留为可选项，之后要恢复剑身色再切回 `"weapon"`。
- **不越剑前（2026-08-16 优化）**：`pushPose()` 计算相邻采样的运动方向，把残影位置沿运动反方向
  后移 `trailBackOffset`；首帧只记录不渲染，下一帧有方向后再显示，位移小于 `minMoveDistance` 不生成新残影。
  配合 `widthMul/heightMul/glowScale` 收紧，特效只留在剑已经扫过的轨迹内。
- **书法拖尾规则（2026-08-16 用户澄清后定稿）**：每条残影是短直线，且必须**垂直于剑身**
  （`perpendicularToWeapon: true`，渲染旋转 = 剑身 rotation + 90°）。纹理沿剑身方向排布多条
  垂直线段，一次采样即可覆盖整把剑；宽度用 `perpendicularCoverageWidth=0.9` 约束，避免超出剑宽。
- **深度与显隐**：剑气挂在 `worldEffectsGroup`，深度恒为 `weaponSprite.depth - 1`；
  地图模式自动随特效组隐藏。
- **后续替换正式素材**：只需要把 `_ensureTexture()` 的 Canvas 绘制换成
  `scene.load.image('sword_aura_brush', 'assets/effects/sword_aura_brush.png')` 并保持
  key/竖向直线/透明底一致，消费端零改动；建议 PNG 白色直线 + `setTint` 控制剑气颜色。
- **避免的坑**：
  1. 不要用大量独立粒子追剑，粒子旋转/尺寸难对齐剑贴图，残影 Sprite 池更稳；
  2. 残影必须比剑贴图低一层，且要在 `_updateDynamicDepths` 之后更新，否则过墙会浮层；
  3. 残影中心不能直接拿 `sprite.x/y`：普通攻击 origin 是中心、dashHand origin 是剑柄，
     必须按 `(0.5 - originX/Y) × displaySize` 旋转后反推视觉中心（本次 `_pushSwordAuraPose` 口径）。
    5. 残影若直接放在当前剑中心，笔触会同时向运动前方延伸，视觉上“特效跑到剑前面”；
       必须沿速度反方向做 `trailBackOffset` 后移，首帧只记录不渲染、静止帧不采样。
    4. 纯 ADD 发光在亮色地图会被洗掉（世界-122 复现）：必须 NORMAL 核心层兜底可见性，
       ADD 只做增强层。

---

### 平滑弧形刀光（SwordArcTrail，2026-08-16 重做）

> **状态（2026-08-16）**：当前平滑弧形刀光已暂停——`sword.arc.enabled = false`。
> 代码与配置保留，后续重新启用时改回 `true` 即可。

- **旧剑气已停用**：`sword.aura.enabled = false`；不再使用短线/贴图残影方案。
- **新方案**：`src/effects/sword-arc-trail.js`
  1. 连续采样剑的视觉中心与显示尺寸；
  2. 用历史采样点构建 Ribbon：沿运动方向两侧按法线展开，尾端收成一点；
  3. Catmull-Rom 细分边缘，形成平滑弧线；
  4. 外层/中层/内层三层多边形叠加：外层大而淡、内层窄而亮，得到弯月刀光；
  5. 采样点沿运动反方向 `trailBackOffset` 轻微后移，避免跑到剑前。
- **配置**：`sword.arc`
  （enabled / intervalMs / lifeMs / maxCount / tailLength / trailBackOffset /
  minMoveDistance / color / coreHalfWidth / midHalfWidth / outerHalfWidth /
  alphaOuter / alphaMid / alphaCore / outlineEnabled / outlineColor / outlineAlpha / outlineHalfWidth / headWidthMul / fadeInRatio / fadeOutRatio / particleEnabled / particleCount / particleAlpha / smoothSteps）。
- **通用性排查结论（2026-08-16）**：新效果没有 `scene8/main` 之类的场景分支，代码是通用的。
  世界-122 看不到时，先排除了组可见性：`SwordArcTrail` 不再挂 `worldEffectsGroup`，而是直接
  使用场景 Graphics，并只在地图选择界面按 `_mapModeActive` 显式隐藏；同时加黑色轮廓底层提高对比度。
- **深度（2026-08-16 二轮）**：刀光从剑下一层改为剑上一层（`weaponSprite.depth + 1`），
  保证剑可见时刀光一定可见；外层宽度仍用 `outerHalfWidth` 控制，避免过大。
- **柔化拼接（2026-08-16 三轮）**：不再整条 Ribbon 单色填充，改为逐段四边形填充，
  每段按生命进度做 `fadeInRatio/fadeOutRatio` 透明度曲线；与剑衔接端用 `headWidthMul` 收窄，
  尾端宽度归零；段间补小圆点，并沿边缘撒 `particleCount` 个淡出粒子，消除箭头/菱形硬边。
- **调参**：想让弧线更圆滑调大 `smoothSteps`；想更长调大 `lifeMs`/`tailLength`；
  想更亮调大 `alphaCore/alphaMid`；外层宽度不要超过剑宽太多，`outerHalfWidth` 建议 ≤0.6。
- **经验**：贴图残影线很难做平滑刀光，轨迹 Ribbon + Catmull-Rom + 多层宽度叠加更接近
  常见的弯月形挥砍特效；性能也只需一个 Graphics 对象。

---

### 交互式开发工具（DevTool）与攻击动画插帧系统

> 阅读 `src/ui/dev-tool.js`、`src/combat/weapon-transform.js`、`src/entities/player/weapon-anim.js`、`src/items/weapon-anim-config.js`、`src/phaser/scenes/GameScene.js` 后的结构梳理。
> **2026-07-26 简化定稿**：挂载点系统（handAnchors/gripOffset）与关键帧系统（keyframes）已删除——生产配置零使用，且单点锚无法帧间跟手（逐帧已全覆盖）。现只保留两条路径：攻击=逐帧 perFrame，静态姿态=每状态 holdOffset。

#### 一、DevTool 整体结构

`src/ui/dev-tool.js` 是一个基于 Canvas 2D 的独立调试面板，与 Phaser 游戏循环解耦，用于武器/动画参数的可视化与持久化。

**核心状态：**
```js
state: { anim, weaponType, frameIndex, playProgress, isPlaying }
weaponParams: { offsetX, offsetY, rotation, scale }
```

**两大子系统：**
1. **武器定位面板**：调整 `offsetX/Y`、`rotation`、`scale`，实时预览武器相对角色的位置（传统 holdOffset 模式）。
2. **逐帧编辑（perFrame）**：`attack.type === 'perFrame'` 时 weaponParams 直接对应当前帧，滑块/播放逐帧调武器姿态。
3. **动画/贴图/AI 调试面板**：加载四方向精灵图、逐帧播放、调试敌人贴图与 AI。

**关键方法：**
- `_loadCharacterFrames()`：按 `data/player-anim-config.json`（PLAYER_ANIMS）加载角色精灵图，`PANEL_ANIM_TO_CONFIG` 映射面板键→配置键。
- `_getPerFrameTransform()`：按进度插值逐帧配置。
- `_buildPreviewOverrides()`：把面板中的调整打包成 `WeaponTransform` 可消费的参数。
- `_save()`：写回 `WeaponAnimConfig`，并通过 `window.electronAPI.saveWeaponConfig` 持久化到 `public/data/weapon-anim-config.json`。
- `_draw()`：用 `WeaponTransform` 在 Canvas 上绘制角色、武器与轨迹。
- 播放帧率：读配置 `frameRate`，面板 `#devToolFps` 输入框可手动覆盖（`_getPreviewFps`）。

#### 二、攻击动画插帧（唯一路径：逐帧 perFrame）

- **配置位置**：`WeaponAnimConfig[weaponType].attack.frames`（`attack.type === 'perFrame'`）。
- **结构**：`{ offsetX, offsetY, rotation, scale }` 数组，每帧对应攻击动画的一帧。
- **插值**：按 `playProgress` 在相邻两帧之间做线性插值。
  - `weapon-transform.js`：`getInterpolatedPerFramePosition()` 用 `_lerpPerFrame1D/2D` 插值。
  - `weapon-anim.js`：检测到 perFrame 后，Tween 只驱动 progress；武器 Sprite 的位置/旋转/缩放由 `GameScene.syncWeapon()` 按当前动画帧同步，Tween 只负责命中判定窗口与状态重置。
- **无 perFrame 配置的近战武器**：走 `_playSwordAttackTween` 默认三段 Tween 链（windup 200ms / swing 300ms / recover 400ms）。
- **贴图同步**：`setPlayerAnimation('attack_sword', tweenDuration)` 用 `anims.timeScale` 把玩家攻击贴图对齐 Tween 总时长（2026-07-26 修复 900ms Tween vs 667ms 贴图各播各的问题）。

#### 三、坐标变换链

```
dev-tool 调整参数
    ↓
保存为 WeaponAnimConfig[weapon].attack.frames（perFrame）/ [state].holdOffset（静态姿态）
    ↓
WeaponTransform.getInterpolatedPerFramePosition() / getWeaponLocalOffset()
    ↓
GameScene.syncWeapon() / weapon-anim.js Tween
    ↓
Phaser Sprite.x / y / rotation / scale
```

**镜像处理：**
- 玩家朝左时，`facingRight = false`。
- `WeaponTransform` 内部把本地 X 坐标取反，并把旋转角度处理为 `Math.PI - rotation`。
- **不**对武器 Sprite 直接使用 `setFlipX`，避免旋转中心错乱。

#### 四、玩家攻击动画驱动流程

1. 输入触发：`triggerWeaponAnim('main')`。
2. 状态机进入 `swing`。
3. 剑类武器调用 `_playSwordAttackTween()`：
   - 若 `attack.type === 'perFrame'`：Tween 驱动 progress，`syncWeapon()` 逐帧同步。
   - 否则走默认 windup/swing/recover 路径。
4. `onStart` 激活 `_pendingThrust`，在攻击前 500ms 内做命中判定。
5. `onComplete` 结束攻击状态、给经验、武器回到 idle 位置。

#### 五、与怪物攻击动画的对比

- **玩家**：由 `weapon-anim.js` Tween + `WeaponAnimConfig` 精确控制武器 Sprite 的位移/旋转/缩放。
- **怪物（如 ZombieDogEnemy）**：仅覆盖 `triggerWeaponAnim()` 设置 `_attackTimer`，用 `_animState = 'attack'` 驱动纹理/帧切换；攻击判定由 `ThrustAttack` 的矩形/动态距离判定处理，**没有**类似玩家的武器 Sprite 插帧系统。

#### 六、后续扩展方向

如需为怪物引入攻击动画插帧（例如让 ZombieDog 的爪击也使用逐帧动画）：
1. 在 `enemy-config.json` / `enemy-types.js` 中为怪物增加攻击动画资源引用。
2. 在 `WeaponAnimConfig` 中新增怪物武器/爪击配置，或复用 `perFrame` 结构。
3. 在 `_syncEnemyAnimation()` 中根据 `_animState === 'attack'` 播放对应 spritesheet。
4. 让 `ZombieDogEnemy.triggerWeaponAnim()` 不只是一个 timer，而是真正驱动一帧一帧的动画 progress。

---
