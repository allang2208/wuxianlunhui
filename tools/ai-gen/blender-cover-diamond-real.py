#!/usr/bin/env python3
"""基地菱形 4 墙/边 无缝闭合验证（2026-08-17 v2，真实墙模型）。

用 render-cover-real.py 同款墙几何（box 230×52×150，v rot.z=52 / h rot.z=-52），
按游戏 _buildBaseRoom 当前口径（单边 4 段、cornerExtend 29、spacing=144.7）摆放，
从顶视图 + 游戏视角（俯仰 30°）渲染，并输出沿边端面间隙/角点覆盖诊断。

尺寸口径：渲染源 box 230 Blender 单位 = 游戏显示 260px → 布局坐标 ×(230/260)。
用法：blender --background --factory-startup --python blender-cover-diamond-real.py
"""
import json
import math
import os

import bpy
import mathutils

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "verify-shots"))
OUT_TOP = os.path.join(OUT_DIR, "cover_diamond_real_top.png")
OUT_ISO = os.path.join(OUT_DIR, "cover_diamond_real_iso.png")
OUT_DIAG = os.path.join(OUT_DIR, "cover_diamond_real_diag.json")

# ---- 游戏参数（px）----
BASE = (4200.0, 4096.0)
ROOM = {"rx": 512.0, "ry": 256.0}
FACE_V = {"A": (-88.0, -21.0), "B": (88.0, -108.0)}   # v 向 face（RB/TL）
FACE_H = {"A": (-88.0, -108.0), "B": (88.0, -21.0)}   # h 向 face（TR/LB）
JOIN_OVERLAP = 40.0
CORNER_EXT = 29.0
OPEN_EDGE = "RB"
BOX = (230.0, 52.0, 150.0)   # render-cover-real.py 墙 box
PX = 230.0 / 260.0            # 游戏 px → Blender 单位
ROT_V = 52.0                  # v 向渲染旋转（底边斜率 -0.4976）
ROT_H = -52.0                 # h 向（镜像）


def face_len():
    a, b = FACE_V["A"], FACE_V["B"]
    return math.hypot(b[0] - a[0], b[1] - a[1])


def build_layout(include_gate_slot=True):
    """复刻 _buildBaseRoom：每条边 n 段坐标（游戏 px）。gateSlot 段记 gate=True。"""
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
    layout = []
    for e in edges:
        dx = e["to"][0] - e["from"][0]; dy = e["to"][1] - e["from"][1]
        ln = math.hypot(dx, dy)
        ux, uy = dx / ln, dy / ln
        g = FACE_V if e["orient"] == "v" else FACE_H
        projA = g["A"][0] * ux + g["A"][1] * uy
        projB = g["B"][0] * ux + g["B"][1] * uy
        toward = "A" if projA < projB else "B"
        halfToV = abs(projA if toward == "A" else projB)
        halfAway = abs(projB if toward == "A" else projA)
        t0 = -CORNER_EXT + halfToV
        tLast = ln + CORNER_EXT - halfAway
        span = tLast - t0
        n = max(2, int(math.ceil(span / step)) + 1)
        spacing = span / (n - 1) if n > 1 else 0
        gateSlot = int(math.floor(n / 2)) if e["key"] == OPEN_EDGE else None
        for i in range(n):
            t = t0 + i * spacing
            is_gate = include_gate_slot and (i == gateSlot)
            layout.append({
                "key": e["key"],
                "orient": e["orient"],
                "x": e["from"][0] + ux * t,
                "y": e["from"][1] + uy * t,
                "gate": is_gate,
            })
    return layout, edges


def place_wall(seg, color):
    bpy.ops.mesh.primitive_cube_add(size=2)
    o = bpy.context.active_object
    sx, sy, sz = BOX
    o.scale = (sx / 2, sy / 2, sz / 2)
    o.location = (seg["x"] * PX, seg["y"] * PX, sz / 2)
    o.rotation_euler = (0, 0, math.radians(ROT_V if seg["orient"] == "v" else ROT_H))
    mat = bpy.data.materials.new(f"m_{len(bpy.data.materials)}")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (*color, 1)
    o.data.materials.append(mat)
    return o


def box_extent_along(seg, u):
    """box 底面 8 顶点在单位向量 u 上的投影区间 [lo, hi]（Blender 单位）。"""
    r = math.radians(ROT_V if seg["orient"] == "v" else ROT_H)
    c, s = math.cos(r), math.sin(r)
    hw, hd = BOX[0] / 2, BOX[1] / 2
    corners = []
    for lx in (-hw, hw):
        for ly in (-hd, hd):
            wx = seg["x"] * PX + lx * c - ly * s
            wy = seg["y"] * PX + lx * s + ly * c
            corners.append(wx * u[0] + wy * u[1])
    return min(corners), max(corners)


