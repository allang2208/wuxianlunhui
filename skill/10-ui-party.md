> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：10. UI、面板与组队系统

## 10. UI、面板与组队系统

### ⭐ 冷钢档案 UI 标准工作流（2026-08-21 定稿，新增或修改玩家 UI 一律先读）

- **权威规范**：`docs/ui-cold-steel-design-system.md`。新增面板、修改面板、HUD 调整、字体调整和主题色调整开始前必须先读对应章节，并按文末检查表交付。
- **视觉真源**：`ui/panel-theme-backpack.css`。灰、白、黑基础色、六档字体、边框、阴影、动画和通用 `.bp-*` 组件类只在此维护；禁止在业务文件复制“近似冷钢”色板。
- **标准模板**：`docs/templates/cold-steel-panel-template.js`。新右侧栏目从模板复制，保留业务根类 + `.bp-right-column`，生命周期统一使用 `BasePanel`。
- **右侧常驻入口图标合同（2026-08-23）**：`hud-panels-misc.js` 的 `sideMenuItems` 是人物状态、技能、背包、图鉴、任务、世界传送、队员管理、属性点与科技树入口的单一映射；正式图统一使用冷钢六边形母版、完整外框安全边距和真实 RGBA 透明底，科技树也使用稳定 PNG 路径而非 emoji。候选必须由玩家确认后才能覆盖 `assets/ui/icons/`（属性点沿用 `assets/ui/addpoint.png`）；换图不得改变既有 74×74 槽位、按钮顺序、快捷键或点击行为。
- **执行顺序**：修改前备份 → 判定面板类型 → 选择同类参考 → 接 BasePanel/右侧挂载层 → 使用主题变量和字体档位 → 核对关闭与输入 → 查看本轮 diff → 交由用户运行验证。
- **统一口径**：右侧主栏目和建筑详情默认 `45vw × 100%`，滑入/收回为 `0.25s cubic-bezier(0.4, 0, 0.2, 1)`；建筑详情是主栏目的同级独立栏目，不做父子嵌套页面。
- **关闭口径**：建筑详情使用 `panelGroup:'buildingDetail' / closeOnEscape:true / closeOnOutsidePointer:true`，外部关闭不得穿透到攻击、移动或场景选择。
- **字体口径**：display 只用于重大页面；title=一级标题，subtitle=分区标题，body=正文，meta=辅助信息，caption=微型提示，数字/计时使用 `--bp-font-number`。
- **范围纪律**：单个 UI 需求只改目标面板及必要共享件，不借机全量迁移旧面板；若需要改变本规范，先更新规范和主题真源，再实现业务代码。
- **Tooltip 数值边界（2026-08-22）**：`status-tooltip-helper.js` 的 `formulaLine()` 接收原始数字并统一交给
  `fmt()`；禁止先调用 `toFixed()` 生成字符串后再送入数字格式器，否则 `isFinite()` 会先隐式通过、随后在
  字符串上调用 `toFixed()` 崩溃。需要整数展示时传 `Math.round(number)`；可能来自配置或存档的速度值先在
  对应 Tooltip 分支局部 `Number(...) || 0`，不要为单项显示改动全局格式器或实际玩法数值。
- **人口经济岗位面板（2026-08-21）**：可安排岗位的经济建筑统一用 `.economy-workforce`、`.economy-progress` 与 `.economy-*-label/note`，第一根条固定显示“岗位安排百分比”；第二根条必须按建筑语义取权威数据——风车显示实际/基础产量，市场显示稳定的有效商人人效，工坊显示 `actualEfficiency / configuredEfficiency` 增效发挥率，银行显示本栋离散结算周期、剩余时间与本轮金币，禁止把共享 `_economyTickMs` 当成市场或工坊的生产进度。仓库不套岗位条语义：第一根“仓储容量”只显示当前仓库的压缩后物理占用率，紧随其后的“位面总容量”显示全部活动仓库聚合占用率，两条均从同一容量服务读取并随面板 tick 刷新。进度只以内联 `width` 表达动态值，外观和低→中→高语义渐变必须留在 `panel-theme-backpack.css`；禁止为各建筑复制色板和按钮样式。市场档案必须同时显示买价、卖价、压力、动态价差和固定交易损耗，按钮文案显示真实扣款/所得而非批次预算。经济工坊与银行的四项本栋升级继续调用 `renderBuildingUpgradeCard` 与共用 tooltip，状态区用两列数字档案，窄屏退化单列；选中对应建筑时覆盖圈必须同步显示并随范围升级刷新。带有布局惩罚等关键副作用的建筑，建造配置应提供 `buildWarning`，选择建筑后在 `#bpHints` 的 `.build-context-warning` 以危险红色显示，取消选择时清空，禁止把警告混进普通快捷键文案。
- **右上基础资源栏（2026-08-22）**：资源栏与 `.game-time` 必须同挂在 `.top-right-hud` 弹性容器，资源栏在前、时间在后，禁止按时间文本宽度硬编码 `right` 偏移；容器与顶部状态栏共享 `top:12px` 基线并使用 `align-items:flex-start` 顶边对齐，资源栏固定为与顶部状态栏一致的 50px 高度，不跟随时间栏拉伸。金币读取 `GoldManager.getGold()`，能源和食物读取 `EnergyManager.getEnergy()/getFood()`；沿用 HUD 刷新入口，但只有数值变化时才改写 DOM。已初始化数值发生变化时，只重播对应数字的单次金色辉光动画，首次载入不触发；数值使用数字字体与资源语义色，外壳继续读取冷钢主题变量，并尊重 `prefers-reduced-motion`。

### 任务系统数据与瞬态场景合同（2026-08-22）

