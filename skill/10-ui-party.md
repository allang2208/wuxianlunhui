> 本文件为 game-dev 技能库分卷，主索引与目录见 ../SKILL.md
> 本节：10. UI、面板与组队系统

## 10. UI、面板与组队系统

### 地牢独立探索台与固定通道布局

- 当前默认 `mapLayout: exploration`；上方环境与下方随机路线分离，图片不限制拓扑，不接入运行时识图。下台整合节点档案、五项真实预期收益、入侵状态和撤离，保留原生命/魔法/等级、组队及右侧入口尺寸与左274/右104安全区。
- 先看生成器拓扑再规划显示：原图为row/col网格时保留全图row，固定196px列距、112px行距，缺行留空；禁止逐列居中/重排破坏原本平行通道。横竖直连优先，仅被其它节点阻挡时避让；双向边按规范key去重。起点在首列间展开，特殊长边可外绕，但不承诺任意图绝对无交叉。
- 展示坐标、DOM房间按钮、Canvas线路、点击、拖动、聚焦共用实际路线窗口。最低0.8缩放与48px按钮保证普通相邻行中心距89.6px；密集路线用分区/平移查看，不把全图无限缩小。Canvas按视图/状态变化重画；关闭清理DOM、ResizeObserver和指针捕获。
- 背景按指挥台实测顶部高度contain等比完整显示，允许黑边；不以cover裁切或底部渐隐掩盖阶梯。进入按钮最小46px（矮窗42px）、操作带最小78px，两种退出右侧并排；标题/收益留白收紧，窄窗内部滚动。炭黑分层、少量蓝青、字体20/16/14/12与Consolas数字均限探索台作用域。
- 房间先选中，再由中央按钮重查isNodeClickable并进入原_enterNode；未揭示类型不泄漏情报，未知事件不虚构低风险。收益读原规则而非示例图数值；入侵标签复用原系统。安全撤离仅起点可用，强制放弃保留清空全部背包的二次确认；真实图、迷雾、双向回头、战斗、奖励、存档不因UI改变。
- 保留legacy/split/landmark兼容分支与正式背景模板。地标兼容模式同一边稳定分配相近冷色，共享段只画一次，颜色不能替代可达判定；探索台突出当前可走/选中线，远线低亮虚线，标签加底色。游戏输入隔离与隐藏/恢复沿原生命周期。
- 收口只保留正式图、获准概念及直接编辑祖先、提示词和来源记录；未选方案、重复CSS片段与整文件before备份不进Git。公共文件按任务代码块合并，不整文件覆盖。实现与回退入口见`docs/dungeon-exploration-console-v9.md`，素材留存理由见候选目录README。

### ⭐ 冷钢档案 UI 标准工作流（2026-08-21 定稿，新增或修改玩家 UI 一律先读）

