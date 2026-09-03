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

#### 玩家/防御塔枪械命中僵尸与动物（2026-08-27）
- 用户素材 `打击音效/枪械击中.mp3` 入库为 `assets/sounds/weapons/gun_hit.mp3`，路径登记在
  `data/audio-config.json#combatCues.gunHitZombieAnimal`；跨实体共用命中声不得写死在怪物配置或单把武器中。
- 触发点必须位于 `DamagePipeline.applyHit()` 的实际伤害结算之后，并确认未被盾牌弹反；只接受
  “玩家（`faction=player` 且非防御结构）或 `_isDefenseTower` 防御塔 + `isGunWeapon()` 枪械 +
  `_faction=enemy` 且 `hasEnemyFamily('僵尸'/'动物')` 目标”。仓鼠士兵为 `companion` 阵营，明确不触发。
- 投射物必须快照发射瞬间的武器身份，不得在命中时读取玩家已经切换后的武器；命中声使用
  `SoundManager.playWorld(path, target.collider.x/y)`，沿用全局同路径重复保护，散弹同时命中不另叠爆音。

#### 场景 BGM 映射（2026-08-22）
- BGM 素材统一存放在 `assets/sounds/music/`，场景映射只写入
  `data/audio-config.json#bgm`，由 `SoundManager.playBgmForScene(sceneId)` 负责循环、音量和切场淡入淡出；禁止在场景类中硬编码音乐路径。
- `main` 是主神空间，使用用户素材 `罗马庭院.wav`。新游戏启动直接设置 `currentScene='main'`、
  不经过 `SceneManager.switchScene()`，因此 `Game.start()` 必须在确定主场景后显式调用一次
  `playBgmForScene('main')`；从其他场景返回时继续由统一切场尾部接管。
- `scene7` 是普通僵尸地牢（初级/中级/高级共用场景），继续使用
  `dungeon_echo.mp3`；`scene11` 是位面僵尸地牢世界，独立使用用户素材
  `幽洞回声.wav`。两者不可因题材相同而复用映射。
- `scene9` 雪原位面使用用户素材 `雪原回声.mp3`。雪原初/中/高级地牢仍共享运行时场景
  `scene7`，不得直接覆盖 `bgm.scene7`；由 `audio-config.json#dungeonBgm` 将
  `frozenBeginner/frozenMid/frozen` 映射到独立 `bgm.frozenDungeon`。`ExpeditionSystem.depart()`、
  `SceneManager.switchScene()` 与回滚恢复都必须向 `playBgmForScene(sceneId, { dungeonType })`
  传入当前地牢类型，确保首次进入、观察模式返回和失败回滚不会误播普通僵尸地牢音轨。

#### 全屏序章音效生命周期与公开素材归档（2026-09-03）

- 逐幕音效只在 `data/audio-config.json#openingCinematic` 登记路径与基础音量，控制器引用配置键，不硬编码文件名。音频以本地MP3进入 `assets/sounds/opening/`，禁止运行时依赖公网URL；公开素材必须确认可用于项目，并同时保留 `ATTRIBUTION.md` 和生成/下载manifest中的标题、来源页、直链、许可与压缩记录。
- 全屏叙事需要精确停止自己的环境音和瞬态音时，调用 `SoundManager.playFile(..., { controllable: true })` 并持有返回句柄。句柄用播放令牌确认仍拥有池化voice，只能停止本次播放，不能误停同路径后发的新声音，也不能重复减少全局voice计数。
- 切幕先停止上一幕瞬态音；环境键变化时停止旧环境音再播新环境音；SKIP、自然结束和异常退出必须停止全部句柄并释放预加载Audio。最终 `Game.start()` 与主场景BGM只在序章完成回调中启动，避免序章环境音与主神空间BGM提前叠加。
- 音频上下文在玩家点击“新游戏”后初始化，符合浏览器自动播放限制。正式入库前优先压缩无损中间件，Git只保留运行时需要的MP3与来源记录；WAV转码件、重复下载和试听缓存清理后再提交。

#### 友方单位音效（2026-08-16 仓鼠系列，用户素材）
- 素材复制改名入库 `assets/sounds/friendly/`：`hamster_shooter_attack.mp3`（射手出膛）、
  `hamster_melee_attack.mp3`（战士/盾卫共用，源=鼠鼠战士 1.mp3）、
  `hamster_miner_mining.mp3`（矿工挥锄）、`hamster_bounty_hunter_attack.mp3`（赏金猎人第 9 帧出膛）。
