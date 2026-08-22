import { HamsterScout } from './hamster-scout.js';
import { HamsterExplorerAI } from '../ai/hamster-explorer-ai.js';
import configData from '../../data/hamster-explorer-config.json';

export class HamsterExplorer extends HamsterScout {
    constructor(x, y, overrides = {}) {
        super(x, y, { ...configData, ...overrides, ai: { ...configData.ai, ...(overrides.ai || {}) } });
        this._isHamsterExplorer = true;
        this._rtsCanAttack = false;
        this.name = configData.name;
        this.animId = configData.id;
        this.animations = { ...(configData.animations || {}) };
        this.sounds = {};
        this.displaySize = Number(configData.displaySize) || 112;
        this.spriteOffsetY = Number(configData.spriteOffsetY) || -43;
        this.footOffsetY = 43;
        this.fogVisionProfile = configData.fogVisionProfile || 'scout';
        this.fogSightRadius = Math.max(1, Number(configData.fogSightRadius) || 2000);
        this.config = { render: { hudOffsetY: 43, footOffsetY: 43 } };
        this._ai = new HamsterExplorerAI(this);
    }

    _startDying() {
        super._startDying();
        const dying = this.animations?.dying || {};
        const frames = Math.max(1, Number(dying.frameCount) || 13);
        const fps = Math.max(1, Number(dying.frameRate) || 12);
        this._deathTimer = frames / fps * 1000 + 60;
    }
}
