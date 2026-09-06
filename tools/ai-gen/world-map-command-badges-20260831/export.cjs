// Asset production only: normalize generated PNGs and render an offline animation design preview.
// Usage: node export.cjs [absolute path to the installed sharp package]
const fs = require('node:fs');
const path = require('node:path');
const sharp = require(process.argv[2] || 'sharp');
const root = path.resolve(__dirname, '../../..');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const motion = JSON.parse(fs.readFileSync(path.join(root, 'data/world-map-command-feedback.json'), 'utf8'));
const theme = fs.readFileSync(path.join(root, 'ui/panel-theme-backpack.css'), 'utf8');
const color = (name) => theme.match(new RegExp(`--${name}:\\s*([^;]+);`))[1];
const colors = { move: color('bp-ui-accent-bright'), attack: color('bp-notice-danger'),
    enter: color('bp-notice-success'), blocked: color('bp-notice-warning') };
const pngData = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`;

(async () => {
    const report = [], icons = {};
    for (const entry of manifest.sources) {
        const source = path.join(__dirname, entry.source);
        const { data, info } = await sharp(source).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
        let left = info.width, top = info.height, right = -1, bottom = -1, minAlpha = 255;
        for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
            const alpha = data[(y * info.width + x) * 4 + 3];
            minAlpha = Math.min(minAlpha, alpha);
            if (alpha <= 16) continue;
            left = Math.min(left, x); right = Math.max(right, x);
            top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        if (minAlpha !== 0 || right < left) throw new Error(`${entry.key}: source must contain genuine transparent pixels and a visible emblem`);
        const crop = { left, top, width: right - left + 1, height: bottom - top + 1 };
        const resized = await sharp(source).extract(crop).resize(88, 88, { fit: 'inside' }).png().toBuffer({ resolveWithObject: true });
        const image = await sharp({ create: { width: 96, height: 96, channels: 4, background: '#00000000' } })
            .composite([{ input: resized.data, left: Math.floor((96 - resized.info.width) / 2), top: Math.floor((96 - resized.info.height) / 2) }]).png().toBuffer();
        const destination = path.join(root, entry.asset);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.writeFileSync(destination, image);
        icons[entry.key] = pngData(image);
        report.push({ key: entry.key, sourceSize: [info.width, info.height], minAlpha, crop,
            output: entry.asset, size: [96, 96], visibleSize: [resized.info.width, resized.info.height], bytes: image.length });
    }
    const pointer = pngData(fs.readFileSync(path.join(root, 'assets/ui/cursors/normal-pointer-cold-steel.png')));
    const width = 960, height = 430, delay = 40, frames = 80;
    const names = { move: '行军', attack: '攻击 / 解围', enter: '进入基地', blocked: '不可执行' };
    const image = (url, x, y, size) => `<image href="${url}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
    const frameSvg = (time, still = false) => {
        let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="960" height="430" fill="${color('bp-ui-black-soft')}"/><g font-family="Microsoft YaHei, sans-serif" fill="${color('bp-ui-text')}"><text x="24" y="32" font-size="20" font-weight="700">大地图 · 冷钢命令光标</text><text x="24" y="57" font-size="12" fill="${color('bp-ui-text-muted')}">离线动画设计预览 · 上：动作徽记与外圈 / 下：48px固定箭头 + 36px徽记 / 目标格：520ms下令反馈</text>`;
        for (const [index, key] of ['move', 'attack', 'enter', 'blocked'].entries()) {
            const x = 24 + index * 234, cx = x + 102, cy = 151;
            const wave = key === 'blocked' || still ? .5 : (1 - Math.cos(time / motion.hoverPeriodMs[key] * Math.PI * 2)) / 2;
            const opacity = .28 + .42 * wave, scale = .9 + .15 * wave;
            const outline = (centerX, centerY, r, alpha, dash = '') => key === 'enter'
                ? `<rect x="${centerX-r}" y="${centerY-r}" width="${r*2}" height="${r*2}" rx="8" fill="none" stroke="${colors[key]}" stroke-opacity="${alpha}"/>`
                : `<circle cx="${centerX}" cy="${centerY}" r="${r}" fill="none" stroke="${colors[key]}" stroke-opacity="${alpha}" ${dash}/>`;
            svg += `<rect x="${x}" y="78" width="216" height="330" rx="10" fill="${color('bp-ui-charcoal')}" stroke="${color('bp-ui-gray')}"/>`;
            svg += outline(cx, cy, 57 * scale, opacity, key === 'move' ? 'stroke-dasharray="4 4"' : '') + image(icons[key], cx - 48, cy - 48, 96);
            svg += `<text x="${cx}" y="229" text-anchor="middle" font-size="16" font-weight="700">${names[key]}</text><text x="${cx}" y="250" text-anchor="middle" font-size="12" fill="${color('bp-ui-text-muted')}">${key === 'blocked' ? '悬停静态 / 拒绝时短提示' : `外圈 ${motion.hoverPeriodMs[key]}ms / 主体不漂移`}</text>`;
            const px = cx - 39, py = 271;
            svg += `<path d="M${px+3-5} ${py+2}h10 M${px+3} ${py+2-5}v10" stroke="${color('bp-ui-gray-light')}"/>`;
            svg += image(pointer, px, py, 48);
            const bx = px + 3 + motion.pointerOffset[0], by = py + 2 + motion.pointerOffset[1];
            svg += outline(bx + 18, by + 18, 22 * scale, opacity, key === 'move' ? 'stroke-dasharray="3 3"' : '') + image(icons[key], bx, by, motion.badgeSize);
            const elapsed = time - 2000;
            if (!still && elapsed >= 0 && elapsed < motion.confirmDurationMs) {
                const progress = elapsed / motion.confirmDurationMs, eased = 1 - Math.pow(1 - progress, 3);
                const alpha = progress < .5 ? 1 : (1 - progress) * 2;
                svg += `<g opacity="${alpha}">${outline(cx, 375, 26 * (.7 + .75 * eased), 1-progress)}${image(icons[key], cx - 22, 353, 44)}</g>`;
            } else svg += `<text x="${cx}" y="382" text-anchor="middle" font-size="12" fill="${color('bp-ui-text-muted')}">目标格 · ${still ? '静态参照' : '等待下令'}</text>`;
        }
        return svg + '</g></svg>';
    };
    await sharp(Buffer.from(frameSvg(0, true))).png().toFile(path.join(__dirname, 'contact-sheet.png'));
    const rawFrames = [];
    for (let frame = 0; frame < frames; frame++) rawFrames.push(await sharp(Buffer.from(frameSvg(frame * delay))).ensureAlpha().raw().toBuffer());
    await sharp(Buffer.concat(rawFrames), { raw: { width, height: height * frames, channels: 4, pageHeight: height } })
        .gif({ loop: 0, delay, colours: 128, effort: 3 }).toFile(path.join(__dirname, 'command-feedback-preview.gif'));
    fs.writeFileSync(path.join(__dirname, 'export-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(),
        runtimeRgbaBytes: 4 * 96 * 96 * 4, assets: report, preview: { width, height, frames, delayMs: delay, durationMs: frames * delay },
        note: 'Asset export and authored animation preview only; no game test or runtime capture.' }, null, 2) + '\n');
    console.log(JSON.stringify({ assets: report, preview: path.join(__dirname, 'command-feedback-preview.gif') }, null, 2));
})().catch((error) => { console.error(error.message); process.exitCode = 1; });
