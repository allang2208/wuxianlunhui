import { HamsterLightCavalry } from './hamster-light-cavalry.js';
import configData from '../../data/hamster-camel-cavalry-config.json';

/**
 * 沙漠官邸骆驼骑兵：复用轻骑的配置驱动近战状态机，不继承仓鼠骑士的冲锋技能。
 * 基准防御单独乘 1.15，避免为抬防御修改六维并连带污染物攻、暴抗和生命公式。
 */
export class HamsterCamelCavalry extends HamsterLightCavalry {
    constructor(x, y, overrides = {}) {
        const archive = {
            ...configData,
            ...overrides,
            ai: { ...(configData.ai || {}), ...(overrides.ai || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
            animations: { ...(configData.animations || {}), ...(overrides.animations || {}) },
        };
        super(x, y, archive);
        this._isHamsterCamelCavalry = true;
        this.animId = configData.id;
        this.name = configData.name;
        this.footOffsetY = Math.max(0, Number(archive.render?.footOffsetY) || 129.7);
        this.config = {
            render: {
                ...(this.config?.render || {}),
                ...(archive.render || {}),
                footOffsetY: this.footOffsetY,
            },
        };
        // 通用 defenseMult 必须始终从未升级的15%强化基准计算，避免重复乘算。
        this._upgradeBaseDefense = Number(this.data?.def) || 0;
        this._camelFrightReduction = 0;
        this._camelFrightTimer = 0;
        this.configureCollisionFromArchive(archive);
    }

    calculateCombatStats() {
        super.calculateCombatStats();
        if (!this.data) return;
        const baseMult = Math.max(0, Number(configData.baseDefenseMult) || 1);
        const upgradeMult = Math.max(0, Number(this._camelDefenseUpgradeMult) || 1);
        this.data.def = Math.max(0, Math.round((Number(this.data.def) || 0) * baseMult * upgradeMult));
        this.def = this.data.def;
    }

    applyBarracksUpgrades(upgrade = {}) {
        if (Number.isFinite(upgrade.defenseMult)) {
            this._camelDefenseUpgradeMult = Math.max(0, Number(upgrade.defenseMult));
        }
        if (Number.isFinite(upgrade.camelFrightReduction)) {
            this._camelFrightReduction = Math.max(0, Math.min(0.9, Number(upgrade.camelFrightReduction)));
        }
        super.applyBarracksUpgrades(upgrade);
    }

    update(dt, entities) {
        super.update(dt, entities);
        if (this.active === false || this._dying || !(this.data?.hp > 0) || !(this._camelFrightReduction > 0)) return;
        this._camelFrightTimer -= dt;
        if (this._camelFrightTimer > 0) return;
        this._camelFrightTimer = Math.max(50, Number(this.aiConfig?.camelFrightRefreshMs) || 200);
        const radius = Math.max(0, Number(this.aiConfig?.camelFrightRadius) || 600);
        const radiusSq = radius * radius;
        const duration = Math.max(this._camelFrightTimer + 50,
            Number(this.aiConfig?.camelFrightDurationMs) || 350);
        const candidates = entities?.values ? entities.values() : (entities || []);
        for (const enemy of candidates) {
            if (!enemy || enemy.active === false || enemy._faction !== 'enemy' || enemy._isDead || enemy._dying) continue;
            if (typeof enemy.applyCamelFright !== 'function') continue;
            const dx = (Number(enemy.x) || 0) - this.x;
            const dy = (Number(enemy.y) || 0) - this.y;
            if (dx * dx + dy * dy > radiusSq) continue;
            enemy.applyCamelFright(duration, this._camelFrightReduction);
        }
    }

    _startDying() {
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 16);
        const fps = Math.max(1, Number(dying.frameRate) || 12);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
