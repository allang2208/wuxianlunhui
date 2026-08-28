import {
    burstParticles,
    fireGroundShockwave,
    fireRadialBurst,
    resolveSkillEffectDepth,
} from './combat-fx.js';

/**
 * 动力爆矛命中爆炸：只负责 Phaser 视觉，不选择目标、不结算伤害。
 * 结构复用火球的“冲击波 + ADD 火花 + NORMAL 烟尘”，并加入助推器同色的蓝青爆芯。
 */
export function spawnPoweredLanceExplosion({ source, x, y, z = 0, radius = 180 } = {}) {
    const groundX = Number(x) || 0;
    const groundY = Number(y) || 0;
    const displayY = groundY - (Number(z) || 0);
    const effectDepth = resolveSkillEffectDepth({
        source,
        groundY,
        groundOffset: 60,
        preferSourceDepth: false,
    });
    const smokeDepth = resolveSkillEffectDepth({
        source,
        groundY,
        groundOffset: 55,
        preferSourceDepth: false,
    });

    fireGroundShockwave({
        x: groundX,
        y: displayY,
        maxRadius: radius,
        strokeColor: 0xff8a2a,
        fillColor: 0xffb347,
        lineWidth: 8,
        duration: 440,
        flicker: true,
        depth: effectDepth,
    });
    fireGroundShockwave({
        x: groundX,
        y: displayY,
        maxRadius: radius * 0.58,
        strokeColor: 0x63eaff,
        fillColor: 0x208cff,
        lineWidth: 5,
        duration: 300,
        flicker: false,
        strokeAlpha: 0.9,
        fillAlpha: 0.08,
        depth: effectDepth + 0.1,
    });
    fireRadialBurst({
        x: groundX,
        y: displayY,
        count: 24,
        color: 0xffd27a,
        lenMin: radius * 0.18,
        lenMax: radius * 0.72,
        widthMin: 1.5,
        widthMax: 4,
        duration: 420,
        perspective: true,
        depth: effectDepth + 0.2,
    });
    fireRadialBurst({
        x: groundX,
        y: displayY,
        count: 12,
        color: 0x8ff7ff,
        lenMin: radius * 0.1,
        lenMax: radius * 0.45,
        widthMin: 1,
        widthMax: 3,
        duration: 300,
        perspective: true,
        depth: effectDepth + 0.3,
    });
    burstParticles({
        texture: 'impact_dot',
        x: groundX,
        y: displayY,
        count: 34,
        jitter: radius * 0.16,
        config: {
            speed: { min: 130, max: 470 },
            scale: { start: 3.1, end: 0.15 },
            alpha: { start: 0.95, end: 0 },
            lifespan: { min: 360, max: 680 },
            tint: [0xffffff, 0xffd27a, 0xff7a24, 0x8ff7ff, 0x288dff],
            blendMode: 'ADD',
        },
        destroyAfterMs: 900,
        depth: effectDepth + 0.4,
    });
    burstParticles({
        texture: 'smoke_particle',
        x: groundX,
        y: displayY,
        count: 10,
        jitter: radius * 0.18,
        config: {
            speed: { min: 18, max: 85 },
            scale: { start: 1.4, end: 4.2 },
            alpha: { start: 0.38, end: 0 },
            lifespan: { min: 720, max: 1250 },
            tint: [0x5b514b, 0x3f464b, 0x2f3940],
            blendMode: 'NORMAL',
        },
        destroyAfterMs: 1450,
        depth: smokeDepth,
    });
}
