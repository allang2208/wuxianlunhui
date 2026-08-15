// 侍从系统框架单测：成长规则 / Companion 升级 / PartySystem 增删与经验分发
// 运行：node scripts/test-party-system.mjs
await import('./register-json-loader.mjs');
const { allocateOnLevelUp, registerGrowthRule } = await import('../src/config/companion-growth.js');
const { Companion } = await import('../src/entities/companion.js');
const { PartySystem } = await import('../src/systems/party-system.js');
const { canEquipSlot, getEquipmentBonuses } = await import('../src/ui/equip/equip-rules.js');
const { buildSkillMap, grantSkillExp, getSkillEffect } = await import('../src/systems/skill-system.js');
const {
    decideCompanionAction, pickCompanionSpell,
    shouldRelocateCompanion, shouldUseRun, DEFAULT_MAGE_AI,
} = await import('../src/ai/companion-ai-decision.js');

const fakeSkillData2 = () => ({
    holyLight: {
        id: 'holyLight', name: '圣光', icon: '✨', iconImage: '', description: '魔法治疗/伤害',
        maxLevel: 20, tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
        expFormula: '100 + (level - 1) * 100',
        effectFormula: { healBase: '5 + level * 5', cooldown: 10, intMul: '1 + level * 0.5' },
        expRewards: { hit: 5, kill: 10 },
    },
    fireball: {
        id: 'fireball', name: '火球术', icon: '🔥', iconImage: '', description: '魔法伤害',
        maxLevel: 20, tags: [{ name: '魔法', type: 'magic' }, { name: '主动', type: 'active' }],
        expFormula: '100 + (level - 1) * 100',
        effectFormula: { damageBase: '20 + level * 5', mpCost: '15 + level', cooldown: '5 - level * 0.1' },
        expRewards: { hit: 1, kill: 6 },
    },
    iceSpike: {
        id: 'iceSpike', name: '冰锥', icon: '🧊', iconImage: '', description: '冰系伤害',
        maxLevel: 20, tags: [{ name: '魔法', type: 'magic' }],
        expFormula: '100 + (level - 1) * 100',
        effectFormula: { damageBase: '15 + level * 4', mpCost: '10 + level', cooldown: '4 - level * 0.08' },
        expRewards: { hit: 1, kill: 6 },
    },
    lightningStrike: {
        id: 'lightningStrike', name: '闪电', icon: '⚡', iconImage: '', description: '电系伤害',
        maxLevel: 20, tags: [{ name: '魔法', type: 'magic' }],
        expFormula: '100 + (level - 1) * 100',
        effectFormula: { damageBase: '25 + level * 5', mpCost: '18 + level', cooldown: '6 - level * 0.1' },
        expRewards: { hit: 1, kill: 6 },
    },
});

// 模拟浏览器环境：fromSerialized 的 restoreSkills 需要 window.SKILL_DATA
if (typeof globalThis.window === 'undefined') {
    globalThis.window = { SKILL_DATA: fakeSkillData2() };
}

let pass = 0, fail = 0;
const check = (name, ok, detail = '') => {
    if (ok) { pass++; console.log('PASS', name); }
    else { fail++; console.log('FAIL', name, detail); }
};

// --- 成长规则 ---
const c = { data: { level: 5 } };
const w = allocateOnLevelUp(c, 'warrior', 2);
check('warrior 2点→str1+con1', w.str === 1 && w.con === 1, JSON.stringify(w));
const m = allocateOnLevelUp(c, 'mage', 2);
check('mage 2点→int1+wis1', m.int === 1 && m.wis === 1, JSON.stringify(m));
const r = allocateOnLevelUp(c, 'ranger', 2);
check('ranger 2点→dex1+luck1', r.dex === 1 && r.luck === 1, JSON.stringify(r));
const unknown = allocateOnLevelUp(c, 'no_such_rule', 2);
check('未知规则→balanced 兜底（总点数不丢）', unknown.str + unknown.dex + unknown.int + unknown.con + unknown.wis + unknown.luck === 2, JSON.stringify(unknown));
registerGrowthRule('test_growth', () => ({ str: 2 }));
const tg = allocateOnLevelUp(c, 'test_growth', 2);
check('运行时注册规则生效', tg.str === 2, JSON.stringify(tg));