- `data/quests.json` 与 `public/data/quests.json` 是任务定义双份真源，必须同步；`QuestRegistry` 只提供深冻结定义，禁止把 `accepted/completed/current` 等运行字段写回定义。
- `QuestStore` 是任务状态唯一真源：任务状态、逐项目标、活动会话、裂隙位置/进度与失败原因统一版本化序列化；主存档只保存 `quests: QuestStore.serialize()`，旧档缺字段时回到默认态，旧单例形状由 store 迁移入口清洗。
- `QuestSystem.QUESTS` 与 `QuestState` 仅作为旧 UI/NPC/裂隙调用点的兼容门面；新增逻辑应调用 registry/store 命令，禁止再建立第四份进度状态。状态变化通过 store 订阅刷新已打开的任务档案。
- 任务借用未解锁持久世界时，`switchScene(..., { questTravel:true, questId })` 必须同时校验活动任务、目标 scene 与 `mode:'quest'`；普通传送门建造/进入门禁保持不变。SceneManager 用独立的任务实例标记贯穿死亡和回城，不能在离场时临时读取已可能被重置的 `QuestState`。
- 瞬态任务实例只复用目标世界地形、边界与障碍，不启动该世界的 Defense/资源/建筑/快照/迷雾/入侵/兵线，也不读写该世界永久坐标。裂隙、返回门和任务怪必须按菱形边界与可行走性采样，并清除落点重叠的 `_scatter` 障碍和地表装饰。

### 小地图（GameScene 静态层/动态层，2026-08-16 布局修复沉淀）

- **结构**：静态层 `_minimapStaticGraphics`（背景/边框/墙壁，缓存重绘）+ 动态层
  `_minimapDynamicGraphics`（视野框/实体点/玩家箭头，每帧 clear 重绘）+ 标题 text，
  全部 scrollFactor(0) + depth 99999，`_syncHud` 里调用（NPC 对话时隐藏）。
- **scrollFactor(0) 对象在 zoom≠1 下的定位铁律**：Phaser 4 对 scrollFactor=0 的图形
  仍乘相机 zoom（只是不随相机滚动）——所有绘制坐标必须 × `1/zoom`（`_minimapInvZoom`），
  屏幕位置 = 绘制坐标；`Camera` 必须 `setOrigin(0,0)`（origin 0.5 会按视图中心枢轴
  平移缩放，zoom 0.7 时小地图被推到屏幕中部，2026-08-15 修复）。
- **⚠ 静态层缓存键必须含 zoom（2026-08-16 世界-122 实锤）**：缓存键
  `wallCount:worldWxworldH` 缺 zoom——切到世界-122（zoom 0.7）时 `_syncHud` 先于
  `_updateCamera` 运行，静态层按上一场景 zoom=1 的 invZ 绘制；之后 zoom 变化但键不变
  → **永不重绘**，背景被相机缩放成 105×105 @ (7,42)：视野框（动态层按正确 invZ）
  画出背景框外 + 背景顶部与左上菜单按钮重叠。修复：缓存键加 zoom 维度 +
  `_updateCamera` 里 zoom 变化时显式 `_minimapStaticKey = null` 双保险（SKILL #31
  「缓存键必须包含全部渲染输入 + 场景切换处显式失效」的又一例证）。
- **视野框视口尺寸用 `this.scale.width/height`**（与 `_updateCamera` 同源），不要用
  固定 `CONFIG.VIEW_WIDTH/HEIGHT`——窗口非 1920×1080 时黄色视野框偏小/偏大。
- **静态层墙壁绘制也要框内裁剪**（与动态层 `inBox` 同口径）：墙可带负坐标/越界
  坐标，不裁剪会画出小地图框外。
- 验证：`tools/cdp-minimap-probe*.mjs` 解析两层的 commandBuffer（FILL_RECT=3/
  LINE_TO=4/MOVE_TO=5）换算屏幕坐标，断言静态层背景 == 配置位置尺寸、视野框 ⊆ 框内；
  截图 `tools/verify-shots/minimap-*.png`。

### 面板生命周期框架（2026-07-21 新增，新面板优先复用）

新增抽屉式面板时**优先复用** `src/ui/panels/base-panel.js`（BasePanel），不要重写 open/close/toggle/遮罩关闭：
- `new BasePanel({ id, className, stateKey })`：懒构建单例 DOM（首次 open 创建），open/close/toggle 统一走 UIState + active 类（抽屉动画由 CSS className 自带）；
- 只需实现 `buildContent(el)`（填充 HTML/绑事件，只调一次）与可选 `onOpen()/onClose()` 钩子；遮罩层点击关闭框架自带（各自判断 isOpen，多面板共存）；
- 对象字面量系统同样适用（参考 `warehouse-system.js` 的 `_getPanel()` 懒创建模式 + `get _isOpen()` 代理）。
- **消耗品拖拽与快捷栏层级（2026-08-22）**：从玩家背包拖动消耗品时，先快照
  `systemPanel.getBoundingClientRect()`；指针仍在该范围内保持既有层级，允许交换背包格位置。
  第一次越过启动时边界后，背包和 `panelOverlay` 均继续显示，只把 `.bottom-bar` 临时挂到
  `#rightSidebarPanelLayer` 的 modal 子层，使快捷栏盖在背包之上；`dragend` 必须恢复快捷栏原父节点
  与顺序。快捷栏以外区域继续走原丢弃规则；仓库打开时保持双面板拖放，不进入该让位逻辑。
- **右侧栏目层级（2026-08-20）**：状态/装备背包/技能/图鉴、任务、位面与队员管理统一用
  `mountRightSidebarPanel` 挂到 `#rightSidebarPanelLayer`，禁止继续分别挂在 `#uiLayer`、
  `#gameContainer` 或 `body` 后只调子元素 z-index。普通右栏面板 role=`panel`，遮罩=`backdrop`，
  队员招募等从属模态=`modal`；统一层高于普通场景 UI，但暂停菜单等全局模态仍在其上。
