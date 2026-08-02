import { SkillManager } from '../../ui/skill-manager.js';
import { BoltSkillSystem } from './bolt-skill-system.js';
import { burstParticles, fireGroundShockwave } from '../../effects/combat-fx.js';
import { SoundManager } from '../../ui/sound-manager.js';
import skillsData from '../../../data/skills.json';

/**
 * 火球系统（通用版）——BoltSkillSystem 的火球 kind 封装。
 * 支持玩家与敌人作为施法者（source）；玩家通过鼠标瞄准，非玩家自动瞄准 source.target。
 * 差异点：单颗悬浮火球（73 帧动画）→ 发射 → 命中/撞墙/到射程 = 范围爆炸（距离衰减）。
 */

const FIREBALL_KIND = {
    skillKey: 'fireball',
    mpShortageColor: '#ff6b35',
    wallRadius: 12,
    hitRadius: 20,
    fields: {
        active: '_fireballActive',
        timer: '_fireballTimer',
        cooldown: '_fireballCooldown',
        spikes: '_fireballSpikes', // 内部统一数组（原系统单对象，经 alias 暴露）
        alias: '_fireball',        // GameScene 渲染兼容字段
    },
    img: { field: '_fireballImg', src: 'assets/skills/fireball_spritesheet.png' },
    anim: { totalFrames: 73, hoverMs: 100, flyMs: 50 },
    spawnText: () => '🔥 火球凝聚',
    makeProjectiles(effect, source) {
        const radius = ((source && source.groundRadius) || 40) + 26;
        return [{
            id: 0,
            active: true,
            launched: false,
            offsetX: 0, // 以施法者圆柱体碰撞体积中心生成（y 抬升由渲染层按 bodyHeight/2 处理）
            offsetY: 0,
            elev: ((source && source.bodyHeight) || 120) * 0.5, // 圆柱体碰撞体积垂直中心
            orbitAngle: 0, // 发射前待机：绕施法者圆柱体椭圆轨道环绕
            orbitRx: radius,
            orbitRy: radius * 0.7,
            orbitSpeed: 0.0018,
            flyX: 0, flyY: 0,
            flyAngle: 0,
            flySpeed: effect.flySpeed,
            flyDistance: 0,
            flyActive: false,
            animTimer: 0,
            frameIndex: 0,
            swayTimer: 0,
            swayFreqX: 1.5,
            swayAmpX: 2,
            scale: 1.0,
        }];
    },
    trail: {
        intervalMs: 50,
        backOffset: 14,
        destroyAfterMs: 500,
        config: {
            speed: { min: 0, max: 40 },
            scale: { start: 1.2, end: 0.1 },
            alpha: { start: 0.7, end: 0 },
            lifespan: 350,
            tint: [0xffd27a, 0xff8830, 0xff5510],
            blendMode: 'ADD',
        },
    },
    addSkillExp(source, hitCount, killCount) {
        SkillManager.addFireballExp(source, hitCount, killCount);
    },
    // 命中/撞墙：范围爆炸（特效三层 + AOE 距离衰减）
    onImpact(sys, spike, { x, y, entities, damage, effect, skill }) {
        const radius = effect.explosionRadius;
        // 命中音效（skills.json fireball.sounds.hit 配置驱动；命中/撞墙/到射程爆炸同点播放）
        const hitSound = skillsData.skills?.fireball?.sounds?.hit;
        if (hitSound && SoundManager && typeof SoundManager.playFile === 'function') {
            SoundManager.playFile(hitSound);
        }
        // 爆炸特效：① 冲击波扩散圈 ② ADD 火焰爆发 ③ 烟尘余韵
        fireGroundShockwave({
            x, y, maxRadius: radius,
            strokeColor: 0xff7020, fillColor: 0xff9540,
            lineWidth: 7, duration: 420, flicker: true,
        });
        burstParticles({
            texture: 'impact_dot', x, y, count: 26, jitter: radius * 0.25,
            config: {
                speed: { min: 120, max: 420 },
                scale: { start: 2.8, end: 0.2 },
                alpha: { start: 0.9, end: 0 },
                lifespan: { min: 350, max: 600 },
                tint: [0xffffff, 0xffd27a, 0xff8830, 0xff5510],
                blendMode: 'ADD',
            },
            destroyAfterMs: 800, depth: y + 60,
        });
        burstParticles({
            texture: 'smoke_particle', x, y, count: 8, jitter: radius * 0.2,
            config: {
                speed: { min: 20, max: 70 },
                scale: { start: 1.5, end: 3.5 },
                alpha: { start: 0.35, end: 0 },
                lifespan: { min: 700, max: 1100 },
                tint: 0x555555,
            },
            destroyAfterMs: 1300, depth: y + 55,
        });
        sys._explodeAoE(x, y, damage, radius, entities, skill);
        spike.flyActive = false;
        spike.active = false;
    },
    // 到达最大射程：原地爆炸
    onMaxRange(sys, spike, ctx) {
        this.onImpact(sys, spike, { ...ctx, x: spike.flyX, y: spike.flyY });
    },
};

export class FireballSystem extends BoltSkillSystem {
    constructor(source, options = {}) {
        super(source, FIREBALL_KIND, options);
    }
}
