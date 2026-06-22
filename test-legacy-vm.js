const vm = require('vm');
const fs = require('fs');

const context = {
  window: {},
  document: {
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    createElement: () => ({ className: '', style: {}, textContent: '', innerHTML: '', appendChild: () => {}, remove: () => {}, addEventListener: () => {}, closest: () => null, dataset: {} }),
    body: { appendChild: () => {}, removeChild: () => {} }
  },
  Image: function() { this.src = ''; },
  Audio: function() { this.volume = 1; this.play = () => Promise.resolve(); },
  console: { log: (...args) => console.log('[LEGACY]', ...args), warn: (...args) => console.warn('[LEGACY]', ...args), error: (...args) => console.error('[LEGACY]', ...args) },
  performance: { now: () => Date.now() },
  alert: () => {},
  localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  Math: Math,
  Date: Date,
  Set: Set,
  Map: Map,
  JSON: JSON,
  Array: Array,
  Object: Object,
  String: String,
  Number: Number,
  Boolean: Boolean,
  parseInt: parseInt,
  parseFloat: parseFloat,
  isNaN: isNaN,
  isFinite: isFinite,
  Infinity: Infinity,
  NaN: NaN,
  undefined: undefined,
  encodeURIComponent: encodeURIComponent,
  decodeURIComponent: decodeURIComponent,
  Error: Error,
  TypeError: TypeError,
  ReferenceError: ReferenceError,
  SyntaxError: SyntaxError,
  Promise: Promise,
  RegExp: RegExp,
  setTimeout: setTimeout,
  clearTimeout: clearTimeout,
  setInterval: setInterval,
  clearInterval: clearInterval,
  requestAnimationFrame: () => 0,
  cancelAnimationFrame: () => {},
  navigator: {},
  location: { protocol: 'http:' },
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => {},
  Event: function(type) { this.type = type; },
  KeyboardEvent: function(type, init) { this.type = type; this.key = init.key; },
  MouseEvent: function(type) { this.type = type; },
  DataTransfer: function() { this._data = {}; this.setData = (k,v) => { this._data[k]=v; }; this.getData = (k) => this._data[k] || ''; },
  DragEvent: function(type) { this.type = type; this.dataTransfer = new context.DataTransfer(); },
  EventBus: { on: () => {}, off: () => {}, emit: () => {}, emitFirst: () => {} },
  EffectManager: { add: () => {} },
  FloatingTextEffect: function() {},
  SweepEffect: function() {},
  CONFIG: {
    KEYS: { MENU: 'Escape', INVENTORY: 'KeyC', EQUIP: 'KeyC', SKILL: 'KeyK', CODEX: 'KeyL', SKILL_Q: 'KeyQ', SKILL_E: 'KeyE', SKILL_R: 'KeyR', ITEM_1: 'Digit1', ITEM_2: 'Digit2', ITEM_3: 'Digit3', ITEM_4: 'Digit4', W: 'KeyW', S: 'KeyS', A: 'KeyA', D: 'KeyD', SHIFT: 'ShiftLeft' },
    WORLD_WIDTH: 4000, WORLD_HEIGHT: 3000
  },
  Renderer: { init: () => {}, generateWorld: () => {} },
  DropItem: function() {},
  Player: function() {},
  Enemy: function() {},
  TargetDummy: function() {},
  ItemFactory: { createItem: () => ({}) },
  ItemDatabase: { items: [] },
  EquipManager: {
    G18_PISTOL_ITEM: {},
    TEST_BOW_ITEM: {},
    KINGHTS_SWORD_ITEM: {},
    RUNE_SWORD_ITEM: {},
    NIGHT_FLAME_SWORD_ITEM: {},
    TEST_EQUIPMENTS: {},
    player: null,
    updateInventoryUI: () => {},
    updateEquipUI: () => {},
    equipItem: () => {},
    unequipItem: () => {},
    useItem: () => {},
    canEquip: () => true,
    getEquipSlots: () => ({}),
    getInventorySlots: () => ([])
  }
};

// Create circular window reference
context.window = context;

vm.createContext(context);

try {
  const code = fs.readFileSync('legacy.js', 'utf8');
  vm.runInContext(code, context, { filename: 'legacy.js', displayErrors: true });
  
  console.log('=== VM Execution Result ===');
  console.log('typeof Game:', typeof context.Game);
  console.log('typeof SystemUI:', typeof context.SystemUI);
  console.log('typeof Input:', typeof context.Input);
  console.log('typeof SkillManager:', typeof context.SkillManager);
  console.log('typeof SoundManager:', typeof context.SoundManager);
  
  if (typeof context.Game === 'object') {
    console.log('Game.init exists:', typeof context.Game.init === 'function');
    console.log('Game.start exists:', typeof context.Game.start === 'function');
  }
} catch (e) {
  console.error('VM Execution Error:', e.message);
  console.error('Stack:', e.stack);
}
