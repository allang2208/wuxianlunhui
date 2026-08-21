#!/usr/bin/env node
/* 离线真函数阴影多边形导出（贴合审计 v2）：
 * 直接驱动运行时模块的太阳模型（configure + getStaticShadow），
 * 对每栋建筑 × 多个时刻输出最终并集多边形（显示像素坐标，锚点=(0,0)）。 */
import fs from 'node:fs';
import { EnvironmentLightingSystem as ELS } from '../src/world/environment-lighting-system.js';
import manifest from '../data/environment-lighting-assets.json' with { type: 'json' };

const BUILDINGS = {
    thatch_hut: [794, 650, 275, 225],
    blacksmith: [910, 743, 279, 197],
    church: [1039, 1220, 256, 301],
    research_institute: [908, 1076, 256, 303],
    warehouse: [1024, 1094, 278, 298],
    shooting_range: [786, 627, 272, 217],
    cavalry_school: [940, 713, 266, 202],
    barracks: [737, 620, 275, 231],
    mine: [847, 663, 277, 217],
    defense_base: [688, 572, 440, 366],
};
// phase: 0.125=09:00, 0.25=12:00, 0.354=14:30, 0.438=16:30, 0.479=17:30
const PHASES = [0.125, 0.25, 0.354, 0.438, 0.479];

const out = { phases: {}, meta: {} };
for (const [key, [texW, texH, dw, dh]] of Object.entries(BUILDINGS)) {
    const meta = manifest.assets?.[key]?.shadowSilhouette;
    if (!meta) continue;
    const scaleX = dw / texW;
    const scaleY = dh / texH;
    const columns = meta.columns;
    const frontTX = columns.reduce((a, c) => (c[2] > a[2] ? c : a), columns[0])[0];
    const contentHeights = columns
        .map((c) => Math.max(0, Math.max(c[2], meta.frontY - 0.5 * Math.abs(c[0] - frontTX)) - c[1]) * scaleY)
        .sort((a, b) => a - b);
    const mh = Math.max(1, contentHeights[Math.min(contentHeights.length - 1, Math.floor(contentHeights.length * 0.75))]);
    const maxOffset = Math.max(43, mh * 0.5);
    const common = { scaleX, scaleY, anchorX: 0, anchorY: 0, frontX: meta.frontX, frontY: meta.frontY, texCenterX: texW / 2, flipX: false };
    const bodyVerts = ELS.getSilhouetteFootprintVertices(columns, common);
    out.meta[key] = { texW, texH, scaleX, scaleY, frontX: meta.frontX, frontY: meta.frontY, measuredHeight: mh, maxOffset, bodyVerts,
        groundCurve: columns.map((c) => [c[0], Math.max(c[2], meta.frontY - 0.5 * Math.abs(c[0] - frontTX))]) };

    for (const phase of PHASES) {
        ELS.configure({ animateSun: false, startPhase: phase });
        const sun = ELS.getSun();
        const profile = ELS.getStaticShadow({ height: mh, maxOffset });
        if (!profile) continue;
        const theta = Math.atan2(profile.offsetY, profile.offsetX);
        const hullBody = bodyVerts.length >= 3 ? ELS.getStaticShadowHull(bodyVerts, profile) : [];
        const silPoly = ELS.getSilhouetteShadowPolygon(columns, { ...common, theta, length: profile.length, maxHeight: mh, maxOffset });
        const union = ELS.getUnionShadowPolygon(hullBody, silPoly, { theta });
        const pk = String(phase);
        out.phases[pk] = out.phases[pk] || { sun: { elevation: sun.elevation, daylight: sun.daylight, shadowX: sun.shadowX, shadowY: sun.shadowY }, items: {} };
        out.phases[pk].items[key] = { length: profile.length, opacity: profile.opacity, theta, hullBody, silPoly, union };
    }
}
fs.writeFileSync('tools/verify-shots/_realpoly.json', JSON.stringify(out));
console.log('phases:', Object.keys(out.phases).join(', '));
for (const [pk, pv] of Object.entries(out.phases)) {
    console.log(`phase ${pk}: elev=${pv.sun.elevation.toFixed(2)} daylight=${pv.sun.daylight.toFixed(2)} dir=(${pv.sun.shadowX.toFixed(2)},${pv.sun.shadowY.toFixed(2)}) warehouse len=${pv.items.warehouse?.length.toFixed(1)} op=${pv.items.warehouse?.opacity.toFixed(3)} union=${pv.items.warehouse?.union.length}pt`);
}
