
import { Easing } from '../config/math-utils.js';
import bundledWeaponAnimConfig from '../../data/weapon-anim-config.json';

// 武器动画配置：打包内 data/ 是离线兜底，开发/运行时 public/data/ 成功后递归覆盖。
// stab 配置包含函数，保留在 JS 模块中，加载后合并到 WeaponAnimConfig
function cloneConfig(value) {
    return JSON.parse(JSON.stringify(value));
}

function isPlainObject(value) {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function mergeConfigTree(target, source) {
    if (!isPlainObject(source)) return target;
    for (const [key, value] of Object.entries(source)) {
        const targetValue = target[key];
        if ((isPlainObject(targetValue) && !isPlainObject(value))
            || (Array.isArray(targetValue) && !Array.isArray(value))) {
            console.warn(`[WeaponAnimConfig] 忽略类型不匹配的运行时字段: ${key}`);
            continue;
        }
        if (isPlainObject(value) && isPlainObject(target[key])) {
            mergeConfigTree(target[key], value);
        } else if (value !== null && value !== undefined) {
            target[key] = isPlainObject(value) || Array.isArray(value)
                ? cloneConfig(value)
                : value;
        }
    }
    return target;
}

let WeaponAnimConfig = cloneConfig(bundledWeaponAnimConfig);

const STAB_CONFIG = {
    // 刺击动画通用配置（可被所有剑类武器复用）
    windupMs: 150,      // 蓄力时间（ms）
    stabMs: 200,        // 刺击时间（ms）— 快速有力
    recoverMs: 350,     // 收回时间（ms）— 缓慢收回
    windupDist: 0.35,   // 蓄力回退距离（倍率）
    stabDist: 0.893,    // 前刺距离：94px / 105 = 0.893，固定94px（已放大25%）
    recoverSnapDist: 10, // 瞬移后剩余距离（px），用于平滑过渡
    easeIn: Easing.easeInCubic,    // 蓄力缓动：前急后缓
    easeOut: Easing.easeOutQuad,   // 刺击缓动：快速爆发
    easeRecover: Easing.easeInOutCubic, // 收回缓动：平滑
    // 角度变化（可选，留空则使用 WEAPON_ANIM 默认值）
    idleAngle: 0, windupAngle: Math.PI / 6, swingAngle: -Math.PI / 6,
};

async function loadWeaponAnimConfig() {
    try {
        let data = null;
        if (typeof window !== 'undefined' && window.electronAPI && window.electronAPI.loadWeaponConfig) {
            data = await window.electronAPI.loadWeaponConfig();
        } else {
            const response = await fetch('/data/weapon-anim-config.json?t=' + Date.now());
            if (!response.ok) throw new Error(`Failed to load weapon-anim-config: ${response.status}`);
            data = await response.json();
        }
        if (data && typeof data === 'object') {
            // 深层合并保留打包内必需字段；运行时文件缺一个 hitBox 子键时不能把整棵 sword 覆盖空。
            mergeConfigTree(WeaponAnimConfig, data);
        }
    } catch (err) {
        console.warn('[WeaponAnimConfig] 运行时配置加载失败，使用打包内配置:', err);
    }
    // stab 配置无法 JSON 化（含函数），始终由 JS 提供
    WeaponAnimConfig.stab = STAB_CONFIG;
    // 法杖（staff，2026-08-02 新增）：近战攻击套用剑类动画——配置别名指向 sword，免维护双份
    if (WeaponAnimConfig.sword && !WeaponAnimConfig.staff) {
        WeaponAnimConfig.staff = WeaponAnimConfig.sword;
    }
}

await loadWeaponAnimConfig();

// 辅助函数：获取武器按状态分层的配置
// key: 武器配置键（如 'sword', 'pistol', 'bow'）
// state: 动画状态（如 'idle', 'walk', 'running'）
function getWeaponStateConfig(key, state) {
    const cfg = WeaponAnimConfig[key];
    if (!cfg) return null;
    const stateCfg = cfg[state] || {};
    return {
        holdOffsetX: stateCfg.holdOffsetX !== undefined ? stateCfg.holdOffsetX : cfg.holdOffsetX,
        holdOffsetY: stateCfg.holdOffsetY !== undefined ? stateCfg.holdOffsetY : cfg.holdOffsetY,
        idleRotation: stateCfg.idleRotation !== undefined ? stateCfg.idleRotation : cfg.idleRotation,
        idleScale: stateCfg.idleScale !== undefined ? stateCfg.idleScale : cfg.idleScale,
        timingMul: cfg.timingMul,
        animType: cfg.animType,
        hitBox: cfg.hitBox,
        stab: cfg.stab,
        renderParams: cfg.renderParams
    };
}

export { WeaponAnimConfig, getWeaponStateConfig };