- **权威规范**：`docs/ui-cold-steel-design-system.md`。新增面板、修改面板、HUD 调整、字体调整和主题色调整开始前必须先读对应章节，并按文末检查表交付。
- **视觉真源**：`ui/panel-theme-backpack.css`。灰、白、黑基础色、六档字体、边框、阴影、动画和通用 `.bp-*` 组件类只在此维护；禁止在业务文件复制“近似冷钢”色板。
- **顶部通知字号与语义色（2026-08-30）**：`showTopNotification`普通20px、场景标题/重要警告24px，升级保留28px标题/18px说明/48px图标；字体统一`--bp-font-ui`，银白info/柔和绿success/琥珀warning/柔和红danger与升级金色只在主题`--bp-notice-*`定义。新调用传`tone/emphasis`，旧color按已登记颜色归类、fontSize>=24归入重要档，不按文案猜类型；未知显式颜色保留。长文换行且限制宽度，视觉样式不得散落到业务文件。
- **顶部通知共享FIFO合同（2026-08-30）**：人物/技能升级、地牢/场景、背包满、改造返还和裂隙完成共用`src/ui/top-notification-queue.js`单一播放槽；按触发顺序逐条显示，前条收尾移除后才开始后条，禁止重叠、插队、打断或自行合并丢弃。新顶部瞬态提示必须走`SceneManager.showTopNotification`或`TopNotificationQueue.show`，不得自行向body挂提示或维护另一条播放队列。升级每次触发立即登记公共队列，文字/音效/闪光同步开播，永久属性与冷却刷新立即提交一次、不受排队/取消影响。TimerManager暂停时剩余时长与动画共同冻结，恢复续播；退出游戏/clearAll清空，按组清理升级不清其它来源。普通默认3000ms、升级2800ms；底部常驻路线HUD、模态和世界飘字不属于该队列。详见UI规范§5.4。
- **通关奖励结算卡合同（2026-08-24）**：`#rewardPanel` 是必须完成选择的居中模态，使用冷钢档案标题层级与 `role="dialog"/aria-modal`；三卡桌面并列、窄屏单列，卡片统一为2:3并消费 `assets/ui/reward_card_bg_cold_steel.png`。卡框的钟表/齿轮/机械元素只能占边缘，中部保留动态文案安全区；可点击卡必须是原生 `button`，具备默认、hover、`:focus-visible`、selected、disabled 状态。普通卡框和标题不得使用金币黄，禁止持续漂浮/弹跳；奖励语义、发放和关闭时序仍归 `RewardSystem`，视觉改造不得改数值。选择卡牌必须先做金币总容量预检，发奖异常要回滚背包、仓库、地面掉落、等级和属性点并保留重选入口；只有整包成功后才能锁定卡牌和启动2秒关闭。浮动文字/UI刷新属于非关键表现，异常不得中断真实发奖。强制关闭必须取消关闭定时器并清掉模态状态。
- **标准模板**：`docs/templates/cold-steel-panel-template.js`。新右侧栏目从模板复制，保留业务根类 + `.bp-right-column`，生命周期统一使用 `BasePanel`。
- **防御塔详情面板合同（2026-08-30）**：根节点固定使用 `.defense-tower-panel.bp-right-column`，标题、武器挂载、火控遥测、背包武器、六维芯片、六项模块和维修区只输出 `.dt-*` 业务语义类；枪灰外壳、边线、字号、按钮、焦点、禁用态和响应式网格统一维护在 `ui/panel-theme-backpack.css`。业务模板只允许弹药/换弹/热量/耐久等动态进度宽度内联，金币、低弹药、换弹、过热和危险出售仅保留必要语义色。芯片/模块图片用 `renderLightweightProjectImage` 消费正式路径并自动落到128px镜像，关闭面板必须调用 `releaseLightweightProjectImages`；UI换肤不得改装载、升级、维修、出售、遥测刷新或存档结算。
- **右侧常驻入口图标合同（2026-08-23）**：`hud-panels-misc.js` 的 `sideMenuItems` 是人物状态、技能、背包、图鉴、任务、世界传送、队员管理、科技树与属性点入口的单一映射；属性点是条件提示入口，显示时固定在科技树下方最末位。正式图统一使用冷钢六边形母版、完整外框安全边距和真实 RGBA 透明底，科技树也使用稳定 PNG 路径而非 emoji。候选必须由玩家确认后才能覆盖 `assets/ui/icons/`（属性点沿用 `assets/ui/addpoint.png`）；换图不得改变既有 74×74 槽位、其余按钮顺序、快捷键或点击行为。图标源画布允许非正方形，但显示必须使用统一 68×68 内框和 `object-fit:contain` 保持比例；同一槽位中图标显得偏小时，先量 Alpha 非透明像素包围盒，若是源图透明留白过大则归一可见边界与透明安全边，不要扩大按钮或破坏统一内框。悬停放大由侧栏及按钮开放视觉溢出并提升当前按钮层级，禁止通过扩大点击槽位解决裁剪。
- **HUD 状态栏挂载与安全区合同（2026-08-23）**：`hud-core.js#createHudCore()` 必须创建稳定的 `#statusBarContainer.status-bar-container`；`StatusBar` 可以在 HUD 尚未构建时静默等待，但 render 时必须重新获取容器并补绑悬停说明。状态逻辑仍可在无 DOM 时运行，不能因暂时不显示图标而删除挂载点。图标区固定使用 `252px` HUD 宽度，锚在正常 `150px` 小地图右侧（`left:172px`）、菜单下方、`top:225px` 组队栏上方，四列紧凑排列并最多显示三行后局部滚动；卡内只保留图标、层数、时间，名称和详情进入悬停浮窗。`body.map-mode` 与 `body.expedition-preparing` 必须隐藏该栏，禁止与路线信息栈或出征全屏面板争夺左上区域。
- **右侧常驻栏目关闭合同（2026-08-23）**：人物状态/技能/背包/图鉴、任务、世界传送、队员管理与科技树都必须支持 ESC 关闭，且再次按各自入口快捷键（CapsLock/K/Tab/U/L/O/P/Y）等价于关闭；浏览器 `keydown` 与 Electron `electron-esc` 必须进入相同的实际 `close()` 生命周期，禁止只隐藏 DOM 或让 ESC 穿透后同时打开暂停菜单。
- **科技树节点图标合同（2026-08-23）**：当前 33 项科技的正式图标统一放在 `assets/ui/technology-icons/`，以冷钢六边形母版生成 1024×1024 真透明 RGBA；`data/technology-tree.json#iconPath` 是图片引用，原 `icon` emoji 只作资源失败回退。卡片与详情必须消费同一图片，`object-fit:contain` 保持完整徽章与安全边距；未解锁位面科技继续由整卡 TV 雪花遮蔽，禁止提前露出真实图标。
- **科技树画布拖拽合同（2026-08-23）**：`.technology-tree-viewport` 的滚动条与鼠标左键拖动必须同时可用；Pointer Events 从空白和科技卡片都可起拖，超过 6px 阈值后按起点快照同时更新 `scrollLeft/scrollTop`，并通过 pointer capture 保持移出元素后的连续性。只有实际进入拖动才拦截紧随其后的单次 click，短按卡片仍须正常选择科技；拖动期间统一显示 grabbing 并禁止文本选择，不得把卡片改成只能拖、不能点。
- **玩家技能右栏滚动合同（2026-08-23）**：`#systemPanel` 的标题栏与主 Tab 必须保持固定；`#tab-skill.active` 以 `flex:1 / min-height:0` 接收剩余高度，`.skill-filter-bar` 固定、`.skill-grid` 单独纵向滚动，禁止让活动 Tab 使用 `height:100%` 后叠加头部导致底部被根面板 `overflow:hidden` 裁切。技能详情 `.skill-detail` 必须限制在技能页内并保留独立滚动；滚动容器需可键盘聚焦并使用冷钢滚动条。
- **全局滚动条统一合同（2026-08-27）**：`ui/panel-theme-backpack.css` 统一提供冷钢滚动条变量与全局规则（Firefox/Chrome/WebKit）：`scrollbar-width: thin`、`scrollbar-color: var(--bp-ui-gray) var(--bp-ui-black-soft)`、`::-webkit-scrollbar{ width/height: var(--bp-scrollbar-size); background: var(--bp-ui-black-soft); thumb: var(--bp-ui-gray) + 1px 同色边框 + var(--bp-scrollbar-radius); hover:var(--bp-ui-accent); active:var(--bp-ui-accent-bright); corner:var(--bp-ui-black-soft)`），并加 `!important` 覆盖已加载旧样式。
- **地牢随机事件冷钢模态合同（2026-08-27）**：`dungeon-event-system.js` 只生成业务语义 DOM，视觉统一放在`panel-theme-backpack.css`；事件与结果页使用不可跳过的`role="dialog"/aria-modal`决策模态，桌面为叙述/行动双栏、窄屏纵向堆叠，长文本和多选项必须可独立滚动。属性检定概率同时显示文字和数值，并固定按`≥75%`绿、`50%—74%`青、`30%—49%`黄、`<30%`红表达从高到低；颜色不得改动属性公式或代替文字。原生按钮必须具备hover、`:focus-visible`、disabled状态，打开聚焦首项、最终关闭恢复焦点，事件结果按钮的防穿透延迟继续保留。
- **执行顺序**：修改前备份 → 判定面板类型 → 选择同类参考 → 接 BasePanel/右侧挂载层 → 使用主题变量和字体档位 → 核对关闭与输入 → 查看本轮 diff → 交由用户运行验证。
- **统一口径**：右侧主栏目和建筑详情默认 `45vw × 100%`，滑入/收回为 `0.25s cubic-bezier(0.4, 0, 0.2, 1)`；建筑详情是主栏目的同级独立栏目，不做父子嵌套页面。
- **关闭口径**：建筑详情使用 `panelGroup:'buildingDetail' / closeOnEscape:true / closeOnOutsidePointer:true`，外部关闭不得穿透到攻击、移动或场景选择。
- **字体口径**：display 只用于重大页面；title=一级标题，subtitle=分区标题，body=正文，meta=辅助信息，caption=微型提示，数字/计时使用 `--bp-font-number`。
- **范围纪律**：单个 UI 需求只改目标面板及必要共享件，不借机全量迁移旧面板；若需要改变本规范，先更新规范和主题真源，再实现业务代码。
- **怪物图鉴冷钢响应式合同（2026-08-24）**：系统面板沿用 `45vw` 标准宽度，同时必须有不超过视口的上限和桌面可读下限；宽窗口使用列表/详情双栏，窄窗口把详情作为同一面板内的滑入层并提供明确返回，不允许固定双栏挤出屏幕。标题/主分类固定，分类条、列表和详情各自承担自己的滚动，所有 flex 滚动祖先补 `min-height:0`，使用稳定滚动槽、冷钢滚动条和 overscroll 边界，禁止根面板与子列表争抢滚轮。页签、分类、卡片必须使用原生按钮、`aria-selected` 和可见 `:focus-visible`，切换主分类时关闭旧详情；缺数据和缺图使用明确档案占位，不用颜色圆点冒充内容。
- **Tooltip 数值边界（2026-08-22）**：`status-tooltip-helper.js` 的 `formulaLine()` 接收原始数字并统一交给
  `fmt()`；禁止先调用 `toFixed()` 生成字符串后再送入数字格式器，否则 `isFinite()` 会先隐式通过、随后在
  字符串上调用 `toFixed()` 崩溃。需要整数展示时传 `Math.round(number)`；可能来自配置或存档的速度值先在
  对应 Tooltip 分支局部 `Number(...) || 0`，不要为单项显示改动全局格式器或实际玩法数值。
