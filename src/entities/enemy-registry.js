import * as implementations from './enemy-types.js';
import enemies from '../../data/enemy-config.json';

// Content declares its constructor once. Existing dungeon decorators remain in
// that mode; neither looking up a class nor building a pool creates an entity.
export function enemyConstructor(type) {
    const name = enemies[type]?.entityClass;
    return typeof implementations[name] === 'function' ? implementations[name] : null;
}

export function createRegisteredEnemy(type, x, y, { mode = 'invasion', overrides = {} } = {}) {
    const Constructor = enemyConstructor(type), config = enemies[type];
    if (!Constructor || !config) return null;
    const unit = new Constructor(x, y, {
        ...config, showWeapon: false,
        ...(mode === 'dungeon' ? { ai: { ...config.ai, aggroRange: 9999, loseTimeout: 999999, alertRange: 9999 } } : {}),
        ...overrides,
    });
    unit._enemyTypeKey = type;
    for (const [property, childType] of Object.entries(config.entityBindings || {})) {
        unit[property] = (childX, childY) => createRegisteredEnemy(childType, childX, childY, { mode });
    }
    return unit;
}

export function registeredEnemyFactories(mode = 'dungeon') {
    // Delay export lookup until invocation to preserve existing module cycles.
    return Object.fromEntries(Object.entries(enemies).filter(([, config]) => config.entityClass
        && (mode !== 'dungeon' || config.dungeonAutoFactory !== false))
        // CombatRoomSystem instantiates dungeon factories with `new`. A regular
        // function remains callable by other consumers and, when constructed,
        // explicitly returns the registered enemy entity.
        .map(([type]) => [type, function RegisteredEnemyFactory(x, y) {
            const unit = createRegisteredEnemy(type, x, y, { mode });
            if (!unit && new.target) throw new Error(`怪物工厂未能构造实体：${type}`);
            return unit;
        }]));
}
