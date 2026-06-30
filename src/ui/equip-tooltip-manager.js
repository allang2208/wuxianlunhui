// Equip Tooltip System - Extracted from EquipManager
// Pure functions for rendering and managing equipment tooltips

import { CraftSystem } from './craft-system.js';
import { isSemiAuto } from '../config/gun-ammo.js';

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
        const ttName = document.getElementById('ttName');
        const ttType = document.getElementById('ttType');
        const ttStats = document.getElementById('ttStats');
        const ttExtra = document.getElementById('ttExtra');
        const ttDesc = document.getElementById('ttDesc');
        if (!ttName || !ttType || !ttStats || !ttExtra || !ttDesc) return;
        console.log('TOOLTIP V2 LOADED'); // Cache bust
        // 从 CodexManager 合并完整的武器数据
        const codexItem = (typeof CodexManager !== 'undefined' && CodexManager.getItemByName) ? CodexManager.getItemByName(item.name) : null;
        // 安全初始化 fullItem
        let fullItem = {};
        try {
            fullItem = codexItem ? { ...codexItem } : { ...(item || {}) };
        } catch (e) {
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
                if (statName === '物理攻击' && Game.player && Game.player.data) {
                    const d = Game.player.data;
                    let computed = 0;
                    if (fullItem.weaponId) {
                        const formulas = {
                            weapon1: Math.round(6 + d.str * 0.5 + d.dex * 0.5),
                            weapon2: Math.round(10 + d.str * 1 + d.dex * 0.5),
                            weapon3: Math.round(6 + d.dex * 0.35),
                            weapon14: Math.round(50 + d.dex * 2 + d.str * 1.5),
                            weapon4: Math.round(8 + d.str * 0.6 + d.int * 1),
                            weapon5: Math.round(12 + d.str * 1.2 + d.int * 1),
                            weapon6: Math.round(10 + d.str * 0.5 + d.wis * 0.35),
                            weapon7: Math.round(3 + d.str * 0.05 + d.wis * 0.15),
                            weapon8: Math.round(7 + d.str * 0.4 + d.wis * 0.45),
                            weapon9: Math.round(1 + d.dex * 0.05 + d.wis * 0.08),
                            weapon10: Math.round(30 + d.dex * 1 + d.wis * 2),
                            weapon11: Math.round(7 + d.str * 0.4 + d.wis * 0.45),
                            weapon12: Math.round(10 + d.con * 0.2 + d.wis * 0.5),
                            weapon13: Math.round(8 + d.con * 0.5 + d.wis * 0.25)
                        };
                        computed = formulas[fullItem.weaponId] || 0;
                    } else if (fullItem.weaponType === 'pistol' || fullItem.rangedType === 'pistol') {
                        computed = 6; // 手枪默认固定值
                    } else if (fullItem.weaponType === 'pkm') {
                        computed = Math.round(5 + d.str * 0.1 + d.stamina * 0.1);
                    } else if (fullItem.weaponType === 'akm') {
                        computed = Math.round(3 + d.str * 0.05 + d.wis * 0.15);
                    } else if (fullItem.weaponType === 'qbz191') {
                        computed = Math.round(3 + d.str * 0.04 + d.wis * 0.18);
                    }
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
            extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">🎯 攻击参数</span></div>`;
            // 攻击力计算公式（含强化等级）
            const el = (item.enhanceLevel || fullItem.enhanceLevel || 0);
            let atkFormula = '';
            if (fullItem.weaponId) {
                if (fullItem.weaponId === 'weapon1') {
                    atkFormula = `${6 + el} + 力量×${(0.5 + 0.02 * el).toFixed(2)} + 敏捷×${(0.5 + 0.02 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon2') {
                    atkFormula = `${10 + el} + 力量×${(1 + 0.02 * el).toFixed(2)} + 敏捷×${(0.5 + 0.02 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon3') {
                    atkFormula = `${6 + el} + 敏捷×${(0.35 + 0.02 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon14') {
                    atkFormula = `${50 + el * 10} + 敏捷×${(2 + 1.5 * el).toFixed(2)} + 力量×${(1.5 + 1.5 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon4') {
                    atkFormula = `${8 + el} + 力量×${(0.6 + 0.02 * el).toFixed(2)} + 智力×${(1 + 0.02 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon5') {
                    atkFormula = `${12 + el} + 力量×${(1.2 + 0.02 * el).toFixed(2)} + 智力×${(1 + 0.02 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon6') {
                    atkFormula = `${10 + el} + 力量×${(0.5 + 0.15 * el).toFixed(2)} + 精神×${(0.35 + 0.1 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon7') {
                    atkFormula = `${3 + el} + 力量×${(0.05 + 0.01 * el).toFixed(2)} + 精神×${(0.15 + 0.02 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon8') {
                    atkFormula = `${7 + el} + 力量×${(0.4 + 0.12 * el).toFixed(2)} + 精神×${(0.45 + 0.2 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon9') {
                    atkFormula = `${1 + el} + 敏捷×${(0.05 + 0.02 * el).toFixed(2)} + 精神×${(0.08 + 0.02 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon10') {
                    atkFormula = `${30} + ${el * 5} + 敏捷×${(1 + 1.25 * el).toFixed(2)} + 精神×${(2 + 2 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon11') {
                    atkFormula = `${7 + el} + 力量×${(0.4 + 0.12 * el).toFixed(2)} + 精神×${(0.45 + 0.2 * el).toFixed(2)}`;
                } else if (fullItem.weaponId === 'weapon12') {
                    const ce = fullItem._craftEffects;
                    if (ce && ce.slugMode) {
                        atkFormula = `${8 + el * 5} + 体质×${(0.6 + 0.05 * el).toFixed(2)} + 精神×${(1 + 0.1 * el).toFixed(2)}`;
                    } else {
                        atkFormula = `${10 + el} + 体质×${(0.2 + 0.10 * el).toFixed(2)} + 精神×${(0.5 + 0.15 * el).toFixed(2)}`;
                    }
                } else if (fullItem.weaponId === 'weapon13') {
                    const ce = fullItem._craftEffects;
                    if (ce && ce.slugMode) {
                        atkFormula = `${8 + el * 5} + 体质×${(0.6 + 0.05 * el).toFixed(2)} + 精神×${(1 + 0.1 * el).toFixed(2)}`;
                    } else {
                        atkFormula = `${8 + el} + 体质×${(0.5 + 0.15 * el).toFixed(2)} + 精神×${(0.25 + 0.10 * el).toFixed(2)}`;
                    }
                }
            } else if (fullItem.weaponType === 'pistol' || fullItem.rangedType === 'pistol') {
                atkFormula = '固定值 6';
            } else if (fullItem.weaponType === 'pkm') {
                atkFormula = `${10 + el} + 力量×${(0.5 + 0.15 * el).toFixed(2)} + 精神×${(0.35 + 0.1 * el).toFixed(2)}`;
            } else if (fullItem.weaponType === 'akm') {
                atkFormula = `${3 + el} + 力量×${(0.05 + 0.01 * el).toFixed(2)} + 精神×${(0.15 + 0.02 * el).toFixed(2)}`;
            } else if (fullItem.weaponType === 'qbz191') {
                atkFormula = `${3 + el} + 力量×${(0.04 + 0.01 * el).toFixed(2)} + 精神×${(0.18 + 0.02 * el).toFixed(2)}`;
            } else if (fullItem.weaponType === 'qjb201') {
                atkFormula = `${7 + el} + 力量×${(0.4 + 0.12 * el).toFixed(2)} + 精神×${(0.45 + 0.2 * el).toFixed(2)}`;
            }
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击力公式</span><span class="tt-stat-val">${atkFormula || '-'}</span></div>`;
            // 从 codexItem 或 fullItem 获取 attack 数据，如没有则尝试 ItemDatabase
            let attackParams = item.attack || fullItem.attack || (codexItem ? codexItem.attack : null);
            if (!attackParams && typeof ItemDatabase !== 'undefined' && ItemDatabase.items) {
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
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">攻击间隔</span><span class="tt-stat-val">${attackParams && attackParams.attackInterval ? attackParams.attackInterval + 'ms' : '-'}</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">命中类型</span><span class="tt-stat-val">${attackParams && attackParams.hitType ? attackParams.hitType : '-'}</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">伤害类型</span><span class="tt-stat-val">${attackParams && attackParams.damageType ? attackParams.damageType : '-'}</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">击退距离</span><span class="tt-stat-val">${effectiveKnockback !== null ? effectiveKnockback + 'px' : '-'}</span></div>`;
            // 武器参数（仅枪械类）
            const isGun = fullItem.weaponType === 'pistol' || fullItem.weaponType === 'pkm' || fullItem.weaponType === 'akm' || fullItem.weaponType === 'qbz191' || fullItem.weaponType === 'qjb201' || fullItem.weaponType === 'shotgun';
            if (isGun) {
                extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">🔫 武器参数</span></div>`;
                const ammoMap = { weapon6: { max: 75, reloadTime: 3500 }, weapon7: { max: 30, reloadTime: 1150 }, weapon8: { max: 30, reloadTime: 1000 }, weapon9: { max: 12, reloadTime: 750 }, weapon10: { max: 6, reloadTime: 1750 }, weapon11: { max: 60, reloadTime: 2000 }, weapon12: { max: 7, reloadTime: 400 }, weapon13: { max: 12, reloadTime: 2000 } };
                const ammoCap = ammoMap[fullItem.weaponId];
                if (ammoCap) {
                    const effectiveMax = ammoCap.max + (ce?.magazineDelta || 0);
                    const effectiveReloadTime = ammoCap.reloadTime + (ce?.reloadTimeDelta || 0);
                    extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">子弹数</span><span class="tt-stat-val">${effectiveMax}发</span></div>`;
                    extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">换弹时间</span><span class="tt-stat-val">${effectiveReloadTime}ms</span></div>`;
                }
                extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">射程</span><span class="tt-stat-val">${effectiveRange > 0 ? effectiveRange + 'px' : '-'}</span></div>`;
                // 弹速：优先从 EquipDataManager 获取完整数据，回退到 attackParams，最后硬编码默认值
                let baseProjectileSpeed = 0;
                const ed = (typeof window !== 'undefined' && window.EquipDataManager) ? window.EquipDataManager : null;
                if (ed) {
                    const edItem = Object.values(ed).find(v => v && v.weaponId === fullItem.weaponId);
                    if (edItem && edItem.attack && edItem.attack.projectileSpeed) {
                        baseProjectileSpeed = edItem.attack.projectileSpeed;
                    }
                }
                if (!baseProjectileSpeed && attackParams && attackParams.projectileSpeed) {
                    baseProjectileSpeed = attackParams.projectileSpeed;
                }
                if (!baseProjectileSpeed) {
                    const speedMap = { weapon6: 30, weapon7: 30, weapon8: 36, weapon9: 13, weapon10: 20, weapon11: 18 };
                    baseProjectileSpeed = speedMap[fullItem.weaponId] || 0;
                }
                const effectiveProjectileSpeed = baseProjectileSpeed > 0 ? Math.round(baseProjectileSpeed * (1 + (ce?.projectileSpeedPercent || 0))) : 0;
                extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">弹速</span><span class="tt-stat-val">${effectiveProjectileSpeed > 0 ? effectiveProjectileSpeed + 'px/帧' : '-'}</span></div>`;
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
                } else if (isSemiAuto(fullItem.weaponId)) {
                    // 半自动武器（沙漠之鹰等）：显示每次射击散布增加和后坐力恢复时间
                    const baseShotSpread = 5;
                    const shotSpread = Math.max(0, baseShotSpread + (ce?.shotSpreadDelta || 0));
                    const baseRecovery = 500;
                    const recovery = Math.max(100, baseRecovery + (ce?.recoilRecoveryDelta || 0));
                    extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">每次射击散布增加</span><span class="tt-stat-val">+${shotSpread}°</span></div>`;
                    extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">后坐力恢复时间</span><span class="tt-stat-val">${recovery}ms</span></div>`;
                } else {
                    // 其他枪械（全自动）：渐进式散布（所有枪械统一 0.5s 开始散布）
                    const spreadBaseMap = { pkm: { start: 500, max: 4000, angle: 25 }, akm: { start: 500, max: 4000, angle: 25 }, qbz191: { start: 500, max: 4000, angle: 25 }, qjb201: { start: 500, max: 4000, angle: 30 }, pistol: { start: 500, max: 4000, angle: 30 } };
                    const baseSpread = spreadBaseMap[fullItem.weaponType] || { start: 500, max: 4000, angle: 25 };
                    let spreadStart = baseSpread.start;
                    let spreadMax = baseSpread.max;
                    let spreadAngle = baseSpread.angle;
                    const effectiveSpreadStart = spreadStart + (ce?.spreadStartDelta || 0);
                    const effectiveSpreadMax = spreadMax + (ce?.spreadTimeDelta || 0);
                    const effectiveSpreadAngle = spreadAngle + (ce?.maxSpreadAngleDelta || 0);
                    extraHtml += `<div class="tt-extra-row" id="tt-spread-start"><span class="tt-stat-name">散布开始时间</span><span class="tt-stat-val" id="tt-spread-start-val">${effectiveSpreadStart > 0 ? (effectiveSpreadStart/1000).toFixed(1) + '秒' : '即时'}</span></div>`;
                    extraHtml += `<div class="tt-extra-row" id="tt-spread-max"><span class="tt-stat-name">达到最大散布时间</span><span class="tt-stat-val" id="tt-spread-max-val">${(effectiveSpreadMax/1000).toFixed(1)}秒</span></div>`;
                    extraHtml += `<div class="tt-extra-row" id="tt-spread-angle"><span class="tt-stat-name">最大散布角度</span><span class="tt-stat-val" id="tt-spread-angle-val">±${effectiveSpreadAngle}°</span></div>`;
                    // 实时散布状态（仅当玩家装备该武器时显示）
                    extraHtml += `<div class="tt-extra-row" id="tt-spread-live" style="display:none;"><span class="tt-stat-name">当前散布</span><span class="tt-stat-val" id="tt-spread-live-val">0%</span></div>`;
                }
                // 武器特效
                let effectsHtml = '';
                const twoHandedTypes = ['pkm', 'akm', 'qbz191', 'qjb201'];
                if (twoHandedTypes.includes(fullItem.weaponType)) {
                    const baseReduction = 0.50;
                    const effectiveReduction = Math.max(0, baseReduction - (ce?.moveSpeedPercent || 0));
                    const pct = Math.round(effectiveReduction * 100);
                    effectsHtml += `<div class="tt-extra-row"><span class="tt-stat-name">移动速度</span><span style="color:#ff0000;font-weight:700;">-${pct}%</span></div>`;
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
        // 特殊攻击信息：只显示伤害类型、伤害公式、持续时间、冷却时间
        if (fullItem && (fullItem.specialAttack || (codexItem && codexItem.specialAttack))) {
            const sa = fullItem.specialAttack || (codexItem && codexItem.specialAttack);
            const icon = fullItem.weaponId === 'weapon5' ? '🔥' : (fullItem.weaponId === 'weapon4' ? '⚔' : (fullItem.weaponId === 'weapon2' ? '🗡' : '✨'));
            const name = fullItem.weaponId === 'weapon5' ? '夜与火之剑' : (fullItem.weaponId === 'weapon4' ? '符文长剑' : (fullItem.weaponId === 'weapon2' ? '骑士长剑' : '特殊攻击'));
            extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">${icon} 特殊攻击：${name}</span></div>`;
            if (sa.damageType) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">伤害类型</span><span class="tt-stat-val">${sa.damageType}</span></div>`;
            if (sa.damageFormula) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">伤害公式</span><span class="tt-stat-val">${sa.damageFormula}</span></div>`;
            if (sa.duration) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">持续时间</span><span class="tt-stat-val">${sa.duration}秒</span></div>`;
            if (sa.cooldown !== undefined) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">冷却时间</span><span class="tt-stat-val">${sa.cooldown}秒</span></div>`;
        }
        // 符文长剑特殊攻击（未在 specialAttack 字段中定义，通过 weaponId 识别）
        if (fullItem.weaponId === 'weapon4') {
            extraHtml += `<div class="tt-extra-row" style="border-top:1px solid rgba(0,0,0,0.08);margin-top:4px;padding-top:4px;"><span class="tt-stat-name" style="font-weight:700;">⚔ 特殊攻击：符文长剑</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">效果</span><span class="tt-stat-val">生成4把悬浮符文剑，右键发射</span></div>`;
            extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">持续时间</span><span class="tt-stat-val">30秒</span></div>`;
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
        if (fullItem.stack > 1) extraHtml += `<div class="tt-extra-row"><span class="tt-stat-name">堆叠数量</span><span class="tt-stat-val">${fullItem.stack}</span></div>`;
        ttExtra.innerHTML = extraHtml;
        ttDesc.textContent = fullItem.desc || '';
        // ===== 改造详情面板（左侧） =====
        const ttCraft = document.getElementById('ttCraft');
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
                // 合计改造数值
                const effects = fullItem._craftEffects || null;
                if (effects) {
                    const statMap = [
                        { key: 'rangeDelta', name: '射程', fmt: v => v > 0 ? `+${v}px` : `${v}px` },
                        { key: 'knockbackDelta', name: '击退', fmt: v => v > 0 ? `+${v}px` : `${v}px` },
                        { key: 'spreadTimeDelta', name: '最大散布时间', fmt: v => v > 0 ? `+${v}ms` : `${v}ms` },
                        { key: 'spreadStartDelta', name: '散布开始时间', fmt: v => v > 0 ? `+${v}ms` : `${v}ms` },
                        { key: 'reloadTimeDelta', name: '换弹时间', fmt: v => v > 0 ? `+${v}ms` : `${v}ms` },
                        { key: 'magazineDelta', name: '弹夹容量', fmt: v => v > 0 ? `+${v}发` : `${v}发` },
                        { key: 'projectileSpeedPercent', name: '弹速', fmt: v => v > 0 ? `+${(v*100).toFixed(0)}%` : `${(v*100).toFixed(0)}%` },
                        { key: 'moveSpeedPercent', name: '移动速度', fmt: v => v > 0 ? `+${(v*100).toFixed(0)}%` : `${(v*100).toFixed(0)}%` },
                        { key: 'maxSpreadAngleDelta', name: '最大散布角度', fmt: v => v > 0 ? `+${v}°` : `${v}°` },
                        { key: 'damagePercent', name: '伤害', fmt: v => v > 0 ? `+${(v*100).toFixed(0)}%` : `${(v*100).toFixed(0)}%` },
                        { key: 'critChancePercent', name: '暴击率', fmt: v => v > 0 ? `+${(v*100).toFixed(0)}%` : `${(v*100).toFixed(0)}%` },
                        { key: 'slugRecoilRecovery', name: '后坐力恢复时间', fmt: v => v > 0 ? `+${v}ms` : `${v}ms` },
                    ];
                    let summaryHtml = '<div class="tt-craft-summary"><div class="tt-craft-summary-title">📊 合计改造数值</div>';
                    let hasSummary = false;
                    for (const stat of statMap) {
                        const val = effects[stat.key];
                        if (val && val !== 0) {
                            hasSummary = true;
                            const colorClass = val > 0 ? 'tt-craft-stat-pos' : 'tt-craft-stat-neg';
                            summaryHtml += `<div class="tt-craft-row"><span class="tt-craft-name">${stat.name}</span><span class="${colorClass}">${stat.fmt(val)}</span></div>`;
                        }
                    }
                    if (effects.hideMuzzleFlash) {
                        hasSummary = true;
                        summaryHtml += `<div class="tt-craft-row"><span class="tt-craft-name">枪口火焰</span><span class="tt-craft-stat-pos">隐藏</span></div>`;
                    }
                    if (effects.highPowerScope) {
                        hasSummary = true;
                        summaryHtml += `<div class="tt-craft-row"><span class="tt-craft-name">瞄准模式</span><span class="tt-craft-stat-pos">高倍镜 (3x)</span></div>`;
                    }
                    if (effects.redDotScope) {
                        hasSummary = true;
                        summaryHtml += `<div class="tt-craft-row"><span class="tt-craft-name">瞄准模式</span><span class="tt-craft-stat-pos">红点 (1x)</span></div>`;
                    }
                    if (effects.slugMode) {
                        hasSummary = true;
                        summaryHtml += `<div class="tt-craft-row"><span class="tt-craft-name">射击模式</span><span class="tt-craft-stat-pos">独头弹（单发）</span></div>`;
                    }
                    if (effects.flechetteMode) {
                        hasSummary = true;
                        summaryHtml += `<div class="tt-craft-row"><span class="tt-craft-name">射击模式</span><span class="tt-craft-stat-pos">箭型弹（穿透）</span></div>`;
                    }
                    if (effects.piercingBonus && effects.piercingBonus > 0) {
                        hasSummary = true;
                        summaryHtml += `<div class="tt-craft-row"><span class="tt-craft-name">穿透目标</span><span class="tt-craft-stat-pos">+${effects.piercingBonus}</span></div>`;
                    }
                    if (effects.magazineOverride) {
                        hasSummary = true;
                        summaryHtml += `<div class="tt-craft-row"><span class="tt-craft-name">弹夹容量</span><span class="tt-craft-stat-pos">覆盖为 ${effects.magazineOverride}发</span></div>`;
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
        const ttEnchant = document.getElementById('ttEnchant');
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
        const tooltip = document.getElementById('equipTooltip');
        if (!tooltip) return;
        const ttCraft = document.getElementById('ttCraft');
        const ttEnchant = document.getElementById('ttEnchant');
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
        const tooltip = document.getElementById('equipTooltip');
        const self = this;
        // 关闭按钮
        const closeBtn = document.getElementById('ttCloseBtn');
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
        document.querySelectorAll('.diablo-slot').forEach(slot => {
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
                const enchantPanel = document.getElementById('enchantPanel');
                const enchantOpen = enchantPanel && enchantPanel.classList.contains('active');
                if (EnhanceSystem._isOpen) {
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
            slot.ondblclick = function(e) {
                const key = slot.dataset.slot;
                const item = self.player.equipments[key];
                const enchantPanel = document.getElementById('enchantPanel');
                const enchantOpen = enchantPanel && enchantPanel.classList.contains('active');
                if (EnhanceSystem._isOpen) {
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
        const tooltip = document.getElementById('equipTooltip');
        const self = this;
        document.querySelectorAll('.inv-cell').forEach(cell => {
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
            cell.ondblclick = function(e) {
                const idx = parseInt(cell.dataset.slot);
                const item = self.backpackItems.find(i => i.slot === idx);
                if (!item) return;
                // 附魔卷轴：只在附魔栏打开时可双击放入
                if (item.scrollId) {
                    const enchantPanel = document.getElementById('enchantPanel');
                    if (enchantPanel && enchantPanel.classList.contains('active')) {
                        if (typeof window !== 'undefined' && window.EnchantSystem && window.EnchantSystem._equipScrollFromBackpack) {
                            window.EnchantSystem._equipScrollFromBackpack(idx);
                        }
                    }
                    return;
                }
                if (ShopSystem._isOpen && item.category !== 'gold') {
                    ShopSystem.addToSellGrid(idx);
                } else if (EnhanceSystem._isOpen && item.category !== 'gold') {
                    EnhanceSystem.equipFromBackpack(idx);
                } else {
                    self.callbacks.equipFromBackpack(idx);
                }
            };
            cell.oncontextmenu = function(e) {
                e.preventDefault();
                e.stopPropagation();
                const idx = parseInt(cell.dataset.slot);
                const item = self.backpackItems.find(i => i.slot === idx);
                if (!item) return;
                // 附魔卷轴：只在附魔栏打开时可右键放入
                if (item.scrollId) {
                    const enchantPanel = document.getElementById('enchantPanel');
                    if (enchantPanel && enchantPanel.classList.contains('active')) {
                        if (typeof window !== 'undefined' && window.EnchantSystem && window.EnchantSystem._equipScrollFromBackpack) {
                            window.EnchantSystem._equipScrollFromBackpack(idx);
                        }
                    }
                    return;
                }
                if (ShopSystem._isOpen && item.category !== 'gold') {
                    ShopSystem.addToSellGrid(idx);
                } else if (EnhanceSystem._isOpen && item.category !== 'gold') {
                    EnhanceSystem.equipFromBackpack(idx);
                } else if (CraftSystem._isOpen) {
                    CraftSystem._equipFromBackpack(idx);
                } else {
                    self.callbacks.equipFromBackpack(idx);
                }
            };
        });
    },

};