- **人口经济岗位面板（2026-08-21，2026-08-25 第二进度条审计）**：可安排岗位的经济建筑统一用 `.economy-workforce`、`.economy-progress` 与 `.economy-*-label/note`，第一根条固定显示“岗位安排百分比”。第二根条必须先分类再接权威数据：持续产出或仅以内部周期入账的建筑（研究院、天气塔、风车、银行、皇家铸币局、大商场、工坊、市场、位面谐振塔、深钻井等）只能显示稳定的产量/岗位/业务发挥率，并在文本中显示真实每秒数值；禁止绑定 `_economyTickMs`、`settlementIntervalMs` 的取模余数或任何结算后必归零的计时器。单一物流任务（面包屋、酒馆）可显示当前有边界阶段的真实进度，但标题必须随 `取货/返店/加工/送仓/服务` 阶段同步变化，阶段切换后的归零不得继续冒充“收益效率”或“整批进度”。并行物流任务（蒸汽电站）禁止用 `max/min/平均任务进度` 塞入单条，否则领先任务完成后会倒退；未拆分逐员工任务条时统一显示稳定运行效率。阻断态必须来自业务快照，无岗位、无覆盖、断路、缺输入或满仓等真实阻断才归零。仓库不套岗位条语义：第一根“仓储容量”只显示当前仓库的压缩后物理占用率，紧随其后的“位面总容量”显示全部活动仓库聚合占用率，两条均从同一容量服务读取并随面板 tick 刷新。进度只以内联 `width` 表达动态值，外观和低→中→高语义渐变必须留在 `panel-theme-backpack.css`；禁止为各建筑复制色板和按钮样式。市场档案必须同时显示买价、卖价、压力、动态价差和固定交易损耗，按钮文案显示真实扣款/所得而非批次预算。有升级项目的矿工营地、房屋、经济工坊、银行和仓库统一调用 `renderBuildingUpgradeCard` 与共用 tooltip，开始时扣费、卡内显示读条、完成后才生效；状态区用两列数字档案，窄屏退化单列。选中工坊或银行时覆盖圈必须同步显示并随范围升级刷新。带有布局惩罚等关键副作用的建筑，建造配置应提供 `buildWarning`，选择建筑后在 `#bpHints` 的 `.build-context-warning` 以危险红色显示，取消选择时清空，禁止把警告混进普通快捷键文案。
- **右上经济面板（2026-08-22，2026-08-23 军事人口/时钟等高，2026-08-26 可展开详情/卷轴动效）**：金币、能源、食物和人口概览所在栏统一称为“经济面板”；与 `.game-time` 同挂在 `.top-right-hud` 弹性容器，经济面板在前、时间在后，折叠态必须读取 `--top-right-instrument-height` 保持74px等高，禁止按时间文本宽度硬编码 `right` 偏移；容器与顶部状态栏共享 `top:12px` 基线并使用 `align-items:flex-start` 顶边对齐。金币/能源/食物保持首行三列，第二行对称显示“兵力 已出兵/房屋容量”和“工作 已分配岗位/房屋容量”，中间必须有分隔；军事人口读取 `MilitaryPopulationSystem`，工作人口经 `EconomyHudSystem` 只读桥读取 `PopulationEconomySystem.getPopulationSnapshot()`，两条线路只共享房屋容量、彼此不占用。面板底部使用原生按钮和向下箭头展开/收起，维护 `aria-controls/aria-expanded/aria-label`；经济面板与顶部天气/时间进度栏的箭头都必须在各自小按钮内水平、垂直居中，并以按钮中心为旋转轴。交互沿用顶部天气/时间进度栏在缩略外壳上展开的语言，但经济面板宽度必须始终固定250px，禁止横向放大。详情通过网格行从缩略面板底部向下展开，配合轻微下移复位和淡入形成卷轴下放效果，边框/阴影同步加强，时钟不得跳位；收起时向上卷回并恢复74px缩略版，禁止另开浮层或瞬时切换 `display`。详情仓容必须读取 `EnergyManager` 的当前位面活动仓库：总占用按共享物理容量计算，且只有“总占用”容量条按填充进度依次显露绿→青→黄→红危险度色带；能源、食物、兵力和工作人口容量条继续保留各自资源语义色，不得一并改成危险度色带。能源/食物的“距满仓剩余量”分别按每座仓库的能源/食物压缩倍率折算，禁止把两种资源误当成独立仓库；金币仍是背包单格无限堆叠，只能明确显示“无上限”，禁止伪造仓容百分比；兵力和工作人口各自显示容量条。每秒产出使用实际资源总量的近5秒滚动净变化，明确标注“近5秒净值”，不得在 UI 内重复实现一套生产公式。金币读取 `GoldManager.getGold()`，能源和食物读取 `EnergyManager.getEnergy()/getFood()`；沿用 HUD 刷新入口，动态进度只写内联 `width`，其余视觉样式归 `panel-theme-backpack.css`。已初始化概览数字发生变化时只重播对应数字的单次辉光动画，首次载入不触发；保留资源语义色、冷钢主题变量，并尊重 `prefers-reduced-motion`。
- **经济/时钟等宽修订（2026-08-26）**：`.basic-resource-bar` 与 `.game-time` 必须共同读取 `.top-right-hud` 的 `--top-right-instrument-width:250px`，形成74px等高、250px等宽的成对仪表。经济面板同时锁定 `width/min-width/max-width`，缩略栏、展开详情和内容容器统一使用100%内宽；详情禁止负横向边距，长文案只能在壳内收口，不能把下半部分撑得比缩略栏更宽。两块展开按钮禁止继续依赖字体字符基线，箭头由居中的7px CSS折线绘制，并以自身中心旋转。
- **时钟包裹与经济概览大数缩写修订（2026-08-27）**：经济面板保持 `250px` 固定；时钟新增独立 `--game-time-instrument-width:286px` 并由 `.game-time` 专用读取，补偿后时钟整体向右延伸，且 `.top-right-hud` 位置使用 `right: calc(max(64px, 100px - (var(--game-time-instrument-width) - var(--top-right-instrument-width))))`，避免超出左侧面板基线。概览大数按阈值缩写：`>=10000` 为小写 `k`（10000=10k），`>=1000000` 为大写 `M`；鼠标悬停浮窗显示完整数值（资源 10,000；兵力/工作人口 12,500 / 20,000）；展开详情与 `economyGoldCapacityText`、`_updateEconomyCapacityMeter` 继续使用完整原始数值。
- **经济缩略高度硬边界（2026-08-26）**：经济面板不能只依靠详情的`0fr`推断折叠高度；外壳折叠态必须同时锁定`min-height/max-height:74px`，避免详情内边距或分隔线留下像素级增高。展开态只把`max-height`向下释放到足够容纳详情的上限，并与详情网格行共同过渡；时钟继续固定74px。底部箭头按钮属于外接控制柄，不得反向撑高经济外壳。

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
- **地牢布局规格（2026-08-23）**：全局小地图允许使用宽版 HUD 尺寸，但 `scene7` 地牢战斗必须读取双份 `game-config.json#minimap.dungeon`，保持 `150×150 @ (10,60)`；绘制、战争迷雾、点击和拖动一律继续消费 `_minimapLayout()`，禁止各自判断地牢并复制尺寸。静态缓存键除 zoom、世界尺寸、墙数量外还必须包含最终宽高与锚点，确保场景切换后的规格变化触发重绘。
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
- **附属层恢复必须同时检查当前场景资格**：`GameScene` 会跨逻辑场景常驻，位面战争迷雾的小地图
  Image 因而会保留上一场景纹理。退出地图模式、关闭对话等通用 HUD 恢复不能只调用
  `setVisible(true)`，还必须确认当前 `FogOfWarSystem` grid 为 active；否则返回无迷雾场景后，
  每帧 HUD 恢复会与 100ms 降频同步的隐藏互相打架，表现为旧黑图持续频闪。
