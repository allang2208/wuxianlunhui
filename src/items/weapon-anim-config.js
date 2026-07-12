
import { Easing } from '../config/math-utils.js';

// 武器动画配置：数据从 public/data/weapon-anim-config.json 加载
// stab 配置包含函数，保留在 JS 模块中，加载后合并到 WeaponAnimConfig
let WeaponAnimConfig = {};

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
            Object.assign(WeaponAnimConfig, data);
        }
    } catch (err) {
        console.error('[WeaponAnimConfig] Failed to load config:', err);
    }
    // stab 配置无法 JSON 化（含函数），始终由 JS 提供
    WeaponAnimConfig.stab = STAB_CONFIG;
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
        handAnchors: cfg.handAnchors || null,
        gripOffset: cfg.gripOffset || null,
        timingMul: cfg.timingMul,
        animType: cfg.animType,
        hitBox: cfg.hitBox,
        stab: cfg.stab,
        renderParams: cfg.renderParams
    };
}

export { WeaponAnimConfig, getWeaponStateConfig };
