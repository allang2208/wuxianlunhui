// ============================================================
// HamsterTrenchAssault — 战壕突击兵（2026-09-02）
// 近代步兵军营III级突击路线：复用成熟火枪接敌/LOS/RTS和霰弹扇区，
// 但保持独立身份、动作脚线与低于现代特战的散布参数。
// ============================================================
import { HamsterMusketeer } from './hamster-musketeer.js';
import { HamsterRiotSquadAI } from '../ai/hamster-riot-squad-ai.js';
import hamsterTrenchAssaultConfig from '../../data/hamster-trench-assault-config.json';

export class HamsterTrenchAssault extends HamsterMusketeer {
    constructor(x, y, overrides = {}) {
        super(x, y, {
            ...hamsterTrenchAssaultConfig,
            ...overrides,
            ai: { ...(hamsterTrenchAssaultConfig.ai || {}), ...(overrides.ai || {}) },
            animations: {
                ...(hamsterTrenchAssaultConfig.animations || {}),
                ...(overrides.animations || {}),
            },
            render: {
                ...(hamsterTrenchAssaultConfig.render || {}),
                ...(overrides.render || {}),
            },
        });
        this._isHamsterTrenchAssault = true;
        this.animId = 'hamster_trench_assault';
        this._ai = new HamsterRiotSquadAI(this);
    }

    /** 霰弹扇区不继承火枪穿甲弹。 */
    getCurrentWeapon() {
        return null;
    }

    /** 保留49帧不可逆倒地至末帧，不沿用火枪基类较短的死亡计时。 */
    _startDying() {
        super._startDying();
        const dying = this.animations?.dying || {};
        const frameCount = Math.max(1, Number(dying.frameCount) || 1);
        const frameRate = Math.max(1, Number(dying.frameRate) || 1);
        this._deathTimer = frameCount / frameRate * 1000;
    }

    /** 336×160紧裁图集使用真实脚线，绕过512格通用脚底假设。 */
    getAnimationFootY(textureKey) {
        const prefix = `companion_${this.animId}_`;
        if (!textureKey?.startsWith(prefix)) return undefined;
        const action = textureKey.slice(prefix.length);
        const footY = Number(this.animations?.[action]?.footY);
        return Number.isFinite(footY) ? footY : undefined;
    }
}
