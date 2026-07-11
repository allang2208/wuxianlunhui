/**
 * EffectFactory — 统一特效创建与对象池复用
 * 封装 MuzzleFlashEffect / ShellCasingEffect 等特效的 _acquire + reset/create 逻辑。
 */

import { EffectManager } from '../effects/effect-manager.js';
import { MuzzleFlashEffect } from '../effects/muzzle-flash.js';
import { ShellCasingEffect } from '../effects/shell-casing.js';

export const EffectFactory = {
    /**
     * 创建枪口火焰特效。
     * @param {number} x
     * @param {number} y
     * @param {number} angle
     * @param {number} [scale=1.0]
     * @returns {MuzzleFlashEffect}
     */
    createMuzzleFlash(x, y, angle, scale = 1.0) {
        let e = EffectManager._acquire('MuzzleFlashEffect');
        if (e) {
            e.reset(x, y, angle, scale);
        } else {
            e = new MuzzleFlashEffect(x, y, angle, scale);
        }
        EffectManager.add(e);
        return e;
    },

    /**
     * 创建弹壳特效。
     * @param {number} x
     * @param {number} y
     * @param {number} angle
     * @returns {ShellCasingEffect}
     */
    createShellCasing(x, y, angle) {
        let e = EffectManager._acquire('ShellCasingEffect');
        if (e) {
            e.reset(x, y, angle);
        } else {
            e = new ShellCasingEffect(x, y, angle);
        }
        EffectManager.add(e);
        return e;
    }
};
