// ============================================================
// HamsterPhalanx — 仓鼠方阵（2026-08-26）
// 仓鼠盾卫二级路线：沿用成熟近战盾卫 AI、RTS 与自动防御契约，
// 使用军团大盾 + 双刃斧的慢速重装动画和独立数值配置。
// ============================================================
import { HamsterGuard } from './hamster-guard.js';
import hamsterPhalanxConfig from '../../data/hamster-phalanx-config.json';

const DYING_DURATION_MS = 1550; // dying 31 帧 @20fps

export class HamsterPhalanx extends HamsterGuard {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...hamsterPhalanxConfig,
            ...overrides,
            ai: { ...(hamsterPhalanxConfig.ai || {}), ...(overrides.ai || {}) },
            animations: { ...(hamsterPhalanxConfig.animations || {}), ...(overrides.animations || {}) },
            render: { ...(hamsterPhalanxConfig.render || {}), ...(overrides.render || {}) },
        });
        this._isHamsterPhalanx = true;
        this.animId = 'hamster_phalanx';
    }

    _startDying() {
        super._startDying();
        this._deathTimer = DYING_DURATION_MS;
    }
}
