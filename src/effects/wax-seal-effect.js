import { DamagePipeline } from '../combat/damage-pipeline.js';
import { getAttackLineOfSightIgnore } from '../combat/melee-reach.js';
import { applyWaxSealSlow } from '../combat/wax-seal-status.js';
import { canAttackDefenseTarget } from '../ai/defense-target-priority.js';
import { isFriendlyFire } from '../entities/damageable-entity.js';
import { PERSPECTIVE_SCALE_Y } from '../config/perspective-config.js';
import { GroundEllipse } from '../physics/skill-shapes.js';
import { surfaceEffectFromEntity } from '../physics/elevation.js';
import { PartySystem } from '../systems/party-system.js';
import { WallSystem } from '../world/wall-system.js';

// 墙体集合与高架身份在释放时冻结；后续施法者移动/死亡不会改变已释放蜡印。
function snapshotIgnore(ignore) {
    return {
        segs: new Set(ignore?.segs || []), rects: new Set(ignore?.rects || []),
        surfaceEntity: ignore?.surfaceEntity ? {
            z: ignore.surfaceEntity.z, _surfaceKind: ignore.surfaceEntity._surfaceKind,
            _elevatedNavigationBridge: ignore.surfaceEntity._elevatedNavigationBridge,
        } : null,
    };
}

/** 固定 900ms 预警 -> 一次伤害 -> 短促消散。与施法者的后摇、死亡计时互不依赖。 */
export class WaxSealEffect {
    constructor(source, target, skill, entities, releaseOvershootMs = 0) {
        this.active = true;
        this.x = target.collider?.x ?? target.x;
        this.y = target.collider?.y ?? target.y;
        this.surface = surfaceEffectFromEntity(target);
        this.source = source;
        this._entities = entities;
        this._sourceIdentity = { _faction: source._faction, _isHumanoid: source._isHumanoid,
            attacks: { ranged: source.attacks?.ranged } };
        this._origin = { x: source.collider.x, y: source.collider.y };
        this._castIgnore = snapshotIgnore(getAttackLineOfSightIgnore(source, target));
        this._surfaceIgnore = snapshotIgnore(WallSystem.ignoreForEntity(source));
        this._skill = { ...skill };
        this._damage = Math.max(1, Math.round(source.data.matk * skill.damageMul));
        this._age = 0;
        // Game 的实体更新先于 EffectManager；首次只消费释放帧跨过事件点的余量，
        // 不能再次加上整帧 dt，否则预警会比标称 900ms 提前结束。
        this._firstStepMs = releaseOvershootMs;
        this._consumed = false;
        this._graphics = null;
        this._sceneId = typeof window !== 'undefined' ? window.SceneManager?.currentScene : null;
        this._dungeonCombat = this._sceneId === 'scene7' && !!window.DungeonMapSystem?.active;
        const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
        if (scene) {
            this._graphics = scene.add.graphics();
            this._graphics.setPosition(this.x, this.y - this.surface.z);
            this._graphics.setDepth(this.y - 998);
            scene.worldEffectsGroup?.add(this._graphics);
            this._redraw();
        }
    }

    getFogPosition() { return { x: this.x, y: this.y }; }
    getFogVisuals() { return this._graphics; }

    update(dt) {
        if (!this.active) return;
        if (typeof window !== 'undefined') {
            const dungeon = window.DungeonMapSystem;
            // 奖励/地图面板仍更新普通特效，但已结束的战斗不能继续伤害玩家。
            if ((this._sceneId && window.SceneManager?.currentScene !== this._sceneId)
                || (this._dungeonCombat && (!dungeon?.active
                    || !['combat', 'boss'].includes(dungeon.state)))) {
                this._destroyPhaserSprite();
                return;
            }
        }
        this._age += this._firstStepMs ?? Math.max(0, dt);
        this._firstStepMs = null;
        if (!this._consumed && this._age >= this._skill.warningMs) {
            this._consumed = true; // 先消费，伤害/死亡回调不能产生第二次爆发。
            this._detonate();
        }
        if (!this.active) return;
        if (this._age >= this._skill.warningMs + this._skill.burstVisualMs) {
            this._destroyPhaserSprite();
            return;
        }
        this._redraw();
    }