- **场景提交后必须在揭开加载层前原子刷新**：`switchScene` 提交新 `currentScene` 后调用
  `refreshMinimapForSceneTransition()`，先让相机应用目标场景 zoom，再清静态键、清 100ms 节流并
  重画；禁止让按离场 zoom 绘制的常驻 Graphics 在新相机缩放下暴露一帧或等待下个 10Hz tick。
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
- **祭坛地牢分组与锁定态合同（2026-08-24）**：`#expeditionDungeonSelect` 使用原生 `optgroup` 显示系列父标题，子项统一为“系列名-初级/中级/高级”并按 `tierOrder` 升序；父标题使用冷钢高亮色、subtitle 字号和高字重，子项使用正文颜色与 body 字号，未解锁项降色并附前置通关说明。DOM 只消费 `DungeonConfig.getDungeonGroups()`，解锁刷新与出征二次拦截归 `ExpeditionSystem`，禁止在面板构建代码硬编码僵尸/沼泽系列。
- **出征背景资源合同（2026-08-22）**：全屏出征界面统一引用 `assets/ui/expedition-bg.png`；
  `game-style.css` 与 `ui/panel-theme-backpack.css` 必须继续共用该路径及 `center / cover no-repeat`，替换背景时直接覆盖此唯一资源，禁止再引入并行旧图或分叉路径。
