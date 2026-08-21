> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：11. 音效系统

## 11. 音效系统

### 音效导入工作流（2026-07-17 新增，参照集合体落地；2026-07-21 目录规范更新）

#### 目录规范（2026-07-21）
所有音效**按实体类别建子目录，禁止堆在 assets/sounds/ 根目录**：
```
assets/sounds/enemies/<怪物英文名>/   # 怪物音效（如 amalgam/time_agent/time_agent_shield）
assets/sounds/friendly/               # 友方单位音效（仓鼠矿工/战士/射手/盾卫，2026-08-16）
assets/sounds/weapons/                # 枪械开火/换弹/过热等武器音效
assets/sounds/bow/                    # 弓箭音效
assets/sounds/shield/                 # 盾牌格挡/受击音效
assets/sounds/ui/                     # 金币/升级/出售/击倒等系统音效
```
2026-07-21 已完成存量迁移（根目录音效全部入子目录，引用同步更新）。新增音效一律入对应子目录，路径写进配置（enemy-config.json sounds / weapon-fx-config.js 等），不在代码里写死。

#### 友方单位音效（2026-08-16 仓鼠系列，用户素材）
- 素材复制改名入库 `assets/sounds/friendly/`：`hamster_shooter_attack.mp3`（射手出膛）、
  `hamster_melee_attack.mp3`（战士/盾卫共用，源=鼠鼠战士 1.mp3）、
  `hamster_miner_mining.mp3`（矿工挥锄）。
- 配置：`data/hamster-*-config.json` 新增 `sounds` 块（attack/mining 键 → 路径）；
  `Companion` 基类 `this.sounds = archive.sounds || {}`（一处生效，伙伴未配置默认为空）。
- 触发：各 AI 攻击命中/发射点调 `_playSound(key)` 助手——世界内发声走
  `SoundManager.playWorld(path, x, y)`（坐标衰减，音效铁律），无则 playFile 兜底；
  射手在 `_fireProjectile`（第 10 帧出膛）、战士 `_tryAttack`、盾卫 `_applyDamage`
  （第 10 帧判定）、矿工 `_tryAttack`（采矿命中）。
- 纯视觉岗位单位同样遵守配置与位置音效口径：仓鼠农民在 `population-economy.json#windmill.workerVisual.sounds` 声明 `harvesting`，`HamsterFarmerVisualSystem.setState` 只在进入收割状态时调用一次 `SoundManager.playWorld`；禁止在逐帧动画更新中播放或把素材路径硬编码进视觉系统。

#### 步骤1: 素材复制建档（规则 4）
按类别在项目下建子文件夹，把用户提供的音频复制进去：
```
assets/sounds/enemies/<怪物英文名>/   # 如 assets/sounds/enemies/amalgam/idle.mp3
```

#### 步骤2: enemy-config.json 配置 sounds 映射（规则 1，不硬编码）
```json
"sounds": {
  "idle":   "assets/sounds/enemies/amalgam/idle.mp3",
  "throw":  "assets/sounds/enemies/amalgam/idle.mp3",
  "impact": "assets/sounds/enemies/amalgam/hitting.mp3",
  "slamHit":"assets/sounds/enemies/amalgam/hitting.mp3",
  "death":  "assets/sounds/enemies/amalgam/dying.mp3",
  "idleInterval": 3000
}
```
键名按怪物类内事件自定义（idle/throw/impact/slamHit/death/...）；`idleInterval` 为待机环境音间隔（ms）。

#### 步骤3: 怪物类内按事件播放
`SoundManager.playFile(path)` 直接播放文件，无需 BootScene 预加载。统一在类内写一个小助手：

```javascript
_playSound(key) {
    const path = this.config?.sounds?.[key];
    if (path && SoundManager && typeof SoundManager.playFile === 'function') {
        SoundManager.playFile(path);
    }
}
```

事件触发点（集合体范例）：
- idle 待机：`update()` 中计时器到点播放（间隔读 `sounds.idleInterval`）
- 投掷出手（fireFrame）：`_playSound('throw')`
- 投射物落地：`_playSound('impact')`
- 砸地命中帧（hitFrames）：`_playSound('slamHit')`
- 死亡：`onDeath()` 中 `_playSound('death')`

#### 步骤4: 距离衰减（可选，位置音效，2026-08-03）
需要"声源离玩家越近越大声、超出最大距离无声"的音效，走 SoundManager 位置音效能力（音量逐帧由主循环统一刷新，调用方不自己算距离）：

- **循环音轨**：播放后每帧把声源坐标与衰减参数挂上——
  ```javascript
  SoundManager.setLoopPosition(id, x, y, {
      base: s.loopVolumeBase ?? 0.5,     // 远端音量
      max: s.loopVolumeMax ?? 1.5,       // 近端音量（可 >100%）
      nearDist: s.loopNearDist ?? 150,   // 满音量距离
      farDist: s.loopFarDist ?? 600,     // base 音量距离
      maxDist: s.loopMaxDist ?? 2000,    // 静音距离，超出后音量 0
  });
  ```
  曲线：d≤nearDist 恒 max → farDist 处 base → maxDist 处 0（双段线性连续）。
