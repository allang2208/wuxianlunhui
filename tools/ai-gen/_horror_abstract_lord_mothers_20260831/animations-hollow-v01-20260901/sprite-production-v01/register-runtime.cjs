const fs = require('fs');
const path = require('path');

const productionRoot = __dirname;
const repoRoot = path.resolve(productionRoot, '../../../../..');
const parametersPath = path.join(productionRoot, 'animation-parameters.json');
const manifestPath = path.join(productionRoot, 'sprite-manifest.json');
const parameters = JSON.parse(fs.readFileSync(parametersPath, 'utf8'));

const runtimeAssets = path.join(repoRoot, 'assets/enemies/hollow_ovum');
fs.mkdirSync(runtimeAssets, { recursive: true });
for (const state of ['idle', 'walk', 'vacuum', 'pulse', 'death']) {
    fs.copyFileSync(
        path.join(productionRoot, 'final', `${state}.png`),
        path.join(runtimeAssets, `${state}.png`)
    );
}

const frameLayouts = Object.fromEntries(
    Object.entries(parameters.actions).map(([state, action]) => [state, {
        columns: action.columns,
        rows: action.rows,
        frameWidth: action.frameWidth,
        frameHeight: action.frameHeight,
        frameCount: action.frameCount,
        endFrame: action.endFrame,
        footX: action.footX,
        footY: action.footY,
        duration: action.duration,
        frameDurations: action.frameDurations,
        repeat: action.repeat,
    }])
);

const hollowOvum = {
    entityClass: 'HollowOvum',
    invasion: {
        enabled: false,
        comment: '本次仅接入恐怖地牢，不新增来袭编组。',
    },
    id: 'hollowOvum',
    name: '空腔之卵',
    type: '领主',
    category: 'monster',
    family: '僵尸',
    families: ['僵尸', '深渊', '大型'],
    rank: 'lord',
    level: 12,
    poolWhitelistOnly: true,
    hp: 2400,
    maxHp: 2400,
    speed: 92,
    str: 22,
    dex: 18,
    con: 78,
    int: 76,
    wis: 50,
    luck: 10,
    matk: 72,
    mdef: 78,
    size: 28,
    collisionRadius: 74,
    height: 178,
    color: '#6f5965',
    showWeapon: false,
    description: '恐怖地牢专属抽象领主。悬浮的多层卵壳围绕贯穿空腔收张；远距以真空汲引分段拉近目标，近身释放壳脉冲反压。没有人形肢体、武器、召唤物或死亡爆炸。其基础值进入恐怖地牢后再按C/B/A专属倍率结算。',
    attackType: '魔法（真空牵引/壳脉冲范围）',
    basicMeleeResolver: false,
    attackRange: 480,
    attackDistance: 480,
    aiInterval: 120,
    attackTelegraph: {
        overlapWindup: true,
        durationMs: 1000,
    },
    attack: {
        type: 'thrust',
        cooldown: 6500,
        range: 480,
        dynamicRange: 480,
        width: 148,
        knockback: 0,
    },
    attackSkills: {
        vacuum: {
            initialCooldownMs: 3000,
            triggerRange: 480,
            radius: 480,
            duration: frameLayouts.vacuum.duration,
            frames: frameLayouts.vacuum.frameCount,
            pullFrames: [16, 24, 32, 40],
            pullDistance: 34,
            eventFrame: 40,
            eventMs: 2500,
            damageMul: 1.25,
            damageType: 'magic',
            cooldown: 10500,
            targets: 'allHostile',
            requiresSameSurface: true,
            requiresLos: true,
            comment: '正式f16/24/32/40各向空腔牵引34px；f40空腔完全张开时再结算一次魔攻×1.25。四次牵引和伤害均按同层、墙体与范围复查。',
        },
        pulse: {
            initialCooldownMs: 1500,
            triggerRange: 270,
            radius: 270,
            duration: frameLayouts.pulse.duration,
            frames: frameLayouts.pulse.frameCount,
            eventFrame: 28,
            eventMs: 1166.666667,
            damageMul: 2,
            damageType: 'magic',
            knockback: 115,
            stunMs: 650,
            cooldown: 6500,
            targets: 'allHostile',
            requiresSameSurface: true,
            requiresLos: true,
            comment: '源f28即正式f28；脉冲峰值在1166.667ms对270px地面椭圆各结算一次魔攻×2，向外击退115并短眩晕650ms。',
        },
    },
    ai: {
        aggroRange: 9999,
        pacingRange: 240,
        loseTimeout: 3000,
    },
    render: {
        spriteSize: 432,
        collisionWidth: 164,
        collisionHeight: 178,
        bodyDisplayHeight: 181,
        footOffsetY: 91,
        colliderOffsetX: 0,
        colliderOffsetY: 0,
        projectileHitbox: {
            width: 164,
            height: 178,
            offsetX: 0,
            bottom: 0,
        },
        capsuleHudAnchor: true,
    },
    textures: {
        referenceCell: parameters.referenceCell,
        idle: 'assets/enemies/hollow_ovum/idle.png',
        walk: 'assets/enemies/hollow_ovum/walk.png',
        vacuum: 'assets/enemies/hollow_ovum/vacuum.png',
        pulse: 'assets/enemies/hollow_ovum/pulse.png',
        death: 'assets/enemies/hollow_ovum/death.png',
        frameLayouts,
        idleFrameWidth: frameLayouts.idle.frameWidth,
        idleFrameHeight: frameLayouts.idle.frameHeight,
        idleFrameCount: frameLayouts.idle.frameCount,
        idleSheetColumns: frameLayouts.idle.columns,
    },
    death: {
        animMs: frameLayouts.death.duration,
        holdMs: 1600,
        fadeMs: 600,
    },
    skills: [
        {
            name: '真空汲引',
            desc: '480px地面椭圆内起手，1.0秒红轮廓与动作前摇重叠；第16/24/32/40帧各向本体牵引34px，第40帧额外造成魔攻×1.25魔法伤害。全程复查同层、墙体和范围，起手间隔10.5秒。',
        },
        {
            name: '壳脉冲',
            desc: '270px内优先起手，第28帧（1.167秒）造成魔攻×2范围魔法伤害，击退115并眩晕0.65秒；同层且无遮挡才命中，起手间隔6.5秒。',
        },
        {
            name: '空卵坍缩',
            desc: '死亡播放完整5.167秒坍缩动作，末帧留尸1.6秒后用0.6秒淡出；不召唤、不爆炸，经验和掉落沿用领主规则。',
        },
    ],
};