- **右栏浮窗必须进入同一堆叠上下文（2026-08-21）**：右侧栏目层本身是
  `z-index: var(--z-right-sidebar-panels)` 的独立 stacking context。项目说明、装备提示等浮窗若仍直接
  挂在 `body`，即使自身 `z-index` 很高也可能被整层右栏遮住；应挂到 `#rightSidebarPanelLayer`
  内并高于 panel 子层。共用建筑升级浮窗以 `building-upgrade-tooltip.js` 为参考，同时负责把旧的
  body 子节点迁回正确层级。
- **建筑详情统一关闭（2026-08-19）**：建筑类 BasePanel 传
  `panelGroup:'buildingDetail' / closeOnEscape:true / closeOnOutsidePointer:true`。
  `closeBasePanels('buildingDetail')` 同时覆盖浏览器键盘与 Electron ESC；面板外左/右
  `mousedown` 关闭整个详情分组并阻止点击穿透到攻击/场景操作。面板内部点击不关闭，
  打开后300ms内忽略外部关闭以防打开事件自身回落。

已迁移范例：`warehouse-system.js`（仓库面板）。

- **地牢出征准备钥匙合同（2026-08-22）**：出征状态固定为最左侧钥匙/奖励说明与中部地牢、
  正式队友选择，不再挂载祭品填充栏、祭品效果栏或右侧装备背包。队友栏只读写 `PartySystem.members`（点击成员进入
  管理/移出，点击空位招募替换），禁止把 `Game.friendlyUnits` 中的仓鼠兵种混入。左栏实时展示当前地牢对应
  `anchorTokenF~A` 及背包+仓库总数；确认出征自动消耗，不允许手工拖入祭品。
  `body.expedition-preparing` 仅隐藏常驻 `.party-bar`、侧栏遮罩并在关闭/出征时清理，禁止移动
  组队栏或其他 HUD 的预设坐标。
- **出征背景资源合同（2026-08-22）**：全屏出征界面统一引用 `assets/ui/expedition-bg.png`；
  `game-style.css` 与 `ui/panel-theme-backpack.css` 必须继续共用该路径及 `center / cover no-repeat`，替换背景时直接覆盖此唯一资源，禁止再引入并行旧图或分叉路径。
- **出征/路线双 Canvas 层级合同（2026-08-23）**：地牢路线背景、连线和节点由下层
  `#gameCanvas` 绘制，Phaser 主画布平时位于其上。进入 `body.map-mode` 后必须通过专用
  `.phaser-game-canvas` 类显式隐藏上层画布，不能只依赖相机 `rgba(0,0,0,0)`；相机/渲染器
  的黑色清屏一旦未正确清除，会把已正常绘制的路线页整体遮成纯黑。路线模式同时兜底隐藏
  `.expedition-overlay/.expedition-panel/.expedition-rule-panel`，退出路线模式移除 body class 后
  Phaser 画布自然恢复。出征左侧说明栏与中部面板必须共享同一个宽度变量并都用
  `box-sizing:border-box`，否则说明栏的 padding/border 会越过约定边界遮挡钥匙提示。
- **地牢友军边界**：确认出征时把 `Game.friendlyUnits` 暂存到 `SceneManager` 并从地牢运行态清空，
  回到主神空间后按原对象和原坐标恢复；只允许独立注册在 `PartySystem.members` 的正式队友随行。

- **建筑详情独立栏目（2026-08-21 新口径）**：墙/门/楼梯详情和塔、小屋、兵营、
  配置型生产建筑、基地核心详情都作为 `#rightSidebarPanelLayer` 下的同级独立栏目，统一
  `45vw × 100%`、右侧滑入/收回和建筑详情关闭分组。禁止把详情 DOM 嵌入建筑主面板或通过
  `.detail-active` 切成父子二级页；打开详情时用 `bringToFront:true` 置前，关闭后自然露出仍在下层的
  建筑主栏目。建设模式全局标记 `Game._buildMode` 仍供塔/小屋/兵营跳过 260px 交互距离。

### 模式级快捷键与角色输入隔离

- 建造、RTS、观察者等模式复用角色键位时，模式监听必须注册在捕获阶段，先于通用 `Input`
  消费事件；合法模式事件执行 `preventDefault()`、`stopImmediatePropagation()`，并清除
  `Input.keys` 中已经遗留的同名按键状态。
- 模式切换入口还要主动清理旧按键状态；按钮通过键盘激活后应立即 `blur()`，避免同一次空格
  既激活按钮又在下一帧触发角色翻滚。
- 文本框、下拉框和 `contenteditable` 保留浏览器的文字输入，但仍阻断事件进入角色输入链；
  `event.repeat` 不重复切换模式。
- 模式快捷键只改变显示或指令状态，不能进入伤害、碰撞、寻路等逻辑真源。
- **玩家纳入 RTS 时必须切换控制源（2026-08-23）**：F1 只负责模式状态与输入锁，玩家移动/普通攻击由专用控制器产生命令意图，再交给既有玩家速度、墙体、高架、武器和弹药链消费；禁止伪造 `Input.mouse`，也禁止把玩家塞进友军 `_command` 后交给单位 AI。玩家编组使用稳定保留键，PartySystem 选中同步仍只写正式队友 ID。
- **指挥奔跑是表现态，不是冲刺态**：统一显示谓词可合并 `_isSprinting || _rtsRunVisual`，但耐力消耗、冲刺速度、冲刺攻击、尘土与双手枪打断仍只读取真实 `_isSprinting`。逐发装填枪在指挥攻击中不得走手动打断入口，保持 `reloading` 到满弹，再由持续攻击命令自动续射。

#### 步骤4: 声道与 BGM（2026-07-21 新增）
- **声道**：`playFile(path, volume, channel)` 第三参为声道（`sfx` 战斗音效默认 / `ui` 界面 / `music` 音乐），声道音量配置在 `data/audio-config.json` 的 `channels`（独立于 masterVolume 的二级调节）；运行时可 `SoundManager.setChannelVolume(channel, v)`。
- **BGM**：`data/audio-config.json` 的 `bgm` 映射场景 → 音轨（`null` = 无 BGM），切场景自动播放/停止（SceneManager 已接入 `playBgmForScene`）；音轨用 `playLoop` 循环，交叉淡入 `bgmCrossfadeSec`。新 BGM 素材放入 `assets/sounds/music/` 并填配置即可。