- **一次性音效**：`SoundManager.playFileAt(path, x, y, volume, channel, { nearDist, maxDist })`——按播放瞬间距离衰减，超出 maxDist 不播。
- **配置键**：enemy-config.json `sounds` 块用 `loopVolumeBase/loopVolumeMax/loopNearDist/loopFarDist/loopMaxDist`（蝇群范式，值全部进配置不硬编码）；音量刷新由 `game.js update()` 顶部 `SoundManager.update(dt)` 统一完成。
- **注意**：无玩家（或玩家 inactive）时保持当前音量不变；死亡/场景切换清理走既有 `_destroyCustomEffects` / `stopAllLoops`，位置音效无需额外清理。
- **NPC/世界实体帧音效必须走 `playWorld`**（2026-08-12 铁匠打铁声修复）：GameScene 的
  `frameSounds`（game-config `npcs.*.sprite.frameSounds`，动画播到指定帧触发一次）原来调
  `playFile`——无世界坐标、永远满音量、远离 NPC 仍听得见。改为
  `SoundManager.playWorld(fsCfg.path, e.x, e.y)` + `playFile` 兜底。铁律：新增任何"世界内发声"
  （NPC 动画帧、敌人、机关、门、宝箱）先查是否带坐标走 `playWorld`，别默认 `playFile`；
  玩家自身音效（枪声/脚步/技能/UI）才用 `playFile`。
- **音效放大优先做进文件**（2026-08-11 左轮 .357 开火声 1.5 倍）：源素材 mean -26.1dB →
  ffmpeg `volume=1.5` → 入库 -23.0dB，播放端默认 volume=1.0 不再乘系数（避免双份放大）。
  文件峰值已 0dB 后（mean 接近满幅）再放大只能走播放音量参数 `playFile(path, v)` 或声道音量，
  禁止对文件再放大（会削波失真）。

#### 全局升级提示音（2026-08-21）
- 玩家等级提升与玩家技能升级统一由 `LevelUpEffectQueue._renderEffect()` 在对应提示真正展示时播放，路径读取 `data/audio-config.json#uiCues.playerUpgrade`，使用 `playFile(path, 1, 'ui')`。旧的玩家 `onLevelUp()` 直播放必须移除，避免同一次升级双响；连续技能升级随提示队列逐项播放，声音与画面保持同序。
- 建筑完工/升级若产品明确要求“无论距离都能听见”，同样属于全局系统提示，可用 `playFile`；房屋的路径放在 `population-economy.json#house.upgradeCompleteSound`。这属于明确的全局通知例外；普通 NPC、门、机关和建筑世界声仍必须走 `playWorld`。
- 用户素材统一复制为英文稳定名放入 `assets/sounds/ui/`；触发代码只读配置键，不直接引用素材库路径，也不在多个升级入口复制同一 MP3 路径。

#### 步骤5: 程序化合成音效（numpy 管线，2026-08-16 铁闸门开/关）
> 素材优先级 = **用户提供 > 合成兜底**：世界-122 铁闸门音效一轮用合成（
> `gen-gate-sounds.py`），二轮被用户素材 `D:\即时重放\1.mp3` 替换（`gate_iron.mp3`，
> 开/关共用），合成 wav 与脚本已删除。本节保留为**无素材时的通用能力**。

没有现成素材的机械/环境音效可程序化合成，零素材依赖、可复现、无版权问题：

- **合成先例**：`tools/ai-gen/add-weapon.py`（枪械开火/换弹/装备；合成管线范本）。
- **基本构件**：`_noise(n, seed)` 白噪声 → `_bandpass(x, lo, hi)` FFT 带通（金属摩擦 =
  中频 500~2600Hz；撞击 = 低频 90~300Hz 主体 + 高频泛音）→ `_env_exp(n, tau)` 指数衰减
  （咔嗒/撞击用 tau=dur/3）→ `_click(amp, dur, lo, hi, seed)` 短促爆点。
- **金属撞击 = 多谐波衰减正弦簇**：低频 thump（如 98Hz, tau=dur/2.2）+ 钢体共振（262Hz ×0.6）
  + 泛音（523/1046Hz 递减）+ 带通噪声爆点 ×0.5——单频正弦干瘪，多谐波才有"金属感"。
- **滑轨/摩擦 = 带通噪声 × 包络 + 周期刮擦**：滑动包络用 `sin(πt)^0.9`（渐强渐弱模拟
  门先加速后减速）；"滑轮过缝"用每隔 ~65~85ms 一个 30ms 短噪声爆发（`_rail_slide`）。
- **时长对齐动画**：世界-122 门动画 `GATE_GEOM.animMs`=650ms → 开门 0.85s（咔嗒+滑动+末端
  锁扣）、关门 1.0s（滑动+0.65s 处撞击+锁扣）；RMS 分段检查确认结构（关门 0.6~0.7s 段应有
  撞击尖峰）。
- **输出**：44100Hz 16bit 立体声 WAV（`np.stack([out, np.roll(out, 2~4)])` 轻微立体声），
  文件直接进 `assets/sounds/environment/`；`.venv-sprites\\Scripts\\python.exe` 运行。
- **接入**：世界内机关/建筑音效走 `SoundManager.playWorld(path, x, y)`（距离衰减），
  声源坐标取**感应中心**（门洞物理中心 `_detectX/_detectY`，非精灵中心——等距偏移会让
  远距离单位听不到）。玩家自身音效仍走 `playFile`。
- **验证**：CDP 探针拦截模块单例 `SoundManager.playWorld` 记录调用路径/坐标——
  **必须按 performance 资源表的真实 URL import**（裸路径在 HMR 后拿到空单例/不同实例，
  patch 不生效；SKILL #27 同款坑）；波形 RMS 分段 + 频谱质心（开门 ~2kHz 中高频、关门
  ~1.4kHz 低频）数值验证结构。

---

