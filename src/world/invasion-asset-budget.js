import { RuntimeAssetManager } from '../phaser/assets/runtime-asset-manager.js';
import { invasionDependencyTypes } from '../config/enemy-invasion-catalog.js';

const dimensions = new Map();
const typeReports = new Map();
let queue = Promise.resolve();

async function readPngDimensions(url) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let reader;
    try {
        // Read only the header, never decode/upload all candidate textures.
        // Servers that ignore Range are still cancelled after the first 24 bytes.
        const response = await fetch(url, { headers: { Range: 'bytes=0-23' }, signal: controller.signal });
        if (!response.ok) throw new Error('无法读取纹理尺寸');
        const header = new Uint8Array(24);
        if (response.body?.getReader) {
            reader = response.body.getReader();
            let offset = 0;
            while (offset < header.length) {
                const { value, done } = await reader.read();
                if (done) break;
                const length = Math.min(header.length - offset, value.length);
                header.set(value.subarray(0, length), offset); offset += length;
            }
            if (offset < 24) throw new Error('纹理头不完整');
        } else {
            // Refuse an unbounded fallback download on older backends.
            if (response.status !== 206) throw new Error('当前资源协议不支持尺寸读取');
            const bytes = new Uint8Array(await response.arrayBuffer());
            if (bytes.length < 24) throw new Error('纹理头不完整');
            header.set(bytes.subarray(0, 24));
        }
        if ([137, 80, 78, 71, 13, 10, 26, 10].some((byte, index) => header[index] !== byte)) throw new Error('资源不是PNG，需登记整图尺寸');
        const view = new DataView(header.buffer), width = view.getUint32(16), height = view.getUint32(20);
        if (!width || !height) throw new Error('纹理尺寸无效');
        return { width, height, bytes: width * height * 4 };
    } finally {
        clearTimeout(timeout);
        if (reader) await reader.cancel().catch(() => {});
        controller.abort();
    }
}

function textureDimensions(entry) {
    const textures = RuntimeAssetManager.scene?.textures;
    const texture = textures?.exists(entry.key) ? textures.get(entry.key) : null;
    const source = texture?.key === entry.key ? texture.source?.[0]?.image : null;
    const width = source?.naturalWidth || source?.width, height = source?.naturalHeight || source?.height;
    if (width > 0 && height > 0) return Promise.resolve({ width, height, bytes: width * height * 4 });
    const stamp = `${entry.url}:${entry.frameWidth}:${entry.frameHeight}:${entry.endFrame}`;
    if (!dimensions.has(stamp)) {
        const request = queue.then(() => readPngDimensions(entry.url));
        queue = request.catch(() => {});
        dimensions.set(stamp, request);
        request.catch(() => dimensions.delete(stamp));
    }
    return dimensions.get(stamp);
}

export async function invasionAssetBudget(types, { isCancelled = () => false } = {}) {
    const dependencyTypes = invasionDependencyTypes(types);
    const resolved = RuntimeAssetManager.resolveEnemyVisualKeysForTypes(dependencyTypes);
    if (resolved.unresolvedTypes.length) throw new Error(`资源未登记：${resolved.unresolvedTypes.join('、')}`);
    const entries = resolved.keys.map((key) => RuntimeAssetManager.enemyTextureManifest.get(key));
    if (entries.some((entry) => !entry?.url) || !entries.length) throw new Error('缺少完整纹理登记');
    const sheets = [];
    for (const entry of entries) {
        if (isCancelled()) throw new Error('集结选型已取消');
        sheets.push({ key: entry.key, ...(await textureDimensions(entry)) });
    }
    const report = { types: dependencyTypes, sheets, bytes: sheets.reduce((total, sheet) => total + sheet.bytes, 0),
        source: 'registered-png-header' };
    if (types.length === 1) typeReports.set(types[0], { bytes: report.bytes, sheets: sheets.length, source: report.source });
    return report;
}

export function knownInvasionAssetBudget(type) { return typeReports.get(type) || null; }
