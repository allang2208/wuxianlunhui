import { ItemDatabase } from '../items/item-database.js';
import { Game } from '../game.js';
// Equip Tooltip System - Extracted from EquipManager
// Pure functions for rendering and managing equipment tooltips

import { FloatingTextEffect } from '../effects/floating-text.js';
import { CraftSystem } from './craft-system.js';
import { EnhanceSystem } from './enhance-system.js';
import { UIState } from './ui-state.js';
import { getAmmoConfig, getFireMode } from '../config/gun-ammo.js';
import { CRAFT_EFFECT_REGISTRY, getCraftEffectDisplay } from '../config/craft-effect-registry.js';

import { EffectManager } from '../effects/effect-manager.js';
import { queryAllElements, getElement } from '../utils/dom-utils.js';
import { CodexManager } from './codex-manager.js';

export const EquipTooltipManager = {
    player: null,
    backpackItems: null,
    callbacks: {},

    init(options) {
        this.player = options.player || null;
        this.backpackItems = options.backpackItems || null;
        this.callbacks = {
            unequip: options.unequip || (() => false),
            equipFromBackpack: options.equipFromBackpack || (() => {}),
            showSplitDialog: options.showSplitDialog || (() => {}),
            triggerEquipFlash: options.triggerEquipFlash || (() => {}),
            triggerBackpackFlash: options.triggerBackpackFlash || (() => {})
        };
    },

    renderTooltip(item) {
        const ttName = getElement('ttName');
        const ttType = getElement('ttType');
        const ttStats = getElement('ttStats');
        const ttExtra = getElement('ttExtra');
        const ttDesc = getElement('ttDesc');
        if (!ttName || !ttType || !ttStats || !ttExtra || !ttDesc) return;
         // Cache bust
        // 从 CodexManager 合并完整的武器数据
        const codexItem = (CodexManager && CodexManager.getItemByName) ? CodexManager.getItemByName(item.name) : null;
        // 安全初始化 fullItem
        let fullItem = {};
        try {
            fullItem = codexItem ? { ...codexItem } : { ...(item || {}) };
        } catch (_e) {
            fullItem = { ...(item || {}) };
        }
        if (codexItem && item) {
            // 用 item 的 stats 值覆盖 codexItem 的 stats 值（如动态计算后的物理攻击）
            if (item.stats && Array.isArray(item.stats) && fullItem.stats && Array.isArray(fullItem.stats)) {
                // 深拷贝 stats 数组，避免修改共享的 codexItem.stats 引用
                fullItem.stats = JSON.parse(JSON.stringify(fullItem.stats));
                const itemStatsMap = new Map();
                for (const s of item.stats) {
                    const key = (s.name || s.label || '').trim();
                    if (key) itemStatsMap.set(key, s);
                }
                for (let i = 0; i < fullItem.stats.length; i++) {
                    const fs = fullItem.stats[i];
                    const key = (fs.label || fs.name || '').trim();
                    if (key && itemStatsMap.has(key)) {
                        const itemStat = itemStatsMap.get(key);
                        fullItem.stats[i] = { ...fs, value: itemStat.value, pos: itemStat.pos };
                    }
                }
            }
            // 保留 item 中独有的运行时字段（如 slot、backpackSlot、itemId 等）
            for (const key of Object.keys(item)) {
                if (item[key] !== undefined && item[key] !== null && item[key] !== '') {
                    if (fullItem[key] === undefined || fullItem[key] === null || fullItem[key] === '') {
                        fullItem[key] = item[key];
                    }
                }
            }
        }
        // 稀有度颜色绑定
        const rarityColorMap = { common: '#c0c0c0', uncommon: '#7aff7a', rare: '#7a9aff', epic: '#c67aff' };
        const rarityLabelMap = { common: '普通', uncommon: '优质', rare: '稀有', epic: '史诗' };
        const rarityKey = fullItem.rarity || 'common';
        const rarityLabel = rarityLabelMap[rarityKey] || rarityKey;
        const rarityColor = rarityColorMap[rarityKey] || '#ffffff';
        ttName.innerHTML = fullItem.name + ((fullItem.enhanceLevel || 0) > 0 ? `<span class="tt-enhanced-badge">已强化 +${fullItem.enhanceLevel}</span>` : '');
        ttType.innerHTML = fullItem.type + (fullItem.rarity ? ` | <span style="color:${rarityColor};font-weight:700;">${rarityLabel}</span>` : '') + (fullItem.level ? ` | Lv.${fullItem.level}` : '');
        // 属性列表
        let statsHtml = '';
        if (fullItem.stats && fullItem.stats.length > 0) {
            statsHtml = fullItem.stats.map(s => {
                const statName = s.name || s.label;
                if (!statName) return '';
                let value = s.value;
                // 所有武器攻击力显示计算后的数值
                if (statName === '物理攻击' && Game.player && Game.player.getCurrentWeaponAtk) {
                    const computed = Game.player.getCurrentWeaponAtk(fullItem);
                    if (computed > 0) value = computed;
                }
                return `<div class="tt-stat"><span class="tt-stat-name">${statName}</span><span class="tt-stat-val ${s.pos ? 'pos' : ''}">${value}</span></div>`;
            }).join('');
        }
        ttStats.innerHTML = statsHtml;
        // 额外属性
        let extraHtml = '';
        if (fullItem.category) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">分类</span><span class="tt-stat-val">${fullItem.category}</span></div>`;
        if (fullItem.weaponTypeTag) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器类型</span><span class="tt-stat-val">${fullItem.weaponTypeTag}</span></div>`;
        else if (fullItem.weaponType) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器类型</span><span class="tt-stat-val">${fullItem.weaponType}</span></div>`;
        if (fullItem.equipSlot) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">装备槽位</span><span class="tt-stat-val">${fullItem.equipSlot}</span></div>`;
        if (fullItem.weaponId) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器ID</span><span class="tt-stat-val">${fullItem.weaponId}</span></div>`;
        if (fullItem.weaponCategory) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">武器分类</span><span class="tt-stat-val">${fullItem.weaponCategory}</span></div>`;
        // 武器攻击参数：只要有武器ID或武器类型，就显示攻击参数
        const isWeapon = fullItem.weaponId || (fullItem.category && fullItem.category.includes('weapon')) || fullItem.weaponType;
        if (isWeapon) {
            if (fullItem.weaponType === 'shield') {
                extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">🛡 防御参数</span></div>`;
                const defenseData = item.defense || fullItem.defense || (codexItem ? codexItem.defense : null);
                if (defenseData) {
                    const el = (item.enhanceLevel || fullItem.enhanceLevel || 0);
                    const baseDef = defenseData.base || 0;
                    const perEnhance = defenseData.perEnhance || 0;
                    const totalDef = baseDef + el * perEnhance;
                    const defFormula = `${totalDef}（基础 ${baseDef} + 强化等级 × ${perEnhance}）`;
                    extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">防御力公式</span><span class="tt-stat-val">${defFormula}</span></div>`;
                    extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">防御减少伤害</span><span class="tt-stat-val">${(defenseData.damageReduction * 100).toFixed(0)}%</span></div>`;
                    extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">防御受击体力</span><span class="tt-stat-val">${defenseData.staminaCost || '-'}</span></div>`;
                    extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">弹反眩晕时间</span><span class="tt-stat-val">${(defenseData.parryStun / 1000).toFixed(1)}秒</span></div>`;
                }
                extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">✨ 防具特效</span></div>`;
                extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">特效</span><span class="tt-stat-val">暂无</span></div>`;
            } else {
                extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">🎯 攻击参数</span></div>`;
            // 攻击力计算公式（含强化等级）
            const el = (item.enhanceLevel || fullItem.enhanceLevel || 0);
            let atkFormula = this._buildFormulaDisplay(fullItem.attackFormula, el, fullItem._craftEffects);
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击力公式</span><span class="tt-stat-val">${atkFormula || '-'}</span></div>`;
            // 从 codexItem 或 fullItem 获取 attack 数据，如没有则尝试 ItemDatabase
            let attackParams = item.attack || fullItem.attack || (codexItem ? codexItem.attack : null);
            if (!attackParams && ItemDatabase && ItemDatabase.items) {
                const dbItem = Object.values(ItemDatabase.items).find(i => i.name === fullItem.name);
                attackParams = dbItem ? dbItem.attack : null;
            }
            // 获取实时改造效果（用于动态计算所有数值）
            const ce = fullItem._craftEffects || null;
            const rangeDelta = ce?.rangeDelta || 0;
            const knockbackDelta = ce?.knockbackDelta || 0;
            const baseRange = (attackParams && attackParams.range) ? attackParams.range : 0;
            const effectiveRange = baseRange + rangeDelta;
            const baseKnockback = (attackParams && attackParams.knockback !== undefined) ? attackParams.knockback : null;
            const effectiveKnockback = baseKnockback !== null ? baseKnockback + knockbackDelta : null;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击距离</span><span class="tt-stat-val">${effectiveRange > 0 ? effectiveRange + 'px' : '-'}</span></div>`;
            // 远程武器显示子弹速度
            if (fullItem.category === 'weapon_ranged') {
                const bulletSpeedVal = (attackParams && (attackParams.bulletSpeed !== undefined ? attackParams.bulletSpeed : attackParams.projectileSpeed));
                extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">子弹速度</span><span class="tt-stat-val">${bulletSpeedVal !== undefined && bulletSpeedVal !== null ? bulletSpeedVal + 'px/s' : '-'}</span></div>`;
            }
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击间隔</span><span class="tt-stat-val">${attackParams && attackParams.attackInterval ? attackParams.attackInterval + 'ms' : '-'}</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">命中类型</span><span class="tt-stat-val">${attackParams && attackParams.hitType ? attackParams.hitType : '-'}</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">伤害类型</span><span class="tt-stat-val">${attackParams && attackParams.damageType ? attackParams.damageType : '-'}</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">击退距离</span><span class="tt-stat-val">${effectiveKnockback !== null ? effectiveKnockback + 'px' : '-'}</span></div>`;
            // 武器参数（仅枪械类）
            const isGun = fullItem.ammoConfig && fullItem.category === 'weapon_ranged';
            if (isGun) {
                extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">🔫 武器参数</span></div>`;
                const ammoCap = getAmmoConfig(fullItem);
                if (ammoCap) {
                    if (ammoCap.max === Infinity) {
                        extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">子弹数</span><span class="tt-stat-val">无限</span></div>`;
                    } else {
                        const effectiveMax = ammoCap.max + (ce?.magazineDelta || 0);
                        const effectiveReloadTime = ammoCap.reloadTime + (ce?.reloadTimeDelta || 0);
                        extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">子弹数</span><span class="tt-stat-val">${effectiveMax}发</span></div>`;
                        extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">换弹时间</span><span class="tt-stat-val">${effectiveReloadTime}ms</span></div>`;
                    }
                }
                extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">射程</span><span class="tt-stat-val">${effectiveRange > 0 ? effectiveRange + 'px' : '-'}</span></div>`;
                // 散布参数：散弹枪与其他枪械不同
                if (fullItem.weaponType === 'shotgun') {
                    if (ce && ce.slugMode) {
                        // 独头弹模式：显示每次射击散布增加和后坐力恢复时间
                        const baseShotSpread = 5;
                        const shotSpread = Math.max(0, baseShotSpread + (ce.shotSpreadDelta || 0));
                        const baseRecovery = 500;
                        const recovery = Math.max(100, baseRecovery + (ce.slugRecoilRecovery || 0));
                        extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">每次射击散布增加</span><span class="tt-stat-val">+${shotSpread}°</span></div>`;
                        extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">后坐力恢复时间</span><span class="tt-stat-val">${recovery}ms</span></div>`;
                    } else {
                        // 普通散弹枪模式：保持原有散布角度显示
                        let spreadAngle = 20; // 基础散布角度（普通模式每发弹丸±20°）
                        if (ce && ce.maxSpreadAngleDelta) {
                            spreadAngle += ce.maxSpreadAngleDelta;
                        }
                        if (spreadAngle < 0) spreadAngle = 0;
                        extraHtml += `<div class="tt-extra-row" id="tt-spread-angle"><span class="tt-stat-name">散布角度</span><span class="tt-stat-val" id="tt-spread-angle-val">±${spreadAngle}°</span></div>`;
                    }
                    // 箭型弹改造词条
                    if (ce && ce.flechetteMode) {
                        const piercing = 1 + (ce.piercingBonus || 0);
                        extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">穿透目标</span><span class="tt-stat-val">${piercing}个</span></div>`;
                    }
                } else if (getFireMode(fullItem) === 'semiAuto') {
                    // 半自动武器（沙漠之鹰等）：显示每次射击散布增加和后坐力恢复时间
                    const baseShotSpread = 5;
                    const shotSpread = Math.max(0, baseShotSpread + (ce?.shotSpreadDelta || 0));
                    const baseRecovery = 500;
                    const recovery = Math.max(100, baseRecovery + (ce?.recoilRecoveryDelta || 0));
                    extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">每次射击散布增加</span><span class="tt-stat-val">+${shotSpread}°</span></div>`;
                    extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">后坐力恢复时间</span><span class="tt-stat-val">${recovery}ms</span></div>`;
                } else {
                    // 其他枪械（全自动）：渐进式散布（从配置读取）
                    const sp = fullItem.spreadParams || { startDelay: 500, maxTime: 4000, maxAngle: 25 };
                    let spreadStart = sp.startDelay || 500;
                    let spreadMax = sp.maxTime || 4000;
                    let spreadAngle = sp.maxAngle || 25;
                    const effectiveSpreadStart = spreadStart + (ce?.spreadStartDelta || 0);
                    const effectiveSpreadMax = spreadMax + (ce?.spreadTimeDelta || 0);
                    const effectiveSpreadAngle = spreadAngle + (ce?.maxSpreadAngleDelta || 0);
                    extraHtml += `<div class="tt-extra-row" id="tt-spread-start"><span class="tt-stat-name">散布开始时间</span><span class="tt-stat-val" id="tt-spread-start-val">${effectiveSpreadStart > 0 ? (effectiveSpreadStart/1000).toFixed(1) + '秒' : '即时'}</span></div>`;
                    extraHtml += `<div class="tt-extra-row" id="tt-spread-max"><span class="tt-stat-name">达到最大散布时间</span><span class="tt-stat-val" id="tt-spread-max-val">${(effectiveSpreadMax/1000).toFixed(1)}秒</span></div>`;
                    extraHtml += `<div class="tt-extra-row" id="tt-spread-angle"><span class="tt-stat-name">最大散布角度</span><span class="tt-stat-val" id="tt-spread-angle-val">±${effectiveSpreadAngle}°</span></div>`;
                    // 能量轻机枪：特殊参数（从 energyLMGParams 配置读取）
                    if (fullItem.energyLMGParams) {
                        const elp = fullItem.energyLMGParams;
                        const ohTime = (elp.overheatTime / 1000) + ((ce?.overheatTimeDelta || 0) / 1000);
                        const ohRecover = (elp.overheatRecoverTime / 1000) + ((ce?.overheatRecoverDelta || 0) / 1000);
                        const rampUp = (elp.rampUpTime / 1000);
                        extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">过热时间</span><span class="tt-stat-val">${ohTime.toFixed(1)}秒</span></div>`;
                        extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">过热恢复时间</span><span class="tt-stat-val">${ohRecover.toFixed(1)}秒</span></div>`;
                        extraHtml += `<div class="tt-extra-row" id="tt-ramp-up"><span class="tt-stat-name">达到最大射速时间</span><span class="tt-stat-val">${rampUp.toFixed(1)}秒</span></div>`;
                    }
                    // 实时散布状态（仅当玩家装备该武器时显示）
                    extraHtml += `<div class="tt-extra-row" id="tt-spread-live" style="display:none;"><span class="tt-stat-name">当前散布</span><span class="tt-stat-val" id="tt-spread-live-val">0%</span></div>`;
                }
                // 武器特效
                let effectsHtml = '';
                if (fullItem.isTwoHanded && ['pkm', 'akm', 'qbz191', 'qjb201', 'energy_lmg'].includes(fullItem.weaponType)) {
                    const baseReduction = 0.50;
                    const effectiveReduction = Math.max(0, baseReduction - (ce?.moveSpeedPercent || 0));
                    const pct = Math.round(effectiveReduction * 100);
                    effectsHtml += `<div class="tt-extra-row"><span class="tt-stat-name">移动速度</span><span style="color:#ff0000;font-weight:700;">-${pct}%</span></div>`;
                }
                // 机枪类：显示过热时间（从 heatParams 或 energyLMGParams 读取）
                const heatSource = fullItem.heatParams || fullItem.energyLMGParams;
                if (heatSource) {
                    const ohTime = (heatSource.overheatTime / 1000) + ((ce?.overheatTimeDelta || 0) / 1000);
                    effectsHtml += `<div class="tt-extra-row"><span class="tt-stat-name">过热时间</span><span class="tt-stat-val">${ohTime.toFixed(1)}秒</span></div>`;
                }
                if (fullItem.weaponType === 'pistol' && Game.player && Game.player.skills && Game.player.skills.pistolMastery) {
                    const pm = Game.player.skills.pistolMastery;
                    const speedBonus = pm.getEffect(pm.level).speedPercent;
                    effectsHtml += `<div class="tt-extra-row"><span class="tt-stat-name">移动速度</span><span style="color:#00ff00;font-weight:700;">+${(speedBonus*100).toFixed(0)}%</span></div>`;
                }
                if (effectsHtml) {
                    extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">✨ 武器特效</span></div>`;
                    extraHtml += effectsHtml;
                }
            }
        }
    }
    // 特殊攻击信息：只显示伤害类型、伤害公式、持续时间、冷却时间
        if (fullItem && (fullItem.specialAttack || (codexItem && codexItem.specialAttack))) {
            const sa = fullItem.specialAttack || (codexItem && codexItem.specialAttack);
            const icon = fullItem.specialAttackType === 'nightFlame' ? '🔥' : (fullItem.specialAttackType === 'runeSword' ? '⚔' : (fullItem.specialAttackType === 'knightsSword' ? '🗡' : '✨'));
            const name = fullItem.specialAttackType === 'nightFlame' ? '夜与火之剑' : (fullItem.specialAttackType === 'runeSword' ? '符文长剑' : (fullItem.specialAttackType === 'knightsSword' ? '骑士长剑' : '特殊攻击'));
            extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">${icon} 特殊攻击：${name}</span></div>`;
            if (sa.damageType) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">伤害类型</span><span class="tt-stat-val">${sa.damageType}</span></div>`;
            if (sa.damageFormula) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">伤害公式</span><span class="tt-stat-val">${sa.damageFormula}</span></div>`;
            if (sa.duration) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">持续时间</span><span class="tt-stat-val">${sa.duration}秒</span></div>`;
            if (sa.cooldown !== undefined) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">冷却时间</span><span class="tt-stat-val">${sa.cooldown}秒</span></div>`;
        }
        // 符文长剑特殊攻击（未在 specialAttack 字段中定义，通过 weaponId 识别）
        if (fullItem.specialAttackType === 'runeSword') {
            extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">⚔ 特殊攻击：符文长剑</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">效果</span><span class="tt-stat-val">生成4把悬浮符文剑，右键发射</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">伤害类型</span><span class="tt-stat-val">魔法</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">伤害公式</span><span class="tt-stat-val">⌊(物理攻击+魔法攻击)×1.2⌋</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">持续时间</span><span class="tt-stat-val">30秒</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">冷却时间</span><span class="tt-stat-val">15秒</span></div>`;
        }
        // 骑士长剑冲刺突刺（通过 skillOverrides 识别）
        if (fullItem.skillOverrides && fullItem.skillOverrides.dashAttackThrust) {
            const so = fullItem.skillOverrides.dashAttackThrust;
            extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">🗡 冲刺突刺</span></div>`;
            if (so.animation && so.animation.dashDist) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">冲刺距离</span><span class="tt-stat-val">${so.animation.dashDist}px</span></div>`;
            if (so.hitCheck) {
                extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">判定形状</span><span class="tt-stat-val">${so.hitCheck.shape === 'rectangle' ? '矩形' : so.hitCheck.shape}</span></div>`;
                if (so.hitCheck.length) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">判定长度</span><span class="tt-stat-val">${so.hitCheck.length}px</span></div>`;
                if (so.hitCheck.width) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">判定宽度</span><span class="tt-stat-val">${so.hitCheck.width}px</span></div>`;
            }
        }
        // 消耗品效果显示
        if (fullItem.category === 'consumable' && fullItem.effect) {
            extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">✨ 使用效果</span></div>`;
            const eff = fullItem.effect;
            if (eff.type === 'heal') {
                extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">恢复类型</span><span class="tt-stat-val">生命值</span></div>`;
                extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">恢复公式</span><span class="tt-stat-val">最大生命×20% + 体质×2</span></div>`;
            } else if (eff.type === 'mana') {
                extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">恢复类型</span><span class="tt-stat-val">魔法值</span></div>`;
                extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">恢复公式</span><span class="tt-stat-val">最大魔法×20% + 智力×10% + 精神×10%</span></div>`;
            }
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">使用方式</span><span class="tt-stat-val">右键点击 / 拖入快捷栏</span></div>`;
        }
        if (fullItem.stack > 1) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">堆叠数量</span><span class="tt-stat-val">${fullItem.stack}</span></div>`;
        ttExtra.innerHTML = extraHtml;
        ttDesc.textContent = fullItem.desc || '';
        // ===== 改造详情面板（左侧） =====
        const ttCraft = getElement('ttCraft');
        if (ttCraft) {
            const weaponId = fullItem.weaponId;
            const hasCraft = fullItem._craftData && Object.keys(fullItem._craftData).length > 0;
            if (hasCraft) {
                const itemMods = fullItem._craftData;
                let craftHtml = '<div class="tt-craft-title">🔧 改造项目</div>';
                // 获取改造配置
                const weaponConfig = CraftSystem._getCraftConfig(weaponId);
                for (const slotId in itemMods) {
                    const modId = itemMods[slotId];
                    const slotOpts = weaponConfig && weaponConfig.options ? weaponConfig.options[slotId] : null;
                    if (slotOpts) {
                        const opt = slotOpts.find(o => o.id === modId);
                        if (opt) {
                            craftHtml += `<div class="tt-craft-row"><div class="tt-craft-left"><span class="tt-craft-icon">${opt.icon}</span><span class="tt-craft-name">${opt.name}</span></div><span class="tt-craft-desc">${opt.desc || ''}</span></div>`;
                        }
                    }
                }
                // 合计改造数值（使用 Craft Effect Registry 动态生成）
                const effects = fullItem._craftEffects || null;
                if (effects) {
                    let summaryHtml = '<div class="tt-craft-summary"><div class="tt-craft-summary-title">📊 合计改造数值</div>';
                    let hasSummary = false;
                    for (const [name, value] of Object.entries(effects)) {
                        if (value === undefined || value === null || value === false || value === 0) continue;
                        const reg = CRAFT_EFFECT_REGISTRY[name];
                        if (!reg) continue;
                        hasSummary = true;
                        const display = getCraftEffectDisplay(name, value);
                        const colorClass = (typeof value === 'number' && value < 0) ? 'tt-craft-stat-neg' : 'tt-craft-stat-pos';
                        const categoryLabel = { damage: '伤害', range: '射程', mobility: '机动', ammo: '弹药', spread: '散布', overheat: '过热', defense: '防御', special: '特殊', mode: '模式' }[reg.category] || '属性';
                        summaryHtml += `<div class="tt-craft-row"><span class="tt-craft-name">${categoryLabel}</span><span class="${colorClass}">${display}</span></div>`;
                    }
                    summaryHtml += '</div>';
                    if (hasSummary) craftHtml += summaryHtml;
                }
                ttCraft.innerHTML = craftHtml;
                ttCraft.classList.add('visible');
            } else {
                ttCraft.innerHTML = '';
                ttCraft.classList.remove('visible');
            }
        }
        // ===== 附魔详情面板（左侧） =====
        const ttEnchant = getElement('ttEnchant');
        if (ttEnchant) {
            const hasEnchant = fullItem._isEnchanted && fullItem._enchantData;
            if (hasEnchant) {
                let enchantHtml = '<div class="tt-enchant-title">✨ 附魔效果</div>';
                const ed = fullItem._enchantData;
                const ee = fullItem._enchantEffects || {};
                // 显示前缀+后缀名称
                let nameHtml = '';
                if (ed.prefix) nameHtml += `<span class="enchant-prefix">${ed.prefix.name}</span> `;
                nameHtml += fullItem.name;
                if (ed.suffix) nameHtml += ` <span class="enchant-suffix">${ed.suffix.name}</span>`;
                enchantHtml += `<div class="tt-enchant-row"><span class="tt-enchant-name">${nameHtml}</span></div>`;
                // 显示效果
                const effectMap = [
                    { key: 'damagePercent', name: '攻击力', fmt: v => `+${(v*100).toFixed(0)}%` },
                    { key: 'attackIntervalMul', name: '攻击间隔', fmt: v => `×${v.toFixed(2)}` },
                    { key: 'critRate', name: '暴击率', fmt: v => `+${(v*100).toFixed(0)}%` },
                    { key: 'poisonOnHit', name: '特殊效果', fmt: () => '攻击叠加中毒' },
                    { key: 'piercingBonus', name: '穿透目标', fmt: v => `+${v}` },
                ];
                for (const stat of effectMap) {
                    const val = ee[stat.key];
                    if (val !== undefined && val !== false) {
                        enchantHtml += `<div class="tt-enchant-row"><span class="tt-enchant-effect">${stat.name}: ${stat.fmt(val)}</span></div>`;
                    }
                }
                ttEnchant.innerHTML = enchantHtml;
                ttEnchant.classList.add('visible');
            } else {
                ttEnchant.innerHTML = '';
                ttEnchant.classList.remove('visible');
            }
        }
        // 实时散布数据更新循环已移除（可能导致浮窗问题）
    },
    _positionTooltip(e) {
        const tooltip = getElement('equipTooltip');
        if (!tooltip) return;
        const ttCraft = getElement('ttCraft');
        const ttEnchant = getElement('ttEnchant');
        const hasCraft = ttCraft && ttCraft.classList.contains('visible');
        const hasEnchant = ttEnchant && ttEnchant.classList.contains('visible');
        const craftW = hasCraft ? 486 : 0; // 480px + 6px margin
        const enchantW = hasEnchant ? 186 : 0; // 180px + 6px margin
        const tw = 360 + craftW + enchantW;
        let left = e.clientX - tw - 10;
        let top = e.clientY + 10;
        // 先临时设置位置并获取实际高度
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
        const th = tooltip.offsetHeight || 280;
        // 水平边界检测：默认在鼠标左侧，若左侧空间不足则放右侧
        if (left < 10) left = e.clientX + 10;
        if (left + tw > window.innerWidth - 10) left = window.innerWidth - tw - 10;
        // 垂直边界检测：优先在鼠标下方，若下方空间不足则放上方
        if (top + th > window.innerHeight - 10) {
            top = e.clientY - th - 10;
        }
        // 若上方也超出，则强制限制在视口内
        if (top < 10) top = 10;
        tooltip.style.left = left + 'px';
        tooltip.style.top = top + 'px';
        // 保存固定位置
        tooltip._fixedLeft = left;
        tooltip._fixedTop = top;
    },
    _removeMoveHandler(el) {
        if (el && el._ttMoveHandler) {
            document.removeEventListener('mousemove', el._ttMoveHandler);
            el._ttMoveHandler = null;
        }
    },
    bindEquipTooltip() {
        const tooltip = getElement('equipTooltip');
        const self = this;
        // 关闭按钮
        const closeBtn = getElement('ttCloseBtn');
        if (closeBtn) {
            closeBtn.onclick = function(e) {
                e.stopPropagation();
                tooltip.classList.remove('visible', 'pinned');
                tooltip._pinned = false;
            };
        }
        // 点击外部关闭
        document.addEventListener('click', function(e) {
            if (tooltip._pinned && !tooltip.contains(e.target) && !e.target.closest('.diablo-slot') && !e.target.closest('.inv-cell') && !e.target.closest('.shop-buy-cell') && !e.target.closest('.shop-sell-cell')) {
                tooltip.classList.remove('visible', 'pinned');
                tooltip._pinned = false;
            }
        });
        queryAllElements('.diablo-slot').forEach(slot => {
            slot.onmouseenter = function(e) {
                if (tooltip._pinned) return; // 固定时不响应hover
                const key = slot.dataset.slot;
                const item = self.player.equipments[key];
                if (!item) return;
                self.renderTooltip(item);
                tooltip.classList.add('visible');
                self._positionTooltip(e);
                slot._ttMoveHandler = self._positionTooltip;
                document.addEventListener('mousemove', slot._ttMoveHandler);
            };
            slot.onmouseleave = function() {
                if (tooltip._pinned) return; // 固定时不隐藏
                tooltip.classList.remove('visible');
                self._removeMoveHandler(slot);
            };
            slot.onclick = function(e) {
                const key = slot.dataset.slot;
                const item = self.player.equipments[key];
                if (!item) return;
                e.stopPropagation();
                if (tooltip._pinned) {
                    // 再次点击已固定的项，取消固定
                    tooltip.classList.remove('visible', 'pinned');
                    tooltip._pinned = false;
                } else {
                    // 固定显示
                    self.renderTooltip(item);
                    tooltip.classList.add('visible', 'pinned');
                    tooltip._pinned = true;
                    self._positionTooltip(e);
                    // 固定后移除mousemove监听器，不再跟随鼠标
                    self._removeMoveHandler(slot);
                }
            };
            slot.oncontextmenu = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const key = slot.dataset.slot;
                const item = self.player.equipments[key];
                const enchantPanel = getElement('enchantPanel');
                const enchantOpen = enchantPanel && enchantPanel.classList.contains('active');
                if (UIState.isOpen('enhance')) {
                    if (item) {
                        EnhanceSystem.equipFromSlot(key);
                    }
                    return;
                }
                if (enchantOpen) {
                    return;
                }
                if (self.callbacks.unequip(key)) {
                    EffectManager.add(new FloatingTextEffect(self.player.x, self.player.y - 20, '已卸下装备'));
                }
            };
            slot.ondblclick = function(_e) {
                const key = slot.dataset.slot;
                const item = self.player.equipments[key];
                const enchantPanel = getElement('enchantPanel');
                const enchantOpen = enchantPanel && enchantPanel.classList.contains('active');
                if (UIState.isOpen('enhance')) {
                    if (item) {
                        EnhanceSystem.equipFromSlot(key);
                    }
                    return;
                }
                if (enchantOpen) {
                    return;
                }
                // 默认行为：卸下装备
                if (self.callbacks.unequip(key)) {
                    EffectManager.add(new FloatingTextEffect(self.player.x, self.player.y - 20, '已卸下装备'));
                }
            };
        });
    },
    bindInventoryTooltip() {
        const tooltip = getElement('equipTooltip');
        const self = this;
        queryAllElements('.inv-cell').forEach(cell => {
            cell.onmouseenter = function(e) {
                if (tooltip._pinned) return;
                const idx = parseInt(cell.dataset.slot);
                const item = self.backpackItems.find(i => i.slot === idx);
                if (!item) return;
                self.renderTooltip(item);
                tooltip.classList.add('visible');
                self._positionTooltip(e);
                cell._ttMoveHandler = self._positionTooltip;
                document.addEventListener('mousemove', cell._ttMoveHandler);
            };
            cell.onmouseleave = function() {
                if (tooltip._pinned) return;
                tooltip.classList.remove('visible');
                self._removeMoveHandler(cell);
            };
            cell.onclick = function(e) {
                const idx = parseInt(cell.dataset.slot);
                const item = self.backpackItems.find(i => i.slot === idx);
                if (!item) return;
                e.stopPropagation();
                // Shift+点击：拆分堆叠物品
                if (e.shiftKey && item.stack > 1) {
                    e.preventDefault();
                    e.stopPropagation();
                    self.callbacks.showSplitDialog(item, idx);
                    return;
                }
                if (tooltip._pinned) {
                    tooltip.classList.remove('visible', 'pinned');
                    tooltip._pinned = false;
                } else {
                    self.renderTooltip(item);
                    tooltip.classList.add('visible', 'pinned');
                    tooltip._pinned = true;
                    self._positionTooltip(e);
                    // 固定后移除mousemove监听器，不再跟随鼠标
                    self._removeMoveHandler(cell);
                }
            };
            // 双击/右键装备已改为事件委托（EquipManager.init 中统一绑定），
            // 这里只负责提示框，避免重复绑定或绑定丢失。
        });
    },

    _buildFormulaDisplay(formula, el, craftEffects) {
        if (!formula) return '';
        let effectiveFormula = formula;
        if (craftEffects && craftEffects.slugMode && formula.variants && formula.variants.slugMode) {
            effectiveFormula = formula.variants.slugMode;
        }
        const base = (effectiveFormula.base || 0) + el * (effectiveFormula.enhanceFlat || 0);
        const parts = [`${base}`];
        const attrNames = { str: '力量', dex: '敏捷', int: '智力', con: '体质', wis: '精神' };
        for (const attr of effectiveFormula.attrs || []) {
            const coeff = attr.base + (attr.perEnhance || 0) * el;
            if (Math.abs(coeff) < 0.001) continue;
            const name = attrNames[attr.key] || attr.key;
            parts.push(`${coeff >= 0 ? '+' : '-'} ${name}×${Math.abs(coeff).toFixed(2)}`);
        }
        return parts.join(' ');
    },

};
