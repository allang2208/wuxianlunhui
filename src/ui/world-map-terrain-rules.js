import layout from '../../data/world-map-layout.json';
const SIN = Math.sin(layout.cameraElevationDegrees * Math.PI / 180);
/** Rule symbols share the exact terrain projection in both near and cached far views. */
export function drawStrategicTerrainRules(ctx, cell, x, y, scale, { drawMountain = true } = {}) {
    ctx.save();
    if (drawMountain && cell.mountain) {
        ctx.beginPath();
        ctx.moveTo(x - scale * .64, y + scale * .28);
        ctx.lineTo(x - scale * .12, y - scale * .72);
        ctx.lineTo(x + scale * .18, y - scale * .24);
        ctx.lineTo(x + scale * .4, y - scale * .56);
        ctx.lineTo(x + scale * .67, y + scale * .28); ctx.closePath();
        ctx.fillStyle = '#454b50'; ctx.fill(); ctx.strokeStyle = '#c1c7ca'; ctx.lineWidth = Math.max(1, scale * .04); ctx.stroke();
        if (cell.pass) {
            ctx.beginPath(); ctx.moveTo(x - scale * .7, y + scale * .12);
            ctx.lineTo(x, y - scale * .08); ctx.lineTo(x + scale * .7, y + scale * .1);
            ctx.strokeStyle = '#dfc68d'; ctx.lineWidth = Math.max(2, scale * .15); ctx.stroke();
        }
    }
    for (const id of cell.rivers || []) {
        if (cell.id >= id) continue;
        const [q, r] = id.split(',').map(Number), dq = q - cell.q, dr = r - cell.r;
        const dx = Math.sqrt(3) * (dq + dr / 2), dy = -1.5 * dr;
        const length = Math.hypot(dx, dy), mx = x + dx * scale / 2, my = y + dy * SIN * scale / 2;
        const tx = -dy / length * scale * .52, ty = dx / length * SIN * scale * .52;
        ctx.beginPath(); ctx.moveTo(mx - tx, my - ty); ctx.lineTo(mx + tx, my + ty);
        ctx.strokeStyle = '#264657'; ctx.lineWidth = Math.max(3, scale * .2); ctx.stroke();
        ctx.strokeStyle = '#82b5c1'; ctx.lineWidth = Math.max(1.5, scale * .09); ctx.stroke();
    }
    ctx.restore();
}