// --- Companion 升级（经验同玩家曲线；升级自动按成长规则分配） ---
const archive = { id: 't1', name: '测试', baseLevel: 1, baseExp: 0,
    baseData: { str: 5, dex: 5, int: 5, con: 5, wis: 5, luck: 5 }, growthRule: 'warrior' };
const comp = new Companion(archive);
const lv0 = comp.data.level;
check('初始等级 1', lv0 === 1, `got ${lv0}`);
comp.gainExp(comp.data.maxExp + 10); // 升 1 级 + 10 余
check('升级到 2', comp.data.level === 2, `got ${comp.data.level}`);
check('升级属性点已分配（str+1/con+1）', comp.data.str === 6 && comp.data.con === 6,
    `str=${comp.data.str} con=${comp.data.con}`);
check('attrPoints 清空', comp.data.attrPoints === 0, `got ${comp.data.attrPoints}`);
check('HP 回满', comp.data.hp === comp.data.maxHp, `hp=${comp.data.hp}/${comp.data.maxHp}`);
check('maxExp 已重算', comp.data.maxExp === comp.getExpForLevel(2), `got ${comp.data.maxExp}`);

// --- PartySystem 增删 / 满员 / 经验分发 ---
PartySystem.init();
check('init 后空队', PartySystem.size === 0);
check('加入 warrior', PartySystem.addCompanion('warrior_bruno') === true);
check('加入 mage', PartySystem.addCompanion('mage_luna') === true);
check('加入 ranger', PartySystem.addCompanion('ranger_keith') === true);
check('满员拒绝（3/3）', PartySystem.addCompanion('priest_sera') === false);
check('重复招募拒绝', PartySystem.addCompanion('warrior_bruno') === false);
const lvBefore = PartySystem.members[0].data.level;
PartySystem.grantCombatExp(PartySystem.members[0].data.maxExp);
check('战斗经验全量分发（不分摊）', PartySystem.members.every(mm => mm.data.level === lvBefore + 1),
    PartySystem.members.map(mm => `${mm.id}:${mm.data.level}`).join(','));
check('移出队员', PartySystem.removeCompanion('mage_luna') === true);
check('移出后空位释放', PartySystem.addCompanion('priest_sera') === true);
check('移出后释放名额', PartySystem.removeCompanion('priest_sera') === true);
check('移出后可重新招募', PartySystem.addCompanion('mage_luna') === true);

// --- 解除招募保留状态：再招募继承（等级/属性/装备/背包） ---
const luna = PartySystem.getMember('mage_luna');
// 升级 + 装备 + 背包塞物
luna.gainExp(luna.data.maxExp + 20);                 // 升 1 级（属性点自动分配）
luna.backpack.push({ slot: 3, name: '传承护符', category: 'accessory' });
luna.equipments.armor = { name: '传承法袍', category: 'armor', equipSlot: 'armor', bonusStats: { int: 2 } };
luna.calculateCombatStats();
luna.updateMaxStats();
const lvKeep = luna.data.level, intKeep = luna.data.int;
check('解除招募（移出）', PartySystem.removeCompanion('mage_luna') === true);
check('档案保留（roster 有露娜）', !!PartySystem.serializeRoster()['mage_luna']);
check('再招募继承', PartySystem.addCompanion('mage_luna') === true);
const luna2 = PartySystem.getMember('mage_luna');
check('继承等级', luna2.data.level === lvKeep, `got ${luna2.data.level}`);
check('继承属性（含成长分配）', luna2.data.int === intKeep, `int ${luna2.data.int} vs ${intKeep}`);
check('继承装备', luna2.equipments.armor && luna2.equipments.armor.name === '传承法袍');
check('继承背包', luna2.backpack.some(b => b.name === '传承护符'));
check('继承经验', luna2.data.exp === luna.data.exp);