- **出征/路线双 Canvas 层级合同（2026-08-23）**：地牢路线背景、连线和节点由下层
  `#gameCanvas` 绘制，Phaser 主画布平时位于其上。进入 `body.map-mode` 后必须通过专用
  `.phaser-game-canvas` 类显式隐藏上层画布，选择器不得假设它是 `#gameContainer` 的直接子元素
  （实际挂在 `#gameLayer` 内）；不能只依赖相机 `rgba(0,0,0,0)`。相机/渲染器
  的黑色清屏一旦未正确清除，会把已正常绘制的路线页整体遮成纯黑。路线模式同时兜底隐藏
  `.expedition-overlay/.expedition-panel/.expedition-rule-panel`，退出路线模式移除 body class 后
  Phaser 画布自然恢复。出征左侧说明栏与中部面板必须共享同一个宽度变量并都用
  `box-sizing:border-box`，否则说明栏的 padding/border 会越过约定边界遮挡钥匙提示。
- **路线选择 HUD 冷钢合同（2026-08-23，2026-08-29 地标路线）**：预期奖励、特工入侵概率与“当前地牢”继续统一由
  `#dungeonRouteInfoStack`承载；`mapPresentation:'landmark'`时，`#dungeonRouteTopHud`必须重排为左侧标题/探索进度、中部横向奖励与入侵情报、右侧安全撤离/放弃操作。生命/魔法/等级状态栏必须继续直属`document.body`，复用既有顶部居中坐标、110px血魔条、间距和响应式尺寸，禁止挂入指挥层后被压缩、移位或隐藏。背景场景不得烘焙文字、节点、路线或面板；路线UI必须保持可动态扩展。
  `body.map-mode`保留组队栏和右侧入口图标；地标路线允许仅覆盖组队栏的`top/left`把它放到左侧奖励→入侵情报栈之后，但不得改变组队栏尺寸、内部间距、图标规格或地牢外预设。右侧入口图标的尺寸、位置、间距保持不动。地标路线视窗固定预留左侧274px、右侧104px安全区（或未来从同一布局真源读取），禁止缩放既有面板。经济/时钟和其它常规战斗HUD继续隐藏，退出路线模式后统一恢复。旧contain背景与旧40/60 full-plate仅作兼容分支，不能把它们的上下分区约束套到地标模式。
  右侧安全撤离/放弃按钮使用原生`<button>` + `.bp-button`，不得再以整板图片承担按钮文字与状态；路线标题、状态栏和奖励卡只在
  `panel-theme-backpack.css`消费冷钢变量，业务代码只写动态数值。完整底板由地牢配置`mapBackgroundFullPlate:true`显式启用，不能让单个地牢换图改变其它地牢。
- **路线操作层与决策弹窗合同（2026-08-29）**：路线节点使用冷钢程序化外壳和战斗/事件/首领/奖励语义色，
  禁止重新混入羊皮卷、蜡封或 emoji 图标；选点只通过路线节点并继续经过 `isNodeClickable()` 后进入既有 `_enterNode()`。
  地标模式下方只保留细线“区段索引”；“战略总览/返回当前位置”作为小型原生按钮固定在索引右侧，不再建立厚重作战台、行动指令分舱、状态图例或下一步列表。导航必须避让原尺寸组队栏和右侧入口。
  地标模式的完整16:9环境背景使用等比居中cover，仅裁切装饰边缘，禁止非等比拉伸；同一地牢可通过`mapBackgroundVariants`登记多张静态母图，但每张必须有自身原始像素锚点、HUD安全边界和拓扑偏好。单局路线生成完成后只允许按分支密度、单列负载、同列连接占比和行跨度选择一次背景，路线指纹只作稳定破同分，往返地图不得跳图。旧版上方背景继续使用contain居中，旧40/60底板走独立兼容分支，三种显示合同不能混用。
  可前往节点允许显示贴近节点的冷钢档案卡，内容只从既有节点/奖励运行态推导；档案按钮与直接点击节点都必须先调用`isNodeClickable()`再进入`_enterNode()`，不得为展示新增第二套可达或结算逻辑。
  地标模式的起点、战斗、精英、随机事件、首领、奖励和未侦察图标必须使用独立透明位图徽记，节点外壳和状态环继续由Canvas绘制；禁止再用“起/战/?/首/赏/★/✓”等字体符号代替正式图标。图标应接近填满节点内圈，但不得覆盖外框、呼吸环或改变点击半径。地标路线必须按背景资产登记独立结构锚点，以母图原始像素坐标描述桥面、门厅、阶梯和城墙通道，并与背景共用同一cover矩阵；区段节点只生成展示投影，不得改写生成器节点的`x/y`、边、迷雾或可达关系。同列岔路节点中心距不足一个完整选择圈时，必须按结构带长度计算“平行轨数 × 纵向槽位”，优先用完整结构带展开，再对当前区段全部节点执行最小72px、带安全边界的确定性消碰撞；稀疏列保持单轨，禁止通过缩小徽记或点击圈掩盖重叠。不可到达线路须与可前往银青流光明显区分，使用黑铁槽底、锈红断续线和中点阻断叉，但仍只表达现有可达结果，不得另建判定。
  加载页、宝箱离场、放弃确认和通关结算共用 `panel-theme-backpack.css` 的冷钢结构，业务层只提供动态文案、
  结果回调和进度值；模态必须具备标题/说明关联、键盘焦点边界，并在 shutdown/异常退出时清理。
  路线栏需要结构版本标记；发现同 id 的旧版或残缺 DOM 时先销毁再创建，禁止热更新或同页重入继续复用旧结构而让新版作战台不可见。区段聚焦失败只能降级路线坐标，不能删除作战台；控制台须独立恢复`hidden/aria-hidden`与交互状态。