---

### 侍从系统框架（2026-08-12，占位符阶段）

> 框架已验收通过；当前为数据/UI/队伍管理骨架，战斗模型贴图未渲染（占位）。

#### 架构与文件地图
- `data/companion-config.json`：候选侍从档案（id/name/title/desc/avatar 占位/
  modelPlaceholder/growthRule/初始六维/skills 占位/weaponType）。新增侍从 = 加档案 + 成长规则。
- `src/config/companion-growth.js`：成长规则注册表（`GROWTH_RULES[id] = (companion, points) =>
  {str,dex,int,con,wis,luck}` + `registerGrowthRule(id,fn)` 扩展）——升级属性点自动分配，
  **不硬编码**；未知规则回退 balanced（总点数不丢，缺额补体质）。
- `src/entities/companion.js`：数据模型与玩家对齐（六维 data/level/exp/equipments/backpack/
  skills）；`gainExp` 战斗专用（升级曲线=玩家 computeMaxExp，升级回满 HP/MP）；序列化接口。
- `src/systems/party-system.js`：单例，最多 3 名侍从（玩家+3=4 人队）；`grantCombatExp`
  **与玩家同额、无平分机制**；onChange 订阅刷新。
- UI：`party-ui.js`（组队栏，替换 questTracker 位置）、`recruit-ui.js`（卡片招募）、
  `companion-panel.js`（右侧队员面板三 tab + 背包拖入）、expedition 四圆圈（hud-panels-
  expedition-quest-reward.js 的 `expeditionMemberBar` + expedition-system.js `_renderMemberBar`）。
- **组队栏选中/多选（2026-08-16）**：点击名字=单选选中该单位（**不再点击即弹队员面板**，
  面板仍走右侧边菜单「管理队员」），Shift+点击=多选；选中数据存 `PartySystem`
  （`selectedIds` / `setSelected` / `toggleSelected` / `clearSelection` / `isSelected`，
  移出队员自动退出选中并 notify）；组队栏槽位选中态 = `.party-slot--selected`（金框发光）；
  GameScene `_syncCompanionSprites` 按 `isSelected` 给精灵金色 tint（0xffd98a）+
  脚下光圈（`_selectionRings` / `_showSelectionRing`）；指令轮盘目标 =
  `PartySystem.selectedIds`（无选中兜底队员面板当前队员/第一名），轮盘不再全局拦 UIState
  （改为按按下时悬停目标拦截）+ 拦截 `.companion-overlay`；**待命指令立即打断**
  攻击/防御/风车/施法（不再等动画播完才生效）。实机探针：`tools/cdp-party-select.mjs`。

#### 铁律/坑
- **档案恢复必须带 AI 配置（2026-08-16 实机根因）**：`Companion.serialize()` 存
  `aiConfig`/`unlockSkills`，`fromSerialized` 恢复（老档回退 companion-config.json
  同 id 档案）并按真实等级重跑 `_checkUnlocks()`——否则解散再招募/读档后
  `aiConfig=null`：GameScene `aiMode` 为 false 把队员当“纯跟随单位”贴玩家（精灵
  与逻辑坐标脱节），AI 错用 DEFAULT_MAGE_AI，**命令执行了但画面不动**（伊莉丝
  “不执行”根因）。另：`_tick` 命令态覆盖动画只对法师做 `spell`，近战不能覆盖
  （否则命令态战斗伊莉丝攻击动画被顶掉）。探针：`tools/cdp-elise-command.mjs`。
- **剑盾近战采集（2026-08-16）**：`_applyWarriorCommand` 的 gather 不能回落跟随
  （旧代码 `case 'gather': default: follow` 是伊莉丝“采集不执行”根因）——
  `_cmdWarriorGather`：走到指令点最近能源点（`_isEnergyNode` 未枯竭）→ 近战范围
  `_tryMeleeAttack` 挥砍（atk×1.25，节点 takeDamage 产能源），袋满回玩家移交；
  探针 `tools/cdp-elise-gather.mjs`（334px 外 run→walk→attack，节点掉血）。
- **队友动作全量审计（2026-08-16）**：`tools/cdp-party-audit.mjs`——5 指令
  （hold/follow/patrol/aggressive/gather）× {露娜,伊莉丝} × {新招募,档案恢复}
  20/20 通过：露娜远程（施法/弹体采集），伊莉丝近战（挥砍采集/贴身追击），
  档案恢复后 aiRole 正确、命令照常执行；战斗动作（攻击/防御/风车/施法/跟随/撤退）
  由 cdp-elise-ai / cdp-luna-ai 复核通过。审计用例记得开敌人屏蔽器
  （主城野怪会随时间刷出干扰）。
- **移动攻击/两点巡逻统一（2026-08-22）**：轮盘 `attack_move/patrol` 与 RTS 左侧通用按钮
  都写入 `RtsTacticalOrderSystem`；高层命令逐帧翻译为 AI 已支持的 `move/attack`。移动攻击在
  900px 统一感知范围内接敌，击杀后恢复原终点；巡逻以单位下令时位置为起点、指令点为另一端，
  两端往返并在战斗结束后续巡。显式右键移动、指定攻击、跟随、待命等新命令必须先清高层命令。
- **指令入口能力过滤与普通模式复用（2026-08-22）**：中键轮盘只在实际目标中存在仓鼠探险家时
  渲染“探险”，普通队友与其他仓鼠单位不显示无效按钮。左下指令框在 RTS 模式读取
  `RTSCommand._selection`，普通模式读取 `PartySystem.selectedIds`；普通模式地图选点必须在
  mousedown 当帧开始消费玩家输入边沿，避免既下达巡逻/移动攻击又被旧左键纯移动覆盖。
