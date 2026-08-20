/**
 * 城墙高架远程战斗契约：
 * - 仅友方 wall_walk 获得 20% 射程；
 * - 魔法距离倍率与普通远程共用；
 * - 矩形墙按真实交点高度判断，不再使用整段平均高度；
 * - 友军自定义弹道与玩家投射物工厂均接入统一入口。
 */
await import('./register-json-loader.mjs');
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

globalThis.window = globalThis.window || {};

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
    applyElevatedRangedRange,
    getElevatedRangedRangeMultiplier,
    projectileWallContext,
} = await import('../src/combat/elevated-ranged.js');
const {
    getMagicRangeMultiplier,
    getMagicAreaMultiplier,
} = await import('../src/utils/magic-craft-helper.js');
const { WallSystem } = await import('../src/world/wall-system.js');
const { hasRangedLineOfSight } = await import('../src/combat/ranged-line-of-sight.js');

let passed = 0;
let failed = 0;
const check = (name, condition, detail = '') => {
    if (condition) {
        passed++;
        console.log(`  ✓ ${name}${detail ? `：${detail}` : ''}`);
    } else {
        failed++;
        console.error(`  ✗ ${name}${detail ? `：${detail}` : ''}`);
    }
};

const wallPlayer = { _faction: 'player', _surfaceKind: 'wall_walk', z: 125 };
const wallFriend = { _faction: 'companion', _surfaceKind: 'wall_walk', z: 125 };
const stairFriend = { _faction: 'companion', _surfaceKind: 'stairs', z: 90 };
const wallEnemy = { _faction: 'enemy', _surfaceKind: 'wall_walk', z: 125 };

check('玩家站墙顶射程倍率=1.2',
    getElevatedRangedRangeMultiplier(wallPlayer) === 1.2);
check('友军站墙顶基础600射程变720',
    applyElevatedRangedRange(wallFriend, 600) === 720);
check('楼梯途中无射程加成',
    applyElevatedRangedRange(stairFriend, 600) === 600);
check('敌人站墙顶无友方加成',
    applyElevatedRangedRange(wallEnemy, 600) === 600);
check('魔法改造倍率与墙顶倍率乘算',
    Math.abs(getMagicRangeMultiplier({
        ...wallPlayer,
        equipments: {
            weapon: { _craftEffects: { magicRangePercent: 0.25 } },
        },
        weaponMode: 'weapon',
    }) - 1.5) < 1e-9);
check('墙顶加成只扩大最大射程，不扩大锁定/传导范围',
    Math.abs(getMagicAreaMultiplier({
        ...wallPlayer,
        equipments: {
            weapon: { _craftEffects: { magicRangePercent: 0.25 } },
        },
        weaponMode: 'weapon',
    }) - 1.25) < 1e-9);

