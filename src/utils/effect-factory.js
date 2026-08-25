/**
 * EffectFactory — 统一特效创建与对象池复用
 * 封装 MuzzleFlashEffect / ShellCasingEffect 等特效的 _acquire + reset/create 逻辑。
 */

import { EffectManager } from '../effects/effect-manager.js';
import { DodgeEffect } from '../effects/particle-effects.js';

export const EffectFactory = {
    /**
     * 创建枪口火焰特效。
     * @param {number} x
     * @param {number} y
     * @param {number} angle
     * @param {number} [scale=1.0]
     * @returns {MuzzleFlashEffect|null}
     */
    createMuzzleFlash(x, y, angle, scale = 1.0) {
        return EffectManager.spawnPooledCosmetic(
            'muzzleFlash', 'MuzzleFlashEffect', x, y, x, y, angle, scale
        );
    },

    /**
     * 创建弹壳特效。
     * @param {number} x 弹出位置 X
     * @param {number} y 弹出位置 Y
     * @param {number} angle 开火方向
     * @param {number} [groundY] 落地的脚底 Y（从枪械贴图中心弹出并落下时传入）
     * @returns {ShellCasingEffect|null}
     */
    createShellCasing(x, y, angle, groundY) {
        return EffectManager.spawnPooledCosmetic(
            'shellCasing', 'ShellCasingEffect', x, y, x, y, angle, groundY
        );
    },

    /**
     * 创建闪避拖尾特效。
     * @param {number} x
     * @param {number} y
     * @param {number} dirX
     * @param {number} dirY
     * @returns {DodgeEffect}
     */
    createDodgeEffect(x, y, dirX, dirY) {
        let e = EffectManager._acquire('DodgeEffect');
        if (e) {
            e.reset(x, y, dirX, dirY);
        } else {
            e = new DodgeEffect(x, y, dirX, dirY);
        }
        EffectManager.add(e);
        return e;
    },

    /**
     * 创建扬尘特效。
     * @param {number} x
     * @param {number} y
     * @param {number} intensity
     * @param {{scale?:number,lifeMul?:number,depth?:number}} [options]
     * @returns {DustEffect|null}
     */
    createDustEffect(x, y, intensity, options = {}) {
        return EffectManager.spawnPooledCosmetic(
            'dust', 'DustEffect', x, y, x, y, intensity, options
        );
    },

    createHitEffect(x, y) {
        return EffectManager.spawnPooledCosmetic('impact', 'HitEffect', x, y, x, y);
    },

    createSmokeEffect(x, y) {
        return EffectManager.spawnPooledCosmetic('smoke', 'SmokeEffect', x, y, x, y);
    },

    createBloodMistEffect(x, y, angle = 0) {
        return EffectManager.spawnPooledCosmetic(
            'bloodMist', 'BloodMistEffect', x, y, x, y, angle
        );
    }
};