- **选中光圈（2026-08-16）**：填充 alpha 0.15 / 边缘 strokeAlpha 1.0；深度 =
  **该成员精灵 − 0.1**（与阴影同口径）——AI 队员贴图深度由 `_updateDynamicDepths`
  按世界 Y 每帧仲裁，光圈必须在仲裁段精灵 setDepth 后同帧覆盖（`_showSelectionRing`
  里读上一帧深度只是兜底），否则玩家/队友纵向移动后光圈会盖到贴图上。
  探针：`tools/cdp-ring-check.mjs`（参数 + 深度跟随 + Y 移动同步）。
- **仓库能源唯一真源（2026-08-23 矿工物流修订）**：玩家与普通队友采矿仍直接进入仓库；仓鼠矿工是唯一运输例外，矿点产出先进入个人经济背包，返抵所属矿工营地并提交后才写入仓库。矿工背包不是可操作物品栏，也不属于最终库存。
  `EnergyManager` 注册所有 `workshopType:'warehouse'` 建筑，`getEnergy/getCapacity`
  聚合每座仓库的 `storedEnergy/storageCapacity`；单仓默认5000，多仓容量与存量自动求和。
  玩家、仓鼠矿工、玩家队友攻击能源点时由 `EnergyNode.takeDamage` 直接
  `depositEnergy`，满仓时不扣矿点并提示“仓库已满，请修建更多的仓库”。
- 矿工背包默认 300；矿工营地“背包扩容”每级 +100、最多 5 级。背包满后进入
  `unload_return→storage_wait`，仓库放不下的部分继续留在矿工身上，腾出容量后在营地续交，
  全部提交后自动复工。撤销矿工人口岗位时同样先返营提交再离岗。被下达 gather 的正式队友
  改为 hold 并停止采矿，需重新下达采集指令。
- 能源退款必须先 `EnergyManager.canStore(refund)`，禁止先拆建筑再因满仓丢退款；
  胜利奖励显示 `depositEnergy` 实际入库量。主存档写 `world122.energyStorage`。
  回归：`test-energy.mjs` + `test-warehouse-energy.mjs`。
- **伊莉丝动作音效（2026-08-16）**：`assets/sounds/companions/elise/attacking.mp3` /
  `defending.mp3`（铠甲骑士 attacking/defending 副本）；companion-ai.js
  `ELISE_SOUNDS` + `_playSound(key)`（`SoundManager.playWorld` 世界音源），
  `_tryMeleeAttack` → attacking、`_startDefend` → defending。
  探针 `tools/cdp-elise-sound.mjs`（攻击 ×2 / 防御 ×1 触发；防御触发注意风车优先：
  4 敌放 250~380px 在风车范围外才会走防御）。
- **左键纯移动指令（2026-08-16）**：有队友选中时左键点组队栏外任意位置 =
  取消选中 + `setCommand(selectedIds,'move',worldPoint)`；AI `_cmdMove` 只移动不接敌，
  到达（≤40px）站定，目标不可达走 `_nearestWalkable`（WallSystem.canMoveTo 失败 →
  16~400px 螺旋找最近可达点）；move 模式跳过掉队/卡死瞬移。move 不在轮盘 5 指令表
  （轮盘 `_execute` 只认 follow/aggressive/patrol/gather/hold），探针直接调 setCommand。
  game.js 已挂 `Game.Renderer` / `Game.WallSystem`（探针用，勿依赖动态 import 平行实例）。
  探针 `tools/cdp-party-move.mjs`。
- **右键移动=最高优先级（2026-08-16）**：有选中时右键 = 清空当前指令后执行
  `move`（不取消选中，可连续右键改道）；`move` 在法师/剑盾的
  `cmd.mode==='hold'||'move'` 分支**先于施法/攻击/防御/风车锁打断**，`_cmdMove`
  再清 gather/patrol 残余；game.js 右键块在 `if(leftPressed)` 之外独立执行并消费
  `rightPressed`（防玩家右键特殊攻击同帧触发）。目标点画绿色下指箭头
  （GameScene.showMoveMarker：0x3dff6a 三角+箭杆，depth=y+15，1.2s 淡出）。
- **指定攻击指令（2026-08-16 RTS 右键点敌）**：`PartySystem.setCommand` 签名扩为
  `(target, mode, point=null, targetEntity=null)`——`mode==='attack'` 时把目标实体存入
  `_command.target`；companion-ai 的 `case 'attack'` 转 `_cmdAggressive(entities, player,
  cmd.target)` / 法师 `_cmdWarriorAggressive(..., cmd.target)`，队友优先打指定目标。
  探针 `tools/cdp-party-rightmove.mjs` + 截图 `tools/verify-shots/rightmove_marker.png`。