def diagnose(layout, edges):
    """输出沿边端面间隙与角点覆盖（正=缝隙，负=重叠；Blender 单位，×260/230=px）。"""
    out = {"edges": {}, "corners": {}}
    for e in edges:
        dx = e["to"][0] - e["from"][0]; dy = e["to"][1] - e["from"][1]
        ln = math.hypot(dx, dy)
        u = (dx / ln, dy / ln)
        segs = [s for s in layout if s["key"] == e["key"]]
        segs.sort(key=lambda s: s["x"] * u[0] + s["y"] * u[1])
        gaps = []
        for a, b in zip(segs, segs[1:]):
            _, aHi = box_extent_along(a, u)
            bLo, _ = box_extent_along(b, u)
            gaps.append(round((bLo - aHi) * 260 / 230, 2))
        out["edges"][e["key"]] = {
            "n": len(segs),
            "spacing_px": round(144.7, 2),
            "end_gaps_px": gaps,
        }
    # 角点：四条边首末段端面相对顶点的位置（正=未达顶点，负=越过顶点）
    vertex_map = {
        "T": ((4200, 3840), ["TL", "TR"]),
        "R": ((4712, 4096), ["TR", "RB"]),
        "B": ((4200, 4352), ["RB", "LB"]),
        "L": ((3688, 4096), ["LB", "TL"]),
    }
    for vname, (v, keys) in vertex_map.items():
        row = {}
        for key in keys:
            e = next(x for x in edges if x["key"] == key)
            dx = e["to"][0] - e["from"][0]; dy = e["to"][1] - e["from"][1]
            ln = math.hypot(dx, dy)
            u = (dx / ln, dy / ln)
            segs = [s for s in layout if s["key"] == key]
            segs.sort(key=lambda s: s["x"] * u[0] + s["y"] * u[1])
            if v == e["from"]:
                lo, _ = box_extent_along(segs[0], u)
                row[key] = round((lo - v[0] * PX * u[0] - v[1] * PX * u[1]) * 260 / 230, 2)
            else:
                _, hi = box_extent_along(segs[-1], u)
                row[key] = round((hi - v[0] * PX * u[0] - v[1] * PX * u[1]) * 260 / 230, 2)
        out["corners"][vname] = row
    with open(OUT_DIAG, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=1)
    print("[diamond-real] diag:", json.dumps(out, ensure_ascii=False))


def add_ground_outline(edges):
    """画菱形边线（细长 box），供顶视对照。"""
    for e in edges:
        x1, y1 = e["from"][0] * PX, e["from"][1] * PX
        x2, y2 = e["to"][0] * PX, e["to"][1] * PX
        cx, cy = (x1 + x2) / 2, (y1 + y2) / 2
        ln = math.hypot(x2 - x1, y2 - y1)
        bpy.ops.mesh.primitive_cube_add(size=2)
        o = bpy.context.active_object
        o.scale = (ln / 2, 2, 1)
        o.location = (cx, cy, 0.5)
        o.rotation_euler = (0, 0, math.atan2(y2 - y1, x2 - x1))
        mat = bpy.data.materials.new(f"line_{len(bpy.data.materials)}")
        mat.use_nodes = True
        mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (0.0, 1.0, 0.2, 1)
        o.data.materials.append(mat)


def setup_camera(loc, rot, ortho_scale):
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = ortho_scale
    cam_data.clip_start = 0.01
    cam_data.clip_end = 100000.0
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = loc
    cam.rotation_euler = rot
    bpy.context.scene.camera = cam
    return cam


def add_sun():
    bpy.ops.object.light_add(type="SUN", location=(BASE[0] * PX, BASE[1] * PX, 2500))
    sun = bpy.context.active_object
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sun.data.energy = 4.0
    sun.data.angle = math.radians(20)
    return sun


def render(filepath):
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.filepath = filepath
    bpy.context.scene.render.resolution_x = 1024
    bpy.context.scene.render.resolution_y = 1024
    bpy.ops.render.render(write_still=True)
    print(f"[diamond-real] saved {filepath}")


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    layout, edges = build_layout(include_gate_slot=False)  # 先测 4 墙/边能否闭合
    print(f"[diamond-real] faceLen={face_len():.2f} segs={len(layout)}")
    for s in layout:
        color = (0.55, 0.42, 0.25) if not s["gate"] else (0.2, 0.2, 0.22)
        place_wall(s, color)
    add_ground_outline(edges)
    diagnose(layout, edges)
    add_sun()

    # 顶视图
    setup_camera((BASE[0] * PX, BASE[1] * PX, 2200), (0, 0, 0), 1750)
    render(OUT_TOP)

    # 游戏视角（俯仰 30°，正面看）
    dist = 1400
    setup_camera((BASE[0] * PX, BASE[1] * PX - dist * math.cos(math.radians(30)), dist * math.sin(math.radians(30))),
                 (math.radians(60), 0, 0), 1900)
    render(OUT_ISO)


main()
