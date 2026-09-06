import roadsideConfig from '../data/roadside-decorations.json';
import performanceConfig from '../data/performance-config.json';
import { blockCellCenter } from '../src/world/gate4-grid.js';
import { RoadsideDecorationSystem } from '../src/world/roadside-decoration-system.js';
import {
    ROAD_ROLE,
    RoadsideVisualIndex,
    roadsideBuildingAccessPoint,
    roadsideCellKey,
    roadsideChunkKey,
    roadsideHash32,
} from '../src/world/roadside-visual-index.js';

let passed = 0;
let failed = 0;

function check(name, condition, detail = '') {
    if (condition) {
        passed++;
        console.log(`✓ ${name}`);
    } else {
        failed++;
        console.error(`✗ ${name}${detail ? `: ${detail}` : ''}`);
    }
}

function road(i, j, owners = new Set()) {
    const [x, y] = blockCellCenter(i, j);
    return {
        i,
        j,
        key: roadsideCellKey(i, j),
        x,
        y,
        kind: 'road',
        frame: 0,
        owners,
        sprite: fakeSprite(),
    };
}

function building(id, i, j, profile, access = { xOffset: 0, yOffset: 0, clearRadius: 80 }) {
    const [x, y] = blockCellCenter(i, j);
    return {
        id,
        x,
        y,
        active: true,
        _isGridBuilding: true,
        _buildingFootprintCells: 2,
        _economyWorking: true,
        _cfg: { id, roadsideProfile: profile, roadsideAccess: access },
        spriteCfg: { size: 256, sizeH: 256, footOffsetY: 128, roadsideAccess: access },
    };
}

function fakeSprite() {
    return {
        active: true,
        visible: true,
        depth: 0,
        frame: { name: 0 },
        setTexture(key) { this.textureKey = key; return this; },
        setPosition(x, y) { this.x = x; this.y = y; return this; },
        setVisible(value) { this.visible = value; return this; },
        setActive(value) { this.active = value; return this; },
        setOrigin() { return this; },
        setDisplaySize() { return this; },
        setAlpha() { return this; },
        setDepth(value) { this.depth = value; return this; },
        setFrame(value) { this.frame.name = value; return this; },
        destroy() { this.active = false; this.destroyed = true; },
    };
}

const topology = new Map();
for (const [i, j] of [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1], [10, 10], [11, 10], [10, 11]]) {
    topology.set(roadsideCellKey(i, j), road(i, j));
}
const home = building('home', 0, 0, 'housing');
const energy = building('energy', 1, 0, 'energy', { mode: 'none' });
topology.get('0,0').owners.add(home);
const index = new RoadsideVisualIndex(roadsideConfig);
index.update({ roadTiles: topology, buildings: [home, energy], full: true });

check('十字交叉道路被判定为主路', index.get('0,0')?.role === ROAD_ROLE.MAIN);
check('折角道路被判定为支路', index.get('10,10')?.role === ROAD_ROLE.SECONDARY);
check('单连接道路被判定为尽头路', index.get('-1,0')?.role === ROAD_ROLE.DEAD_END);
check('直接附属建筑在混合投票中获得更高权重',
    index.get('0,0')?.profileWeights?.housing > index.get('0,0')?.profileWeights?.energy);
check('入口净空命中附近道路格', index.get('0,0')?.accessClear === true);
check('无入口配置不会生成入口点',
    roadsideBuildingAccessPoint(energy, roadsideConfig) === null);
check('确定性散列重复输入结果一致且坐标变化可区分',
    roadsideHash32(-7, 13, 122) === roadsideHash32(-7, 13, 122)
    && roadsideHash32(-7, 13, 122) !== roadsideHash32(-6, 13, 122));
check('负坐标按8×8格稳定分块',
    roadsideChunkKey(-1, -1, 8) === '-1,-1'
    && roadsideChunkKey(-8, -8, 8) === '-1,-1'
    && roadsideChunkKey(-9, -9, 8) === '-2,-2');

const localRoads = new Map();
for (let i = -6; i <= 6; i++) {
    for (let j = -6; j <= 6; j++) localRoads.set(roadsideCellKey(i, j), road(i, j));
}
const localIndex = new RoadsideVisualIndex(roadsideConfig);
localIndex.update({ roadTiles: localRoads, buildings: [], full: true });
localRoads.delete('0,0');
const roadChange = localIndex.update({
    roadTiles: localRoads,
    buildings: [],
    dirtyRoadKeys: ['0,0'],
});
check('单格道路变化最多扩张为5×5候选', roadChange.dirtyKeys.size <= 25,
    `actual=${roadChange.dirtyKeys.size}`);
check('道路删除后索引无残留', localIndex.get('0,0') === null);

const changedBuilding = building('local-home', 0, 0, 'housing');
localIndex.update({ roadTiles: localRoads, buildings: [changedBuilding], dirtyRoadKeys: [] });
changedBuilding._economyWorking = false;
const buildingChange = localIndex.update({ roadTiles: localRoads, buildings: [changedBuilding] });
check('单栋建筑状态变化最多处理9×9候选', buildingChange.dirtyKeys.size <= 81,
    `actual=${buildingChange.dirtyKeys.size}`);

const denseRoads = new Map();
for (let row = 0; row < 32; row++) {
    for (let col = 0; col < 32; col++) {
        const tile = road(col, row * 2);
        denseRoads.set(tile.key, tile);
    }
}
const denseBuildings = [];
for (let n = 0; n < 80; n++) {
    denseBuildings.push(building(`dense-${n}`, (n % 20) + 4, Math.floor(n / 20) * 6 + 2,
        ['housing', 'agriculture', 'gold', 'energy', 'science', 'military', 'civic'][n % 7],
        { mode: 'none' }));
}
const scene = {
    add: { image: () => fakeSprite() },
    textures: { exists: () => true },
    cameras: { main: { worldView: null } },
};
RoadsideDecorationSystem.reset();
RoadsideDecorationSystem.sync({
    scene,
    roadTiles: denseRoads,
    buildings: denseBuildings,
    roadRevision: 1,
    full: true,
});
const stats = RoadsideDecorationSystem.getStats();
check('视口立体脚点物件不超过96', stats.activeFootSprites <= 96,
    `actual=${stats.activeFootSprites}`);
check('视口固定地表物件不超过240', stats.activeGroundSprites <= 240,
    `actual=${stats.activeGroundSprites}`);
const limits = performanceConfig.roadsideDecor.chunkLayerLimits;
let chunkBudgetsValid = true;
for (const specs of RoadsideDecorationSystem._chunkSpecs.values()) {
    const counts = { prop: 0, fixture: 0, surface: 0, rain: 0, edge: 0, siteMargin: 0 };
    for (const spec of specs) {
        const key = spec.layer === 'site' || spec.layer === 'margin' ? 'siteMargin' : spec.layer;
        counts[key] = (counts[key] || 0) + 1;
    }
    for (const [layer, limit] of Object.entries(limits)) {
        if ((counts[layer] || 0) > limit) chunkBudgetsValid = false;
    }
}
check('所有8×8区块均遵守分层硬预算', chunkBudgetsValid);
const stableRebuilds = RoadsideDecorationSystem.getStats().rebuildCount;
for (let frame = 0; frame < 240; frame++) {
    RoadsideDecorationSystem.syncViewport(null);
}
check('稳定240帧不会增加街景重建次数',
    RoadsideDecorationSystem.getStats().rebuildCount === stableRebuilds);
RoadsideDecorationSystem.reset();

console.log(`\nRoadside visual index: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
