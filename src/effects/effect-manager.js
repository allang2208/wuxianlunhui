import { Camera } from '../world/camera.js';
import { MuzzleFlashEffect } from './muzzle-flash.js';
import { BloodEffect, BloodMistEffect, DodgeEffect, DustEffect } from './particle-effects.js';
import { ShellCasingEffect } from './shell-casing.js';
import { SmokeEffect } from './smoke-effect.js';
import { BloodHitEffect as HitEffect } from './blood-hit-effect.js';
import { FloatingTextEffect } from './floating-text.js';
import { Projectile } from '../combat/projectile.js';
const EffectManager = {
    effects: [], critFlash: 0,
    _pools: {},
    _factories: {
        'BloodEffect': () => new BloodEffect(0, 0, 0),
        'BloodMistEffect': () => new BloodMistEffect(0, 0, 0),
        'Projectile': () => new Projectile(0, 0, 0, 0, 0, 0, {min:0,max:0}, false, null, null, null),
        'DustEffect': () => new DustEffect(0, 0, 1.0),
        'DodgeEffect': () => new DodgeEffect(0, 0, 1, 0),
        'SmokeEffect': () => new SmokeEffect(0, 0),
        'MuzzleFlashEffect': () => new MuzzleFlashEffect(0, 0, 0),
        'ShellCasingEffect': () => new ShellCasingEffect(0, 0, 0),
        'HitEffect': () => new HitEffect(0, 0)
    },
    _acquire(type) {
        if (!this._pools[type]) this._pools[type] = [];
        let obj = this._pools[type].pop();
        if (!obj) obj = this._factories[type] ? this._factories[type]() : {};
        obj.active = true;
        obj._effectType = type;
        return obj;
    },
    _release(type, obj) {
        if (!this._pools[type]) this._pools[type] = [];
        this._pools[type].push(obj);
    },
    add(effect) { this.effects.push(effect); },
    update(dt) {
        // 原地清理失效特效，避免每帧创建新数组
        for (let i = this.effects.length - 1; i >= 0; i--) {
            const e = this.effects[i];
            e.update(dt);
            if (!e.active) {
                if (e._effectType) this._release(e._effectType, e);
                this.effects.splice(i, 1);
            }
        }
        if (this.critFlash > 0) { this.critFlash -= 4.992 * (dt / 1000); if (this.critFlash < 0) this.critFlash = 0; }
    },
    createDamageText(x, y, damage, isCrit) {
        // 使用 FloatingTextEffect 替代 DOM 伤害数字，统一走 Phaser 渲染管线
        const text = isCrit ? `暴击! ${damage}` : `${damage}`;
        const color = isCrit ? '#ffaa44' : '#ff6666';
        const fontSize = isCrit ? 22 : 18;
        this.add(new FloatingTextEffect(x, y - 20, text, color, fontSize));
    },
    triggerCritEffects() { this.critFlash = 1.0; Camera.triggerShake(12); }
};

export { EffectManager };
