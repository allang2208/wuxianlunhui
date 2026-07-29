import { SkillManager } from '../../ui/skill-manager.js';
import { BoltSkillSystem } from './bolt-skill-system.js';
import { burstParticles, fireGroundShockwave } from '../../effects/combat-fx.js';

/**
 * 冰锥系统（通用版）——BoltSkillSystem 的冰锥 kind 封装。
 * 支持玩家与敌人作为施法者（source）；玩家通过鼠标瞄准，非玩家自动瞄准 source.target。
 * 差异点：N 颗悬浮冰锥（身后扇形）→ 全部发射 → 命中/撞墙 = 碎裂（同帧可多目标结算）；
 * 到达最大射程 = 静默消失（无特效）。
 */

const ICE_SPIKE_KIND = {
    skillKey: 'iceSpike',
    mpShortageColor: '#5a8aaa',
    wallRadius: 8,
    hitRadius: 12,
    fields: {
        active: '_iceSpikeActive',
        timer: '_iceSpikeTimer',
        cooldown: '_iceSpikeCooldown',
        spikes: '_iceSpikeSpikes',
    },
    img: { field: '_iceSpikeImg', src: 'assets/skills/icearrow.png' },
    spawnText: (effect) => `❄ 冰锥凝聚 x${effect.spikeCount}`,
    makeProjectiles(effect) {
        const projectiles = [];
        for (let i = 0; i < effect.spikeCount; i++) {
            const side = i % 2 === 0 ? -1 : 1; // 左右交替
            const row = Math.floor(i / 2); // 0, 0, 1, 1, 2, 2...
            projectiles.push({
                id: i,
                offsetX: -30 - row * 30, // 身后，每对向后30px
                offsetY: side * 30, // 左右30px
                active: true,
                launched: false,
                flyX: 0, flyY: 0,
                flyAngle: 0,
                flySpeed: effect.flySpeed,
                flyDistance: 0,
                flyActive: false,
                swayTimer: i * 0.5,
                swayFreqX: 2.0 + Math.random() * 0.5,
                swayFreqY: 1.5 + Math.random() * 0.5,
                swayAmpX: 3,
                swayAmpY: 2,
            });
        }
        return projectiles;
    },
    trail: {
        intervalMs: 60,
        backOffset: 10,
        destroyAfterMs: 450,
        config: {
            speed: { min: 0, max: 30 },
            scale: { start: 0.9, end: 0.1 },
            alpha: { start: 0.6, end: 0 },
            lifespan: 300,
            tint: [0xffffff, 0xaaddff, 0x66aaff],
            blendMode: 'ADD',
        },
    },
    addSkillExp(source, hitCount, killCount) {
        SkillManager.addIceSpikeExp(source, hitCount, killCount);
    },
    // 命中/撞墙：冰锥碎裂（特效两层：冰屑带重力 + 小冰环）；同帧多目标逐目标结算（准穿透）
    onImpact(sys, spike, { x, y, damage, skill, hitEntity }) {
        burstParticles({
            texture: 'impact_dot', x, y, count: 12, jitter: 8,
            config: {
                speed: { min: 100, max: 320 },
                scale: { start: 1.6, end: 0.15 },
                alpha: { start: 0.9, end: 0 },
                lifespan: { min: 300, max: 500 },
                gravityY: 500, // 冰屑受重力下落
                tint: [0xffffff, 0xaaddff, 0x66aaff],
                blendMode: 'ADD',
            },
            destroyAfterMs: 700, depth: y + 60,
        });
        fireGroundShockwave({
            x, y, maxRadius: 70,
            strokeColor: 0x9fd8ff, fillColor: 0xd8f0ff,
            lineWidth: 4, duration: 320, flicker: true,
        });
        // 撞墙（无命中目标）只播特效；命中目标才结算伤害/经验
        if (hitEntity) {
            const wasAlive = hitEntity.hp > 0;
            hitEntity.takeDamage(damage, sys.source, 'magic');
            if (skill && sys._isPlayer()) {
                this.addSkillExp(sys.source, 1, (wasAlive && hitEntity.hp <= 0 && !hitEntity._summoned) ? 1 : 0);
            }
        }
        spike.flyActive = false;
        spike.active = false;
    },
    // 到达最大射程：静默消失（原版无特效）
    onMaxRange() {},
};

export class IceSpikeSystem extends BoltSkillSystem {
    constructor(source, options = {}) {
        super(source, ICE_SPIKE_KIND, options);
    }
}