// --- serialize → fromSerialized 往返健壮性（带技能/装备/背包；防"按钮点击无反应"静默异常） ---
const c4 = new Companion({ id: 't4', name: '往返测试', baseLevel: 1, baseData: { str: 5, dex: 5, int: 5, con: 5, wis: 5, luck: 5 }, growthRule: 'mage' });
// 注入技能 + 使用（触发 getEffect 缓存）+ 升级 + 装备
c4.skills = buildSkillMap(['holyLight'], {
    holyLight: { id: 'holyLight', name: '圣光', icon: '✨', iconImage: '', description: 't', maxLevel: 20, tags: [], expFormula: '100 + (level-1)*100', effectFormula: { healBase: '5 + level * 5', cooldown: 10 }, expRewards: {} },
});
if (c4.skills.holyLight) {
    c4.skills.holyLight.getEffect(1);   // 触发 _effectCache
    c4.skills.holyLight.exp = 50;
}
c4.equipments.armor = { name: '法袍', category: 'armor', equipSlot: 'armor', bonusStats: { int: 2 }, defense: { base: 3, perEnhance: 1 }, enhanceLevel: 2 };
c4.backpack.push({ slot: 0, name: '卷轴', category: 'consumable', stack: 5 });
let ser = null, restored = null, serErr = null, restoreErr = null;
try { ser = c4.serialize(); } catch (e) { serErr = String(e); }
if (ser) { try { restored = Companion.fromSerialized(ser); } catch (e) { restoreErr = String(e); } }
check('serialize 不抛错', serErr === null, serErr || '');
check('fromSerialized 不抛错', restoreErr === null, restoreErr || '');
if (ser && restored) {
    check('往返恢复等级/属性', restored.data.level === c4.data.level && restored.data.int === c4.data.int);
    check('往返恢复装备', restored.equipments.armor && restored.equipments.armor.name === '法袍');
    check('往返恢复背包', restored.backpack.some(b => b.name === '卷轴'));
    check('往返恢复技能等级', restored.skills.holyLight && restored.skills.holyLight.level === c4.skills.holyLight.level,
        restored.skills && restored.skills.holyLight ? `got lv ${restored.skills.holyLight.level}` : 'no skill');
    check('往返恢复技能方法(getEffect)', restored.skills.holyLight && typeof restored.skills.holyLight.getEffect === 'function',
        restored.skills && restored.skills.holyLight ? `methods: ${Object.keys(restored.skills.holyLight).join(',')}` : 'no skill');
    check('往返恢复技能方法(getExpForNext)', restored.skills.holyLight && typeof restored.skills.holyLight.getExpForNext === 'function');
    check('往返技能可修炼', grantSkillExp(restored, 'holyLight', 10) !== undefined || restored.skills.holyLight.exp > 50);
}