- **长路线语义缩放合同（2026-08-29）**：45～70节点地牢不得通过无限缩小把所有房间塞进同一视图；展示层按
  `node.col`每4列划分区段，总览只显示区段地标链和探索摘要，聚焦态显示所选区段真实节点并保留前后各一列接头。
  总览每行最多8个区段，超出后按蛇形折返续排，禁止重新退化为单条超长斜线；节点使用切角冷钢件，线路以已走/可达/未开放三态和机械接头表达。
  返回路线页必须自动跟随玩家所在区段，手工浏览其它区段不得改变`currentNodeId`；区段按钮与总览不得绕过迷雾、
  `isNodeClickable()`或`_enterNode()`，也不得改变节点/边、宝箱岔路、双向可达、入侵、奖励与完成状态。区段聚焦与
  DOM路线栏只能作为可降级表现层；初始化异常必须回退完整基础路线图，不得中断`DungeonMapSystem.init()`或阻断进入地牢。
- **矿洞静态通道模板（2026-08-30）**：初/中/高级矿洞复用地标HUD与徽记，不改状态栏/组队栏/右栏尺寸位置。`src/config/mine-route-landmarks.js`只登记完整平台`lanes`与楼梯`connectors`；基础选图间距76，正式展示用至少96源像素槽位为绕行留白，并按实际窗口反投影边界、徽记/标签边距与屏幕点击缓冲筛选。每区最多3列、可见容量58%核心预算；单列超量也按节点分区，核心归属按ID，不再只用列范围；剩余容量只容纳真实逻辑邻接点。显示、悬停、点击与档案入口共用可见节点集合，切区/缩放清空旧指针与卡片，尺寸进入缓存键。共享通道增加代价与平行轨道，无关徽记采用圆外绕行，不新增玩法连接；可前往线最后绘制。极窄裁切无平台时只允许背景和路线同步聚焦平台，不能移动HUD。`weighted-terrain`选图在本局稳定，恐怖地牢保留原选图及结构带算法。详见`docs/dungeon-mine-landmark-ui-2026-08-30.md`。
- **地标路线复用与资产收口边界**：新增地牢只登记自己的母图、通道/锚点和拓扑偏好，复用展示层，不复制玩法生成器或另建可达判定。正式背景、模板、三级配置的`data/`与`public/data/`双份接线、提示词/来源记录须作为完整交付保留；十张轮换母图不是十个候选废案，不得因为单局只加载一张而清除其余图。清理前区分配置引用、显式回退与被否候选，不删除来源链。槽位间距和绕行公式是实现约束，不等同实机验收，也不能保证任意逻辑图完全无交叉。
- **主神空间祭坛占地（2026-08-23）**：祭坛仍保留 `npcType:'altar'` 与既有对话/出征入口，
  但实体创建后必须使用 `applyBuildingFootprint(..., 2)` 和重建 Collider，统一为标准 2×2 建筑占地。
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
- **建筑模式是独立输入态（2026-08-23）**：可复用 RTS 的玩家输入锁和自由镜头参数，但不得把
  `RTSCommand.enabled` 置真，也不得保留普通指令栏的待选命令。建筑选择后只隐藏主栏目，右键/放置中
  Esc/成功一次建造恢复栏目；建筑模式的 `Space` 由 FlatViewSystem 捕获，WASD 与鼠标攻击始终被锁。
- **压平快捷键唯一口径（2026-08-29）**：建筑模式与 RTS 指挥模式只允许捕获阶段的 `Space` 切换
  压平/恢复，不注册滚轮或其它备用输入；离开两种模式自动恢复立面。普通直接操控的 `Space` 继续只归
  玩家闪避，观察者只有正式进入 RTS 指挥态才可使用压平快捷键。