- 配置：`data/hamster-*-config.json` 新增 `sounds` 块（attack/mining 键 → 路径）；
  `Companion` 基类 `this.sounds = archive.sounds || {}`（一处生效，伙伴未配置默认为空）。
- 触发：各 AI 攻击命中/发射点调 `_playSound(key)` 助手——世界内发声走
  `SoundManager.playWorld(path, x, y)`（坐标衰减，音效铁律），无则 playFile 兜底；
  射手在 `_fireProjectile`（第 10 帧出膛）、战士 `_tryAttack`、盾卫 `_applyDamage`
  （第 10 帧判定）、矿工 `_tryAttack`（采矿命中）；赏金猎人继承火枪 `_fireProjectile`，
  只在第 9 帧投射物成功创建后播放自身 `sounds.attack`。
- 纯视觉岗位单位同样遵守配置与位置音效口径：仓鼠农民在 `population-economy.json#windmill.workerVisual.sounds` 声明 `harvesting`，`HamsterFarmerVisualSystem.setState` 只在进入收割状态时调用一次 `SoundManager.playWorld`；禁止在逐帧动画更新中播放或把素材路径硬编码进视觉系统。

#### 正式动作视频音轨→友军音效（2026-08-26 仓鼠反载/忍者）
- 只能从运行时精灵表实际采用的正式视频提取；先核对生成 manifest/source-sheet report 中的获选文件，不得从废案版本、同名备选或其他兵种视频补齐。每段保留 `source + trim window + output`清单和可复现脚本。
- 视频“有音轨”不等于可入库：先查声道/采样率/时长和100ms响度包络。动作前后接近静音、只有短促攻击峰值的片段可裁切；整段长时高响度、持续配乐/环境底噪或无法分离动作主体的音轨必须拒绝，不能为了“有声”就强行导入。
- 友军短音效默认裁出干净动作窗口，去DC，边缘12ms淡入/淡出，归一到44.1kHz双声道MP3；响度收口必须同时有 RMS 目标和峰值上限，峰值先到上限时不得继续拉高造成削波。当 PyAV/FFmpeg 在 Windows 不能直接封装到中文绝对路径时，先编码到 ASCII 临时目录，再用 Unicode-safe 文件 API 复制到正式路径；交付前删除临时探针和自动编码目录。
- 接线时点跟随游戏真实事件：枪声在投射物成功出膛时走 `playGunshotAt`，并把正式路径加入 `audio-config.json#gunshotPreloadPaths`；近战声在命中/接触帧单次播放；烟遁类状态音在隐身真正生效的会话守卫内播放，不在逐帧更新里重复触发。玩家本体技能可用 `playFile`；同一技能由仓鼠/Companion 施放时必须切换为 `playWorld(path, source.x, source.y)`。
- 可复用实现为 `tools/ai-gen/extract-hamster-soldier-audio.py` 与 `tools/ai-gen/hamster-soldier-video-audio-20260826.json`。正式 MP3、提取脚本和来源清单属于交付件；全程背景噪声、失败编码输出、临时波形/探针才是废案，不得误删其他会话保留的原视频和精灵表真源。

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
- 房屋运行时经济类型是`housing`，音效配置键是`house`；完成入口查配置时做局部映射，不能直接用`_economyType`索引，也不能为了提示音改动建筑类型或存档字段。完成音效只在真实前台完成分支播放，后台/预览不为此补播现场声音。
- 用户素材统一复制为英文稳定名放入 `assets/sounds/ui/`；触发代码只读配置键，不直接引用素材库路径，也不在多个升级入口复制同一 MP3 路径。

#### 全局按钮点击音效（2026-08-22）
- 用户素材以 `assets/sounds/ui/button_click.mp3` 入库，唯一路径配置在
  `audio-config.json#uiCues.buttonClick`，使用 `ui` 声道；禁止在各面板按钮处理器中重复播放。
- `SoundManager.init()` 只注册一次文档捕获阶段 `click` 监听，匹配 `button`、按钮型 `input` 与
  `[role="button"]`，因此首次启动后动态创建的面板同样生效。`:disabled`、`.disabled`、
  `aria-disabled="true"`、`data-disabled="true"` 及 `[inert]` 区域内按钮必须静音；
  普通地图点击、拖拽格子和无按钮语义的卡片不触发。