- **指挥模式审计终案（2026-08-18）**：
  1. **能力边界不能靠“写了 `_command`”假装支持**：经济矿工标记
     `_rtsSelectable=false / _rtsCanAttack=false`，RTS 收集、点选、框选和编队入口必须统一过滤；
     矿工 AI 还要清理旧档遗留命令，保证玩家不能用历史 `_command` 打断自动采矿物流。
  2. **指挥与建筑模式强制互斥**：启用 RTS 先 `_closeBuildingUI()`；`BuildingSystem.open`
     反向关闭 RTS；RTS 鼠标过滤必须包含 `.wall-editor-panel`。指挥模式点建筑后退出 RTS，
     掩体详情必须走 `BuildingSystem.open()+_showDetail`，禁止裸 `_buildPanel()+active=true`
     （会缺监听器、幽灵无法放置且面板点击泄漏成世界点击）。
  3. **跨场景命令清理**：离开 scene8 时全队命令重置 follow，并清 target/
     `_tacticalTarget`/路径/速度；否则 scene8 世界坐标和敌人引用会带进下一场景。
  4. **右键移动即时打断**：盾卫/民兵的 `_swingActive`、射手/斥候的 `_shotActive`
     通过 `cancelForCommand()` 清理；已飞出的投射物继续，尚未出膛的动作取消。
  5. **选中判定按身体矩形**：点击/框选统一用 `_unitScreenRect`（collision/size/bodyHeight
     投影到客户区），不能只认脚底 `collisionRadius+6` 小圆；高大精灵点身体也能选中。
  6. **属性面板读真实数据源**：仓鼠攻击优先 `_ai._attackDamage` / `aiConfig.attackDamage`，
     移速优先 `aiConfig.walkSpeed`；运行时 `maxSpeed=0` 只表示当前站定，不是基础移速。
  7. **详情查询必须只读（2026-08-22）**：`RTSCommand._readStats()` 不得为了刷新面板调用
     `calculateCombatStats()`，否则会覆盖已经应用到 `data.def` 的兵种防御升级。升级栏分别读取
     `unit-upgrade-store`、`ability-store`；矿工读取所属 `_hut.modules`。状态栏读取选中实体自己的
     `statusEffects` 与旧式层数/计时字段，不得借用只代表玩家的 `StatusBar.effects`，也不得在 UI
     创建第二套倒计时。状态列表仅在类型结构变化时重建，层数、效果值和剩余时间原地刷新。
  回归：`scripts/test-rts-command.mjs` + `scripts/test-party-system.mjs` 均已接入 `npm test`。
- **能源簇位（2026-08-16）**：`ENERGY_CONFIG.clusters`——(2000,1300) 曾落在常见
  建屋区（小屋门口见既有矿点的观感来源），已东移至 **(3000,1500)**；新位置距基地
  ~2170px、距最近簇 ~850px，6144×4096 内且不在右端刷怪带。树木散布排除带随簇心
  自动更新；簇位是唯一数据源（energy-node-system.setup / scene-manager 树排除均
  读取它），无测试硬编码。验证探针 `tools/cdp-cluster-move-check.mjs`
  （旧位 0 节点 / 新位 14 / 旧建屋点门口 0 矿）。
- **能源节点间距铁律（2026-08-16）**：节点贴图最大 91px（nodeSize 84 × displayScale
  1.08），簇内最小间距必须 **≥115px**（旧 85px 导致全图 27 对贴图重叠——“门口
  叠矿/贴图叠一起”实锤根因）；改间距时同步看 spread 是否够放满 count。
  探针 `tools/cdp-node-overlap.mjs`（<110px 重叠对应为 0）。另：`EnergyNodeSystem.setup`
  生成前强制清空场上残留 `_isEnergyNode`（防 HMR/重复 setup 堆积）。
- **能源节点强制审计（2026-08-16）**：世界-122 只允许存在当前 4 簇内的矿点——
  `EnergyNodeSystem.sweepStacked()` 每 ~1s（GameScene.update）① 删除不在任何簇
  （spread+50 内）的残留节点 ② 同位置（<60px）多节点只留第一个（防“门边叠矿”）。
  实机验证：注入 (1324,2110)×3 + 北边散点 → 1s 全清、总数回到 54。另外
  `SceneManager._saveMainSceneState/_loadMainScene` 主城快照**剔除 `_isEnergyNode`**
  （矿点绝不能经保存/恢复被带回主城——旧污染会凭空出现“家门口一堆矿”）。
- 升级经验唯一入口：击杀结算（damageable-entity）→ `PartySystem.grantCombatExp`；无野外经验。
- 物品转移 `slot` 必须最后写（`{...item, slot: targetSlot}`——源 item 自带 slot 字段，
  spread 会覆盖目标槽位，实机抓出）。
- 拖入队员背包：`CompanionPanel._moveFromPlayerToCompanion` 读
  `Game.EquipManager._dragDropManager._dragSrc` 并置 `_dropHandled=true`（阻止 dragend 丢弃）。
- **队员装备与玩家通用（2026-08-12）**：`src/ui/equip/equip-rules.js` 共享
  `canEquipSlot`/`getEquipmentBonuses`（玩家 drag-drop-manager 与侍从同一套，勿再各写）；
  队员背包装备走 `Companion.equipFromBackpack`（自动槽位：单手主手→weapon2→offhand→全满替换
  主手；盾进副手且卸双手主手；双手武器只进主手；被占槽替换回包）+ `unequip` + `calculateCombatStats`
  （六维差值法 + atk/def 同玩家公式）；队员背包格拖回玩家背包走
  `text/companion-item` → drag-drop-manager inv-cell drop → EventBus
  `companion:moveToPlayerBackpack`。
- **调试铁律**：Runtime.evaluate 里 `import('/src/xxx.js')` 会创建**平行模块实例**——
  调试/探针一律用 `window.Game.PartySystem/RecruitUI/CompanionPanel/ExpeditionSystem`
  （game.js init 挂载的单一权威），否则 addCompanion 加到平行实例而 UI 读静态实例（实测抓出）。
- **技能通用模块（2026-08-12）**：技能公式/构建单一来源 `src/systems/skill-formula.js`
  （纯函数，data-loader 委托 + skill-system 共用）；`src/systems/skill-system.js` 提供
  buildSkillMap / grantSkillExp（修炼，升级逻辑与 SkillLevelSystem 同源内联——保持无 Phaser
  依赖可 node 单测）/ onSkillLevelUp（按 effectFormula 属性奖励）/ renderSkillList（通用技能卡）。
  侍从技能 = companion-config.skills 的 id 数组（当前空=占位，填 id 即自动拥有/修炼/渲染）。
  **坑**：skill-system 勿 import data-loader / skill-level-system（会拉 Phaser 依赖链，
  node 单测 `window is not defined`）；公式解析器改动必须同步 skill-formula.js（唯一实现）。
- **队员管理入口（2026-08-12）**：右侧 side-menu（hud-panels-misc.js）「👥 队员管理」→
  `CompanionPanel.openManage()`（顶部队员切换条 + 空状态招募按钮 + 打开时隐藏 side-menu）。
  **坑**：清空队伍用 `while(members.length) remove(members[0].id)`（遍历中 splice 会跳项）。
