import { HamsterScout } from './hamster-scout.js';
import { HamsterExplorerAI } from '../ai/hamster-explorer-ai.js';
import configData from '../../data/hamster-explorer-config.json';

export class HamsterExplorer extends HamsterScout {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...configData,
            ...overrides,
            ai: { ...configData.ai, ...(overrides.ai || {}) },
            render: { ...(configData.render || {}), ...(overrides.render || {}) },
        });
        this._isHamsterExplorer = true;
        this._rtsCanAttack = false;
        this.name = configData.name;
        this.animId = configData.id;
        this.animations = { ...(configData.animations || {}) };
        this.sounds = {};
        this.displaySize = Number(overrides.displaySize ?? configData.displaySize) || 95.797281;
        this.spriteOffsetY = Number(overrides.spriteOffsetY ?? configData.spriteOffsetY) || -36.859501;
        const renderConfig = { ...(configData.render || {}), ...(overrides.render || {}) };
        this.footOffsetY = Math.max(0, Number(renderConfig.footOffsetY) || 36.859501);
        this.fogVisionProfile = configData.fogVisionProfile || 'scout';
        this._baseFogSightRadius = Math.max(1, Number(configData.fogSightRadius) || 1600);
        this.fogSightRadius = this._baseFogSightRadius;
        this.fogSightDebuffImmune = configData.fogSightDebuffImmune === true;
        this.config = {
            render: {
                ...renderConfig,
                hudOffsetY: Math.max(0, Number(renderConfig.hudOffsetY) || 119),
                footOffsetY: this.footOffsetY,
            },
        };
        this._ai = new HamsterExplorerAI(this);
        this.configureCollisionFromArchive({
            ...configData,
            ...overrides,
            render: renderConfig,
        });
    }

    applyBarracksUpgrades(upgrades = {}) {
        super.applyBarracksUpgrades(upgrades);
        const bonus = Math.max(0, Number(upgrades.fogSightRadiusBonus) || 0);
        this.fogSightRadius = this._baseFogSightRadius + bonus;
    }

    _startDying() {
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 13);
        const fps = Math.max(1, Number(dying.frameRate) || 12);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
