/**
 * UI z-index 常量定义
 * 
 * 所有游戏中的 z-index 层级统一在此管理，避免硬编码导致的层级冲突。
 * 按层级范围分组，从底层到顶层排列。
 */

// ============================================================
// 基础游戏层 (1 - 15)
// ============================================================

/** 游戏主画布，最底层 */
const GAME_CANVAS = 1;

/** 背包/格子内稀有度标签 */
const ITEM_RARITY_BADGE = 2;

/** 快捷栏技能图标 */
const SKILL_ASSIGNED = 3;

/** 已强化标签（装备栏/背包） */
const SLOT_ENHANCED_BADGE = 3;

/** 面板遮罩层（系统面板打开时的背景暗化） */
const PANEL_OVERLAY = 5;

/** 快捷栏技能冷却遮罩 */
const COOLDOWN_OVERLAY = 5;

/** 快捷栏冷却时间文字 */
const COOLDOWN_TEXT = 6;

/** UI 交互层（覆盖在游戏画布之上） */
const UI_LAYER = 10;

/** 强化槽位内部层级 */
const ENHANCE_SLOT_INNER = 10;

/** 侧边功能菜单 */
const SIDE_MENU = 11;

/** 攻击范围切换按钮 */
const ATTACK_RANGE_TOGGLE = 11;

/** 系统面板（状态/装备/技能等） */
const SYSTEM_PANEL = 15;

// ============================================================
// 动态效果层 (50)
// ============================================================

/** 战斗飘字（伤害/治疗等） */
const COMBAT_TEXT = 50;

// ============================================================
// 属性提示层 (1001)
// ============================================================

/** 属性加点悬浮提示 */
const ATTR_TOOLTIP = 1001;

// ============================================================
// 功能面板层 (4000 - 5001)
// ============================================================

/** 商店面板 */
const SHOP_PANEL = 4000;

/** 强化面板（铁匠铺） */
const ENHANCE_PANEL = 4000;

/** 制造/合成面板 */
const CRAFT_PANEL = 4000;

/** NPC 对话框 */
const NPC_DIALOGUE_BOX = 5000;

/** NPC 立绘（悬浮于对话框之上） */
const NPC_PORTRAIT = 5001;

// ============================================================
// 工具提示与弹窗层 (10000 - 10001)
// ============================================================

/** 装备拆分确认对话框 */
const SPLIT_DIALOG = 10000;

/** 装备悬浮提示（Tooltip） */
const EQUIP_TOOLTIP = 10001;

/** 背包已满通知 */
const BACKPACK_FULL_NOTICE = 10001;

// ============================================================
// 置顶 UI 层 (9998 - 9999)
// ============================================================

/** 游戏计时器（秒表） */
const GAME_TIMER = 9998;

/** 版本徽章（右上角装饰） */
const VERSION_BADGE = 9999;

// ============================================================
// 最高覆盖层 (99999 - 100000)
// ============================================================

/** 加载遮罩层 */
const LOADING_OVERLAY = 99999;

/** 屏幕闪光特效（升级等） */
const SCREEN_FLASH = 99999;

/** 升级提示文字 */
const LEVEL_UP_TEXT = 100000;

// ============================================================
// 导出对象
// ============================================================

/**
 * z-index 常量对象（驼峰命名）
 * 用于 JS 中直接设置 element.style.zIndex
 */
export const Z_INDEX = {
  // 基础游戏层
  gameCanvas: GAME_CANVAS,
  itemRarityBadge: ITEM_RARITY_BADGE,
  skillAssigned: SKILL_ASSIGNED,
  slotEnhancedBadge: SLOT_ENHANCED_BADGE,
  panelOverlay: PANEL_OVERLAY,
  cooldownOverlay: COOLDOWN_OVERLAY,
  cooldownText: COOLDOWN_TEXT,
  uiLayer: UI_LAYER,
  enhanceSlotInner: ENHANCE_SLOT_INNER,
  sideMenu: SIDE_MENU,
  attackRangeToggle: ATTACK_RANGE_TOGGLE,
  systemPanel: SYSTEM_PANEL,

  // 动态效果层
  combatText: COMBAT_TEXT,

  // 属性提示层
  attrTooltip: ATTR_TOOLTIP,

  // 功能面板层
  shopPanel: SHOP_PANEL,
  enhancePanel: ENHANCE_PANEL,
  craftPanel: CRAFT_PANEL,
  npcDialogueBox: NPC_DIALOGUE_BOX,
  npcPortrait: NPC_PORTRAIT,

  // 工具提示与弹窗层
  splitDialog: SPLIT_DIALOG,
  equipTooltip: EQUIP_TOOLTIP,
  backpackFullNotice: BACKPACK_FULL_NOTICE,

  // 置顶 UI 层
  gameTimer: GAME_TIMER,
  versionBadge: VERSION_BADGE,

  // 最高覆盖层
  loadingOverlay: LOADING_OVERLAY,
  screenFlash: SCREEN_FLASH,
  levelUpText: LEVEL_UP_TEXT,
};

/**
 * CSS 变量形式的 z-index 对象
 * 用于通过 JS 注入 CSS 自定义属性，例如：
 *   Object.entries(CSS_Z_INDEX).forEach(([k, v]) => {
 *     document.documentElement.style.setProperty(k, v);
 *   });
 * 之后在 CSS 中可通过 var(--z-game-canvas) 等方式引用
 */
export const CSS_Z_INDEX = {
  // 基础游戏层
  '--z-game-canvas': String(GAME_CANVAS),
  '--z-item-rarity-badge': String(ITEM_RARITY_BADGE),
  '--z-skill-assigned': String(SKILL_ASSIGNED),
  '--z-slot-enhanced-badge': String(SLOT_ENHANCED_BADGE),
  '--z-panel-overlay': String(PANEL_OVERLAY),
  '--z-cooldown-overlay': String(COOLDOWN_OVERLAY),
  '--z-cooldown-text': String(COOLDOWN_TEXT),
  '--z-ui-layer': String(UI_LAYER),
  '--z-enhance-slot-inner': String(ENHANCE_SLOT_INNER),
  '--z-side-menu': String(SIDE_MENU),
  '--z-attack-range-toggle': String(ATTACK_RANGE_TOGGLE),
  '--z-system-panel': String(SYSTEM_PANEL),

  // 动态效果层
  '--z-combat-text': String(COMBAT_TEXT),

  // 属性提示层
  '--z-attr-tooltip': String(ATTR_TOOLTIP),

  // 功能面板层
  '--z-shop-panel': String(SHOP_PANEL),
  '--z-enhance-panel': String(ENHANCE_PANEL),
  '--z-craft-panel': String(CRAFT_PANEL),
  '--z-npc-dialogue-box': String(NPC_DIALOGUE_BOX),
  '--z-npc-portrait': String(NPC_PORTRAIT),

  // 工具提示与弹窗层
  '--z-split-dialog': String(SPLIT_DIALOG),
  '--z-equip-tooltip': String(EQUIP_TOOLTIP),
  '--z-backpack-full-notice': String(BACKPACK_FULL_NOTICE),

  // 置顶 UI 层
  '--z-game-timer': String(GAME_TIMER),
  '--z-version-badge': String(VERSION_BADGE),

  // 最高覆盖层
  '--z-loading-overlay': String(LOADING_OVERLAY),
  '--z-screen-flash': String(SCREEN_FLASH),
  '--z-level-up-text': String(LEVEL_UP_TEXT),
};
