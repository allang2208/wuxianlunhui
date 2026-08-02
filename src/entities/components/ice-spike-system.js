import { SkillManager } from '../../ui/skill-manager.js';
import { BoltSkillSystem } from './bolt-skill-system.js';
import { burstParticles, fireGroundShockwave } from '../../effects/combat-fx.js';
import { SoundManager } from '../../ui/sound-manager.js';
import skillsData from '../../../data/skills.json';

/**
 * 冰锥系统（通用版）——BoltSkillSystem 的冰锥 kind 封装。
 * 支持玩家与敌人作为施法者（source）；玩家通过鼠标瞄准，非玩家自动瞄准 source.target。
 * 差异点：N 颗悬浮冰锥（身后扇形）→ 全部发射 → 命中/撞墙 = 碎裂（同帧可多目标结算）；
 * 到达最大射程 = 静默消失（无特效）。
 */

// 命中音效节流（防同帧多颗冰锥刷音，与近战命中音效同口径 90ms）
let _iceHitSoundCd = 0;

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
    makeProjectiles(effect, source) {
        const projectiles = [];
        // 立体环绕：围绕施法者圆柱体碰撞体积——水平角度均分 + 垂直高度沿圆柱体螺旋分布
        const radius = ((source && source.groundRadius) || 40) + 18;
        const orbitRx = radius;
        const orbitRy = radius * 0.65; // 椭圆轨道（发射前待机环绕）
        const bodyH = (source && source.bodyHeight) || 120;
        const startAngle = -Math.PI / 2;
        for (let i = 0; i < effect.spikeCount; i++) {
            const angle = startAngle + (i / effect.spikeCount) * Math.PI * 2;
            // elev：圆柱体高度方向位置（0=地面，bodyH=顶沿），从下沿到上沿均匀铺开
            const elev = bodyH * (0.12 + 0.76 * (effect.spikeCount > 1 ? i / (effect.spikeCount - 1) : 0.5));
            projectiles.push({
                id: i,
                offsetX: Math.cos(angle) * radius,
                offsetY: Math.sin(angle) * radius,
                elev,
                orbitAngle: angle, // 初始环绕角（环形分布）
                orbitRx,
                orbitRy,
                orbitSpeed: 0.0015 + (i % 2) * 0.0002, // 相邻错速，避免整体刚性转圈
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
        // 命中音效：命中目标/撞墙都播放（V0.374 调整；skills.json iceSpike.sounds.hit 配置驱动；
        // 90ms 节流防同帧多颗刷音）；伤害/经验只在命中目标时结算
        const now = (typeof performance !== 'undefined' ? performance.now() : Date.now());
        const hitSound = skillsData.skills?.iceSpike?.sounds?.hit;
        if (hitSound && now >= _iceHitSoundCd && SoundManager && typeof SoundManager.playFile === 'function') {
            _iceHitSoundCd = now + 90;
            SoundManager.playFile(hitSound);
        }
        if (hitEntity) {
            const wasAlive = hitEntity.hp > 0;
            hitEntity.takeDamage(damage, sys.source, 'magic');
            // 经验改为整次施法累计（multiHit/multiKill 需要整次命中/击杀数），_end 清场时统一结算
            if (skill && sys._isPlayer()) {
                sys._castHits = (sys._castHits || 0) + 1;
                if (wasAlive && hitEntity.hp <= 0 && !hitEntity._summoned) {
                    sys._castKills = (sys._castKills || 0) + 1;
                }
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
        this._castHits = 0;  // 整次施法累计命中数（multiHit/multiKill 依赖整次统计）
        this._castKills = 0; // 整次施法累计击杀数
    }

    /** 整次施法结束后统一结算经验（全部冰锥命中/飞完/超时后清场时 flush） */
    _end(forced) {
        super._end(forced);
        if (this._spikes().length === 0 && this._castHits > 0 && this._isPlayer()) {
            SkillManager.addIceSpikeExp(this.source, this._castHits, this._castKills);
            this._castHits = 0;
            this._castKills = 0;
        }
    }
}