// --- 侍从装备 + 魔法完整跑通测试（审计链路） ---
const c5 = new Companion({ id: 't5', name: '装备魔法测试', baseLevel: 1, baseData: { str: 10, dex: 8, int: 10, con: 8, wis: 12, luck: 6 }, growthRule: 'priest' });
// 1) 装备：法杖（武器）+ 法袍（护甲，附魔法伤害）
c5.backpack.push({ slot: 0, name: '见习法杖', category: 'weapon_ranged', weaponType: 'staff', equipSlot: 'weapon', isTwoHanded: true, bonusStats: { int: 3 }, matkFormula: { base: 12, intMul: 1.2, wisMul: 0.5, enhanceBase: 2, enhanceIntMul: 0.1, enhanceWisMul: 0.05 } });
c5.backpack.push({ slot: 1, name: '秘法长袍', category: 'armor', equipSlot: 'armor', bonusStats: { wis: 2, maxMp: 40 }, defense: { base: 8, perEnhance: 2 }, enhanceLevel: 2 });
check('装备法杖→weapon', c5.equipFromBackpack(0) === 'weapon');
check('装备法袍→armor', c5.equipFromBackpack(1) === 'armor');
check('装备后 int 加成', c5.data.int === 13, `int=${c5.data.int}`);        // 10 + 3
check('装备后 wis 加成', c5.data.wis === 14, `wis=${c5.data.wis}`);        // 12 + 2
check('装备后 maxMp 加成', c5.data.maxMp >= 40, `maxMp=${c5.data.maxMp}`);
check('装备后防御加成（含强化）', c5.data.def >= 8 + 2 * 2, `def=${c5.data.def}`);
check('装备后魔攻含公式', c5.data.matk > 0, `matk=${c5.data.matk}`);
// 2) 魔法技能：构建 + 效果公式 + 升级
c5.skills = buildSkillMap(['holyLight', 'fireball'], fakeSkillData2());
check('魔法技能构建', !!c5.skills.holyLight && c5.skills.holyLight.name === '圣光');
const healLv1 = getSkillEffect(c5, 'holyLight', 1);
check('圣光 Lv1 效果公式', healLv1.healBase === 10 && healLv1.cooldown === 10, JSON.stringify(healLv1));
check('魔法技能修炼升级', grantSkillExp(c5, 'holyLight', c5.skills.holyLight.maxExp) === true);
check('圣光升级后等级', c5.skills.holyLight.level === 2);
const healLv2 = getSkillEffect(c5, 'holyLight', 2);
check('圣光 Lv2 效果提升', healLv2.healBase === 15, JSON.stringify(healLv2));
// 3) 装备+技能 序列化往返保留
const ser5 = c5.serialize();
const c5r = Companion.fromSerialized(ser5);
check('装备+技能往返：int', c5r.data.int === 13);
check('装备+技能往返：装备', c5r.equipments.weapon && c5r.equipments.weapon.name === '见习法杖');
check('装备+技能往返：技能等级', c5r.skills.holyLight && c5r.skills.holyLight.level === 2);