    _detonate() {
        // 预警期间新出现的遮挡也有效；检查释放原点到固定落点，不读施法者新位置。
        if (WallSystem.blocked(this._origin.x, this._origin.y, this.x, this.y, this._castIgnore)) return;
        const skill = this._skill;
        const shape = new GroundEllipse(this.x, this.y, skill.radius,
            skill.radius * PERSPECTIVE_SCALE_Y, this.surface);
        const game = typeof window !== 'undefined' ? window.Game : null;
        // 世界观察会恢复为新的 Map；结算读取当前战斗实体表，不持有已经清空的旧 Map。
        const entities = game?.entities || this._entities;
        const supplied = entities?.values ? entities.values() : (entities || []);
        const targets = new Set(supplied);
        for (const member of PartySystem.members || []) targets.add(member);
        if (game?.player) targets.add(game.player);
        for (const unit of game?.friendlyUnits || []) targets.add(unit);
        for (const target of targets) {
            if (!this.active) break;
            if (!target?.active || target._isDead || target.hp <= 0 || target.hittable === false
                || target._faction === this._sourceIdentity._faction
                || isFriendlyFire(this._sourceIdentity, target)
                || !canAttackDefenseTarget(this._sourceIdentity, target)
                || !shape.intersectsEntity(target)) continue;
            const ignore = { ...this._surfaceIgnore,
                segs: new Set(this._surfaceIgnore.segs), rects: new Set(this._surfaceIgnore.rects) };
            if (target._coverSeg) ignore.segs.add(target._coverSeg);
            if (target._gateSeg) ignore.segs.add(target._gateSeg);
            if (target._wallRect) ignore.rects.add(target._wallRect);
            if (WallSystem.blocked(this.x, this.y, target.collider.x, target.collider.y, ignore)) continue;
            const hpBefore = target.hp;
            const result = DamagePipeline.applyHit(this.source, target, {
                damage: this._damage, damageType: 'magic', isMelee: false, currentWeapon: null,
                knockback: 0, angle: Math.atan2(target.collider.y - this.y, target.collider.x - this.x),
                confirmedHitContext: { skillId: 'waxfaceMourner.waxSeal' },
            });
            // 闪避无敌、弹反、调试无敌以及零伤害均不附加减速；状态免疫走状态入库门禁。
            if (result.hit && !result.parried && target.hp < hpBefore) {
                applyWaxSealSlow(target, skill.slowDurationMs, skill.slowReduction);
            }
        }
    }

    _redraw() {
        const g = this._graphics;
        if (!g?.active) return;
        const radius = this._skill.radius;
        const p = Math.min(1, this._age / this._skill.warningMs);
        const burst = this._consumed;
        const fade = burst ? Math.max(0, 1 - (this._age - this._skill.warningMs) / this._skill.burstVisualMs) : 1;
        g.clear();
        g.fillStyle(burst ? 0xd4b090 : 0x7e2f35, (burst ? .25 : .12 + p * .1) * fade);
        g.fillEllipse(0, 0, radius * 2, radius * 2 * PERSPECTIVE_SCALE_Y);
        g.lineStyle(burst ? 4 : 2, burst ? 0xf0d5ae : 0xdd6560, .85 * fade);
        // 固定外圈与 GroundEllipse 的两轴完全相同；内圈只表示倒计时，不扩大伤害区。
        g.strokeEllipse(0, 0, radius * 2, radius * 2 * PERSPECTIVE_SCALE_Y);
        const inner = radius * (burst ? .45 + .55 * (1 - fade) : Math.max(.08, 1 - p));
        g.lineStyle(2, 0xcda785, .8 * fade);
        g.strokeEllipse(0, 0, inner * 2, inner * 2 * PERSPECTIVE_SCALE_Y);
        for (let i = 0; i < 4; i++) {
            const a = Math.PI / 4 + i * Math.PI / 2;
            g.lineBetween(Math.cos(a) * radius * .35, Math.sin(a) * radius * .35 * PERSPECTIVE_SCALE_Y,
                Math.cos(a) * radius * .7, Math.sin(a) * radius * .7 * PERSPECTIVE_SCALE_Y);
        }
    }

    // EffectManager 场景清理的既有钩子；销毁后既无残留图形也不能再结算伤害。
    _destroyPhaserSprite() {
        this.active = false;
        this._graphics?.destroy();
        this._graphics = null;
        this.source = null;
        this._entities = null;
    }
}
