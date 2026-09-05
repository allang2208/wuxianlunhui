// Export five ImageGen material-reference candidates only: camera/geometry are not locked.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const dir = path.join(root, 'tools/ai-gen/_abandoned_mine_props_pbr_20260830');
const runtimeDir = path.join(dir, 'candidates');
fs.mkdirSync(runtimeDir, { recursive: true });
const read = file => PNG.sync.read(fs.readFileSync(file));
const save = (file, png) => fs.writeFileSync(file, PNG.sync.write(png));
const specs = [
    { name: 'broken_rail', label: '断轨', visibleSize: 74, originY: 0.5 },
    { name: 'broken_sleepers', label: '枕木', visibleSize: 60, originY: 0.5 },
    { name: 'pickaxe', label: '矿镐', visibleSize: 64, originY: 0.5 },
    { name: 'floor_lantern', label: '矿灯', visibleSize: 44, originY: 0.875 },
    { name: 'minecart_wheel', label: '矿车轮', visibleSize: 56, originY: 0.5 },
];

function bbox(image) {
    let x0 = image.width, y0 = image.height, x1 = -1, y1 = -1, transparent = 0;
    for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        const alpha = image.data[(y * image.width + x) * 4 + 3];
        if (alpha === 0) transparent++;
        if (alpha <= 8) continue;
        x0 = Math.min(x0, x); y0 = Math.min(y0, y);
        x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    if (!transparent || x1 < x0) throw new Error('Expected a nonempty transparent ImageGen source');
    return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Area resampling in premultiplied alpha keeps thin iron edges and internal holes clean.
function resized(image, rect, width, height) {
    const result = new PNG({ width, height });
    for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
        const left = rect.x + x * rect.w / width, right = rect.x + (x + 1) * rect.w / width;
        const top = rect.y + y * rect.h / height, bottom = rect.y + (y + 1) * rect.h / height;
        const total = (right - left) * (bottom - top);
        let alpha = 0;
        const rgb = [0, 0, 0];
        for (let sy = Math.floor(top); sy < Math.ceil(bottom); sy++) {
            for (let sx = Math.floor(left); sx < Math.ceil(right); sx++) {
                const weight = (Math.min(right, sx + 1) - Math.max(left, sx))
                    * (Math.min(bottom, sy + 1) - Math.max(top, sy));
                const i = (sy * image.width + sx) * 4;
                const a = image.data[i + 3] * weight;
                alpha += a;
                for (let c = 0; c < 3; c++) rgb[c] += image.data[i + c] * a;
            }
        }
        const i = (y * width + x) * 4;
        result.data[i + 3] = Math.round(alpha / total);
        if (result.data[i + 3]) for (let c = 0; c < 3; c++) result.data[i + c] = Math.round(rgb[c] / alpha);
    }
    return result;
}

function composite(target, source, left, top) {
    for (let y = 0; y < source.height; y++) for (let x = 0; x < source.width; x++) {
        const tx = x + left, ty = y + top;
        if (tx < 0 || ty < 0 || tx >= target.width || ty >= target.height) continue;
        const i = (y * source.width + x) * 4, j = (ty * target.width + tx) * 4;
        const alpha = source.data[i + 3] / 255;
        const destAlpha = target.data[j + 3] / 255;
        const outAlpha = alpha + destAlpha * (1 - alpha);
        if (!outAlpha) continue;
        for (let c = 0; c < 3; c++) target.data[j + c] = Math.round(
            (source.data[i + c] * alpha + target.data[j + c] * destAlpha * (1 - alpha)) / outAlpha);
        target.data[j + 3] = Math.round(outAlpha * 255);
    }
}

const exported = specs.map(spec => {
    const source = read(path.join(dir, `${spec.name}-source.png`));
    const rect = bbox(source);
    const factor = 208 / Math.max(rect.w, rect.h);
    const content = resized(source, rect, Math.max(1, Math.round(rect.w * factor)), Math.max(1, Math.round(rect.h * factor)));
    const runtime = new PNG({ width: 256, height: 256 });
    const left = Math.round((256 - content.width) / 2);
    const top = spec.name === 'floor_lantern' ? 224 - content.height : Math.round((256 - content.height) / 2);
    composite(runtime, content, left, top);
    const key = `abandoned_mine_prop_${spec.name}`;
    const runtimePath = path.join(runtimeDir, `${key}.png`);
    save(runtimePath, runtime);
    const runtimeBox = bbox(runtime);
    const size = Math.round(spec.visibleSize * runtime.height / Math.max(runtimeBox.w, runtimeBox.h));
    return { ...spec, key, sourceCrop: rect, runtimeBox, size, runtime };
});

// Static review sheet: enlarged sprites above; current 0.7 plane-scale sprites below.
const preview = new PNG({ width: 1200, height: 390 });
const floor = read(path.join(root, 'assets/terrain/floor_abandoned_mine_seamless.png'));
for (let y = 0; y < preview.height; y++) for (let x = 0; x < preview.width; x++) {
    const i = (y * preview.width + x) * 4;
    if (y < 260) {
        const shade = (Math.floor(x / 16) + Math.floor(y / 16)) % 2 ? 53 : 43;
        for (let c = 0; c < 3; c++) preview.data[i + c] = shade;
    } else {
        const sx = Math.floor(x / 0.7) % floor.width;
        const sy = Math.floor((y - 260) / (0.7 * 0.5774)) % floor.height;
        const j = (sy * floor.width + sx) * 4;
        for (let c = 0; c < 3; c++) preview.data[i + c] = floor.data[j + c];
    }
    preview.data[i + 3] = 255;
}
for (const [index, entry] of exported.entries()) {
    const centerX = index * 240 + 120;
    const rect = entry.runtimeBox;
    const scale = 190 / Math.max(rect.w, rect.h);
    const large = resized(entry.runtime, rect, Math.round(rect.w * scale), Math.round(rect.h * scale));
    composite(preview, large, Math.round(centerX - large.width / 2), Math.round(130 - large.height / 2));
    const h = Math.round(entry.size * 0.7);
    const small = resized(entry.runtime, { x: 0, y: 0, w: 256, h: 256 }, h, h);
    composite(preview, small, Math.round(centerX - h / 2), Math.round(334 - h * entry.originY));
}
save(path.join(dir, 'five-props-preview.png'), preview);
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    date: '2026-08-30', generator: 'built-in image_gen', prompts: 'prompts.json',
    authorization: 'Continue the five priority prop replacements proposed in this task',
    status: 'material-reference-only', runtimeInstalled: false,
    reason: 'Free ImageGen output does not lock the shared Blender orthographic 30deg / root 44.8deg geometry. Five runtime replacements withdrawn after pipeline review.',
    nextPipeline: 'Shared Blender model/camera/ground anchor, then model-constrained material refinement',
    pipeline: 'ImageGen alpha -> alpha-content crop -> premultiplied area resampling -> 256px transparent runtime canvas',
    floorChanged: false, otherThirteenPropsChanged: false, collisionChanged: false,
    preview: 'five-props-preview.png', previewScope: 'Offline asset sheet, upper enlarged / lower 0.7 scale; not a game screenshot',
    assets: exported.map(({ runtime, ...entry }) => ({ ...entry,
        source: `${entry.name}-source.png`, candidate: `candidates/${entry.key}.png`,
    })),
}, null, 2) + '\n');
console.log('Exported five material-reference candidates. No runtime assets or configuration changed.');