- **玩家纳入 RTS 时必须切换控制源（2026-08-23）**：F1 只负责模式状态与输入锁，玩家移动/普通攻击由专用控制器产生命令意图，再交给既有玩家速度、墙体、高架、武器和弹药链消费；禁止伪造 `Input.mouse`，也禁止把玩家塞进友军 `_command` 后交给单位 AI。玩家编组使用稳定保留键，PartySystem 选中同步仍只写正式队友 ID。
- **指挥奔跑是表现态，不是冲刺态**：统一显示谓词可合并 `_isSprinting || _rtsRunVisual`，但耐力消耗、冲刺速度、冲刺攻击、尘土与双手枪打断仍只读取真实 `_isSprinting`。逐发装填枪在指挥攻击中不得走手动打断入口，保持 `reloading` 到满弹，再由持续攻击命令自动续射。
- **普通模式世界指针必须走游戏表面白名单（2026-08-23）**：攻击、右键特殊攻击、中键指令轮盘及普通模式的移动攻击/巡逻选点统一调用 `gameplay-pointer-boundary.js`，只有 `#gameContainer`、游戏层或游戏 Canvas 才能产生世界输入；任何 DOM 栏目默认隔离，禁止继续维护易漏项的面板 class 黑名单。`leftDown/rightDown` 与 Pressed 边沿必须一起拦截；地图选点按下和松开都要位于游戏表面，从画面拖到栏目后松开只取消本次指针过程并保留待选指令。
- **普通箭头与武器准星分工（2026-08-30）**：普通直接操控中原本显示默认指针的空手/近战等状态复用指挥模式48×48冷钢箭头与`(3,2)`尖端热点；枪械/弓箭保留独立中心准星，临时队友指令取点优先接管并在结束后恢复。`GameScene._syncCrosshair`先以`elementFromPoint`和现有游戏表面白名单判定UI边界，静止鼠标下打开栏目也必须隐藏DOM准星并恢复控件自身指针；不得修改鼠标坐标或攻击/指令状态。准星使用固定中心小圆点、四向短刻度与轻描边；双份`game-config.json#crosshair.colors`登记冷钢CSS变量名，由渲染器缓存解析，禁止复制近似色板。原散布投影、平滑、逐发反馈与命中标记语义保持不变，不添加漂浮动画。

- **面板默认指针合同（2026-08-30）**：右侧栏目、普通面板、模态背景和非交互信息区复用同一冷钢箭头；图片路径与`(3,2)`热点只登记在`panel-theme-backpack.css`的`--bp-cursor-default`，世界默认态与地牢路线默认态也消费此变量。仅设置根层继承及既有显式`default`的非交互区，不对所有子元素强制`cursor`，按钮点击、文本输入、`grab/grabbing`、移动、缩放和禁用反馈保留原语义；悬停面板仍不得显示武器准星或下发世界指令。
- **冷钢三态手型合同（2026-08-30 尺寸统一修订）**：已有`pointer/grab/grabbing`声明分别消费`--bp-cursor-pointer/grab/grabbing`，主题入口导入`ui/hand-cursors.generated.css`统一提供48×48透明PNG和原生关键词回退。按用户统一大小要求，以源图Alpha内容框等比归一为44px可见长边并居中（当前三态均为44px可见高度），不再以手背甲片宽度定标，禁止拉伸宽高比。热点与裁框/缩放同变换：点击食指尖`(20,2)`、张手掌心`(27,33)`、握手掌心`(25,29)`，不能继续沿用缩放前的同一像素热点。跨目录CSS及内联样式使用同一内嵌PNG变量，避免相对URL随消费位置改变。正式图片在`assets/ui/cursors/`，母图、提示词和确定性导出脚本在`tools/ai-gen/hand-cursors-cold-steel-20260830/`；尺寸参数、源Alpha框和源热点只在manifest维护，导出同时更新PNG与生成CSS。仅替换视觉值，不增加事件、改变真实鼠标坐标或世界指令优先级；文本、缩放、移动、禁用状态及原生HTML拖放的系统反馈保持不变。

- **游戏内物品拖动例外（2026-08-30）**：原生HTML拖放会由浏览器/系统接管鼠标反馈，不能只加`cursor:grabbing`修复Windows指针回退。背包/装备、仓库、队员背包、改造/附魔槽及快捷栏物品改由`item-drag-controller.js`统一适配鼠标拖动：超过6px才起拖，复用原有`DragEvent/DataTransfer`业务，临时`html.item-drag-active`强制消费现有冷钢握手变量，并经游戏表面白名单隔离世界准星/指令；48px物品小预览位于掌心右下方，不变更指针热点或真实坐标。Esc、失焦、源失效、移出窗口松手必须取消且清理，不能丢弃物品、归还改造装备或解绑快捷栏；正常投放沿用原逻辑。监听器只注册一次，帧循环仅在实际拖动时存在，保留滚动边缘滚屏与消耗品越界抬高快捷栏。技能/文本/外部文件仍走原生拖放；非拖动状态禁止全局覆盖后代cursor。此条取代上一条对游戏内物品“仅换视觉、不增加事件”的限制，手型素材及其它输入语义不变。

- **受控物品拖动接线纪律**：只拦截原生`dragstart`，不取消最初`pointerdown`，保留短按、双击和焦点默认行为；新物品入口扩展统一源白名单，不给每个格子重复注册全局监听。取消须先阻止原`dragend`的业务副作用，再发送带`itemDragCancelled`标志的结束事件，最后清理指针、预览、捕获及临时图层；不能用普通“未投放”状态代替取消。

- **鼠标资产归档**：运行时PNG、直接编辑来源、最终RGBA母图、提示词和裁切/热点导出参数成套归档；普通/登高箭头来源及导出在`tools/ai-gen/cursor-sources-20260830/`，三态手型沿用其独立manifest/export。旧图若参与正式改图须保留为参考并标记非运行时；已归档的默认生成目录重复副本可恢复清理，活动清单使用仓库相对路径，不依赖本机临时目录。

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
  都写入 `RtsTacticalOrderSystem`；高层命令逐帧翻译为 AI 已支持的 `move/attack`。军队按本兵种
  `ai.engageRange` 接敌（缺省900px，正式队友保留原900px口径），击杀后恢复原终点；巡逻以单位下令时位置为起点、指令点为另一端，
  两端往返并在战斗结束后续巡。显式新命令通过能力/目标检查、成功提交后才清原高层命令；不可达拒绝不得取消旧巡逻。
