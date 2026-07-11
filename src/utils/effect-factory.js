/**
 * EffectFactory — 统一特效创建与对象池复用
 * 封装 MuzzleFlashEffect / ShellCasingEffect 等特效的 _acquire + reset/create 逻辑。
 */

import { EffectManager } from '../effects/effect-manager.js';
import { MuzzleFlashEffect } from '../effects/muzzle-flash.js';
import { ShellCasingEffect } from '../effects/shell-casing.js';
import { DodgeEffect, DustEffect } from '../effects/particle-effects.js';

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
     * @returns {DustEffect}
     */
    createDustEffect(x, y, intensity) {
        let e = EffectManager._acquire('DustEffect');
        if (e) {
            e.reset(x, y, intensity);
        } else {
            e = new DustEffect(x, y, intensity);
        }
        EffectManager.add(e);
        return e;
    }
};
