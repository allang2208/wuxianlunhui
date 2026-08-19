// ============================================================
// HamsterPriestAI — 仓鼠牧师（世界-122）
// - 默认跟随玩家，不进行普通攻击；
// - 圣光冷却就绪即施放：所有受伤友军优先，按缺血比例/缺血量选择；
// - 无受伤友军时，以最近敌人为目标施放圣光协助战斗；
// - praying 动画第 8 帧实际结算圣光，移动复用 MovementSystem。
// ============================================================
import { MovementSystem } from '../systems/movement-system.js';
import { WallSystem } from '../world/wall-system.js';
import { HolyLightSystem } from '../entities/components/holy-light-system.js';
import { getAbilityLevel, getAbilityValue } from '../world/ability-store.js';
import { getBuildingUpgradeAbility } from '../world/building-upgrade-projects.js';
import { EnergyManager } from '../systems/energy-manager.js';
import { clearRtsSurfaceRoute, resolveRtsMoveDestination } from './rts-command-utils.js';

const INSPIRE_MAGIC = getBuildingUpgradeAbility('inspire_magic') || {};

export class HamsterPriestAI {
    constructor(priest) {
        this.m = priest;
        this.cfg = priest.aiConfig || {};
        this._holyLight = new HolyLightSystem(priest);
        this._decisionTimer = 0;
        this._castActive = false;
        this._castKind = null;
        this._releaseDone = false;
        this._pendingTarget = null;
        this._pendingEntities = null;
        this._pendingPlayer = null;
        this._releaseLeft = 0;
        this._castAnimLeft = 0;
        this._holyLightCooldownMult = this.cfg.holyLightCooldownMult ?? 1;
        this._titheEnergyPerTick = this.cfg.titheEnergyPerTick ?? 0;
        this._titheIntervalMs = this.cfg.titheIntervalMs ?? 0;
        this._titheTimer = 0;
        this._inspireMagicCooldown = 0;
        this._stuckTimer = 0;
        this._lastPosX = priest.x;
        this._lastPosY = priest.y;
        this._stuckStreak = 0;
    }

    applyUpgrades(patch = {}) {
        if (Number.isFinite(patch.holyLightCooldownMult)) {
            const oldMult = this._holyLightCooldownMult || 1;
            this._holyLightCooldownMult = patch.holyLightCooldownMult;
            // 已进入冷却的牧师也立即得到升级后的剩余时间，不必等下一次施法。
            if (this.m._holyLightCooldown > 0) {
                this.m._holyLightCooldown *= this._holyLightCooldownMult / oldMult;
            }
        }
        if (Number.isFinite(patch.castRange)) this.cfg.castRange = patch.castRange;
        if (Number.isFinite(patch.titheEnergyPerTick)) {
            this._titheEnergyPerTick = Math.max(0, Math.floor(patch.titheEnergyPerTick));
            this._titheIntervalMs = Math.max(0, Math.floor(patch.titheIntervalMs || 0));
            if (this._titheEnergyPerTick <= 0 || this._titheIntervalMs <= 0) this._titheTimer = 0;
        }
    }

    cancelForCommand() {
        // 施法是不可打断状态：移动/待命指令等当前 praying 播完后再由下一轮决策接管。
        if (this._castActive) return false;
        this._castActive = false;
        this._castKind = null;
        this._pendingTarget = null;
        this._pendingEntities = null;
        this._pendingPlayer = null;
        this.m._prayerCast = false;
        this.m._animState = 'idle';
        this.m._castState = 'idle';
        this.m.vx = 0;
        this.m.vy = 0;
        this.m.isMoving = false;
        return true;
    }

