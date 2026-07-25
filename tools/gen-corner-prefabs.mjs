// 按用户「上夹角」同款规格，用基底直墙(wall_straight)生成 下/左/右 三个夹角预制
// 透视规则：整体 下>左>右>上；夹角内朝下的臂（更靠近镜头）depth 更大
// 运行: node tools/gen-corner-prefabs.mjs
import fs from 'node:fs';

const FILES = ['public/data/wall-prefabs.json', 'data/wall-prefabs.json'];

// wall_straight 几何（ISO_WALL_GEO.straight）
const GEO = { w: 1600, h: 1383, face: [[16, 622], [1516, 1379]] };
const OVERLAP = 8; // 续接叠合量（SNAP_OVERLAP 同款）

// 从用户「上夹角」读取缩放，保持全套一致
const lib = JSON.parse(fs.readFileSync(FILES[0], 'utf8'));
const ref = lib['上夹角'] && lib['上夹角'].pieces[0];
if (!ref) throw new Error('未找到 上夹角 预制');
const SX = ref.scaleX, SY = ref.scaleY;

// 贴图点 → 世界（origin 中心 + scale + flip）
function tex2world(p, tx, ty) {
    let u = tx - GEO.w / 2;
    const v = ty - GEO.h / 2;
    if (p.flipX) u = -u;
    return { x: p.x + u * SX, y: p.y + v * SY };
}
// face 两端的世界坐标
function faceWorld(p) {
    return [tex2world(p, GEO.face[0][0], GEO.face[0][1]), tex2world(p, GEO.face[1][0], GEO.face[1][1])];
}
// face 世界向量（no flip: (dx+,dy+) 下行; flip: (dx-,dy+) 下行）
const FACE_DX = (GEO.face[1][0] - GEO.face[0][0]) * SX;   // 412.5
const FACE_DY = (GEO.face[1][1] - GEO.face[0][1]) * SY;   // 238.1
const RUN = Math.hypot(FACE_DX, FACE_DY);

let seq = 0;
function piece(cx, cy, flipX, depth, label) {
    return {
        tex: 'wall_straight',
        x: Math.round(cx * 1000) / 1000,
        y: Math.round(cy * 1000) / 1000,
        scaleX: SX, scaleY: SY, flipX, flipY: false,
        depth: Math.round(depth * 1000) / 1000,
        family: 'wall',
        label: label || `直墙·新 ${++seq}`,
    };
}
// "\" 件：face 起点(左上端)在 S
function pieceDownRightAt(S, depth, label) {
    // face[0] 世界 = center + (-(W/2-16)*SX, (622-H/2)*SY)
    const cx = S.x + (GEO.w / 2 - GEO.face[0][0]) * SX;
    const cy = S.y - (GEO.face[0][1] - GEO.h / 2) * SY;
    return piece(cx, cy, false, depth, label);
}
// "\" 件：face 终点(右下端)在 E
function pieceDownRightEnd(E, depth, label) {
    const S = { x: E.x - FACE_DX, y: E.y - FACE_DY };
    return pieceDownRightAt(S, depth, label);
}
// "/" 件(flipX)：face 起点(右上端)在 S
function pieceDownLeftAt(S, depth, label) {
    // flip 后 face[0] 世界 = center + ((W/2-16)*SX, (622-H/2)*SY)
    const cx = S.x - (GEO.w / 2 - GEO.face[0][0]) * SX;
    const cy = S.y - (GEO.face[0][1] - GEO.h / 2) * SY;
    return piece(cx, cy, true, depth, label);
}
// "/" 件(flipX)：face 终点(左下端)在 E
function pieceDownLeftEnd(E, depth, label) {
    const S = { x: E.x + FACE_DX, y: E.y - FACE_DY };
    return pieceDownLeftAt(S, depth, label);
}
function maxFaceY(p) {
    const [a, b] = faceWorld(p);
    return Math.max(a.y, b.y);
}
function minFaceY(p) {
    const [a, b] = faceWorld(p);
    return Math.min(a.y, b.y);
}
function prefab(name, vertex, pieces) {
    const xs = pieces.map(p => p.x), ys = pieces.map(p => p.y);
    return {
        name,
        cx: Math.round((Math.min(...xs) + Math.max(...xs)) / 2),
        cy: Math.round((Math.min(...ys) + Math.max(...ys)) / 2),
        pieces,
    };
}

const out = {};

