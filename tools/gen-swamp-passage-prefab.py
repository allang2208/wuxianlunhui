#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""生成沼泽版通道预制（左右通道·沼泽）：按僵尸通道预制同轴同偏移，
直墙/门换成沼泽墙几何（face 中点对齐、尺度换沼泽档）。"""
import json, io, math

GEO = {
    'straight': {'w': 1600, 'h': 1383, 'face': [[16, 622], [1516, 1379]]},
    'gate':     {'w': 640, 'h': 641, 'face': [[4, 294], [634, 611.3]]},
    'swamp_straight': {'w': 1419, 'h': 1558, 'face': [[28, 791], [1389, 1566.5]]},
    'swamp_gate':     {'w': 640, 'h': 612, 'face': [[5, 275], [634, 632.8]]},
}
Z_STRAIGHT_SCALE = (0.27496382054992763, 0.31450893420271037)
Z_GATE_SCALE = (0.6551724137931034, 0.7510354411835177)
SW_STRAIGHT_SCALE = (0.23773773773773774, 0.24090868685463282)
SW_GATE_SCALE = (0.6310195948189969, 0.6404477307936173)

def face_mid_offset(g, sx, sy):
    w, h = g['w'], g['h']
    f = g['face']
    return ((f[0][0] + f[1][0]) / 2 - w / 2) * sx, ((f[0][1] + f[1][1]) / 2 - h / 2) * sy

def face_mid(piece, geo, sx, sy):
    ox, oy = face_mid_offset(geo, sx, sy)
    return piece['x'] + ox, piece['y'] + oy

def main():
    path = r'data/wall-prefabs.json'
    d = json.load(io.open(path, encoding='utf-8'))
    # 找左右通道：6 件 = 2 门 + 4 直墙，门轴对齐 (0.866, 0.5)
    passage_key = None
    for k, p in d.items():
        texes = {pc.get('tex') for pc in p.get('pieces', [])}
        if texes != {'wall_gate', 'wall_straight'} or len(p.get('pieces', [])) != 6:
            continue
        gates = [pc for pc in p['pieces'] if pc['tex'] == 'wall_gate']
        if len(gates) != 2:
            continue
        gA = face_mid(gates[0], GEO['gate'], *Z_GATE_SCALE)
        gB = face_mid(gates[1], GEO['gate'], *Z_GATE_SCALE)
        L = math.hypot(gB[0] - gA[0], gB[1] - gA[1])
        if L > 100 and ((gB[0] - gA[0]) * 0.866 + (gB[1] - gA[1]) * 0.5) / L > 0.8:
            passage_key = k
            break
    if not passage_key:
        raise SystemExit('左右通道 prefab not found')
    print('source passage:', passage_key)
    src = d[passage_key]
    gates = [p for p in src['pieces'] if p['tex'] == 'wall_gate']
    straights = [p for p in src['pieces'] if p['tex'] == 'wall_straight']
    gA = face_mid(gates[0], GEO['gate'], *Z_GATE_SCALE)
    gB = face_mid(gates[1], GEO['gate'], *Z_GATE_SCALE)
    vx, vy = gB[0] - gA[0], gB[1] - gA[1]
    L = math.hypot(vx, vy)
    axis = (vx / L, vy / L)
    perp = (-axis[1], axis[0])

    off_sw = face_mid_offset(GEO['swamp_straight'], *SW_STRAIGHT_SCALE)
    off_g = face_mid_offset(GEO['swamp_gate'], *SW_GATE_SCALE)
    new_pieces = []
    # ⚠ 2026-08-08 二修：沼泽直墙世界长 374px < 僵尸墙 476px，原 2 段/侧盖不满
    # 走廊（中段留 94~105px 空隙）。按 SKILL「定长瓦片 + 8px 叠合」改为 3 段/侧：
    # 每侧沿走廊轴从 t_start 到 t_end 铺 3 块（步长 = 374 - 8 = 366），覆盖 ≈1106px。
    # 两侧垂直偏移取原预制两件 face 中点的实际 perp 值（走廊两侧不等距）。
    side_offsets = {}
    for z in straights:
        zm = face_mid(z, GEO['straight'], *Z_STRAIGHT_SCALE)
        dperp = (zm[0] - gA[0]) * perp[0] + (zm[1] - gA[1]) * perp[1]
        side = 1 if dperp > 0 else -1
        if side not in side_offsets:
            side_offsets[side] = dperp
    for side, dperp in side_offsets.items():
        # 走廊覆盖范围：两端各超出门口 40px（房间边线由封口逻辑补），
        # 3 块定长（374）8px 叠合 → 1106px 覆盖
        t_start, t_end = -40, L + 40
        n = 3
        step = (t_end - t_start - 374) / (n - 1) if n > 1 else 0
        for i in range(n):
            t = t_start + i * step + 374 / 2
            M = (gA[0] + axis[0] * t + perp[0] * dperp, gA[1] + axis[1] * t + perp[1] * dperp)
            p = dict(straights[0])
            p['tex'] = 'swamp_wall_straight'
            p['scaleX'] = SW_STRAIGHT_SCALE[0]
            p['scaleY'] = SW_STRAIGHT_SCALE[1]
            p['x'] = M[0] - off_sw[0]
            p['y'] = M[1] - off_sw[1]
            p['label'] = '沼泽柴墙'
            new_pieces.append(p)
            fm = face_mid(p, GEO['swamp_straight'], *SW_STRAIGHT_SCALE)
            print('straight side=%+d d=%.1f t=%.1f -> (%.1f, %.1f) face_mid=(%.1f, %.1f)'
                  % (side, dperp, t, p['x'], p['y'], fm[0], fm[1]))
    for z, g_face in zip(gates, [gA, gB]):
        p = dict(z)
        p['tex'] = 'swamp_gate'
        p['scaleX'] = SW_GATE_SCALE[0]
        p['scaleY'] = SW_GATE_SCALE[1]
        p['x'] = g_face[0] - off_g[0]
        p['y'] = g_face[1] - off_g[1]
        p['label'] = '沼泽藤门'
        new_pieces.append(p)
        fm = face_mid(p, GEO['swamp_gate'], *SW_GATE_SCALE)
        print('gate -> (%.1f, %.1f) face_mid=(%.1f, %.1f)' % (p['x'], p['y'], fm[0], fm[1]))

    new_name = passage_key + '·沼泽'
    out = dict(src)
    out['name'] = new_name
    out['pieces'] = new_pieces
    d[new_name] = out
    with io.open(path, 'w', encoding='utf-8') as f:
        json.dump(d, f, ensure_ascii=False, indent=1)
    print('saved', new_name, 'pieces:', len(new_pieces))

if __name__ == '__main__':
    main()