function appendRootProperty(filePath, key, value) {
    let source = fs.readFileSync(filePath, 'utf8');
    if (JSON.parse(source)[key]) return;
    const end = source.lastIndexOf('\n}');
    if (end < 0) throw new Error(`Cannot locate root closing brace in ${filePath}`);
    const rendered = JSON.stringify(value, null, 2).replace(/\n/g, '\n  ');
    source = `${source.slice(0, end)},\n  ${JSON.stringify(key)}: ${rendered}${source.slice(end)}`;
    fs.writeFileSync(filePath, source, 'utf8');
    JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function addDungeonPoolKey(filePath) {
    let source = fs.readFileSync(filePath, 'utf8');
    const existing = JSON.parse(source);
    let registeredArrays = 0;
    const visit = value => {
        if (Array.isArray(value)) {
            if (value.includes('hollowOvum')) registeredArrays += 1;
            value.forEach(visit);
        } else if (value && typeof value === 'object') {
            Object.values(value).forEach(visit);
        }
    };
    visit(existing);
    if (registeredArrays === 6) return;
    if (registeredArrays !== 0) {
        throw new Error(`${filePath}: partial Hollow Ovum registration in ${registeredArrays} arrays`);
    }
    const replacement = /^([ \t]*)"pleatDevourer"\r?\n([ \t]*)\]/gm;
    const matches = [...source.matchAll(replacement)];
    if (matches.length !== 6) throw new Error(`${filePath}: expected 6 Pleat pool tails, found ${matches.length}`);
    source = source.replace(replacement,
        (_match, itemIndent, closeIndent) => `${itemIndent}"pleatDevourer",\n${itemIndent}"hollowOvum"\n${closeIndent}]`);
    fs.writeFileSync(filePath, source, 'utf8');
    const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (!parsed.monsterStatProfiles.horror.enemyKeys.includes('hollowOvum')) {
        throw new Error(`${filePath}: hollowOvum missing from horror stat profile`);
    }
}

for (const relative of ['data/enemy-config.json', 'public/data/enemy-config.json']) {
    appendRootProperty(path.join(repoRoot, relative), 'hollowOvum', hollowOvum);
}
for (const relative of ['data/dungeon-config.json', 'public/data/dungeon-config.json']) {
    addDungeonPoolKey(path.join(repoRoot, relative));
}

parameters.status = 'registered';
parameters.collision = {
    radius: hollowOvum.collisionRadius,
    width: hollowOvum.render.collisionWidth,
    height: hollowOvum.render.collisionHeight,
};
parameters.displaySize = {
    referenceCell: hollowOvum.textures.referenceCell,
    spriteSize: hollowOvum.render.spriteSize,
    bodyDisplayHeight: hollowOvum.render.bodyDisplayHeight,
};
parameters.skills = hollowOvum.attackSkills;
parameters.runtimeIntegration = {
    entity: 'src/entities/enemy-types/hollow-ovum.js',
    configKey: 'hollowOvum',
    assetDirectory: 'assets/enemies/hollow_ovum',
    dungeonPools: 5,
    statProfile: 'horror',
};
delete parameters.warning;
fs.writeFileSync(parametersPath, `${JSON.stringify(parameters, null, 2)}\n`, 'utf8');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
manifest.stage = 'runtime_integrated';
manifest.approvedForRuntime = true;
manifest.runtimeIntegrated = true;
manifest.worldScale = parameters.displaySize;
manifest.collider = parameters.collision;
for (const action of manifest.actions) {
    action.registered = true;
    action.runtimeSheet = `assets/enemies/hollow_ovum/${action.action}.png`;
}
manifest.runtimeIntegration = parameters.runtimeIntegration;
fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

console.log(JSON.stringify({
    enemyConfig: 'hollowOvum',
    assets: fs.readdirSync(runtimeAssets).sort(),
    frameLayouts: Object.keys(frameLayouts),
    decodedMiB: manifest.totalDecodedMiB,
}, null, 2));
