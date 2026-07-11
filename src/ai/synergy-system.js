import { Renderer } from '../world/renderer.js';
import { Enemy } from '../entities/enemy.js';
/**
 * 怪物协同效应系统（SynergySystem）
 * 每帧扫描场上怪物，检测协同条件，应用协同效果
 */

export class SynergySystem {
    constructor() {
        this.rules = [];        // 协同规则数组
        this.activeSynergies = new Map(); // 已激活的协同：key=ruleId, value={rule, affectedEnemies, appliedAt}
        this.scanInterval = 500; // 扫描间隔（ms）
        this._timer = 0;
    }

    // 注册协同规则
    registerRule(rule) {
        this.rules.push(rule);
    }

    // 每帧调用（由 game.js 调用）
    update(dt, entities) {
        this._timer += dt;
        if (this._timer < this.scanInterval) return;
        this._timer = 0;

        const enemies = [];
        entities.forEach(e => { if (e instanceof Enemy && e.active && e.hp > 0) enemies.push(e); });

        for (const rule of this.rules) {
            const affected = this._checkRule(rule, enemies);
            if (affected.length > 0) {
                this._applySynergy(rule, affected);
            } else {
                this._removeSynergy(rule.id);
            }
        }
    }

    // 检查规则是否满足
    _checkRule(rule, enemies) {
        const matched = enemies.filter(e => rule.types.includes(e.type));
        if (matched.length < rule.count) return [];

        // 检查是否在协同范围内
        const groups = [];
        for (let i = 0; i < matched.length; i++) {
            const group = [matched[i]];
            for (let j = 0; j < matched.length; j++) {
                if (i === j) continue;
                const dx = matched[i].x - matched[j].x;
                const dy = matched[i].y - matched[j].y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                if (dist <= rule.radius) group.push(matched[j]);
            }
            if (group.length >= rule.count) groups.push(group);
        }

        return groups.length > 0 ? groups[0] : [];
    }

    // 应用协同效果
    _applySynergy(rule, affected) {
        if (this.activeSynergies.has(rule.id)) {
            const existing = this.activeSynergies.get(rule.id);
            const oldAffected = existing.affected;
            const added = affected.filter(e => !oldAffected.includes(e));
            const removed = oldAffected.filter(e => !affected.includes(e));
            if (added.length === 0 && removed.length === 0) return;
            existing.affected = affected;

            for (const enemy of added) {
                enemy._synergyEffects = enemy._synergyEffects || {};
                enemy._synergyEffects[rule.id] = rule.effects;

                if (rule.effects.speedMul) {
                    enemy._baseSpeed = enemy._baseSpeed || enemy.maxSpeed;
                    enemy.maxSpeed = enemy._baseSpeed * rule.effects.speedMul;
                }
                if (rule.effects.damageMul) {
                    enemy._synergyDamageMul = rule.effects.damageMul;
                }
                if (rule.effects.bleedChance) {
                    enemy._synergyBleedChance = rule.effects.bleedChance;
                }
                if (rule.effects.poisonChance) {
                    enemy._synergyPoisonChance = rule.effects.poisonChance;
                    enemy._synergyPoisonStacks = rule.effects.poisonStacks ?? 1;
                }
            }

            for (const enemy of removed) {
                if (enemy._synergyEffects && enemy._synergyEffects[rule.id]) {
                    if (enemy._synergyEffects[rule.id].speedMul) {
                        enemy.maxSpeed = enemy._baseSpeed || enemy.maxSpeed;
                    }
                    if (enemy._synergyEffects[rule.id].poisonChance) {
                        delete enemy._synergyPoisonChance;
                        delete enemy._synergyPoisonStacks;
                    }
                    if (enemy._synergyEffects[rule.id].damageMul) {
                        delete enemy._synergyDamageMul;
                    }
                    if (enemy._synergyEffects[rule.id].bleedChance) {
                        delete enemy._synergyBleedChance;
                    }
                    delete enemy._synergyEffects[rule.id];
                }
            }

            return;
        }

        this.activeSynergies.set(rule.id, { rule, affected, appliedAt: Date.now() });

        for (const enemy of affected) {
            enemy._synergyEffects = enemy._synergyEffects || {};
            enemy._synergyEffects[rule.id] = rule.effects;

            // 应用效果
            if (rule.effects.speedMul) {
                enemy._baseSpeed = enemy._baseSpeed || enemy.maxSpeed;
                enemy.maxSpeed = enemy._baseSpeed * rule.effects.speedMul;
            }
            if (rule.effects.damageMul) {
                // 标记，在攻击时读取
                enemy._synergyDamageMul = rule.effects.damageMul;
            }
            if (rule.effects.bleedChance) {
                enemy._synergyBleedChance = rule.effects.bleedChance;
            }
            // 新增：中毒效果支持
            if (rule.effects.poisonChance) {
                enemy._synergyPoisonChance = rule.effects.poisonChance;
                enemy._synergyPoisonStacks = rule.effects.poisonStacks ?? 1;
            }
        }

        
    }

    // 移除协同效果
    _removeSynergy(ruleId) {
        if (!this.activeSynergies.has(ruleId)) return;
        const { affected } = this.activeSynergies.get(ruleId);
        for (const enemy of affected) {
            if (enemy._synergyEffects && enemy._synergyEffects[ruleId]) {
                // 恢复速度
                if (enemy._synergyEffects[ruleId].speedMul) {
                    enemy.maxSpeed = enemy._baseSpeed || enemy.maxSpeed;
                }
                // 移除中毒效果
                if (enemy._synergyEffects[ruleId].poisonChance) {
                    delete enemy._synergyPoisonChance;
                    delete enemy._synergyPoisonStacks;
                }
                // 移除伤害倍率
                if (enemy._synergyEffects[ruleId].damageMul) {
                    delete enemy._synergyDamageMul;
                }
                // 移除流血效果
                if (enemy._synergyEffects[ruleId].bleedChance) {
                    delete enemy._synergyBleedChance;
                }
                delete enemy._synergyEffects[ruleId];
            }
        }
        this.activeSynergies.delete(ruleId);
    }

    // 渲染协同光环（可选，在 game.js 渲染循环中调用）
    render(ctx) {
        for (const [, synergy] of this.activeSynergies) {
            for (const enemy of synergy.affected) {
                if (!enemy.active) continue;
                const sp = Renderer.worldToScreen(enemy.x, enemy.y);
                ctx.save();
                ctx.strokeStyle = 'rgba(255, 80, 80, 0.3)';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(sp.x, sp.y, enemy.size + 8, 0, Math.PI * 2);
                ctx.stroke();
                ctx.restore();
            }
        }
    }
}

// 预定义规则
export const DEFAULT_SYNERGY_RULES = [
    {
        id: 'wolfPack',
        name: '狼群战术',
        types: ['BlackWolf'],
        count: 3,
        radius: 300,
        effects: { speedMul: 1.2, bleedChance: 0.2 }
    },
    // 新增规则：毒性瘴气
    {
        id: 'toxicMiasma',
        name: '毒性瘴气',
        types: ['BlackWolf'],
        count: 2,
        radius: 200,
        effects: { poisonChance: 0.3, poisonStacks: 1 }
    }
];
