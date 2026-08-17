#!/usr/bin/env python3
"""基地菱形房无缝拼接测试（2026-08-17，用户思路：先用原模型在 Blender 摆成菱形，
验证端帽叠合/转角互盖是否无缝，再复刻尺寸渲染进游戏）。

几何口径与游戏 src/world/defense-system.js _buildBaseRoom 完全同源：
  - 基地中心 (4200,4096)、room rx=512 ry=256；
  - COVER_FACE v A(-88,-21) B(88,-108)，faceLen=196.33，joinOverlap=40，
    step=faceLen-40=156.33，cornerExtend=29；
  - 渲染源 box 230×52×150 → 游戏显示宽 260px（比例 260/230=1.1304），
    因此这里统一用「游戏 px」表示 box：尺寸 [260, 59, 170]（52×1.1304≈59，150×1.1304≈170）。

输出：tools/verify-shots/cover_diamond_test.png（顶视正交渲染）+ 控制台接缝诊断。
用法：blender --background --factory-startup --python blender-cover-diamond-test.py
"""
import json
import math
import os
import sys

import bpy

OUT_PNG = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "verify-shots", "cover_diamond_test.png")
OUT_PNG = os.path.normpath(OUT_PNG)

# ---- 游戏拼接参数（px） ----
BASE = (4200.0, 4096.0)
ROOM = {"rx": 512.0, "ry": 256.0}
COVER_FACE_V = {"A": (-88.0, -21.0), "B": (88.0, -108.0)}
JOIN_OVERLAP = 40.0
CORNER_EXT = 29.0
OPEN_RADIUS = 90.0
OPEN_EDGE = "RB"

# 显示比例：渲染源 box 230 → 显示 260px
PX = 260.0 / 230.0
BOX_W = 230.0 * PX
BOX_D = 52.0 * PX
BOX_H = 150.0 * PX
ROT_V = 44.8  # v 向渲染旋转（底边投影斜率 0.4976）
ROT_H = -44.8  # h 向（镜像）


def face_len():
    a, b = COVER_FACE_V["A"], COVER_FACE_V["B"]
    return math.hypot(b[0] - a[0], b[1] - a[1])


def build_layout():
    """复刻 _buildBaseRoom：返回每条边上的段列表 [{x,y,orient}]（游戏 px）"""
    bx, by = BASE
    rx, ry = ROOM["rx"], ROOM["ry"]
    T = (bx, by - ry); R = (bx + rx, by); B = (bx, by + ry); L = (bx - rx, by)
    edges = [
        {"key": "TL", "from": T, "to": L, "orient": "v"},
        {"key": "TR", "from": T, "to": R, "orient": "h"},
        {"key": "LB", "from": L, "to": B, "orient": "h"},
        {"key": "RB", "from": R, "to": B, "orient": "v"},
    ]
    flen = face_len()
    step = flen - JOIN_OVERLAP
    A, Bp = COVER_FACE_V["A"], COVER_FACE_V["B"]
    layout = []
    for e in edges:
        dx = e["to"][0] - e["from"][0]; dy = e["to"][1] - e["from"][1]
        ln = math.hypot(dx, dy)
        ux, uy = dx / ln, dy / ln
        g = COVER_FACE_V
        projA = g["A"][0] * ux + g["A"][1] * uy
        projB = g["B"][0] * ux + g["B"][1] * uy
        toward = "A" if projA < projB else "B"
        halfToV = abs(projA if toward == "A" else projB)
        halfAway = abs(projB if toward == "A" else projA)
        t0 = -CORNER_EXT + halfToV
        tLast = ln + CORNER_EXT - halfAway
        n = max(2, int(math.ceil((tLast - t0) / step)) + 1)
        spacing = (tLast - t0) / (n - 1) if n > 1 else 0
        openMid = ln / 2 if e["key"] == OPEN_EDGE else None
        for i in range(n):
            t = t0 + i * spacing
            if openMid is not None:
                f0 = t - halfToV
                f1 = t + halfAway
                if f1 > openMid - OPEN_RADIUS and f0 < openMid + OPEN_RADIUS:
                    continue
            layout.append({
                "key": e["key"],
                "x": e["from"][0] + ux * t,
                "y": e["from"][1] + uy * t,
                "orient": e["orient"],
            })
    return layout


def place_box(seg, color=(0.72, 0.55, 0.32)):
    bpy.ops.mesh.primitive_cube_add(size=2)
    o = bpy.context.active_object
    o.scale = (BOX_W / 2, BOX_D / 2, BOX_H / 2)
    o.location = (seg["x"], seg["y"], BOX_H / 2)
    rot = ROT_V if seg["orient"] == "v" else ROT_H
    o.rotation_euler = (0, 0, math.radians(rot))
    mat = bpy.data.materials.new(f"m_{len(bpy.data.materials)}")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (*color, 1)
    o.data.materials.append(mat)
    return o


