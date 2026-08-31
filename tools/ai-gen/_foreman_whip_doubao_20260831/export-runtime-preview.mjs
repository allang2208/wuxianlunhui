// Offline illustration export: imports the production projection, not Phaser.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { projectForemanWhip } from '../../../src/entities/enemy-types/_shared/foreman-whip-geometry.js';

const root = new URL('./', import.meta.url);
const motion = JSON.parse(fs.readFileSync(new URL('../../../data/foreman-whip-motion.json', root), 'utf8'));
const config = JSON.parse(fs.readFileSync(new URL('../../../data/enemy-config.json', root), 'utf8')).foremanZombie;
const scale = config.render.spriteSize / motion.referenceCell;
const views = Array.from({ length: 8 }, (_, index) => {
    const angle = index * Math.PI / 4;
    const flipX = Math.cos(angle) < -0.0001;
    return {
        name: ['RIGHT', 'DOWN-RIGHT', 'DOWN', 'DOWN-LEFT', 'LEFT', 'UP-LEFT', 'UP', 'UP-RIGHT'][index],
        angle, flipX,
        groundTip: [Math.cos(angle) * 320, Math.sin(angle) * 160],
        frames: motion.frames.map((pose, frame) => projectForemanWhip({
            pose, contactPose: motion.frames[motion.contactFrame], frame,
            contactFrame: motion.contactFrame, root: { x: 0, y: 0 }, pixelScale: scale,
            angle, flipX, reach: 320, strikeHeight: config.attackSkills.whip.handHeight,
        })),
    };
});
fs.writeFileSync(new URL('previews/runtime-projection.json', root), JSON.stringify({
    source: 'production projectForemanWhip; offline illustration, not game capture',
    bodySheet: config.textures.attack, layout: motion.layout, scale,
    widths: motion.strokeWidths, opacities: motion.whipOpacities,
    durations: motion.frameDurations, strikeHeight: config.attackSkills.whip.handHeight, views,
}));
console.log(fileURLToPath(new URL('previews/runtime-projection.json', root)));
