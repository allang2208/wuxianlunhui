import { Enemy } from '../entities/enemy.js';
import buildings from '../../data/producer-buildings.json';

// A tactical siege objective. It never joins the player's building/production registries.
export class StrategicStructure extends Enemy {
    constructor(siteId, record) {
        super(record.x, record.y, { id: `objective_${siteId}_${record.key}`, name: record.name,
            hp: record.hp, maxHp: record.maxHp, speed: 0, size: 70, collisionRadius: 70,
            def: record.def, mdef: record.def, showWeapon: false });
        this.cfgKey = record.visual;
        this._strategicStructure = true;
        this._strategicStructureKey = record.key;
        this._isEnemyEntity = false;
        this._noGoldDrop = true;
        this.immovable = true;
        this.noSeparation = true;
        this.attacks = {};
        this.config.render = { spriteSize: 300 };
        this.hp = record.hp; this.maxHp = record.maxHp;
        Object.assign(this.data, { hp: this.hp, maxHp: this.maxHp, def: record.def, mdef: record.def });
        this.footOffsetY = 70;
    }
    _getTextureKey() { return buildings[this.cfgKey]?.tex || 'explorer_camp'; }
    _getPhaserOptions() { return { spriteSize: 300, flipX: false, tint: 0xe8bab0 }; }
    update(dt) {
        if (!this.active) return;
        this.updateStatusEffects?.(dt);
        this.hitFlash = Math.max(0, (this.hitFlash || 0) - dt);
        this.vx = this.vy = 0;
    }
    onDeath() {
        this.hp = 0; this.data.hp = 0; this.active = false;
        this._destroyPhaserSprite?.();
    }
}