def seg_world_ends(seg):
    """box 局部 X 轴（长轴）两端面中心的世界坐标（XY 平面）"""
    import mathutils
    rot = ROT_V if seg["orient"] == "v" else ROT_H
    r = math.radians(rot)
    c, s = math.cos(r), math.sin(r)
    hw = BOX_W / 2
    e1 = (seg["x"] + hw * c, seg["y"] + hw * s)
    e2 = (seg["x"] - hw * c, seg["y"] - hw * s)
    return e1, e2


def edge_unit(edge):
    dx = edge["to"][0] - edge["from"][0]
    dy = edge["to"][1] - edge["from"][1]
    ln = math.hypot(dx, dy)
    return dx / ln, dy / ln


def geom_diagnose(layout):
    """按边输出：相邻段端面沿边方向的间距（正=缝隙，负=端帽重叠）"""
    bx, by = BASE
    rx, ry = ROOM["rx"], ROOM["ry"]
    T = (bx, by - ry); R = (bx + rx, by); B = (bx, by + ry); L = (bx - rx, by)
    edges = {
        "TL": {"from": T, "to": L, "orient": "v"},
        "TR": {"from": T, "to": R, "orient": "h"},
        "LB": {"from": L, "to": B, "orient": "h"},
        "RB": {"from": R, "to": B, "orient": "v"},
    }
    print("[diamond-test] == 端面间距（正=缝隙 px，负=端帽重叠 px） ==")
    for key, edge in edges.items():
        segs = sorted([s for s in layout if s["key"] == key],
                      key=lambda s: (s["x"] * edge["to"][0] - edge["from"][0]) + s["y"] * (edge["to"][1] - edge["from"][1]))
        ux, uy = edge_unit(edge)
        # 沿边方向排序：投影 = 中心·u
        segs.sort(key=lambda s: s["x"] * ux + s["y"] * uy)
        gaps = []
        for a, b in zip(segs, segs[1:]):
            # a 的末端端面（沿 +u 方向那端）与 b 的首端端面间距
            ae1, ae2 = seg_world_ends(a)
            be1, be2 = seg_world_ends(b)
            aEnd = max(ae1[0] * ux + ae1[1] * uy, ae2[0] * ux + ae2[1] * uy)
            bStart = min(be1[0] * ux + be1[1] * uy, be2[0] * ux + be2[1] * uy)
            gaps.append(round(bStart - aEnd, 2))
        print(f"[diamond-test] {key}: 端面间距={gaps}")


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    layout = build_layout()
    print(f"[diamond-test] faceLen={face_len():.2f} step={face_len() - JOIN_OVERLAP:.2f} segs={len(layout)}")
    for s in layout:
        place_box(s)
    geom_diagnose(layout)

    # 接缝诊断：相邻同边段端帽间距（沿边投影）
    for key in ["TL", "TR", "LB", "RB"]:
        segs = [s for s in layout if s["key"] == key]
        segs.sort(key=lambda s: (s["x"], s["y"]))
        gaps = []
        for a, b in zip(segs, segs[1:]):
            d = math.hypot(b["x"] - a["x"], b["y"] - a["y"])
            gaps.append(round(d - (face_len() - JOIN_OVERLAP), 2))
        print(f"[diamond-test] {key}: {len(segs)} 段，相邻中心距偏差={gaps}")

    # 顶视正交相机
    bpy.ops.object.camera_add(location=(BASE[0], BASE[1], 3000))
    cam = bpy.context.active_object
    cam.rotation_euler = (0, 0, 0)
    cam.data.type = "ORTHO"
    cam.data.ortho_scale = 1600
    scene = bpy.context.scene
    scene.camera = cam
    # 光照：顶部太阳（默认灯随对象全删，无光则全黑）
    bpy.ops.object.light_add(type="SUN", location=(BASE[0], BASE[1], 2000))
    sun = bpy.context.active_object
    sun.rotation_euler = (0, 0, 0)
    sun.data.energy = 3.0
    sun.data.angle = math.radians(45)
    # 地面
    bpy.ops.mesh.primitive_plane_add(size=2200, location=(BASE[0], BASE[1], 0))
    ground = bpy.context.active_object
    gmat = bpy.data.materials.new("ground")
    gmat.use_nodes = True
    gmat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (0.18, 0.22, 0.16, 1)
    ground.data.materials.append(gmat)

    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = OUT_PNG
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    bpy.ops.render.render(write_still=True)
    print(f"[diamond-test] saved {OUT_PNG}")


main()