- **RTS 输入与队列（2026-08-30）**：按钮、轮盘、右键统一目标解析和单位级提交；小地图命令仅使用小地图地面坐标，禁止命中其下面的主画面对象。轮盘保留表面/高度并使用打开时的目标集合。Shift点击切换成员、Shift框选追加、Ctrl移除、数字双击定位；A/P/S/H只在指挥态捕获，文本编辑与独占栏目不穿透。Electron Esc与浏览器共用`cancelPendingCommand`。
- **RTS 指令栏与能力展示**：兵线部署只配置新生产士兵，选中单位栏才向当前选择下令，两者不可混用。普通按钮的可用性与人数来自`RTSCommand.supportsCommand`，专属采集/探险/忍者操作按兵种和状态出现；未绑定快捷键的操作不得虚构键位，A/P/S/H只在实际接管它们的指挥态显示。按钮、轮盘共用`rts-command-presentation.js`图标/文案映射，轮盘提示使用其开启点语义，不能提示再次左键取点。
- **混合状态操作与选择生命周期**：开始/停止探险、隐身/解除隐身使用独立入口，混选不同状态时不能让单个切换按钮遮住另一项操作。点击时读取当前选中单位，不闭包持有旧单位数组；重绘签名包含单位身份和可执行人数，计时重绘保留滚动位置及键盘焦点。目标取点仍统一走原能力、表面、迷雾和队列出口，不新增单位AI执行分支。
- **冷钢命令图集与排版**：`assets/ui/rts-command/commands-cold-steel.png`为4列3行共享图集，CSS使用`background-size:400% 300%`及映射裁切，保留必要提示词/来源；键位和名称由DOM绘制，不烘焙进图。指令按钮必须流式网格排列，图标下方独立显示银灰色20px加粗等宽快捷键，再显示名称；同组保留空键位行对齐，禁用态键位变暗。只把可执行人数做角标，禁止新增按钮继续共用同一绝对坐标；指令栏高度受锚点以下剩余屏幕空间限制，超出内部滚动，不改右侧入口与全局快捷键。
- **坚守与停止（2026-08-30）**：军队hold只索敌原地可攻击目标，复用兵种射程/盲区/LOS/高度；`_guardFromHold`禁止追击和骑兵冲锋，保持原驻守预约。S停止允许自动追敌，H坚守不允许；安全离梯、击退/恐惧与有限驻守仍走原链。玩家和正式队友保留原静止待命行为，未支持的玩家指令在入口禁用并显示混编执行人数。
- **远程待机索敌口径**：军队待机与远程基础AI通过`getRtsAcquireRange`读取兵种配置，900px只能兜底，不能截断长射程兵种。`_canAttackFromHere`由待机、火枪选敌与实际开火共用；防暴队覆盖真实地面距离判定，不能把屏幕Y压缩距离当300px射程。扩大索敌不扩大武器射程，不绕过LOS/盲区/迷雾，不恢复坚守追击。
- **Shift队列完成口径（2026-08-30）**：最多32条语义命令，执行时重规划；执行器自然完成或明确失败，且终态未被外部替换时才推进。游击兵保留已起手射击但仍须发布完成记录；战术重规划失败记录绑定高层order，清旧追击/路径后提示并跳过。外部改令/死亡/移除/换场景清理；F1退出清玩家队列。两点巡逻持续执行，后续队列等待。同批地面命令仅在实际执行成功后共享终点预约，跨帧使用时回收失效预约，不预占未执行位置、不增加逐帧队形调整。队列不写存档，操作与验收清单见`docs/rts-command-controls.md`。
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
  （GameScene.showMoveMarker：0x3dff6a 三角+箭杆，屏幕点=`groundY-z`；depth 至少为
  `groundY+15`，高架目标再抬到 `surfaceDepth+2`，1.2s 淡出）。
- **指定攻击指令（2026-08-16 RTS 右键点敌）**：`PartySystem.setCommand` 签名扩为
  `(target, mode, point=null, targetEntity=null)`——`mode==='attack'` 时把目标实体存入
  `_command.target`；companion-ai 的 `case 'attack'` 转 `_cmdAggressive(entities, player,
  cmd.target)` / 法师 `_cmdWarriorAggressive(..., cmd.target)`，队友优先打指定目标。
  探针 `tools/cdp-party-rightmove.mjs` + 截图 `tools/verify-shots/rightmove_marker.png`。
- **指挥模式审计终案（2026-08-18）**：
  1. **能力边界不能靠“写了 `_command`”假装支持**：经济矿工标记
     `_rtsSelectable=false / _rtsCanAttack=false`，RTS 收集、点选、框选和编队入口必须统一过滤；
     矿工 AI 还要清理旧档遗留命令，保证玩家不能用历史 `_command` 打断自动采矿物流。
  2. **指挥与建设输入态互斥、建筑详情可共存（2026-08-23 新口径）**：启用 RTS 先关闭
     `BuildingSystem` 主建筑栏目；`BuildingSystem.open` 仍反向关闭 RTS，禁止让放置/回收监听器与
     指挥输入并存。指挥模式远程点建筑只打开既有详情栏目，不退出 RTS、也不启用建设模式；
     掩体/门/楼梯走 `BuildingSystem.showRemoteDetail` 的详情专用入口，禁止裸
     `_buildPanel()+active=true`。RTS 鼠标过滤必须包含 `.wall-editor-panel` 与
     `.build-structure-detail-panel`，避免详情按钮点击穿透到世界。
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

