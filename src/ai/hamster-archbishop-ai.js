import { HamsterPriestAI } from './hamster-priest-ai.js';
import { SanctuaryDomainSystem } from '../entities/components/sanctuary-domain-system.js';

const FRIENDLY_FACTIONS = new Set(['player', 'companion']);

/** 大主教在牧师决策链之前尝试释放圣辉领域，其余行为完全沿用牧师 AI。 */
export class HamsterArchbishopAI extends HamsterPriestAI {
    constructor(archbishop) {
        super(archbishop);
        this._sanctuary = new SanctuaryDomainSystem(archbishop);
    }

    update(dt, entities, player) {
        this._sanctuary.update(dt, entities);
        super.update(dt, entities, player);
    }

    updateProjectilesWhileControlled(dt, entities) {
        // 已展开的领域独立计时，控制不能延长其持续时间。
        this._sanctuary.update(dt, entities);
    }

    _tick(entities, player) {
        if (this._trySanctuary(entities, player)) return;
        super._tick(entities, player);
    }

    _trySanctuary(entities, player) {
        const m = this.m;
        if (this._castActive || (m._command?.mode && m._command.mode !== 'follow')) return false;
        if (!m.skills?.sanctuaryDomain || m._sanctuaryDomainCooldown > 0
            || this._sanctuary.isActive()) return false;
        const radius = Math.max(1, Number(this.cfg.sanctuaryTriggerRadius) || 320);
        const minHostiles = Math.max(1, Math.floor(Number(this.cfg.sanctuaryMinHostiles) || 2));
        const candidates = new Set(
            entities?.values ? entities.values() : (Array.isArray(entities) ? entities : [])
        );
        if (player) candidates.add(player);
        candidates.add(m);
        let woundedFriend = false;
        let hostiles = 0;
        for (const entity of candidates) {
            if (!entity || entity.active === false || entity === m) continue;
            if (Math.hypot(entity.x - m.x, entity.y - m.y) > radius) continue;
            if (FRIENDLY_FACTIONS.has(entity._faction)) {
                const hp = entity.data?.hp ?? entity.hp;
                const maxHp = entity.data?.maxHp ?? entity.maxHp;
                if (hp > 0 && maxHp > hp) woundedFriend = true;
            } else if (entity._faction === 'enemy' && entity.hittable && entity.hp > 0) {
                hostiles++;
            }
        }
        if (!woundedFriend && hostiles < minHostiles) return false;
        this._startPrayerCast('sanctuary', { entities, player });
        return true;
    }

    _releaseSpecialCast(kind) {
        if (kind !== 'sanctuary') return false;
        this._sanctuary.trigger();
        return true;
    }

    clear() {
        this._sanctuary.clearDomain();
    }
}
