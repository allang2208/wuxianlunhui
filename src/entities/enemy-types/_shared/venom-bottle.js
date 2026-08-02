import { GroundEllipse } from '../../../physics/skill-shapes.js';
import { PERSPECTIVE_SCALE_Y } from '../../../config/perspective-config.js';
import { hostilesOf, playSoundFrom } from './enemy-utils.js';
import { launchArcProjectile } from '../../../effects/combat-fx.js';
import { GroundZone } from '../../../effects/ground-zone.js';

/**
 * 毒液瓶共享机制（巫婆攻击 2 / 煮锅伴生攻击共用，单一实现勿重复）
 *
 * 流程：抛物线投射物（witch/projective.png，flyDuration 落地，落地前每秒 360° 旋转）
 *   → 落点 GroundZone 毒液区（椭圆 impactRadius、持续 zoneDuration、矿洞绿烟同款绿色烟雾填满：
 *     白色软圆 smoke_particle + 绿色 tint + ADD 亮色混合）
 *   → 每 tickMs 对区内敌对单位造成 魔法攻击×damageMul 魔法伤害，并叠 poisonStacks 层中毒
 *
 * 数值全部来自宿主 enemy-config.json 对应技能块（巫婆 attackSkills.venom / 煮锅 attackSkills.bottle），
 * 本模块不硬编码。毒液区挂在宿主 `host._venomZones` 数组上，由宿主 update 驱动 updateVenomZones、
 * _destroyCustomEffects 调 destroyVenomZones 统一清理（与提灯燃烧区同口径）。
 */

/** 掷出一个毒液瓶（tx/ty 为落点；host 用于特效 depth 与伤害来源） */
export function throwVenomBottle(host, cfg, tx, ty) {
    const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
    if (!scene || !scene.add || !scene.tweens) {
        // 无渲染场景时直接结算（防御性回退）
        createVenomZone(host, cfg, tx, ty);
        return null;
    }
    const dirX = (host._getPhaserOptions && host._getPhaserOptions().flipX) ? -1 : 1;
    let sx = host.x + dirX * (cfg.muzzleForward ?? 30);
    let sy = host.y - (cfg.muzzleUpY ?? 60);
    // 面朝右时的额外微调（配置驱动，右移/下移用正值）
    if (dirX > 0) {
        sx += cfg.muzzleRightDx ?? 0;
        sy += cfg.muzzleRightDy ?? 0;
    }
    const flyDuration = cfg.flyDuration ?? 1500;
    const handle = launchArcProjectile({
        textureKey: 'enemy_witch_projectile',
        size: cfg.projectileSize || 48,
        sx, sy, tx, ty,
        arcHeight: cfg.arcHeight ?? 100,
        duration: flyDuration,
        // 折算角速度恒为 2π rad/s（落地前每秒 360°，提灯同口径）
        spin: Math.PI * 2,
        depth: host.y + 15,
        onImpact: (ix, iy) => {
            createVenomZone(host, cfg, ix, iy);
        },
    });
    return handle ? handle.sprite : null;
}

/** 落点生成毒液区（绿色椭圆 + 绿烟粒子簇；伤害与叠毒在 onTick） */
export function createVenomZone(host, cfg, x, y) {
    // 落地音效（配置 sounds.land，巫婆/煮锅同 key 同文件）
    playSoundFrom(host, 'land');
    // 绿烟配置（配置里 tint 为 "0x......" 字符串，Phaser 粒子需要数值）
    const flameCfg = {
        // 绿烟填满影响区域（smoke_particle + 绿色 tint + ADD，矿洞绿烟同款）
        texture: 'smoke_particle',
        morphMs: cfg.flameMorphMs ?? 90,
        points: cfg.flamePoints ?? 3,
        burstCount: cfg.flameBurstCount ?? 12,
        ...(cfg.flame || {}),
    };
    const parseTint = (v) => (typeof v === 'string' ? parseInt(v, 16) : v);
    if (Array.isArray(flameCfg.tint)) flameCfg.tint = flameCfg.tint.map(parseTint);
    else if (flameCfg.tint !== undefined) flameCfg.tint = parseTint(flameCfg.tint);
    const zone = new GroundZone({
        x, y,
        radius: cfg.impactRadius ?? 200,
        duration: cfg.zoneDuration ?? 6000,
        tickMs: cfg.tickMs ?? 500,
        oil: cfg.oil || {},     // 绿色底面贴花（色值/透明度/growMs/反光全走配置）
        flame: flameCfg,
        onTick: (z, entities) => {
            const matk = host.data?.matk || 0;
            const shape = new GroundEllipse(z.x, z.y, z.radius, z.radius * PERSPECTIVE_SCALE_Y);
            for (const e of hostilesOf(host, entities)) {
                if (!shape.intersectsEntity(e)) continue;
                e.takeDamage(Math.max(1, Math.round(matk * (cfg.damageMul ?? 0.75))), host, 'magic', false);
                // 每次伤害判定命中叠中毒（复用 DamageableEntity.applyPoison 既有中毒实现）
                if (typeof e.applyPoison === 'function') {
                    e.applyPoison(cfg.poisonStacks ?? 1);
                }
            }
        },
    });
    if (!host._venomZones) host._venomZones = [];
    host._venomZones.push(zone);
    return zone;
}

/** 毒液区 tick 与清理（宿主 update 中调用；GroundZone 到期/销毁返回 false） */
export function updateVenomZones(host, dt, entities) {
    if (!host._venomZones) return;
    for (let i = host._venomZones.length - 1; i >= 0; i--) {
        if (!host._venomZones[i].update(dt, entities)) {
            host._venomZones.splice(i, 1);
        }
    }
}

/** 统一特效清理（宿主 _destroyCustomEffects 调用） */
export function destroyVenomZones(host) {
    if (!host._venomZones) return;
    for (const zone of host._venomZones) zone.destroy();
    host._venomZones = [];
}
