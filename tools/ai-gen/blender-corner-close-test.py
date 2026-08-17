#!/usr/bin/env python3
"""拐角闭合决定性测试（2026-08-17）：flush 摆放（face 端正好在顶点）下，
当前墙长 vs 加长端帽，能否盖住菱形角部楔形区（顶视图 + 数值诊断）。

口径与 render-cover-real.py 一致：box W×52×150、v rot 52 / h rot -52，
游戏 px → Blender 单位 ×(W/260)（保持 260px 显示下 W 单位的墙）。
"""
import json
import math
import os

import bpy

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "verify-shots"))

BASE = (4200.0, 4096.0)
RX, RY = 512.0, 256.0
FACE_V = {"A": (-88.0, -21.0), "B": (88.0, -108.0)}
FACE_H = {"A": (-88.0, -108.0), "B": (88.0, -21.0)}
DEPTH, HEIGHT = 52.0, 150.0


def layout_flush(wall_len_px):
    bx, by = BASE
    T = (bx, by - RY); R = (bx + RX, by); B = (bx, by + RY); L = (bx - RX, by)
    edges = [("TL", T, L, "v"), ("TR", T, R, "h"), ("LB", L, B, "h"), ("RB", R, B, "v")]
    out = []
    for key, frm, to, orient in edges:
        dx = to[0] - frm[0]; dy = to[1] - frm[1]
        ln = math.hypot(dx, dy)
        ux, uy = dx / ln, dy / ln
        g = FACE_V if orient == "v" else FACE_H
        pA = g["A"][0] * ux + g["A"][1] * uy
        pB = g["B"][0] * ux + g["B"][1] * uy
        toward = "A" if pA < pB else "B"
        hV = abs(pA if toward == "A" else pB)
        hA = abs(pB if toward == "A" else pA)
        # flush：face 端点正好在顶点；4 段均布
        t0 = hV
        tLast = ln - hA
        for i in range(4):
            t = t0 + (tLast - t0) * i / 3
            out.append({"key": key, "orient": orient, "x": frm[0] + ux * t, "y": frm[1] + uy * t})
    return out


def box_covers_wedge(wall_len_px, layout):
    """对每个顶点：楔形区（两条出边夹角外延）采样点是否被墙 box 覆盖。"""
    px = wall_len_px / 260.0  # 显示 260px = 模型 W 单位
    W = wall_len_px * px      # 模型长度（Blender 单位）
    verts = {
        "T": ((BASE[0], BASE[1] - RY), [(-0.8944, 0.4472), (0.8944, 0.4472)]),
        "R": ((BASE[0] + RX, BASE[1]), [(-0.8944, 0.4472), (0.8944, -0.4472)]),
        "B": ((BASE[0], BASE[1] + RY), [(0.8944, -0.4472), (-0.8944, -0.4472)]),
        "L": ((BASE[0] - RX, BASE[1]), [(0.8944, 0.4472), (-0.8944, 0.4472)]),
    }
    res = {}
    for name, (v, dirs) in verts.items():
        # 楔形方向 = 两条出边方向的外角平分线；采样扇形
        a1 = math.atan2(dirs[0][1], dirs[0][0])
        a2 = math.atan2(dirs[1][1], dirs[1][0])
        # 外角平分线（两条出边之间的夹角，取远离中心的侧）
        mid = (a1 + a2) / 2
        if math.cos(mid) * (v[0] - BASE[0]) + math.sin(mid) * (v[1] - BASE[1]) < 0:
            mid += math.pi
        empty = 0
        total = 0
        for ang_off in range(-24, 25, 6):
            a = mid + math.radians(ang_off)
            for d in range(4, 46, 4):
                wx = v[0] + d * math.cos(a)
                wy = v[1] + d * math.sin(a)
                total += 1
                if not any(inside_box(wx * px, wy * px, s, W, px) for s in layout):
                    empty += 1
        res[name] = round(empty / total * 100, 1)
    return res


def inside_box(wx, wy, s, W, px):
    """墙 box 在 Blender 单位的 AABB（含旋转）是否覆盖点。"""
    rot = math.radians(52 if s["orient"] == "v" else -52)
    c, s2 = math.cos(rot), math.sin(rot)
    hw, hd = W / 2, DEPTH / 2
    # 把点变换到 box 局部坐标
    lx = (wx - s["x"] * px) * c + (wy - s["y"] * px) * s2
    ly = -(wx - s["x"] * px) * s2 + (wy - s["y"] * px) * c
    return abs(lx) <= hw + 0.5 and abs(ly) <= hd + 0.5


def build_and_render(wall_len_px, label):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    lay = layout_flush(wall_len_px)
    PX = wall_len_px / 260.0
    W = wall_len_px * PX
    for s in lay:
        bpy.ops.mesh.primitive_cube_add(size=2, location=(s["x"] * PX, s["y"] * PX, HEIGHT / 2))
        o = bpy.context.active_object
        o.scale = (W / 2, DEPTH / 2, HEIGHT / 2)
        o.rotation_euler = (0, 0, math.radians(52 if s["orient"] == "v" else -52))
    bpy.ops.object.light_add(type="SUN", location=(BASE[0] * PX, BASE[1] * PX, 2500))
    sun = bpy.context.active_object
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sun.data.energy = 4.0
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.ortho_scale = 1750
    cam_data.clip_end = 100000.0
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    cam.location = (BASE[0] * PX, BASE[1] * PX, 2200)
    cam.rotation_euler = (0, 0, 0)
    bpy.context.scene.camera = cam
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.filepath = os.path.join(OUT_DIR, f"corner_close_{label}.png")
    bpy.context.scene.render.resolution_x = 1024
    bpy.context.scene.render.resolution_y = 1024
    bpy.ops.render.render(write_still=True)
    print(f"[corner-close] saved {label}")


def main():
    for wall_len, label in [(230, "L230"), (330, "L330"), (430, "L430")]:
        lay = layout_flush(wall_len)
        cov = box_covers_wedge(wall_len, lay)
        print(f"[corner-close] wallLen={wall_len} 角部楔形空缺%={cov}")
        build_and_render(wall_len, label)


main()