- **解除招募保留状态（2026-08-12）**：PartySystem._roster 档案库——removeCompanion 存
  `serialize()`（等级/属性/装备/背包/技能全保留），addCompanion 有档案走 `fromSerialized`
  恢复继承；招募卡片按 `unlocked/inParty` 显示「再次加入（继承状态）」/「已在队」；
  `serializeRoster()/restoreRoster()` 为存档接口预留。
- **队员背包双栏（2026-08-12）**：companion-panel「装备背包」tab 时左侧同步弹出玩家背包栏
  （`.companion-player-pack`，实时读 `EquipManager.backpackItems`），与队员面板并排紧贴
  （`.companion-panel.with-pack` 圆角切换）；玩家背包格 draggable 写
  `EquipManager._dragDropManager._dragSrc` 后拖到队员背包/装备槽（既有转移接口）。
  **复刻铁律（2026-08-12 返工）**：玩家背包栏必须**逐字段复刻** slot-renderer 的格子格式
  （`.inv-cell.occupied` + inv-rarity 稀有度竖条 + 强化/改造/附魔标签 + 图标 + inv-name +
  inv-stack + data-slot/dragType/dragId/itemName），tooltip 调
  `EquipTooltipManager.bindInventoryTooltip()` 复用；**容器勿用 .inventory-grid 类**
  （updateInventorySlots 用 queryAllElements 全局索引会把它后面的格子 slot 错位），
  用独立容器类 + `.inv-cell` 格子（CSS/tooltip 自动复用）。
- **属性/技能面板复刻（2026-08-12）**：队员属性 tab 生成玩家系统面板同款
  `.status-page` 结构（status-header + 状态条 bar-fill + 基础属性 attr-list 两列 +
  战斗属性 + 详细信息 + 档案）；技能 tab 用 skill-system.renderSkillList 输出玩家同款
  `.skill-card`（skill-icon/name/level/exp-bar）网格——复用全局 CSS，勿自造样式类。
- **队员面板=玩家 system-panel 完整复刻（2026-08-12 二轮返工铁律）**：队员面板外层必须用
  `.system-panel`（右侧滑出 45vw 全高毛玻璃）+ `.panel-tabs`/`.tab-page`；装备页完整复制
  `.gear-layout`（上 `.equip-grid` 3×5 网格 15 槽 + 下 5 列背包格）；**但装备槽/背包格
  必须用 `companion-*` 独立类复制样式**（`.companion-diablo-slot`/`.companion-pack-grid`/
  `.companion-cell`），不能直接用 `.diablo-slot`/`.inv-cell`——玩家渲染器
  （updateEquipSlots/updateInventorySlots）和 tooltip 全局绑定会污染队员槽位。
  展示类（status-page/gear-layout/equip-grid/skill-card）可复用，数据类槽位需隔离类名。
  **玩家装备栏复制（2026-08-12）**：左侧玩家背包栏的装备栏**可以**直接用 `.equip-grid` +
  `.diablo-slot` 类（数据显示的就是玩家装备，玩家渲染器 updateEquipSlots/bindEquipTooltip
  遍历填充/绑 tooltip 恰好正确）；玩家背包格仍用独立容器 + `.inv-cell`（自渲染，
  避免 updateInventorySlots 全局索引错位）。队员侧装备槽/背包必须 `companion-*` 隔离类。
  **双界面同步（2026-08-12）**：队员面板玩家背包栏与玩家系统面板背包 = 同数据
  （EquipManager.backpackItems）、两套 DOM；必须包装 `EquipManager.updateInventorySlots`
  （CompanionPanel._syncPlayerPackHook）让玩家侧操作同步刷新队员侧；队员侧操作已调
  updateInventorySlots 天然同步。玩家装备栏（.diablo-slot）由 updateEquipSlots 全局遍历
  自动同步，无需 hook。
  **组队面板交互（2026-08-12）**：① 弹出动画复用 `.system-panel` 的 `.active` 机制
  （translateX 滑入 0.25s），pack 用 `pack-active` 同款；② 打开 SystemUI/出征等面板必须
  emit `ui:panel-open`（EventBus），CompanionPanel 监听关闭——新增"打开其他面板"的入口时
  记得 emit，否则组队面板不关闭。
  **组队审计铁律（2026-08-12 排查 5 bug）**：
  ① 技能序列化必须 `restoreSkills` 重建（JSON 丢方法，档案恢复后 getEffect/getExpForNext
    TypeError）；② 装备替换/卸下前检查背包空位（满则拒绝，防旧装备静默丢失）；
  ③ `_show()` 必须 `clearTimeout(_closeTimer)`（close 260ms 定时器与快速重开竞态）；
  ④ 拖入队员背包/装备槽前检查容量（满拒绝 + `_returnToPlayerBackpack` 还回，杜绝物品丢失）。
  **成长/技能配置（2026-08-12）**：玩家与队员 maxHp/maxMp 公式统一含
  `(level-1)*10`（每级 +10 生命/魔法）；队员成长规则在 companion-growth.js 注册表；
  队员技能配置 = companion-config.skills（初始）+ unlockSkills（{技能id: 解锁等级}，
  Companion._checkUnlocks 构造/升级自动解锁，通用机制）。新增队员 = 档案 + 成长规则 +
  技能/解锁表即可，无需改业务代码。
  **侍从场景渲染（2026-08-12）**：队员动作动画在 companion-config.animations 配置
  （src/frameWidth/frameHeight/cols/rows/frameCount/frames/frameRate/repeat）；
  BootScene 配置驱动加载注册（键 `companion_<id>_<动画>`）；GameScene
  `_syncCompanionSprites` 每帧跟随玩家（左后偏移、翻转镜像），按玩家状态切
  spell/run/walk/停帧。显示尺寸引用 `PLAYER_DEFAULTS.physics.spriteSize`（2026-08-12
  为 173，与玩家单位完全一致）；跟随水平偏移 150px（原 95 @110px，放大后按比例拉远）。
  新增队员动画 = 素材入库 + animations 配置即可，代码零改动。
  **动画两段注册（2026-08-12）**：需要「起步 + 循环」的动作（如 running）在配置里写
  `startFrames:[s,e] + startFrameRate + startRepeat:0` 与 `loopFrames:[s,e] + frameRate
  + repeat:-1`；BootScene 会生成 `<key>_start`（播一次）与 `<key>`（循环）两个动画键，
  共用同一 sheet 纹理。GameScene `_syncCompanionSprites` 用 sprite 的 `lunaRunning`
  data 标记起步态：首帧进入 sprint 播 `run_start` 并 `once('animationcomplete')` 切
  `<key>` 循环；停止奔跑（idle 分支）复位标记。判定存在用 `this.anims.exists`。
  **循环边界像素分析法（2026-08-12）**：AI 生成动作 sheet 常有首尾不闭环问题。用
  `tools/ai-gen/analyze-sheet-loop.py <png> <fw> <fh> --pair <n>` 对比 alpha 剪影差异
  （0..1，越小越接近）；walking [0,31] 首尾 0.113 → 选 [7,31] 仅 0.023（双脚并拢的
  「过步姿态」两端几乎一致）；running 起步 [0,18]（19 帧，18→19 衔接 0.040）+ 循环
  [19,31]（13 帧，31→19 包裹 0.104，为该素材短循环最优）。**站立/停帧帧号必须跟随
  walk 循环首帧**（GameScene 用 `anims.walk.frames[0]` + `companionIdleFrame` data），
  否则循环起点不在 0 时静止→走路会跳变。**有奔跑素材时站立姿态优先取奔跑动画首帧**
  （2026-08-12 三修）：源视频起跑前就是该姿态，idle→起跑完全连续；GameScene 创建
  精灵时按 `anims.run` 存在与否选 idle 纹理/帧（`companionIdleKey` + `companionIdleFrame`
  data），站立分支用 `setTexture(idleKey, idleFrame)` 切换（跨纹理不能只 setFrame）。
  **循环闪回=水平漂移（2026-08-12 二轮修复）**：AI 生成 running 整张 sheet 每帧人物
  沿水平方向漂移（帧 19 包围盒 x46-465 → 帧 31 x22-489，质心跨度 ~30px），循环回跳
  时人物整体横跳 ~25px 造成「闪回卡顿」——**原始帧剪影差异会高估姿态差异**，先算
  每帧 bbox/质心确认是否漂移。修复：`tools/ai-gen/luna-run-align.py` 把全部帧按内容
  质心水平对齐（保持 512×512、自动求可行参考 X 避免裁切），导出 running_norm.png，
  质心跨度 30px→1.1px，31→19 回跳 0.104→0.070（与相邻帧 0.02~0.06 同级，回跳退化为
  普通帧间变化）。**新增/修改动作图后先做漂移检查**（帧质心跨度 >2px 即需归一化）。
  **headless 验证铁律（2026-08-12）**：`_isSprinting`/`isMoving` 每帧由
  `Input.isSprint()`/速度重算，直接改字段会被覆盖；必须派发真实
  `new KeyboardEvent('keydown',{code:'ShiftLeft'/'KeyW'})`（Input 模块监听真实键盘）
  + 补丁 `player._isFacingMouse=()=>true` + 补满体力，才能稳定驱动 walk/run 状态。
  Phaser 4 动画帧对象取索引用 `frames[i].textureFrame`（非 `.frame`/`.name`）；
  `Game.loop` 是本项目应用层方法，Phaser 循环诊断用 `__phaserScene.game.loop.frame`。