    update(dt, entities, player) {
        const m = this.m;
        if (m._dying || m.data.hp <= 0) return;
        this._holyLight.update(dt);
        this._inspireMagicCooldown = Math.max(0, this._inspireMagicCooldown - dt);
        this._updateTithe(dt);

        if (this._castActive) {
            this._updateCast(dt);
            return;
        }

        this._decisionTimer -= dt;
        if (this._decisionTimer <= 0) {
            this._decisionTimer = this.cfg.decisionMs ?? 120;
            this._tick(entities, player);
        }
        // 本决策帧刚起手时同样立即锁定，禁止 MovementSystem 抢走 praying 状态。
        if (this._castActive) {
            this._updateCast(0);
            return;
        }

        MovementSystem.update(m, dt, entities);
        this._checkStuck(dt);
    }

    /** 教堂什一税：仅有仓库时，每名牧师按升级项目的周期独立提供能源。 */
    _updateTithe(dt) {
        if (!(this._titheEnergyPerTick > 0) || !(this._titheIntervalMs > 0)
            || !EnergyManager?.hasWarehouse?.()) {
            this._titheTimer = 0;
            return;
        }
        this._titheTimer += Math.max(0, dt || 0);
        const ticks = Math.floor(this._titheTimer / this._titheIntervalMs);
        if (ticks <= 0) return;
        this._titheTimer -= ticks * this._titheIntervalMs;
        EnergyManager.depositEnergy(this._titheEnergyPerTick * ticks);
    }

    _updateCast(dt) {
        const m = this.m;
        m.vx = 0;
        m.vy = 0;
        m.isMoving = false;
        m.maxSpeed = 0;
        m._animState = 'spell';
        m._castState = 'casting';

        if (!this._releaseDone) {
            this._releaseLeft -= dt;
            if (this._releaseLeft <= 0) {
                this._releaseDone = true;
                if (this._castKind === 'holyLight'
                    && this._pendingTarget?.active
                    && this._holyLight.triggerOn(this._pendingTarget)) {
                    // HolyLightSystem 已按技能与装备修正写入基础 CD；教堂的施法加速再乘一次。
                    m._holyLightCooldown *= this._holyLightCooldownMult;
                } else if (this._castKind === 'inspire') {
                    this._releaseInspireMagic(this._pendingEntities, this._pendingPlayer);
                }
            }
        }

        this._castAnimLeft -= dt;
        if (this._castAnimLeft > 0) return;
        this._castActive = false;
        this._castKind = null;
        this._pendingTarget = null;
        this._pendingEntities = null;
        this._pendingPlayer = null;
        m._prayerCast = false;
        m._animState = 'idle';
        m._castState = 'idle';
    }

    _tick(entities, player) {
        const m = this.m;
        if (this._castActive) return;
        const command = m._command;
        if (command?.mode && command.mode !== 'follow') {
            this._applyCommand(command);
            return;
        }
        const target = this._pickHolyLightTarget(entities, player);
        if (target && m._holyLightCooldown <= 0 && m.skills?.holyLight) {
            this._startPrayerCast('holyLight', { target });
            return;
        }
        if (this._tryInspireMagic(entities, player)) return;
        this._followPlayer(player);
    }

    /** RTS 指令：移动/待命优先于自动施法；指定攻击用圣光锁定目标。 */
    _applyCommand(command) {
        const m = this.m;
        if (command.mode !== 'move') clearRtsSurfaceRoute(m);
        if (command.mode === 'move') {
            m.target = null;
            const move = resolveRtsMoveDestination(m, command);
            if (!move.arrived) {
                m._tacticalTarget = move.destination;
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 120;
            } else {
                m._command = { mode: 'follow' };
                clearRtsSurfaceRoute(m);
                this._stop();
            }
            return;
        }
        if (command.mode === 'attack') {
            const target = command.target;
            if (!target || !target.active || target.hp <= 0 || target._isEnergyNode) {
                m._command = { mode: 'follow' };
                m.target = null;
                this._stop();
                return;
            }
            const castRange = this.cfg.castRange ?? 600;
            const distance = Math.hypot(target.x - m.x, target.y - m.y);
            if (distance <= castRange && m._holyLightCooldown <= 0 && m.skills?.holyLight) {
                this._startPrayerCast('holyLight', { target });
            } else if (distance > castRange) {
                m.target = target;
                m._tacticalTarget = { x: target.x, y: target.y };
                m._animState = 'walk';
                m.maxSpeed = this.cfg.walkSpeed ?? 120;
            } else {
                m.target = target;
                this._stop();
            }
            return;
        }
        m.target = null;
        this._stop();
    }