#### 右侧栏目与火球命中音效（2026-08-22）
- 右侧栏目开/关共用 `audio-config.json#uiCues.rightSidebarPanel`，由
  `right-sidebar-panel-layer.js` 对 role=`panel/modal` 的根元素统一监听 `active/style.display`
  可见性变化；role=`backdrop` 不监听，避免面板和遮罩同次切换双响。使用 `ui` 声道。
- 火球命中素材放 `assets/sounds/skills/fireball_hit.mp3`，路径写入双份
  `skills.json#fireball.sounds.hit`；直接命中、撞墙和最大射程空爆均在爆炸结算后用
  `playFile` 播放，同一颗火球只响一次。

#### 高频枪声低延迟播放（2026-08-23）
- 普通外部音效继续走 `playFile` 的同路径去重与4实例池；逐发枪声必须走
  `playGunshot`，带世界坐标的敌人枪声走 `playGunshotAt`，禁止重新退回普通 `playFile`。
- 玩家手枪、散弹与机枪/步枪在 `_fireRanged` 内必须全部汇合到 `_playFireSound`；尤其
  `WEAPON_FX_CONFIG.lmg.soundMap` 只是分支音色真源，不能据此绕过 helper 直调 `playFile`。
- `Combatant.fireProjectile` 默认负责一次开火声。复用它但另有整次击发枪口层的调用方（防御塔）
  必须传 `suppressFireSound:true`，再由枪口层只播一次；散弹 pellet 循环禁止逐弹丸发声。
- 敌对持枪者、防御塔、仓鼠火枪与赏金猎人的枪声走 `playGunshotAt`；弓箭、近战和普通动作音
  继续走 `playWorld`。不得因为单位射速较慢就把枪声退回普通同路径去重池，多单位齐射仍会撞限流。
- `gunshotPreloadPaths` 中的正式枪声在音频系统初始化时异步 `fetch + decodeAudioData`；未预载的新枪声
  在首次触发时按同样方式解码，解码期间仍用 rapidFire HTML Audio 兜底；
  缓存完成后每发创建轻量 `AudioBufferSourceNode`，不再对媒体元素反复执行 `play/seek`，
  避免55~60ms射速下的异步启动抖动。解码失败的路径固定退回 HTML Audio，不会逐发重复请求。
- 高速枪声读取 `rapidFireVoiceLimit/rapidFirePerPathVoiceLimit`，默认全局32、同路径24路；
  24路可覆盖双持 G18 同周期两发与约600ms尾音。达到上限时只截断最旧尾音，始终保留新一发
  枪口瞬态，同时避免无限叠加 Web Audio 节点。
- `rapidFireRepeatGuardMs` 默认0，射速和双持同帧击发均不得被通用35ms重复保护吞掉；
  普通 UI、环境、命中和怪物事件音仍保留原重复保护。

#### 自动步枪统一换弹与空仓闭锁声（2026-08-27）
- 自动步枪范围以`gun-ammo.js#WEAPON_CATEGORIES.rifle`为唯一分类，不按武器名逐把硬编码。所有步枪装备/切枪
  统一播放`assets/sounds/weapons/rifle_equip.mp3`，普通换弹统一播放`rifle_reload.mp3`；权威EDM、双份装备模板、
  `getEquipSound/getAmmoConfig`旧档回退必须保持一致。
- `_startReload`必须记录本次换弹是否从`current===0`开始。只有打空弹匣触发的换弹在一次性装填完成后，
  才额外播放一次`getEquipSound(item)`作为枪机闭锁声；剩余弹药大于0时主动换弹不得播放该收尾声。
  判定跟随换弹会话，禁止在逐帧更新中仅凭完成时弹量猜测。
- STG-44、QBZ-95、边境突击步枪与M416（素材来源HK416）分别使用自己的`fire.mp3`；玩家分支音色表、
  `GUN_FIRE_SOUND`回退、防御塔世界枪声和`audio-config.json#gunshotPreloadPaths`必须同步，继续走
  `playGunshot/playGunshotAt`低延迟通道。

#### 外部网站枪声筛选与来源建档（2026-08-29）
- 现实枪械只能采用“型号精确匹配 + 来源页明确允许商用”的单个候选；通用机枪声、游戏提取音频、
  授权不明条目和付费素材预览都不能通过录制或截取绕过授权。无合格结果时保留现状并如实记录缺口。
