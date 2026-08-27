const SPARK_TEXTURE = 'impact_dot';
const SPARK_COUNT = 7;
const MAX_ALIVE_SPARKS = 72;
const VIEW_PADDING = 80;
const COALESCE_MS = 34;
const COALESCE_RADIUS = 18;

let activeScene = null;
let sparkEmitter = null;
let reboundAngleDeg = 0;
let lastBurstAt = -Infinity;
let lastBurstX = 0;
let lastBurstY = 0;

function destroyEmitter() {
    if (sparkEmitter?.active) sparkEmitter.destroy();
    sparkEmitter = null;
    activeScene = null;
    lastBurstAt = -Infinity;
}

function ensureEmitter(scene) {
    if (scene === activeScene && sparkEmitter?.active) return sparkEmitter;
    destroyEmitter();
    if (!scene?.add?.particles || !scene?.textures) return null;
    if (!scene.textures.exists(SPARK_TEXTURE)
        && typeof scene._ensureImpactDotTexture === 'function') {
        scene._ensureImpactDotTexture();
    }
    if (!scene.textures.exists(SPARK_TEXTURE)) return null;

    activeScene = scene;
    const ownedScene = scene;
    sparkEmitter = scene.add.particles(0, 0, SPARK_TEXTURE, {
        emitting: false,
        frequency: -1,
        maxAliveParticles: MAX_ALIVE_SPARKS,
        speed: { min: 105, max: 235 },
        angle: () => reboundAngleDeg + (Math.random() * 104 - 52),
        lifespan: { min: 150, max: 280 },
        scale: { start: 0.95, end: 0 },
        alpha: { start: 1, end: 0 },
        tint: [0xffffff, 0xfff2a6, 0xffc64d, 0xff8a32],
        gravityY: 170,
        blendMode: 'ADD',
    });
    sparkEmitter.addToUpdateList();
    const ownedEmitter = sparkEmitter;
    scene.events?.once?.('shutdown', () => {
        if (activeScene === ownedScene && sparkEmitter === ownedEmitter) destroyEmitter();
    });
    return sparkEmitter;
}

function isInsideView(scene, x, y) {
    const view = scene?.cameras?.main?.worldView;
    if (!view) return true;
    return x >= view.x - VIEW_PADDING
        && x <= view.right + VIEW_PADDING
        && y >= view.y - VIEW_PADDING
        && y <= view.bottom + VIEW_PADDING;
}

/**
 * 玩家枪械弹体撞到墙/障碍物时的共享火花发射器。
 * 单场景只保留一个 Phaser emitter；粒子由 emitter 内部复用，并通过并发上限、
 * 视口/战争迷雾裁剪和同点短时合并控制高射速及霰弹枪的峰值开销。
 */
export function spawnPlayerBulletImpactSparks({ x, y, z = 0, incomingAngle = 0 }) {
    const scene = typeof window !== 'undefined' ? window.__phaserScene : null;
    if (!scene || scene._mapModeActive) return false;

    const worldX = Number(x);
    const groundY = Number(y);
    const displayY = groundY - (Number(z) || 0);
    if (!Number.isFinite(worldX) || !Number.isFinite(displayY)) return false;
    if (!isInsideView(scene, worldX, displayY)) return false;
    if (typeof scene.isFogPointVisible === 'function'
        && !scene.isFogPointVisible(worldX, groundY)) return false;

    const emitter = ensureEmitter(scene);
    if (!emitter) return false;
    const now = Number(scene.time?.now) || 0;
    if (now - lastBurstAt < COALESCE_MS
        && Math.hypot(worldX - lastBurstX, displayY - lastBurstY) < COALESCE_RADIUS) {
        return false;
    }

    reboundAngleDeg = (Number(incomingAngle) || 0) * 180 / Math.PI + 180;
    lastBurstAt = now;
    lastBurstX = worldX;
    lastBurstY = displayY;
    emitter.setDepth(groundY + 501);
    emitter.explode(SPARK_COUNT, worldX, displayY);
    return true;
}
