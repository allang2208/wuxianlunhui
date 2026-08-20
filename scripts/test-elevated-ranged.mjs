/**
 * 城墙高架远程战斗契约：
 * - 友方 wall_walk 保留 20% 射程；楼梯与敌人无加成；
 * - 墙顶弹体忽略发射时的整块承托平台，楼梯弹体照常被墙阻挡；
 * - 墙下射墙顶只允许目标模型命中越过其承托墙；
 * - 友军弹体撞友军墙仅截停，敌军弹体撞友军墙扣耐久。
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
    applyProjectileWallImpact,
    applyElevatedRangedRange,
    canUseWallTopModelException,
    getElevatedRangedRangeMultiplier,
    projectileWallContext,
    wallHitSupportsTarget,
} = await import('../src/combat/elevated-ranged.js');
const {
    getMagicRangeMultiplier,
    getMagicAreaMultiplier,
} = await import('../src/utils/magic-craft-helper.js');
const { WallSystem } = await import('../src/world/wall-system.js');
const {
    hasRangedLineOfSight,
    rangedLineOfSightCacheToken,
} = await import('../src/combat/ranged-line-of-sight.js');

let passed = 0;
let failed = 0;
const check = (name, condition) => {
    if (condition) {
        passed++;
        console.log(`  ✓ ${name}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}`);
    }
};

const wallPlayer = { _faction: 'player', _surfaceKind: 'wall_walk', z: 125 };
const wallFriend = { _faction: 'companion', _surfaceKind: 'wall_walk', z: 125 };
const stairFriend = { _faction: 'companion', _surfaceKind: 'stairs', z: 90 };
const wallEnemy = { _faction: 'enemy', _surfaceKind: 'wall_walk', z: 125 };

check('楼梯底端即使 z=0 也使用独立 LOS 缓存身份',
    rangedLineOfSightCacheToken(
        { _surfaceKind: 'ground', z: 0 },
        { _surfaceKind: 'ground', z: 0 }
    ) !== rangedLineOfSightCacheToken(
        { _surfaceKind: 'stairs', z: 0, _surfaceStaircase: { id: 'stair_a' } },
        { _surfaceKind: 'ground', z: 0 }
    ));
check('墙梯拓扑版本变化会废弃旧 LOS 缓存',
    rangedLineOfSightCacheToken(
        { _surfaceKind: 'wall_walk', z: 125, _surfaceComponentId: 1,
            _elevatedState: { lastValidated: { revision: 1 } } },
        wallEnemy
    ) !== rangedLineOfSightCacheToken(
        { _surfaceKind: 'wall_walk', z: 125, _surfaceComponentId: 1,
            _elevatedState: { lastValidated: { revision: 2 } } },
        wallEnemy
    ));

check('玩家站墙顶射程倍率=1.2', getElevatedRangedRangeMultiplier(wallPlayer) === 1.2);
check('友军站墙顶基础 600 射程变 720', applyElevatedRangedRange(wallFriend, 600) === 720);
check('楼梯途中无射程加成', applyElevatedRangedRange(stairFriend, 600) === 600);
check('敌人站墙顶无友方加成', applyElevatedRangedRange(wallEnemy, 600) === 600);
check('魔法改造倍率与墙顶倍率乘算',
    Math.abs(getMagicRangeMultiplier({
        ...wallPlayer,
        equipments: { weapon: { _craftEffects: { magicRangePercent: 0.25 } } },
        weaponMode: 'weapon',
    }) - 1.5) < 1e-9);
check('墙顶加成只扩大最大射程，不扩大锁定/传导范围',
    Math.abs(getMagicAreaMultiplier({
        ...wallPlayer,
        equipments: { weapon: { _craftEffects: { magicRangePercent: 0.25 } } },
        weaponMode: 'weapon',
    }) - 1.25) < 1e-9);

const savedWalls = WallSystem.walls;
const savedSegments = WallSystem.isoSegments;
const savedHeight = WallSystem._wallHeight;
try {
    WallSystem.trees = [];
    WallSystem.isoSegments = [];
    WallSystem._wallHeight = 60;

    const wallA = { id: 'wall_a', active: true, hittable: true, _faction: 'player', _wallTopZ: 125 };
    const wallB = { id: 'wall_b', active: true, hittable: true, _faction: 'player', _wallTopZ: 125 };
    const rectA = { x: 20, y: -10, w: 20, h: 20, height: 125, _owner: wallA };
    const rectB = { x: 60, y: -10, w: 20, h: 20, height: 125, _owner: wallB };
    wallA._wallRect = rectA;
    wallB._wallRect = rectB;
    const platformSource = {
        ...wallPlayer,
        x: 0,
        y: 0,
        collider: { height: 40 },
        _surfaceWall: wallA,
        _surfaceWalls: [wallA, wallB],
    };
    const platformContext = projectileWallContext(platformSource);
    WallSystem.walls = [rectA, rectB];
    check('墙顶发射快照忽略整块承托平台',
        platformContext.ignoredProjectileWalls.has(wallA)
        && platformContext.ignoredProjectileWalls.has(wallB));
    check('墙顶向任意方向射出不被承托平台阻挡',
        !WallSystem.projectileBlocked(0, 0, 145, 100, 0, 20, platformContext));

    const stairContext = projectileWallContext({
        ...stairFriend,
        x: 0,
        y: 0,
        collider: { height: 40 },
        _surfaceWall: wallA,
        _surfaceWalls: [wallA, wallB],
    });
    check('楼梯发射不继承墙顶平台豁免',
        !stairContext.ignoredProjectileWalls.has(wallA)
        && WallSystem.projectileBlocked(0, 0, 110, 100, 0, 20, stairContext));
    check('楼梯来源不能使用墙顶模型优先例外',
        !canUseWallTopModelException({ _surfaceKind: 'stairs' })
        && canUseWallTopModelException({ _surfaceKind: 'ground' }));

    const unrelatedWall = { id: 'wall_c', active: true, hittable: true, _faction: 'player', _wallTopZ: 125 };
    const unrelatedRect = { x: 100, y: -10, w: 20, h: 20, height: 125, _owner: unrelatedWall };
    WallSystem.walls = [rectA, rectB, unrelatedRect];
    const firstWallHit = WallSystem.projectileWallHit(0, 0, 145, 140, 0, 20, platformContext);
    check('墙顶弹体仍会被非承托墙阻挡', firstWallHit?.owner === unrelatedWall);
    check('墙体首次命中返回交点与所属实体',
        Number.isFinite(firstWallHit?.t) && firstWallHit?.x >= 100);

    const wallTopTarget = {
        x: 120,
        y: 0,
        z: 125,
        _surfaceKind: 'wall_walk',
        _surfaceWall: unrelatedWall,
        _surfaceWalls: [unrelatedWall],
        collider: { height: 40, centerZ: 145 },
    };
    check('仅目标自己的承托墙可作为模型命中例外',
        wallHitSupportsTarget(firstWallHit, wallTopTarget)
        && !wallHitSupportsTarget({ owner: wallA }, wallTopTarget));
    WallSystem.walls = [unrelatedRect];
    check('地面对墙顶锁定允许精确模型射击尝试',
        hasRangedLineOfSight(
            { _faction: 'enemy', _surfaceKind: 'ground', x: 0, y: 0, z: 0, collider: { height: 40 } },
            wallTopTarget
        ));
    const thickSupportRect = { x: 40, y: -10, w: 80, h: 20, height: 125, _owner: unrelatedWall };
    WallSystem.walls = [thickSupportRect];
    check('楼梯向墙顶模型射击仍由承托墙阻挡',
        !hasRangedLineOfSight(
            { _faction: 'enemy', _surfaceKind: 'stairs', x: 0, y: 0, z: 0, collider: { height: 40 } },
            wallTopTarget
        ));

    let wallDamage = 0;
    const friendlyWall = {
        active: true,
        hittable: true,
        _faction: 'player',
        takeDamage(amount) { wallDamage += amount; },
    };
    check('友方弹体撞友方墙只截停不扣耐久',
        !applyProjectileWallImpact({ _faction: 'companion' }, { owner: friendlyWall }, 30)
        && wallDamage === 0);
    check('敌方弹体撞友方墙扣除墙体耐久',
        applyProjectileWallImpact({ _faction: 'enemy' }, { owner: friendlyWall }, 30)
        && wallDamage === 30);
} finally {
    WallSystem.walls = savedWalls;
    WallSystem.isoSegments = savedSegments;
    WallSystem._wallHeight = savedHeight;
}

const read = (relativePath) => fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
const factorySrc = read('src/utils/projectile-factory.js');
const boltSrc = read('src/entities/components/bolt-skill-system.js');
const companionSrc = read('src/ai/companion-ai.js');
const shooterSrc = read('src/ai/hamster-shooter-ai.js');
const scoutSrc = read('src/ai/hamster-scout-ai.js');
const musketeerSrc = read('src/ai/hamster-musketeer-ai.js');
const priestSrc = read('src/ai/hamster-priest-ai.js');
const packageJson = JSON.parse(read('package.json'));
const defenseData = read('data/defense-structures.json');
const defensePublic = read('public/data/defense-structures.json');

check('玩家/通用投射物工厂统一应用高架射程',
    /effectiveMaxRange = applyElevatedRangedRange\(source, maxRange\)/.test(factorySrc));
check('法系飞行物携带发射时墙体上下文并获取首次墙命中',
    /projectileWallContext\(this\.source/.test(boltSrc)
    && /projectileWallHit/.test(boltSrc)
    && /applyProjectileWallImpact/.test(boltSrc));
check('露娜技能与普通光球使用高架射程及墙体上下文',
    /getMagicRangeMultiplier\(c\)/.test(companionSrc)
    && /this\._basicAttackRange\(\)/.test(companionSrc)
    && /projectileWallContext\(c\)/.test(companionSrc));
check('射手/斥候/火枪手均接入统一高架射程',
    [shooterSrc, scoutSrc, musketeerSrc].every((src) => /applyElevatedRangedRange/.test(src)));
check('三类友军自定义弹道均使用首次墙命中和统一墙伤害结算',
    [shooterSrc, scoutSrc, musketeerSrc].every((src) =>
        /projectileWallContext\(m/.test(src)
        && /projectileWallHit/.test(src)
        && /applyProjectileWallImpact/.test(src)
        && /hasRangedLineOfSight/.test(src)));
check('牧师自动/指令圣光接入高架射程与 LOS',
    /_castRange\(\)/.test(priestSrc)
    && /getMagicRangeMultiplier\(this\.m\)/.test(priestSrc)
    && /hasRangedLineOfSight/.test(priestSrc));
check('防御结构配置 data/public 字节一致', defenseData === defensePublic);
check('高架远程专项已加入 npm test 主链',
    packageJson.scripts?.test?.includes('scripts/test-elevated-ranged.mjs'));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
