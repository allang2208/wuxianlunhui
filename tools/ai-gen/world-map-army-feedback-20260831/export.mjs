// Offline art authoring only; this does not boot the game or validate its behavior.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { createArmyMotion } from '../../../src/ui/world-map-army-motion.js';
const require = createRequire(import.meta.url);
const sharp = require(process.argv[2] || 'sharp');
const directory = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(directory, '../../..');
const read = (file) => fs.readFileSync(path.join(root, file));
const settings = JSON.parse(read('data/world-map-command-feedback.json'));
const flags = JSON.parse(read('data/world-map-army-visuals.json'));
const theme = read('ui/panel-theme-backpack.css').toString();
const color = (key) => theme.match(new RegExp(`--${key}:\\s*([^;]+);`))[1];
const png = (bytes) => `data:image/png;base64,${bytes.toString('base64')}`;
const flag = png(await sharp(read(flags.path)).extract({ left: 0, top: 0, width: flags.frameSize, height: flags.frameSize }).png().toBuffer());
const badges = Object.fromEntries(['attack', 'enter', 'blocked'].map((key) => [key, png(read(`assets/ui/world-map/command-badges/${key}.png`))]));
const armyMotion = createArmyMotion(settings);
const width = 960, height = 490, delay = 50, frameCount = 64;
const image = (url, x, y, size) => `<image href="${url}" x="${x}" y="${y}" width="${size}" height="${size}"/>`;
const draw = (time, still = false) => {
    let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="960" height="490" fill="${color('bp-ui-black-soft')}"/><g font-family="Microsoft YaHei, sans-serif" fill="${color('bp-ui-text')}"><text x="24" y="32" font-size="20" font-weight="700">大地图 · 兵棋状态与入营反馈</text><text x="24" y="57" font-size="12" fill="${color('bp-ui-text-muted')}">离线动画设计预览，非游戏录屏 · 复用正式军旗与冷钢徽记 · 位移压缩演示，不代表实际行军速度</text>`;
    const states = [
        [{ march: {} }, '行军', '保持脚点 · 旗面随行军轻摆'],
        [{ warId: 'demo' }, '接战 / 围城', '交叉剑标识 · 红色地面提示'],
        [{ mapStatus: 'blocked' }, '受阻待命', '静态禁止标识 · 原因进入动态'],
        [{ mapStatus: 'entering' }, '抵达基地', '接收光环 · 载入后给清单'],
    ];
    states.forEach(([army, title, detail], index) => {
        const x = 24 + index * 234, cx = x + 108;
        const displayTime = index === 3 ? time % settings.arrivalPulseMs : time;
        const visual = armyMotion(army, displayTime, .5, still);
        const fx = index === 0 && !still ? cx - 20 + time / (frameCount * delay) * 40 : cx;
        const fy = 224, size = 112;
        svg += `<rect x="${x}" y="79" width="216" height="218" rx="8" fill="${color('bp-ui-charcoal')}" stroke="${color('bp-ui-gray')}"/><text x="${cx}" y="108" text-anchor="middle" font-size="16" font-weight="700">${title}</text>`;
        if (index === 0) svg += `<path d="M${cx-62} ${fy}h124" stroke="${color('bp-ui-accent-bright')}" stroke-opacity=".5" stroke-width="2"/>`;
        const ring = index === 1 ? color('bp-notice-danger') : color('bp-notice-success');
        svg += `<ellipse cx="${fx}" cy="${fy}" rx="18" ry="14.74" fill="${color('bp-ui-charcoal')}" stroke="${color('bp-ui-white')}" stroke-width="2.5"/>`;
        if ([1, 3].includes(index)) {
            const radius = 24 + visual.pulse * 7;
            svg += `<ellipse cx="${fx}" cy="${fy}" rx="${radius}" ry="${radius*.819152}" fill="none" stroke="${ring}" stroke-width="2" opacity="${visual.pulse}"/>`;
        }
        svg += `<g transform="rotate(${visual.rotation*180/Math.PI} ${fx} ${fy})">${image(flag, fx - flags.anchor[0]*size, fy - flags.anchor[1]*size, size)}</g>`;
        if (visual.badge) svg += image(badges[visual.badge], fx + size*.25, fy - size*.67, 22);
        svg += `<text x="${cx}" y="278" text-anchor="middle" font-size="12" fill="${color('bp-ui-text-muted')}">${detail}</text>`;
    });
    svg += `<rect x="24" y="314" width="912" height="151" rx="8" fill="${color('bp-ui-charcoal')}" stroke="${color('bp-ui-gray')}"/><text x="42" y="341" font-size="16" font-weight="700">接收清单 · 示意数值</text><text x="42" y="368" font-size="14">抵达 → 载入 → 成功登记；失败保留军团，并从动态记录重新下令</text>`;
    [['已登记', 20], ['已落地', 18], ['等待落地', 2], ['伤员', 3], ['队友', 1]].forEach(([label, value], index) => {
        const x = 42 + index * 177;
        svg += `<text x="${x}" y="402" font-size="12" fill="${color('bp-ui-text-muted')}">${label}</text><text x="${x}" y="434" font-size="24" font-weight="700">${value}</text>`;
    });
    return svg + '</g></svg>';
};
await sharp(Buffer.from(draw(0, true))).png().toFile(path.join(directory, 'contact-sheet.png'));
const frames = [];
for (let index = 0; index < frameCount; index++) frames.push(await sharp(Buffer.from(draw(index * delay))).ensureAlpha().raw().toBuffer());
await sharp(Buffer.concat(frames), { raw: { width, height: height * frameCount, channels: 4, pageHeight: height } })
    .gif({ loop: 0, delay, colours: 128, effort: 3 }).toFile(path.join(directory, 'army-feedback-preview.gif'));
fs.writeFileSync(path.join(directory, 'manifest.json'), JSON.stringify({ purpose: 'Offline design preview, not a runtime capture',
    sources: [flags.path, 'data/world-map-army-visuals.json', 'assets/ui/world-map/command-badges/attack.png',
        'assets/ui/world-map/command-badges/enter.png', 'assets/ui/world-map/command-badges/blocked.png'],
    motion: 'src/ui/world-map-army-motion.js', settings: 'data/world-map-command-feedback.json',
    width, height, frameCount, delayMs: delay, durationMs: frameCount * delay,
    note: 'Existing accepted flag art and previously generated badges are unchanged. Receipt numbers are examples only.' }, null, 2) + '\n');
console.log(path.join(directory, 'army-feedback-preview.gif'));