// ---- 下夹角（∨ 顶点朝下，两臂向左上/右上）----
{
    const V = { x: 4551, y: 2600 };
    const ux = FACE_DX / RUN, uy = FACE_DY / RUN;
    const L1 = pieceDownRightEnd(V, V.y + 2);                       // 左臂内段（前排，顶点收尾）
    const L1s = faceWorld(L1)[0];
    const L2 = pieceDownRightEnd({ x: L1s.x - ux * OVERLAP, y: L1s.y - uy * OVERLAP }, 0, '直墙·新 2');
    L2.depth = maxFaceY(L2);
    const R1 = pieceDownLeftEnd(V, V.y + 1, '直墙·新 3');           // 右臂内段
    const R1s = faceWorld(R1)[0];
    const R2 = pieceDownLeftEnd({ x: R1s.x + ux * OVERLAP, y: R1s.y - uy * OVERLAP }, 0, '直墙·新 4');
    R2.depth = maxFaceY(R2);
    L1.label = '直墙·新 1';
    out['下夹角'] = prefab('下夹角', V, [L1, L2, R1, R2]);
}

// ---- 左夹角（< 顶点朝左，上臂向右上(后墙取 min 底边)、下臂向右下(前墙取 max 底边)）----
{
    const V = { x: 3400, y: 2000 };
    const ux = FACE_DX / RUN, uy = FACE_DY / RUN;
    const U1 = pieceDownLeftEnd(V, 0, '直墙·新 1');                 // 上臂内段（后墙：depth=min 底边，室内实体永远在前）
    U1.depth = minFaceY(U1);
    const U1s = faceWorld(U1)[0];
    const U2 = pieceDownLeftEnd({ x: U1s.x + ux * OVERLAP, y: U1s.y - uy * OVERLAP }, 0, '直墙·新 2');
    U2.depth = minFaceY(U2);
    const D1 = pieceDownRightAt(V, 0, '直墙·新 3');                 // 下臂内段（前墙：depth=max 底边，盖住后臂顶点）
    D1.depth = maxFaceY(D1);
    const D1e = faceWorld(D1)[1];
    const D2 = pieceDownRightAt({ x: D1e.x - ux * OVERLAP, y: D1e.y - uy * OVERLAP }, 0, '直墙·新 4');
    D2.depth = maxFaceY(D2);
    out['左夹角'] = prefab('左夹角', V, [U1, U2, D1, D2]);
}

// ---- 右夹角（> 顶点朝右，上臂向左上(后墙 min)、下臂向左下(前墙 max)）----
{
    const V = { x: 5700, y: 2000 };
    const ux = FACE_DX / RUN, uy = FACE_DY / RUN;
    const U1 = pieceDownRightEnd(V, 0, '直墙·新 1');                // 上臂内段（后墙）
    U1.depth = minFaceY(U1);
    const U1s = faceWorld(U1)[0];
    const U2 = pieceDownRightEnd({ x: U1s.x - ux * OVERLAP, y: U1s.y - uy * OVERLAP }, 0, '直墙·新 2');
    U2.depth = minFaceY(U2);
    const D1 = pieceDownLeftAt(V, 0, '直墙·新 3');                  // 下臂内段（前墙）
    D1.depth = maxFaceY(D1);
    const D1e = faceWorld(D1)[1];
    const D2 = pieceDownLeftAt({ x: D1e.x + ux * OVERLAP, y: D1e.y - uy * OVERLAP }, 0, '直墙·新 4');
    D2.depth = maxFaceY(D2);
    out['右夹角'] = prefab('右夹角', V, [U1, U2, D1, D2]);
}

// ---- 用户手摆「上夹角」深度修正：两臂均为后墙，depth 改为各自 min 底边 ----
//（此前 depth 为摆放时的中心 y，右侧臂 depth 过大导致错误遮挡室内人物）
{
    const ref2 = lib['上夹角'];
    if (ref2 && Array.isArray(ref2.pieces)) {
        for (const p of ref2.pieces) {
            if (p.tex !== 'wall_straight') continue;
            const [a, b] = faceWorld(p);
            p.depth = Math.round(Math.min(a.y, b.y) * 1000) / 1000;
        }
        out['上夹角'] = ref2;
    }
}

for (const f of FILES) {
    const cur = JSON.parse(fs.readFileSync(f, 'utf8'));
    Object.assign(cur, out);
    fs.writeFileSync(f, JSON.stringify(cur, null, 2), 'utf8');
    console.log('written', f);
}
for (const k of Object.keys(out)) {
    console.log(k, '件数:', out[k].pieces.length, '中心:', out[k].cx, out[k].cy);
    for (const p of out[k].pieces) console.log('  ', p.label, 'flipX=' + p.flipX, `(${p.x},${p.y})`, 'depth', p.depth);
}