    /** 圣光与激励共用同一条 praying 状态机：起手后锁定到动画结束，统一在第 8 帧结算。 */
    _startPrayerCast(kind, { target = null, entities = null, player = null } = {}) {
        const m = this.m;
        const spell = m.animations?.spell || {};
        const fps = this.cfg.castAnimFps ?? spell.frameRate ?? 12;
        const releaseFrame = this.cfg.castReleaseFrame ?? 8;
        const frameCount = spell.frameCount ?? 17;
        this._castActive = true;
        this._castKind = kind;
        this._releaseDone = false;
        this._pendingTarget = target;
        this._pendingEntities = entities;
        this._pendingPlayer = player;
        this._releaseLeft = Math.max(0, (releaseFrame - 1) / fps * 1000);
        this._castAnimLeft = frameCount / fps * 1000 + 60;
        m.target = target;
        m._tacticalTarget = null;
        m._prayerCast = true;
        m._animState = 'spell';
        m._castState = 'casting';
        const faceTarget = target || player || m;
        m.rotation = Math.atan2(faceTarget.y - m.y, faceTarget.x - m.x);
        m._lastFaceRight = faceTarget.x >= m.x;
    }

    /** 铁匠铺研究「激励魔法」：起手也必须走 praying；第 8 帧才真正施加 buff。 */
    _tryInspireMagic(entities, player) {
        const level = getAbilityLevel('inspire_magic');
        if (level <= 0 || this._inspireMagicCooldown > 0) return false;
        const duration = getAbilityValue(INSPIRE_MAGIC, level);
        if (!(duration > 0)) return false;
        this._startPrayerCast('inspire', { entities, player });
        return true;
    }

    /** praying 第 8 帧结算：只对牧师范围内的友军施加既有激励。 */
    _releaseInspireMagic(entities, player) {
        const level = getAbilityLevel('inspire_magic');
        if (level <= 0) return 0;
        const duration = getAbilityValue(INSPIRE_MAGIC, level);
        if (!(duration > 0)) return 0;
        const m = this.m;
        const radius = INSPIRE_MAGIC.radius ?? 300;
        const radiusSq = radius * radius;
        const friends = new Set();
        if (player?.active !== false) friends.add(player);
        friends.add(m);
        const game = typeof window !== 'undefined' ? window.Game : null;
        for (const friend of game?.friendlyUnits || []) friends.add(friend);
        for (const friend of game?.PartySystem?.members || []) friends.add(friend);
        const allEntities = [...(entities?.values ? entities.values() : entities || [])];
        for (const entity of allEntities) {
            if (entity?._faction === 'player' || entity?._faction === 'companion') friends.add(entity);
        }
        let affected = 0;
        for (const friend of friends) {
            if (!friend || friend.active === false || typeof friend.applyInspire !== 'function') continue;
            if (friend._faction !== 'player' && friend._faction !== 'companion') continue;
            const dx = friend.x - m.x;
            const dy = friend.y - m.y;
            if (dx * dx + dy * dy > radiusSq) continue;
            friend.applyInspire(duration, {
                speedMul: INSPIRE_MAGIC.speedMul ?? 1.33,
                atkMul: INSPIRE_MAGIC.atkMul ?? 1.5,
            });
            affected++;
        }
        this._inspireMagicCooldown = INSPIRE_MAGIC.cooldownMs ?? 30000;
        return affected;
    }

