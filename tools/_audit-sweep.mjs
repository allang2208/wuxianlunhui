#!/usr/bin/env node
/* 阴影稳定性/碎裂离线扫描（2026-08-19 用户报：研究院复杂建筑、楼梯碎裂、时显时不显）：
 * 用运行时真函数 + 真 manifest，对每栋建筑 × 全天 50 个相位扫描：
 *   - 并集多边形是否退化/为空（时显时不显嫌疑）
 *   - 近边接地曲线相邻列 groundY 跳变 >30 贴图像素的个数（碎裂/锯齿嫌疑）
 *   - 多边形面积突变（相邻相位面积比 >1.5 或 <0.67 = 跳变嫌疑）
 * 楼梯键（wall_stair_*）显示尺寸 220×220（WALL_STAIR_CONFIG）。 */
import { EnvironmentLightingSystem as ELS } from '../src/world/environment-lighting-system.js';
import manifest from '../data/environment-lighting-assets.json' with { type: 'json' };

const BUILDINGS = {
    thatch_hut: [794, 650, 275, 225],
    blacksmith: [910, 743, 279, 197],
    church: [1039, 1220, 256, 301],
    research_institute: [1051, 1114, 256, 271],
    warehouse: [1024, 1094, 278, 298],
    shooting_range: [786, 627, 272, 217],
    cavalry_school: [940, 713, 266, 202],
    barracks: [737, 620, 275, 231],
    mine: [847, 663, 277, 217],
    defense_base: [688, 572, 440, 366],
    portal: [1127, 1192, 335, 354],
    wall_stair_1x1_h: [800, 800, 220, 220],
    wall_stair_1x1_v: [800, 800, 220, 220],
    wall_stair_lower_e1_pos: [800, 800, 220, 220],
    wall_stair_lower_e1_neg: [800, 800, 220, 220],
    wall_stair_lower_e2_pos: [800, 800, 220, 220],
    wall_stair_lower_e2_neg: [800, 800, 220, 220],
    wall_stair_upper_e1_pos: [800, 800, 220, 220],
    wall_stair_upper_e2_pos: [800, 800, 220, 220],
    obstacle_block: [1024, 1024, 260, 259],
};

const polyArea = (pts) => {
    let s = 0;
    for (let i = 0; i < pts.length; i++) {
        const a = pts[i]; const b = pts[(i + 1) % pts.length];
        s += a.x * b.y - b.x * a.y;
    }
    return Math.abs(s) / 2;
};

for (const [key, [texW, texH, dw, dh]] of Object.entries(BUILDINGS)) {
    const meta = manifest.assets?.[key]?.shadowSilhouette;
    if (!meta) { console.log(`${key}: 无剪影`); continue; }
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

    // 接地曲线相邻跳变（贴图像素）
    let jumps = 0;
    let jumpMax = 0;
    for (let i = 1; i < columns.length; i++) {
        const g0 = Math.max(columns[i - 1][2], meta.frontY - 0.5 * Math.abs(columns[i - 1][0] - frontTX));
        const g1 = Math.max(columns[i][2], meta.frontY - 0.5 * Math.abs(columns[i][0] - frontTX));
        const d = Math.abs(g1 - g0);
        if (d > 30) { jumps++; if (d > jumpMax) jumpMax = d; }
    }

    let empties = 0;
    let prevArea = null;
    let areaJumps = 0;
    let maxAreaJump = 1;
    for (let i = 0; i < 50; i++) {
        const phase = i / 50;
        ELS.configure({ animateSun: false, startPhase: phase });
        const profile = ELS.getStaticShadow({ height: mh, maxOffset });
        if (!profile) { empties++; continue; }
        if (profile.opacity <= 0.001) { prevArea = null; continue; } // 夜：本来就不显示
        const theta = Math.atan2(profile.offsetY, profile.offsetX);
        const hullBody = bodyVerts.length >= 3 ? ELS.getStaticShadowHull(bodyVerts, profile) : [];
        const silPoly = ELS.getSilhouetteShadowPolygon(columns, { ...common, theta, length: profile.length, maxHeight: mh, maxOffset });
        const union = ELS.getUnionShadowPolygon(hullBody, silPoly, { theta });
        if (union.length < 3) { empties++; continue; }
        const area = polyArea(union);
        if (prevArea) {
            const r = area / prevArea;
            if (r > 1.5 || r < 0.67) { areaJumps++; if (Math.max(r, 1 / r) > maxAreaJump) maxAreaJump = Math.max(r, 1 / r); }
        }
        prevArea = area;
    }
    console.log(`${key}: 空/退化相位=${empties} 近边跳变=${jumps}(max ${jumpMax.toFixed(0)}texpx) 面积突变=${areaJumps}(max ×${maxAreaJump.toFixed(2)}) body=${bodyVerts.length}`);
}
