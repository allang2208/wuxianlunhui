// 侍从系统框架单测：成长规则 / Companion 升级 / PartySystem 增删与经验分发
// 运行：node scripts/test-party-system.mjs
await import('./register-json-loader.mjs');
const { allocateOnLevelUp, registerGrowthRule } = await import('../src/config/companion-growth.js');
const { Companion } = await import('../src/entities/companion.js');
const { PartySystem } = await import('../src/systems/party-system.js');
const { canEquipSlot, getEquipmentBonuses } = await import('../src/ui/equip/equip-rules.js');
const { buildSkillMap, grantSkillExp, getSkillEffect, grantCompanionSkillExp } = await import('../src/systems/skill-system.js');
const {
    decideCompanionAction, pickCompanionSpell,
    shouldRelocateCompanion, shouldUseRun, DEFAULT_MAGE_AI,
    shouldWarriorDefend, shouldWarriorWhirlwind,
} = await import('../src/ai/companion-ai-decision.js');

const fakeSkillData2 = () => ({
    swordMastery: {
        id: 'swordMastery', name: '剑精通', icon: '⚔', iconImage: '',
        description: '精通剑术，每次挥舞都更加致命',
        maxLevel: 20, tags: [{ name: '被动', type: 'passive' }],
        expFormula: '100 + (level - 1) * 100',
        effectFormula: { atkBonus: 'level', cooldownReduction: 'level * 0.01', dexBonus: 'level' },
        expRewards: { hit: 1, multiHit: 3, kill: 10 },
    },
    shieldDefense: {
        id: 'shieldDefense', name: '持盾防御', icon: '🛡', iconImage: '',
        description: '精通盾牌防御之术',
        maxLevel: 20, tags: [{ name: '被动', type: 'passive' }],
        expFormula: '100 + (level - 1) * 100',
        effectFormula: { defBonusPercent: 'level * 0.02', damageReductionBonus: 'level * 0.02', parryStunBonus: 'Math.floor(level / 5) * 0.25' },
        expRewards: { parry: 10, meleeBlock: 2, rangedBlock: 5 },
    },
    whirlwind: {
        id: 'whirlwind', name: '风车', icon: '🌀', iconImage: '',
        description: '以自身为中心高速旋转武器，对周围敌人造成毁灭性打击',
        maxLevel: 20, tags: [{ name: '近战', type: 'melee' }, { name: '主动', type: 'active' }],
        expFormula: '100 + (level - 1) * 100',
        effectFormula: {
            damageMul: '1.5 + level * 0.10', strBonus: 'level', cooldown: '10 - level * 0.2',
            staminaCost: '20 + level * 1', radius: '120 + level * 5', swordRadiusBonus: 80,
            knockback: 250, stunDuration: 2500, duration: 800,
        },
        expRewards: { hit: 1, multiHit: 3, kill: 15 },
    },
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
check('露娜 spell 动画配置（前16正放+后16倒放 32 帧）', lunaC.animations.spell && lunaC.animations.spell.src.includes('spelling.png')
    && lunaC.animations.spell.frameCount === 32 && lunaC.animations.spell.frames[0] === 0 && lunaC.animations.spell.frames[1] === 31
    && Math.abs(lunaC.animations.spell.frameRate - 26.67) < 0.01);
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

// --- 露娜装备限制：只能法杖（武器）+ 法袍类套装（防具，+魔法攻击力套装） ---
const lunaRules = lunaC.equipRules || {};
check('露娜 equipRules 武器限法杖', Array.isArray(lunaRules.weaponTypes) && lunaRules.weaponTypes.includes('staff'),
    JSON.stringify(lunaRules.weaponTypes));
check('露娜 equipRules 防具限法袍套装（robe/eclipse/lunar/oracle_robe）',
    ['robe', 'eclipse', 'lunar', 'oracle_robe'].every(s => lunaRules.armorSets.includes(s)),
    JSON.stringify(lunaRules.armorSets));
check('露娜 equipNote 文案', lunaC.equipNote === '只能装备法杖和法袍类装备', lunaC.equipNote);
const lunaStaff = { name: '学徒长杖', category: 'weapon_melee', weaponType: 'staff', equipSlot: 'weapon' };
const lunaSword = { name: '生锈长剑', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' };
const lunaGun = { name: 'AKM', category: 'weapon_ranged', weaponType: 'akm', isTwoHanded: true, equipSlot: 'weapon' };
const lunaRobe = { name: '秘法长袍', category: 'armor', equipSlot: 'armor', armorSet: 'robe' };
const lunaLunarArmor = { name: '苍月法袍', category: 'armor', equipSlot: 'armor', armorSet: 'lunar' };
const lunaHeavy = { name: '天罡重甲', category: 'armor', equipSlot: 'armor', armorSet: 'tiangang' };
const lunaPlainArmor = { name: '无套装护甲', category: 'armor', equipSlot: 'armor' };
const lunaRing = { name: '秘法戒指', category: 'accessory', equipSlot: 'ring1' };
check('露娜可装备法杖→weapon', lunaC.canEquip(lunaStaff, 'weapon') === true);
check('露娜禁装备长剑→weapon', lunaC.canEquip(lunaSword, 'weapon') === false);
check('露娜禁装备枪械→weapon', lunaC.canEquip(lunaGun, 'weapon') === false);
check('露娜可装备法袍套装（robe）→armor', lunaC.canEquip(lunaRobe, 'armor') === true);
check('露娜可装备法袍套装（lunar）→armor', lunaC.canEquip(lunaLunarArmor, 'armor') === true);
check('露娜禁装备重甲套装（tiangang）→armor', lunaC.canEquip(lunaHeavy, 'armor') === false);
check('露娜禁装备无套装护甲→armor', lunaC.canEquip(lunaPlainArmor, 'armor') === false);
check('露娜首饰不受限（accessory）', lunaC.canEquip(lunaRing, 'ring1') === true);
// 法杖自动装备走 equipFromBackpack 也被拦截（非 staff 不进装备槽）
const lunaPack = new Companion({ id: 't_luna_rules', name: '露娜规则测试', baseLevel: 1,
    baseData: { str: 4, dex: 6, int: 13, con: 6, wis: 12, luck: 6 }, growthRule: 'mage',
    equipRules: { weaponTypes: ['staff'], armorSets: ['robe', 'eclipse', 'lunar', 'oracle_robe'] } });
lunaPack.backpack.push({ slot: 0, ...JSON.parse(JSON.stringify(lunaSword)) });
lunaPack.backpack.push({ slot: 1, ...JSON.parse(JSON.stringify(lunaRobe)) });
lunaPack.backpack.push({ slot: 2, ...JSON.parse(JSON.stringify(lunaStaff)) });
check('露娜背包自动装备：长剑被拒（留在背包）', lunaPack.equipFromBackpack(0) === null
    && lunaPack.backpack.some(b => b.slot === 0) && !lunaPack.equipments.weapon);
check('露娜背包自动装备：法袍→armor', lunaPack.equipFromBackpack(1) === 'armor');
check('露娜背包自动装备：法杖→weapon', lunaPack.equipFromBackpack(2) === 'weapon');
// 无 equipRules 的队友不受限制（warrior_bruno 等）
const bruno = PartySystem.getMember('warrior_bruno') || new Companion({ id: 'warrior_bruno', name: '布鲁诺', baseLevel: 1, baseData: { str: 12, dex: 8, int: 4, con: 12, wis: 6, luck: 4 }, growthRule: 'warrior', weaponType: 'sword' });
check('无限制队友可装备长剑', bruno.canEquip(lunaSword, 'weapon') === true);
check('无限制队友可装备任意护甲', bruno.canEquip(lunaHeavy, 'armor') === true);
// 解散再招募（roster 继承）后限制仍在
const lunaRulesSer = lunaC.serialize();
check('equipRules 序列化保留', lunaRulesSer.equipRules && lunaRulesSer.equipRules.weaponTypes.includes('staff')
    && lunaRulesSer.equipRules.armorSets.includes('lunar'));
check('equipNote 序列化保留', lunaRulesSer.equipNote === '只能装备法杖和法袍类装备');
const lunaRulesRestored = Companion.fromSerialized(lunaRulesSer);
check('恢复后仍禁长剑', lunaRulesRestored.canEquip(lunaSword, 'weapon') === false);
check('恢复后仍可装法杖', lunaRulesRestored.canEquip(lunaStaff, 'weapon') === true);
check('恢复后仍禁重甲', lunaRulesRestored.canEquip(lunaHeavy, 'armor') === false);
check('恢复后仍可装法袍', lunaRulesRestored.canEquip(lunaRobe, 'armor') === true);
check('恢复后注释保留', lunaRulesRestored.equipNote === '只能装备法杖和法袍类装备');

// --- 剑盾护卫（伊莉丝 / warrior_bruno）：改名、职业、装备限制、动画配置 ---
const companionConfigData2 = await import('../data/companion-config.json');
const eliseArchive = companionConfigData2.default.companions.find(a => a.id === 'warrior_bruno');
const elise = new Companion(eliseArchive);
check('伊莉丝改名', elise.name === '伊莉丝', elise.name);
check('伊莉丝职业=剑盾护卫', elise.title === '剑盾护卫', elise.title);
check('伊莉丝 equipRules 武器=单手剑+盾', Array.isArray(elise.equipRules.weaponTypes)
    && elise.equipRules.weaponTypes.includes('sword') && elise.equipRules.weaponTypes.includes('shield'),
    JSON.stringify(elise.equipRules.weaponTypes));
check('伊莉丝单手剑限制开启', elise.equipRules.oneHandedWeaponsOnly === true);
check('伊莉丝 equipRules 防具=重甲（heavy/zhenyue/tiangang/oracle）',
    ['heavy', 'zhenyue', 'tiangang', 'oracle'].every(s => elise.equipRules.armorSets.includes(s)),
    JSON.stringify(elise.equipRules.armorSets));
check('伊莉丝 equipNote 文案', elise.equipNote === '只能装备单手剑、盾牌和重甲', elise.equipNote);
const eliseSword = { name: '生锈长剑', category: 'weapon_melee', weaponType: 'sword', equipSlot: 'weapon' };
const eliseTwoHandSword = { name: '双手巨剑', category: 'weapon_melee', weaponType: 'sword', isTwoHanded: true, equipSlot: 'weapon' };
const eliseShield = { name: '小圆盾', category: 'weapon_shield', weaponType: 'shield', equipSlot: 'offhand' };
const eliseHeavy = { name: '壁垒重甲', category: 'armor', equipSlot: 'armor', armorSet: 'heavy' };
const eliseOracleArmor = { name: '神域战甲', category: 'armor', equipSlot: 'armor', armorSet: 'oracle' };
const eliseLightArmor = { name: '疾风轻甲', category: 'armor', equipSlot: 'armor', armorSet: 'light' };
const eliseRobeArmor = { name: '秘法长袍', category: 'armor', equipSlot: 'armor', armorSet: 'robe' };
const eliseRing = { name: '秘法戒指', category: 'accessory', equipSlot: 'ring1' };
check('伊莉丝可装备单手剑→weapon', elise.canEquip(eliseSword, 'weapon') === true);
check('伊莉丝可装备盾→offhand', elise.canEquip(eliseShield, 'offhand') === true);
check('伊莉丝禁装备双手剑→weapon', elise.canEquip(eliseTwoHandSword, 'weapon') === false);
check('伊莉丝禁装备法杖→weapon', elise.canEquip(lunaStaff, 'weapon') === false);
check('伊莉丝禁装备远程弓→weapon', elise.canEquip({ name: '训练用弓', category: 'weapon_ranged', weaponType: 'bow', isTwoHanded: true, equipSlot: 'weapon' }, 'weapon') === false);
check('伊莉丝可装备重甲（heavy）→armor', elise.canEquip(eliseHeavy, 'armor') === true);
check('伊莉丝可装备重甲（oracle）→armor', elise.canEquip(eliseOracleArmor, 'armor') === true);
check('伊莉丝禁装备轻甲（light）→armor', elise.canEquip(eliseLightArmor, 'armor') === false);
check('伊莉丝禁装备法袍（robe）→armor', elise.canEquip(eliseRobeArmor, 'armor') === false);
check('伊莉丝首饰不受限（accessory）', elise.canEquip(eliseRing, 'ring1') === true);
check('露娜首饰同样不受限（accessory）', lunaC.canEquip(eliseRing, 'ring1') === true);
// 动画配置：walk 14（起步全播→循环 3~14 帧，半速 10fps）/ run 23（起步全播→循环 11~23 帧，半速 12fps）
// attack 28 / defend 19（enter/hold/exit 三段）
check('伊莉丝 walk 动画 14 帧（起步全播 1~14 → 循环 3~14，半速 10fps）', elise.animations.walk
    && elise.animations.walk.frameCount === 14
    && elise.animations.walk.frames[0] === 0 && elise.animations.walk.frames[1] === 13
    && elise.animations.walk.startFrames[0] === 0 && elise.animations.walk.startFrames[1] === 13
    && elise.animations.walk.loopFrames[0] === 2 && elise.animations.walk.loopFrames[1] === 13
    && elise.animations.walk.startFrameRate === 10 && elise.animations.walk.frameRate === 10);
check('伊莉丝 run 动画 23 帧（起步全播 → 循环 11~23，半速 12fps）', elise.animations.run
    && elise.animations.run.frameCount === 23
    && elise.animations.run.startFrames[0] === 0 && elise.animations.run.startFrames[1] === 22
    && elise.animations.run.loopFrames[0] === 10 && elise.animations.run.loopFrames[1] === 22
    && elise.animations.run.startFrameRate === 12 && elise.animations.run.frameRate === 12);
check('伊莉丝 attack 动画 28 帧（1.5s 播完）', elise.animations.attack
    && elise.animations.attack.frameCount === 28 && elise.animations.attack.repeat === 0
    && Math.abs(elise.animations.attack.frameRate - 28 / 1.5) < 0.01);
check('伊莉丝 defend 动画 19 帧（enter 1~8 → hold 第 8 帧 → exit 9~19）', elise.animations.defend
    && elise.animations.defend.frameCount === 19
    && elise.animations.defend.enterFrames[0] === 0 && elise.animations.defend.enterFrames[1] === 7
    && elise.animations.defend.holdFrame === 7
    && elise.animations.defend.exitFrames[0] === 8 && elise.animations.defend.exitFrames[1] === 18);
check('伊莉丝 AI role=melee_swordshield', elise.aiConfig && elise.aiConfig.role === 'melee_swordshield');
check('伊莉丝攻击参数（间隔 2s / 1.5s 动画 / 命中第 10 帧 / 物攻×1.25）', elise.aiConfig.attackInterval === 2000
    && elise.aiConfig.attackAnimMs === 1500 && elise.aiConfig.attackHitFrame === 10
    && Math.abs(elise.aiConfig.attackDamageMul - 1.25) < 1e-9);
check('伊莉丝防御参数（400px / >3 敌 / 0.5+2+0.5s）', elise.aiConfig.defendRange === 400
    && elise.aiConfig.defendEnemyCount === 3 && elise.aiConfig.defendEnterMs === 500
    && elise.aiConfig.defendHoldMs === 2000 && elise.aiConfig.defendExitMs === 500);
check('伊莉丝防御冷却 15s', elise.aiConfig.defendCooldownMs === 15000,
    `got ${elise.aiConfig.defendCooldownMs}`);
// 序列化保留：限制 + 渲染尺寸
const eliseSer = elise.serialize();
check('伊莉丝序列化保留 equipRules', eliseSer.equipRules && eliseSer.equipRules.weaponTypes.includes('shield')
    && eliseSer.equipRules.armorSets.includes('tiangang'));
// 与露娜同一套显示参数：不配 displaySize/spriteOffsetY（默认 144/无偏移），素材已按露娜规格归一化
check('伊莉丝用默认显示参数（与露娜一致）', elise.displaySize === 0 && elise.spriteOffsetY === 0
    && eliseSer.displaySize === undefined && eliseSer.spriteOffsetY === undefined);
const eliseRestored = Companion.fromSerialized(eliseSer);
check('伊莉丝恢复后仍限单手剑', eliseRestored.canEquip(eliseSword, 'weapon') === true
    && eliseRestored.canEquip(eliseTwoHandSword, 'weapon') === false
    && eliseRestored.canEquip(lunaStaff, 'weapon') === false);
check('伊莉丝恢复后仍限重甲', eliseRestored.canEquip(eliseHeavy, 'armor') === true
    && eliseRestored.canEquip(eliseLightArmor, 'armor') === false);
check('伊莉丝恢复后仍用默认显示参数', eliseRestored.displaySize === 0 && eliseRestored.spriteOffsetY === 0);

// --- 剑盾防御触发判定（纯函数）：半径 400 内 >3 敌 或 有远程敌 ---
const mkEnemy = (x, y, over = {}) => ({ x, y, attacks: {}, ...over });
const near4 = [mkEnemy(100, 0), mkEnemy(-100, 0), mkEnemy(0, 100), mkEnemy(0, -100)];
const near3 = near4.slice(0, 3);
check('防御触发：400px 内 4 敌 → true', shouldWarriorDefend({ enemies: near4, cx: 0, cy: 0, range: 400, enemyCount: 3 }) === true);
check('防御触发：400px 内 3 敌 → false', shouldWarriorDefend({ enemies: near3, cx: 0, cy: 0, range: 400, enemyCount: 3 }) === false);
check('防御触发：2 近战 + 1 远程 → true', shouldWarriorDefend({
    enemies: [mkEnemy(100, 0), mkEnemy(-100, 0), mkEnemy(0, 100, { attacks: { ranged: true } })],
    cx: 0, cy: 0, range: 400, enemyCount: 3,
}) === true);
check('防御触发：远程在范围外不触发', shouldWarriorDefend({
    enemies: [mkEnemy(100, 0), mkEnemy(-100, 0), mkEnemy(600, 0, { attacks: { ranged: true } })],
    cx: 0, cy: 0, range: 400, enemyCount: 3,
}) === false);
check('防御触发：attackRange>300 兜底判远程', shouldWarriorDefend({
    enemies: [mkEnemy(100, 0), mkEnemy(-100, 0), mkEnemy(200, 0, { attackRange: 650 })],
    cx: 0, cy: 0, range: 400, enemyCount: 3,
}) === true);
check('防御触发：attackRange≥350 判远程（弓手 350）', shouldWarriorDefend({
    enemies: [mkEnemy(100, 0), mkEnemy(-100, 0), mkEnemy(200, 0, { attackRange: 350 })],
    cx: 0, cy: 0, range: 400, enemyCount: 3,
}) === true);
check('防御触发：僵尸工头（320 鞭击近战）不算远程', shouldWarriorDefend({
    enemies: [mkEnemy(100, 0), mkEnemy(-100, 0), mkEnemy(200, 0, { attackRange: 320, attack: { type: 'thrust' } })],
    cx: 0, cy: 0, range: 400, enemyCount: 3,
}) === false);
check('防御触发：手脑/飞手（300 近战）不算远程', shouldWarriorDefend({
    enemies: [mkEnemy(100, 0), mkEnemy(-100, 0), mkEnemy(200, 0, { attackRange: 300 })],
    cx: 0, cy: 0, range: 400, enemyCount: 3,
}) === false);
check('防御触发：attack.projectileSpeed 判远程', shouldWarriorDefend({
    enemies: [mkEnemy(100, 0), mkEnemy(-100, 0), mkEnemy(200, 0, { attackRange: 100, attack: { projectileSpeed: 1248 } })],
    cx: 0, cy: 0, range: 400, enemyCount: 3,
}) === true);
check('防御触发：rangedType 判远程', shouldWarriorDefend({
    enemies: [mkEnemy(100, 0), mkEnemy(-100, 0), mkEnemy(200, 0, { rangedType: 'wizard' })],
    cx: 0, cy: 0, range: 400, enemyCount: 3,
}) === true);

// --- 伊莉丝风车（whirlwind）：配置/数值/动画/修炼/触发判定 ---
check('伊莉丝已配置风车', !!elise.skills.whirlwind && elise.skills.whirlwind.name === '风车');
check('伊莉丝 windmill 动画 23 帧（repeat 0）', elise.animations.windmill
    && elise.animations.windmill.frameCount === 23
    && elise.animations.windmill.frames[0] === 0 && elise.animations.windmill.frames[1] === 22
    && elise.animations.windmill.repeat === 0);
check('风车 Lv1 数值（damageMul 1.6 / radius 125+80 / 冷却 9.8s / 时长 0.8s）', (() => {
    const e = elise.skills.whirlwind.getEffect(1);
    return Math.abs(e.damageMul - 1.6) < 1e-9
        && Math.abs(e.radius - 125) < 1e-9 && e.swordRadiusBonus === 80
        && Math.abs(e.cooldown - 9.8) < 1e-9 && Math.abs(e.duration - 800) < 1e-9;
})());
let wwGuard = 0;
while (elise.skills.whirlwind.level < 3 && wwGuard++ < 30) {
    grantSkillExp(elise, 'whirlwind', elise.skills.whirlwind.maxExp);
}
check('风车修炼升级（可到 Lv3）', elise.skills.whirlwind.level >= 3,
    `lv=${elise.skills.whirlwind.level}`);
check('风车升级回调应用力量（strBonus）', elise.data.str >= 13 + elise.skills.whirlwind.level,
    `str=${elise.data.str} lv=${elise.skills.whirlwind.level}`);
check('风车触发：范围内 3 敌 → true', shouldWarriorWhirlwind({
    enemies: [mkEnemy(100, 0), mkEnemy(-100, 0), mkEnemy(0, 80)],
    cx: 0, cy: 0, range: 205, minTargets: 2,
}) === true);
check('风车触发：范围内 1 敌 → false', shouldWarriorWhirlwind({
    enemies: [mkEnemy(100, 0)], cx: 0, cy: 0, range: 205, minTargets: 2,
}) === false);
check('风车触发：范围外不算', shouldWarriorWhirlwind({
    enemies: [mkEnemy(100, 0), mkEnemy(300, 0)], cx: 0, cy: 0, range: 205, minTargets: 2,
}) === false);
check('伊莉丝 AI 配置风车目标数', elise.aiConfig && elise.aiConfig.whirlwindMinTargets === 2);

// --- 剑盾防御受击：hold 期持盾减伤 + 常态弹反（镜像玩家 ShieldSystem） ---
const eliseDef = new Companion(eliseArchive);
eliseDef.equipments.offhand = { name: '小圆盾', weaponType: 'shield', defense: { damageReduction: 0.5, parryStun: 2000, parryKnockback: 100 } };
eliseDef.data.hp = 100;
eliseDef._defending = true; // hold 期由 CompanionAI 置位
const meleeAttacker = { _faction: 'enemy', _attackTimer: 100, x: 0, y: 50, applyStun() {}, applyKnockback() {} };
const defHit = eliseDef.takeDamage(50, meleeAttacker, 'physical', true);
check('防御中承伤 50%（damageReduction 0.5）', Math.abs(defHit.damage - 25) < 1e-9 && defHit.parried === true);
check('防御中常态弹反：打断敌方攻击', meleeAttacker._attackTimer === 0);
const eliseDef2 = new Companion(eliseArchive);
eliseDef2.data.hp = 100;
const plainHit = eliseDef2.takeDamage(50, null);
check('未防御照常承伤', plainHit.damage === 50 && plainHit.parried === false);

// --- 伊莉丝技能：剑精通 + 持盾防御（配置已挂载，修炼/升级链路） ---
check('伊莉丝已配置剑精通', !!elise.skills.swordMastery && elise.skills.swordMastery.name === '剑精通');
check('伊莉丝已配置持盾防御', !!elise.skills.shieldDefense && elise.skills.shieldDefense.name === '持盾防御');
const smExp0 = elise.skills.swordMastery.exp;
check('剑精通修炼加经验', grantSkillExp(elise, 'swordMastery', 50) === false
    && elise.skills.swordMastery.exp === smExp0 + 50);
check('剑精通修炼升级', grantSkillExp(elise, 'swordMastery', elise.skills.swordMastery.maxExp) === true
    && elise.skills.swordMastery.level >= 2);
let sdGuard = 0;
while (elise.skills.shieldDefense.level < 3 && sdGuard++ < 30) {
    grantSkillExp(elise, 'shieldDefense', elise.skills.shieldDefense.maxExp);
}
check('持盾防御修炼升级（可到 Lv3）', elise.skills.shieldDefense.level >= 3,
    `lv=${elise.skills.shieldDefense.level}`);
check('剑精通升级回调应用敏捷（dexBonus）', elise.data.dex >= 8 + elise.skills.swordMastery.level,
    `dex=${elise.data.dex} lv=${elise.skills.swordMastery.level}`);
const eliseSkillSer = elise.serialize();
const eliseSkillRestored = Companion.fromSerialized(eliseSkillSer);
check('伊莉丝技能序列化保留等级', eliseSkillRestored.skills.swordMastery.level === elise.skills.swordMastery.level
    && eliseSkillRestored.skills.shieldDefense.level === elise.skills.shieldDefense.level
    && eliseSkillRestored.skills.swordMastery.getEffect !== undefined);
// 队友技能修炼助手（companion-safe，不触发玩家 SkillManager）
const lunaSkillExp0 = lunaC.skills.iceSpike.exp;
grantCompanionSkillExp(lunaC, 'iceSpike', 20);
check('队友技能修炼助手加经验', lunaC.skills.iceSpike.exp === lunaSkillExp0 + 20);

// --- 露娜魔法修炼/升级（火球/冰锥/闪电，10 级解锁圣光后也可修炼） ---
check('露娜有火球', !!lunaC.skills.fireball && !!lunaC.skills.iceSpike && !!lunaC.skills.lightningStrike);
const lunaMagicGuard = { fireball: 0, iceSpike: 0, lightningStrike: 0, holyLight: 0 };
const lvlMagic = (id) => {
    const sk = lunaC.skills[id];
    let g = 0;
    while (sk.level < 2 && g++ < 30) grantSkillExp(lunaC, id, sk.maxExp);
    return sk.level;
};
check('露娜火球可修炼升级', lvlMagic('fireball') >= 2, `lv=${lunaC.skills.fireball.level}`);
check('露娜冰锥可修炼升级', lvlMagic('iceSpike') >= 2, `lv=${lunaC.skills.iceSpike.level}`);
check('露娜闪电可修炼升级', lvlMagic('lightningStrike') >= 2, `lv=${lunaC.skills.lightningStrike.level}`);
check('露娜 10 级解锁圣光', !!lunaC.skills.holyLight);
check('露娜圣光可修炼升级', lvlMagic('holyLight') >= 2, `lv=${lunaC.skills.holyLight.level}`);
const lunaMagicSer = lunaC.serialize();
const lunaMagicRestored = Companion.fromSerialized(lunaMagicSer);
check('露娜魔法序列化保留等级', lunaMagicRestored.skills.fireball.level === lunaC.skills.fireball.level
    && lunaMagicRestored.skills.holyLight.level === lunaC.skills.holyLight.level
    && typeof lunaMagicRestored.skills.fireball.getEffect === 'function');

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