    /** 受伤友军优先；无受伤友军时才以最近敌人作为圣光伤害目标。 */
    _pickHolyLightTarget(entities, player) {
        const m = this.m;
        const friends = new Set();
        if (player?.active !== false) friends.add(player);
        friends.add(m);
        const game = typeof window !== 'undefined' ? window.Game : null;
        for (const friend of game?.friendlyUnits || []) friends.add(friend);
        for (const friend of game?.PartySystem?.members || []) friends.add(friend);
        const allEntities = [...(entities?.values ? entities.values() : entities || [])];
        for (const entity of allEntities) {
            if (entity?._faction === 'player' || entity?._faction === 'companion') friends.add(entity);
        }

        let bestFriend = null;
        let bestRatio = 0;
        let bestMissing = 0;
        const castRange = this.cfg.castRange ?? 600;
        for (const friend of friends) {
            if (!friend || friend.active === false) continue;
            if (friend._faction !== 'player' && friend._faction !== 'companion') continue;
            if (Math.hypot(friend.x - m.x, friend.y - m.y) > castRange) continue;
            const hp = friend.data?.hp ?? friend.hp;
            const maxHp = friend.data?.maxHp ?? friend.maxHp;
            if (!(hp > 0) || !(maxHp > hp)) continue;
            const missing = maxHp - hp;
            const ratio = missing / maxHp;
            if (ratio > bestRatio || (ratio === bestRatio && missing > bestMissing)) {
                bestFriend = friend;
                bestRatio = ratio;
                bestMissing = missing;
            }
        }
        if (bestFriend) return bestFriend;

        let nearestEnemy = null;
        let nearestDist = Infinity;
        for (const entity of allEntities) {
            if (!entity || !entity.active || entity.hp <= 0) continue;
            if (entity._faction !== 'enemy' || entity._isEnergyNode) continue;
            const dist = Math.hypot(entity.x - m.x, entity.y - m.y);
            if (dist <= (this.cfg.castRange ?? 600) && dist < nearestDist) {
                nearestEnemy = entity;
                nearestDist = dist;
            }
        }
        return nearestEnemy;
    }

    _followPlayer(player) {
        const m = this.m;
        m.target = null;
        if (!player) {
            this._stop();
            return;
        }
        const target = { x: player.x - (this.cfg.followOffset ?? 150), y: player.y };
        if (Math.hypot(target.x - m.x, target.y - m.y) <= (this.cfg.followArriveDist ?? 40)) {
            this._stop();
            return;
        }
        m._tacticalTarget = target;
        m._animState = 'walk';
        m.maxSpeed = this.cfg.walkSpeed ?? 120;
    }

    _stop() {
        const m = this.m;
        m._tacticalTarget = null;
        m._animState = 'idle';
        m.maxSpeed = 0;
        m.vx = 0;
        m.vy = 0;
        m.isMoving = false;
        if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
            m._pathManager._clearPath();
        }
    }

    _checkStuck(dt) {
        const m = this.m;
        if (m._animState !== 'walk') {
            this._stuckTimer = 0;
            this._lastPosX = m.x;
            this._lastPosY = m.y;
            return;
        }
        this._stuckTimer += dt;
        if (this._stuckTimer < 500) return;
        this._stuckTimer = 0;
        const moved = Math.hypot(m.x - this._lastPosX, m.y - this._lastPosY);
        this._lastPosX = m.x;
        this._lastPosY = m.y;
        if (moved > 3) {
            this._stuckStreak = 0;
            return;
        }
        this._stuckStreak++;
        if (this._stuckStreak < 2) return;
        this._stuckStreak = 0;
        if (WallSystem && typeof WallSystem.findSafeSpawn === 'function') {
            const safe = WallSystem.findSafeSpawn(m.x, m.y, m.groundRadius || 20);
            if (safe && Number.isFinite(safe.x) && Number.isFinite(safe.y)) {
                m.x = safe.x;
                m.y = safe.y;
            }
        }
        if (m._pathManager && typeof m._pathManager._clearPath === 'function') {
            m._pathManager._clearPath();
        }
    }
}