const savedWalls = WallSystem.walls;
const savedSegments = WallSystem.isoSegments;
const savedHeight = WallSystem._wallHeight;
try {
    WallSystem.trees = [];
    WallSystem.isoSegments = [];
    WallSystem._wallHeight = 60;
    const context = projectileWallContext(wallPlayer);

    // 轨迹在近墙区间 z=150→约129，真实越墙；旧 averageZ=75 会误判为撞墙。
    WallSystem.walls = [{ x: 0, y: -5, w: 10, h: 10, height: 125 }];
    check('近射手矩形墙按交点高度放行',
        !WallSystem.projectileBlocked(-5, 0, 150, 100, 0, 0, context));
    check('墙顶锁定/魔法视线可越过相邻墙',
        hasRangedLineOfSight(
            { ...wallPlayer, x: -5, y: 0, collider: { height: 40 } },
            { x: 100, y: 0, z: 0, collider: { centerZ: 24 } }
        ));
    check('同一条视线在地面发射时仍被墙阻挡',
        !hasRangedLineOfSight(
            { _faction: 'player', _surfaceKind: 'ground', x: -5, y: 0, z: 0, collider: { height: 40 } },
            { x: 100, y: 0, z: 0, collider: { centerZ: 24 } }
        ));

    // 同一条下降弹道在远墙区间已降到约36→21，应正常阻挡。
    WallSystem.walls = [{ x: 75, y: -5, w: 10, h: 10, height: 125 }];
    check('远处矩形墙在弹道降到墙顶以下时阻挡',
        WallSystem.projectileBlocked(-5, 0, 150, 100, 0, 0, context));

    WallSystem.walls = [];
    WallSystem.isoSegments = [{
        x1: 5,
        y1: -20,
        x2: 5,
        y2: 20,
        halfThick: 1,
        _owner: { _wallTopZ: 125 },
    }];
    check('面线交点高于墙顶时放行',
        !WallSystem.projectileBlocked(0, 0, 140, 10, 0, 130, context));
    check('面线交点低于墙顶时阻挡',
        WallSystem.projectileBlocked(0, 0, 120, 10, 0, 110, context));

    const nearOwner = { x: 5, y: 0 };
    const localContext = projectileWallContext({
        ...wallPlayer,
        x: 0,
        y: 0,
        _surfaceWall: nearOwner,
        _surfaceWalls: [nearOwner],
    });
    WallSystem.isoSegments = [];
    WallSystem.walls = [{
        x: 0,
        y: -5,
        w: 10,
        h: 10,
        height: 125,
        _owner: nearOwner,
    }];
    check('2px净空仅对发射点附近承托墙生效',
        !WallSystem.projectileBlocked(-5, 0, 124, 15, 0, 124, localContext));

    const farOwner = { x: 500, y: 0 };
    localContext.wallClearanceWalls.add(farOwner);
    WallSystem.walls = [{
        x: 495,
        y: -5,
        w: 10,
        h: 10,
        height: 125,
        _owner: farOwner,
    }];
    check('同墙链远端超过净空半径后仍按真实墙高阻挡',
        WallSystem.projectileBlocked(480, 0, 124, 520, 0, 124, localContext));
} finally {
    WallSystem.walls = savedWalls;
    WallSystem.isoSegments = savedSegments;
    WallSystem._wallHeight = savedHeight;
}

const read = (relativePath) =>
    fs.readFileSync(path.join(ROOT, relativePath), 'utf8');
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
check('法系飞行物墙碰撞携带发射者高度上下文',
    /projectileWallContext\(this\.source\)/.test(boltSrc)
    && /spike\.maxRange = launchEffect\.maxRange/.test(boltSrc)
    && /const maxRange = Number\(spike\.maxRange\)/.test(boltSrc));
check('露娜技能选择与普通光球使用高架射程',
    /getMagicRangeMultiplier\(c\)/.test(companionSrc)
    && /this\._basicAttackRange\(\)/.test(companionSrc)
    && /projectileWallContext\(c\)/.test(companionSrc));
check('射手/斥候/火枪手均接入统一高架射程',
    [shooterSrc, scoutSrc, musketeerSrc].every((src) =>
        /applyElevatedRangedRange/.test(src)));
check('三类友军自定义弹道均使用带高度墙碰撞',
    [shooterSrc, scoutSrc, musketeerSrc].every((src) =>
        /projectileWallContext\(m\)/.test(src)
        && /projectileBlocked/.test(src)
        && /hasRangedLineOfSight/.test(src)));
check('牧师自动/指令圣光接入高架射程与LOS',
    /_castRange\(\)/.test(priestSrc)
    && /getMagicRangeMultiplier\(this\.m\)/.test(priestSrc)
    && /hasRangedLineOfSight/.test(priestSrc));
check('防御结构配置 data/public 字节一致',
    defenseData === defensePublic);
check('高架远程专项已加入 npm test 主链',
    packageJson.scripts?.test?.includes('scripts/test-elevated-ranged.mjs'));

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
