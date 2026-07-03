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
        const matched = enemies.filter(e => rule.types.includes(e.constructor.name));
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
        if (this.activeSynergies.has(rule.id)) return; // 已激活

        this.activeSynergies.set(rule.id, { rule, affected, appliedAt: Date.now() });

        for (const enemy of affected) {
            enemy._synergyEffects = enemy._synergyEffects || {};
            enemy._synergyEffects[rule.id] = rule.effects;

            // 应用效果
            if (rule.effects.speedMul) {
                enemy.maxSpeed = (enemy._baseSpeed || enemy.maxSpeed) * rule.effects.speedMul;
            }
            if (rule.effects.damageMul) {
                // 标记，在攻击时读取
                enemy._synergyDamageMul = rule.effects.damageMul;
            }
            if (rule.effects.bleedChance) {
                enemy._synergyBleedChance = rule.effects.bleedChance;
            }
        }

        console.log(`[Synergy] ${rule.name} 激活！影响 ${affected.length} 个怪物`);
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
                delete enemy._synergyEffects[ruleId];
            }
        }
        this.activeSynergies.delete(ruleId);
    }

    // 渲染协同光环（可选，在 game.js 渲染循环中调用）
    render(ctx) {
        for (const [id, synergy] of this.activeSynergies) {
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
        types: ['BlackWolf', 'WolfSpider'],
        count: 3,
        radius: 300,
        effects: { speedMul: 1.2, bleedChance: 0.2 }
    },
    {
        id: 'skirmishLine',
        name: '远近配合',
        types: ['SkeletonArcher', 'SkeletonWarrior'],
        count: 2,
        radius: 200,
        effects: { speedMul: 1.1 }
    }
];
