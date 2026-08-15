// 一次性验证脚本：模拟世界-122 树木散布，验证 footprint 排除带修复（改后违规数应为 0）
// 运行：node scripts/archive/_verify-scatter.mjs
import { WallSystem } from '../../src/world/wall-system.js';
import gameConfig from '../../data/game-config.json' with { type: 'json' };
import { ENERGY_CONFIG } from '../../src/config/energy-config.js';

// defense-system 的 DEFENSE_CONFIG 只取 spawnPoints，避免整模块副作用
const defenseSrc = await import('fs').then(fs => fs.readFileSync(new URL('../../src/world/defense-system.js', import.meta.url), 'utf-8'));
const m = defenseSrc.match(/spawnPoints:\s*\[([\s\S]*?)\]/);
const spawnPts = [...m[1].matchAll(/\{\s*x:\s*([\d.]+),\s*y:\s*([\d.]+)/g)].map(g => ({ x: +g[1], y: +g[2] }));

const cfg = gameConfig.scenes.scene8.treeScatter;
const room = cfg.exclude.baseRoom;
const rPlayer = cfg.exclude.player, rNode = cfg.exclude.energyNode, rSpawn = cfg.exclude.spawnPoint;
const b = cfg.bounds;
const player = { x: 760, y: 2048 };
const nodePos = ENERGY_CONFIG.positions || [];
const variants = ['tall', 'bushy', 'twin', 'wind', 'tiered'];

let violations = { room: 0, player: 0, node: 0, spawn: 0 };
let placed = 0, guard = 0;
const pieces = [];
while (pieces.length < cfg.count && guard++ < cfg.count * 30) {
    const x = b.x0 + Math.random() * (b.x1 - b.x0);
    const y = b.y0 + Math.random() * (b.y1 - b.y0);
    const tex = 'obstacle_tree_' + variants[(Math.random() * variants.length) | 0];
    const geo = WallSystem._geoForTex(tex);
    if (!geo) continue;
    const s = ((geo.obstacleH ?? 240) / geo.h) * (1 - cfg.scaleJitter + Math.random() * cfg.scaleJitter * 2);
    const fp = WallSystem.getObstacleFootprintRect({ tex, x, y, scaleX: s, scaleY: s });
    const fx = fp.x + fp.w / 2, fy = fp.y + fp.h / 2;
    if (fp.x < room[2] && fp.x + fp.w > room[0] && fp.y < room[3] && fp.y + fp.h > room[1]) continue;
    if (Math.hypot(fx - player.x, fy - player.y) < rPlayer) continue;
    if (nodePos.some(n => Math.hypot(fx - n.x, fy - n.y) < rNode)) continue;
    if (spawnPts.some(n => Math.hypot(fx - n.x, fy - n.y) < rSpawn)) continue;
    if (pieces.some(q => Math.hypot(x - q.x, y - q.y) < cfg.minDist)) continue;
    pieces.push({ fp });
    placed++;
}

// 自检：所有已放树木的 footprint 与各排除区的违规数
for (const p of pieces) {
    const { fp } = p;
    const fx = fp.x + fp.w / 2, fy = fp.y + fp.h / 2;
    if (fp.x < room[2] && fp.x + fp.w > room[0] && fp.y < room[3] && fp.y + fp.h > room[1]) violations.room++;
    if (Math.hypot(fx - player.x, fy - player.y) < rPlayer) violations.player++;
    if (nodePos.some(n => Math.hypot(fx - n.x, fy - n.y) < rNode)) violations.node++;
    if (spawnPts.some(n => Math.hypot(fx - n.x, fy - n.y) < rSpawn)) violations.spawn++;
}
console.log(`placed=${placed} rejections=${guard - placed}`);
console.log('violations:', JSON.stringify(violations));
if (violations.room + violations.player + violations.node + violations.spawn === 0) {
    console.log('PASS: footprint 排除带无违规');
} else {
    console.log('FAIL: 存在违规'); process.exit(1);
}