// --- 审计：装备满时替换必须拒绝（防旧装备静默丢失） ---
const c6 = new Companion({ id: 't6', name: '满包测试', baseLevel: 1, baseData: { str: 5, dex: 5, int: 5, con: 5, wis: 5, luck: 5 }, growthRule: 'balanced' });
c6.equipments.weapon = { name: '旧剑', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' };
c6.equipments.weapon2 = { name: '剑2', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' };
c6.equipments.offhand = { name: '剑3', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'offhand' };
for (let i = 0; i < c6.maxBackpackSlots; i++) c6.backpack.push({ slot: i, name: '杂物' + i, category: 'consumable' });
const fullBefore = c6.backpack.length;
c6.backpack.push({ slot: 99, name: '新剑', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' });
const replaced = c6.equipFromBackpack(99);
check('背包满替换被拒绝', replaced === null, `got ${replaced}`);
check('旧剑保留', c6.equipments.weapon && c6.equipments.weapon.name === '旧剑');
check('新剑保留在背包', c6.equipments.weapon.name === '旧剑' && c6.backpack.some(b => b.name === '新剑'));
check('背包未变', c6.backpack.length === fullBefore + 1);
// 满包卸下拒绝
check('满包卸下被拒绝', c6.unequip('weapon') === false);
check('卸下后旧剑仍在', c6.equipments.weapon && c6.equipments.weapon.name === '旧剑');

// --- 露娜配置：初始火球/冰锥/闪电 + 10级解锁圣光 + 每级+1智+1精 + 每级+10生命/魔法 ---
const companionConfigData = await import('../data/companion-config.json');
const lunaArchive = companionConfigData.default.companions.find(a => a.id === 'mage_luna');
const lunaC = new Companion(lunaArchive);
check('露娜初始魔法 600', lunaC.data.maxMp === 600, `maxMp ${lunaC.data.maxMp}`);
check('露娜初始魔法值满', lunaC.data.mp === lunaC.data.maxMp);
check('露娜无装备基础魔攻 25（int×1.5+wis×0.5，与玩家对齐）', lunaC.data.matk === 25, `matk ${lunaC.data.matk}`);
check('消耗品设置默认启用+阈值', lunaC.consumableSettings.enabled === true
    && lunaC.consumableSettings.hpThreshold === 0.3 && lunaC.consumableSettings.mpThreshold === 0.25);
check('露娜初始火球', !!lunaC.skills.fireball);
check('露娜初始冰锥', !!lunaC.skills.iceSpike);
check('露娜初始闪电', !!lunaC.skills.lightningStrike);
check('露娜 10 级前无圣光', !lunaC.skills.holyLight);
const lunaHp0 = lunaC.data.maxHp, lunaMp0 = lunaC.data.maxMp;
const lunaInt0 = lunaC.data.int, lunaWis0 = lunaC.data.wis;
// 升级曲线随等级增长，一次性经验不够——逐级喂满到 10 级
let lunaGuard = 0;
while (lunaC.data.level < 10 && lunaGuard++ < 50) {
    lunaC.gainExp(lunaC.data.maxExp + 1);
}
check('露娜 10 级解锁圣光', !!lunaC.skills.holyLight);
const lunaLv = lunaC.data.level, lunaGain = lunaLv - 1;
check('露娜每级 +1 智力', lunaC.data.int === lunaInt0 + lunaGain, `int ${lunaC.data.int} vs ${lunaInt0 + lunaGain}`);
check('露娜每级 +1 精神', lunaC.data.wis === lunaWis0 + lunaGain, `wis ${lunaC.data.wis} vs ${lunaWis0 + lunaGain}`);
check('露娜每级 +10 生命', lunaC.data.maxHp === lunaHp0 + lunaGain * 10, `hp ${lunaC.data.maxHp} vs ${lunaHp0 + lunaGain * 10}`);
check('露娜每级 +10 魔法（另含 int/wis 加成）', lunaC.data.maxMp >= lunaMp0 + lunaGain * 10, `mp ${lunaC.data.maxMp} vs ${lunaMp0 + lunaGain * 10}`);
check('解锁后圣光可修炼', grantSkillExp(lunaC, 'holyLight', 10) !== undefined || lunaC.skills.holyLight.exp > 0);
// 露娜动画配置（2026-08-15 用 walking and running.mp4 重建：walk 26 帧 / run 起步17+循环23）
check('露娜 walk 动画配置（26帧无缝循环 [0,25]）', lunaC.animations.walk && lunaC.animations.walk.src.includes('walking.png')
    && lunaC.animations.walk.frameCount === 26 && lunaC.animations.walk.frames[0] === 0 && lunaC.animations.walk.frames[1] === 25);
    check('露娜 run 动画配置（起步+循环两段 40帧）', lunaC.animations.run && lunaC.animations.run.src.includes('running.png')
        && lunaC.animations.run.frameCount === 40 && lunaC.animations.run.rows === 5);
    check('露娜 run 起步+循环段', lunaC.animations.run.startFrames[0] === 0 && lunaC.animations.run.startFrames[1] === 16
        && lunaC.animations.run.loopFrames[0] === 17 && lunaC.animations.run.loopFrames[1] === 39);
    check('露娜 spell 动画配置', lunaC.animations.spell && lunaC.animations.spell.src.includes('spelling.png'));
    check('露娜 idle 动画配置', lunaC.animations.idle && lunaC.animations.idle.src.includes('idle.png'));
    check('露娜 spell 施法循环', lunaC.animations.spell.repeat === -1);
const lunaSer = lunaC.serialize();
check('动画配置序列化保留', lunaSer.animations && lunaSer.animations.walk && lunaSer.animations.walk.src.includes('walking.png'));
check('初始魔法覆盖序列化保留', lunaSer.baseMaxMp === 600);
check('消耗品设置序列化保留', lunaSer.consumableSettings && lunaSer.consumableSettings.hpThreshold === 0.3);
const lunaRestored = Companion.fromSerialized(lunaSer);
check('恢复后魔法与序列化一致（600 基准 + 每级10）', lunaRestored.data.maxMp === lunaC.data.maxMp
    && lunaRestored.data.maxMp === 600 + (lunaC.data.level - 1) * 10, `maxMp ${lunaRestored.data.maxMp}`);
check('恢复后消耗品设置保留', lunaRestored.consumableSettings && lunaRestored.consumableSettings.enabled === true);

// --- 装备通用规则（与玩家共用 equip-rules） ---
const sword = { name: '剑', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' };
const shield = { name: '盾', category: 'weapon_melee', weaponType: 'shield', equipSlot: 'offhand' };
const twoHand = { name: '双手步枪', category: 'weapon_ranged', weaponType: 'akm', isTwoHanded: true, equipSlot: 'weapon' };
const armor = { name: '胸甲', category: 'armor', equipSlot: 'armor' };
check('剑可进主手', canEquipSlot(sword, 'weapon') === true);
check('剑可进副手（单手）', canEquipSlot(sword, 'offhand') === true);
check('双手武器禁进副手', canEquipSlot(twoHand, 'offhand') === false);
check('双手武器进主手', canEquipSlot(twoHand, 'weapon') === true);
check('盾只能进副手', canEquipSlot(shield, 'offhand') === true && canEquipSlot(shield, 'weapon') === false);
check('护甲只能进护甲槽', canEquipSlot(armor, 'armor') === true && canEquipSlot(armor, 'helmet') === false);

// --- Companion 装备流程：背包装备 / 替换回包 / 卸下 / 属性结算 ---
const c2 = new Companion({ id: 't2', name: '装备测试', baseLevel: 1, baseData: { str: 5, dex: 5, int: 5, con: 5, wis: 5, luck: 5 }, growthRule: 'warrior' });
c2.backpack.push({ slot: 0, ...JSON.parse(JSON.stringify(sword)) });
c2.backpack.push({ slot: 1, ...JSON.parse(JSON.stringify(armor)) });
check('背包装备剑→weapon', c2.equipFromBackpack(0) === 'weapon');
check('装备后背包移除', !c2.backpack.some(b => b.slot === 0));
check('背包装备胸甲→armor', c2.equipFromBackpack(1) === 'armor');
check('装备槽位正确', c2.equipments.weapon.name === '剑' && c2.equipments.armor.name === '胸甲');
// 单手武器自动槽位（与玩家规则一致：主手满→weapon2→offhand→全满才替换主手）
c2.backpack.push({ slot: 2, ...JSON.parse(JSON.stringify({ name: '剑2', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' })) });
check('主手满→装 weapon2', c2.equipFromBackpack(2) === 'weapon2');
check('主手仍持剑', c2.equipments.weapon.name === '剑');
c2.backpack.push({ slot: 3, ...JSON.parse(JSON.stringify({ name: '剑3', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' })) });
check('weapon2 满→装 offhand', c2.equipFromBackpack(3) === 'offhand');
c2.backpack.push({ slot: 4, ...JSON.parse(JSON.stringify({ name: '剑4', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' })) });
check('全满→替换主手 weapon', c2.equipFromBackpack(4) === 'weapon');
check('旧主手剑回背包', c2.backpack.some(b => b.name === '剑'));
// 卸下回包
check('卸下护甲', c2.unequip('armor') === true);
check('护甲回背包', c2.backpack.some(b => b.name === '胸甲') && !c2.equipments.armor);
// 装备属性结算：给胸甲 bonusStats 后 calculateCombatStats 应体现
const c3 = new Companion({ id: 't3', name: '属性测试', baseLevel: 1, baseData: { str: 5, dex: 5, int: 5, con: 5, wis: 5, luck: 5 }, growthRule: 'balanced' });
const conStat = { name: '体质护甲', category: 'armor', equipSlot: 'armor', bonusStats: { con: 3, maxHp: 50, defense: 5 } };
c3.backpack.push({ slot: 0, ...JSON.parse(JSON.stringify(conStat)) });
c3.equipFromBackpack(0);
check('装备六维 con+3', c3.data.con === 8, `con=${c3.data.con}`);
check('装备 maxHp 计入', c3.data.maxHp >= 150, `maxHp=${c3.data.maxHp}`);
check('装备防御计入', c3.data.def >= 5, `def=${c3.data.def}`);
const eqBonus = getEquipmentBonuses(c3.equipments);
check('共享加成函数', eqBonus.con === 3 && eqBonus.maxHp === 50 && eqBonus.defense === 5, JSON.stringify(eqBonus));

// --- 通用技能模块（玩家/侍从同一套构建/修炼/效果） ---
const fakeSkillData = {
    swordMastery: {
        id: 'swordMastery', name: '剑精通', icon: '⚔', iconImage: '',
        description: '精通剑术', maxLevel: 20,
        tags: [], expFormula: '100 + (level - 1) * 100',
        effectFormula: { atkBonus: 'level', dexBonus: 'level' },
        expRewards: { hit: 1, kill: 10 },
    },
};
const skillMap = buildSkillMap(['swordMastery'], fakeSkillData);
check('通用构建技能对象', !!skillMap.swordMastery && skillMap.swordMastery.name === '剑精通');
const skillOwner = {
    name: '测试侍从', data: { str: 5, dex: 5, level: 1 },
    skills: skillMap,
    calculateCombatStats() {}, updateMaxStats() {},
};
check('通用取技能效果 Lv1', getSkillEffect(skillOwner, 'swordMastery').atkBonus === 1);
check('通用修炼升级', grantSkillExp(skillOwner, 'swordMastery', skillMap.swordMastery.maxExp) === true);
check('升级后等级 2', skillMap.swordMastery.level === 2);
check('效果按新等级', getSkillEffect(skillOwner, 'swordMastery').atkBonus === 2);
check('升级属性奖励 dex+2', skillOwner.data.dex === 7, `dex=${skillOwner.data.dex}`);
// 满级封顶
skillMap.swordMastery.level = 20; skillMap.swordMastery.maxLevel = 20;
check('满级不再升级', grantSkillExp(skillOwner, 'swordMastery', 99999) === false);
// 未知技能忽略
check('未知技能构建忽略', Object.keys(buildSkillMap(['no_such'], fakeSkillData)).length === 0);

// --- CompanionAI 决策纯函数（2026-08-14）---
check('AI: 施法中→cast', decideCompanionAction({ casting: true, hasEnemy: true }) === 'cast');
check('AI: 施法中威胁贴脸→flee（保命打断施法）', decideCompanionAction({
    casting: true, hasEnemy: true, threatDist: 80, safeDistance: 230,
}) === 'flee');
check('AI: 无敌人远跟随→follow', decideCompanionAction({ hasEnemy: false, followDist: 200, followArriveDist: 55 }) === 'follow');
check('AI: 无敌人已到位→idle', decideCompanionAction({ hasEnemy: false, followDist: 30, followArriveDist: 55 }) === 'idle');
check('AI: 近战威胁贴脸→flee', decideCompanionAction({
    hasEnemy: true, threatDist: 100, safeDistance: 230,
    targetDist: 300, combatRange: 640, spellReady: true,
}) === 'flee');
check('AI: 射程内技能就绪→cast', decideCompanionAction({
    hasEnemy: true, threatDist: 300, safeDistance: 230,
    targetDist: 300, combatRange: 640, spellReady: true,
}) === 'cast');
check('AI: 射程外→advance', decideCompanionAction({
    hasEnemy: true, threatDist: 300, safeDistance: 230,
    targetDist: 900, combatRange: 640, spellReady: false,
}) === 'advance');
// 技能选择
const spellInput = (over) => Object.assign({
    cds: { fireball: 0, iceSpike: 0, lightningStrike: 0 },
    mp: 100,
    mpCosts: { fireball: 10, iceSpike: 10, lightningStrike: 20 },
    targetDist: 300,
    ranges: { fireball: 1200, iceSpike: 800, lightningStrike: 600 },
    targetCount: 1, grouped: false,
}, over);
check('技能: 多目标扎堆→闪电', pickCompanionSpell(spellInput({ targetCount: 3, grouped: true })) === 'lightningStrike');
check('技能: 闪电CD→火球', pickCompanionSpell(spellInput({ cds: { fireball: 0, iceSpike: 0, lightningStrike: 5000 }, targetCount: 3, grouped: true })) === 'fireball');
check('技能: 单目标→火球', pickCompanionSpell(spellInput({})) === 'fireball');
check('技能: 火球CD→冰锥', pickCompanionSpell(spellInput({ cds: { fireball: 5000, iceSpike: 0, lightningStrike: 5000 } })) === 'iceSpike');
check('技能: MP不足跳过', pickCompanionSpell(spellInput({ mp: 5 })) === null);
check('技能: 全CD→null', pickCompanionSpell(spellInput({ cds: { fireball: 5000, iceSpike: 5000, lightningStrike: 5000 } })) === null);

// --- 队员移动动画 walk/run 切换（2026-08-14） ---
const P = { x: 0, y: 0 };
check('run判定: flee 永远 run', shouldUseRun('flee', 10, DEFAULT_MAGE_AI) === true);
check('run判定: advance 远距离 run', shouldUseRun('advance', 500, DEFAULT_MAGE_AI) === true);
check('run判定: advance 近距离 walk', shouldUseRun('advance', 100, DEFAULT_MAGE_AI) === false);
check('run判定: follow 远距离 run', shouldUseRun('follow', 300, DEFAULT_MAGE_AI) === true);
check('run判定: follow 近距离 walk', shouldUseRun('follow', 50, DEFAULT_MAGE_AI) === false);
check('run判定: runDist 边界', shouldUseRun('follow', 261, DEFAULT_MAGE_AI) === true
    && shouldUseRun('follow', 260, DEFAULT_MAGE_AI) === false);

// --- 掉队瞬移理智判定（2026-08-14） ---
check('掉队: 范围内不瞬移', shouldRelocateCompanion({ dist: 600, player: P }) === false);
check('掉队: flee 中远离不瞬移', shouldRelocateCompanion({ dist: 800, lastAction: 'flee', player: P }) === false);
check('掉队: 站位合法不瞬移',
    shouldRelocateCompanion({ dist: 800, lastAction: 'advance', tacticalTarget: { x: 400, y: 0 }, player: P }) === false);
check('掉队: 站位离玩家过远瞬移',
    shouldRelocateCompanion({ dist: 800, lastAction: 'advance', tacticalTarget: { x: 800, y: 0 }, player: P }) === true);
check('掉队: 施法中不瞬移', shouldRelocateCompanion({ dist: 800, casting: true, player: P }) === false);
check('掉队: 追赶中不瞬移', shouldRelocateCompanion({ dist: 850, lastPlayerDist: 900, player: P }) === false);
check('掉队: 距离增大掉队瞬移', shouldRelocateCompanion({ dist: 800, lastPlayerDist: 700, player: P }) === true);
check('掉队: PathManager 卡住瞬移', shouldRelocateCompanion({ dist: 800, pathStuck: true, player: P }) === true);
check('掉队: 撞墙瞬移', shouldRelocateCompanion({ dist: 800, inWall: true, player: P }) === true);
check('掉队: 超 hardDist 无条件瞬移', shouldRelocateCompanion({ dist: 1200, lastAction: 'flee', player: P }) === true);
check('掉队: 自定义 teleportDist', shouldRelocateCompanion({ dist: 500, teleportDist: 400, player: P }) === true);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