- 下载优先于浏览器录音，避免系统混音、二次压缩和截断尾音；来源已经是一次完整短促开火时，允许
  原文件直接入库，不为满足“截取”形式而二次编码。若来源含连发，仍按动作音频规则裁出单次瞬态、
  保留自然尾音并写明裁切窗口。
- 每批在`tools/ai-gen/`保存来源清单，至少记录搜索页、作品ID/直达页、作者、网站许可原文、下载规格、
  处理方式、运行时路径及拒绝原因。玩家、防御塔、旧档回退、装备模板、枪声映射和预载表必须同步。
- 2026-08-29 机枪批次仅MG42通过：爱给网作品A62931215标注“原创、CCE协议(CCE0,可商用)”，
  680ms单次开火的免费HQ MP3原样入库为`assets/sounds/weapons/mg42_fire.mp3`；其余型号的审核结论见
  `tools/ai-gen/aigei-machine-gun-audio-20260829.json`。
- 2026-08-29机枪免费来源补检新增M249：Freesound作品568010为Baelphazoar在靶场录制的M249点射，
  标注CC BY 4.0；从44.202秒原始96kHz/16-bit立体声WAV的26.69496875—27.55秒提取一段点射最后一发
  与自然尾响，只做20ms淡出，原路径`m249_fire.wav`不变，因此玩家、塔、旧档回退、双份装备数据和
  预载表无需重复改线。商业发行必须保留`assets/sounds/weapons/ATTRIBUTION.md`中的Baelphazoar署名。
- 2026-08-29 散弹枪批次仅S686通过：规范实枪匹配为Beretta 686 Silver Pigeon，作品A35690072标注
  `CC协议(可商用,署名)`；970ms免费HQ MP3原样入库为`assets/sounds/weapons/s686_fire.mp3`，署名
  `TheRealMattix`必须随商业发行保留在`assets/sounds/weapons/ATTRIBUTION.md`或等效游戏鸣谢中。其余
  七把现实型号的审核结论见`tools/ai-gen/aigei-shotgun-audio-20260829.json`。
- 免费来源补检固定按`OpenGameArt/CC0 → Freesound/CC0 → Freesound/CC BY → Sonniss GDC`逐级推进；
  每把武器仍最多保留一个精确型号候选。Sonniss 只允许从官网主下载、官网明确列出的镜像或官方种子
  获取，第三方目录镜像不得作为入库来源；其许可素材不得作为独立音效、素材包或AI训练数据再分发。
- 2026-08-29补检接入SPAS-12与M870：SPAS-12从Sonniss官网列出的2016 Mirror #1第4卷分段提取
  Pole Position近距96kHz/24bit实枪双连发，只保留第二次直接枪口爆音及其完整尾响为
  `spas12_fire.wav`；M870使用areniporgen的Freesound CC0精确实枪原始48kHz/32-bit立体声WAV，
  不转码原样入库为`m870_fire.wav`。M870的玩家、塔、双份装备模板和预载表同步；Sonniss许可禁止
  原始/可独立提取音效再分发，因此SPAS-12成品不得提交到公开源码仓库，公开分支必须保留原通用枪声，
  只保存来源记录与可复现提取脚本。SAIGA-12K虽找到精确CC0候选，但用户决定不更换；Super90也由
  用户明确决定不更换，两者继续保留现有运行时音效。

#### 三把基础手枪独立开火声（2026-08-29）
- 用户素材分别入库为 `m1911_fire.mp3`、`fn57_fire.mp3`、`usp45_fire.mp3`，对应
  M1911A1、FN Five-seveN、USP .45；USP.45 素材文件夹只有一个时间戳命名 MP3，正式入库时改为稳定英文名。
- 三把手枪的权威 EDM、双份装备模板和 `GUN_FIRE_SOUND` 回退必须一致；玩家 `_playFireSound`
  通过 `getFireSound(item)` 读取当前权威配置，使旧存档实例中历史 `fireSound` 不会覆盖新版枪声。
- 三条正式路径加入 `audio-config.json#gunshotPreloadPaths`，继续走 `playGunshot` 低延迟通道；
  本轮只替换音色，不改变射速、弹匣、伤害、散布、双持或投射物行为。

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