- **侍从属性结算缺口（2026-08-12 审计修复）**：`Companion.calculateCombatStats` 必须
  结算装备 `matkFormula`（与玩家 `_getEquipmentMatkBonus` 同口径：base + 强化×enhanceBase
  + int×intMul + wis×wisMul）——否则法杖等魔法武器魔攻恒 0。装备测试铁律：装备后检查
  int/wis/maxMp/def（含强化）/matk 五项全变，缺一项即结算缺口。
- **overlay z-index 铁律（2026-08-12 实锤）**：招募界面 `.recruit-overlay` 必须 > 队员管理
  `.companion-overlay`（现 4400 > 4300）——低层级 overlay 打开时点按钮会被高层全屏遮罩
  拦截（无反应无报错）；招募打开时还需临时隐藏队员管理面板（close 恢复）。
  新增全屏 overlay 前先查现有 overlay 的 z-index，勿低于其上层。
  **2026-08-12 修正**：z-index 已保证招募在上层后，**不要再临时隐藏下层面板**——
  隐藏会导致 onChange（display===block 条件）不刷新、恢复后内容陈旧；同时
  CompanionPanel 的 onChange 刷新须处理"空状态加入后 _memberId 停留 null"：
  无当前队员且有成员时自动选中 members[0]。
- **高斯武器滤镜已彻底停用（2026-08-12）**：`GameScene._applyWeaponBlur/_ensureWeaponBlur`
  为 no-op/返回 null——`filters.internal.addBlur` 在部分 GPU 下创建 framebuffer 失败
  （Framebuffer Unsupported）→ WebGL context lost → 黑屏（招募黑屏根因）。运动模糊唯一
  正式方案 = 残影（_syncWeaponGhosts）；blurX/blurY 仍驱动残影长度/浓度，勿再启用高斯滤镜。
- 单测带 JSON 导入需自注册 loader：`await import('./scripts/register-json-loader.mjs')`
  + 动态 import src 模块（静态 import 在 loader 注册前解析会报 ERR_IMPORT_ATTRIBUTE_MISSING）。
- 新增侍从技能/战斗模型/装备属性结算/存档落盘：在框架对应留白处接入（skills 空对象、
  modelPlaceholder 未渲染、equipments 无属性结算）。

