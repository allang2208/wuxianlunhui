#!/usr/bin/env python3
"""4格铁栅栏门（2026-08-17）：左右各 1 格石柱（=1×1 方块墙），中间 2 格铁栅栏。
门总宽 = 4 格（4×71.55 ≈ 286px），与 1×1 方块墙同网格；拼入 8 格/边基地菱形验证。
"""
import bmesh
import math
import os

import bpy
import mathutils

OUT_DIR = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "verify-shots"))

S = 64.0          # 格半宽（cell 128×64，边向量 (±64, ±32)）
H = 80.0          # 方块高
EDGE = 8          # 基地 8 格/边

CELLV = {"TL": (-S, S / 2), "TR": (S, S / 2), "RB": (-S, S / 2), "LB": (S, S / 2)}
VERTS = {
    "TL": (0.0, -EDGE * S / 2), "TR": (0.0, -EDGE * S / 2),
    "RB": (EDGE * S, 0.0), "LB": (-EDGE * S, 0.0),
}


def block_mesh(name, cx, cy, h=H, scale=1.0):
    me = bpy.data.meshes.new(name)
    bm = bmesh.new()
    half = S / 2 * scale
    halfy = S / 4 * scale
    quad = [(half, 0), (0, halfy), (-half, 0), (0, -halfy)]
    v = [bm.verts.new((x + cx, y + cy, z)) for (x, y) in quad for z in (0, h)]
    faces = [(0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    for f in faces:
        bm.faces.new([v[i] for i in f])
    bm.to_mesh(me)
    bm.free()
    return me


def add_object(me, mat):
    obj = bpy.data.objects.new(me.name, me)
    bpy.context.scene.collection.objects.link(obj)
    if len(obj.data.materials) == 0:
        obj.data.materials.append(mat)
    return obj


def add_stick(cx, cy, dx, dy, w, h, mat, z=0):
    """沿 (dx,dy) 方向的细长条（用于铁栅栏杆）。"""
    me = bpy.data.meshes.new("stick")
    bm = bmesh.new()
    perp = (-dy, dx)
    pts = [
        (cx + dx * w / 2 + perp[0] * 2, cy + dy * w / 2 + perp[1] * 2),
        (cx + dx * w / 2 - perp[0] * 2, cy + dy * w / 2 - perp[1] * 2),
        (cx - dx * w / 2 - perp[0] * 2, cy - dy * w / 2 - perp[1] * 2),
        (cx - dx * w / 2 + perp[0] * 2, cy - dy * w / 2 + perp[1] * 2),
    ]
    v = [bm.verts.new((x, y, z)) for (x, y) in pts for z in (0, h)]
    faces = [(0, 1, 3, 2), (4, 5, 7, 6), (0, 1, 5, 4), (1, 3, 7, 5), (3, 2, 6, 7), (2, 0, 4, 6)]
    for f in faces:
        bm.faces.new([v[i] for i in f])
    bm.to_mesh(me)
    bm.free()
    return add_object(me, mat)


def gate_module(cx, cy, dirvec, mat_stone, mat_iron):
    """4 格门：沿 dirvec 方向 cells 0..3；石柱在 0/3，铁栅栏横跨 1/2。"""
    d = (dirvec[0], dirvec[1])
    dl = math.hypot(*d)
    u = (d[0] / dl, d[1] / dl)
    c0 = (cx, cy)
    c1 = (cx + d[0], cy + d[1])
    c2 = (cx + 2 * d[0], cy + 2 * d[1])
    c3 = (cx + 3 * d[0], cy + 3 * d[1])
    add_object(block_mesh("pillarL", *c0, h=H), mat_stone)
    add_object(block_mesh("pillarR", *c3, h=H), mat_stone)
    mid = ((c1[0] + c2[0]) / 2, (c1[1] + c2[1]) / 2)
    span = 2 * dl
    for z, hgt in ((16, 6), (50, 6)):
        add_stick(mid[0], mid[1], u[0], u[1], span * 0.94, hgt, mat_iron, z=z)
    n = 11
    for i in range(n + 1):
        t = i / n
        x = c1[0] + (c2[0] - c1[0]) * t
        y = c1[1] + (c2[1] - c1[1]) * t
        add_stick(x, y, u[0], u[1], 8, 58, mat_iron, z=16)


def ring_layout(gate_edge="RB"):
    """8 格/边菱形环：[{key,x,y,kind}]；gate_edge 边 k=2..5 为门（含 4 格）。"""
    out = []
    for key in ("TL", "TR", "RB", "LB"):
        frm = VERTS[key]
        ev = CELLV[key]
        for k in range(EDGE):
            kind = "gate" if (key == gate_edge and 2 <= k <= 5) else "wall"
            out.append({
                "key": key, "kind": kind,
                "x": frm[0] + (k + 0.5) * ev[0],
                "y": frm[1] + (k + 0.5) * ev[1],
                "k": k,
            })
    return out


def make_material(name, color):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (*color, 1)
    return mat


def render_scene(filepath, elevation=30.0, ortho_scale=0, center=(0, 0)):
    bpy.context.view_layer.update()
    objs = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    corners = []
    for o in objs:
        for c in o.bound_box:
            corners.append(o.matrix_world @ mathutils.Vector(c))
    ws = [[c.x, c.y, c.z] for c in corners]
    extent = max(max(a) - min(a) for a in zip(*ws))
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.01
    cam_data.clip_end = max(100.0, extent * 10)
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    el = math.radians(elevation)
    dist = extent * 4
    cam.location = (center[0], center[1] - dist * math.cos(el), dist * math.sin(el))
    cam.rotation_euler = (math.radians(90) - el, 0, 0)
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    pts = [inv @ c for c in corners]
    minx = min(p.x for p in pts); maxx = max(p.x for p in pts)
    miny = min(p.y for p in pts); maxy = max(p.y for p in pts)
    s = ortho_scale or max((maxx - minx) / 0.8, (maxy - miny) / 0.8) * 1.02
    cam_data.ortho_scale = s
    cam_data.shift_x = ((minx + maxx) / 2) / s
    cam_data.shift_y = ((miny + maxy) / 2) / s
    bpy.context.scene.camera = cam
    bpy.ops.object.light_add(type="SUN", location=(center[0], center[1], 2500))
    sun = bpy.context.active_object
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sun.data.energy = 4.0
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.film_transparent = True
    bpy.context.scene.render.filepath = filepath
    bpy.context.scene.render.resolution_x = 1024
    bpy.context.scene.render.resolution_y = 1024
    bpy.ops.render.render(write_still=True)
    print("[gate4] saved", filepath)


def main():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    mat_stone = make_material("stone", (0.72, 0.70, 0.66))
    mat_iron = make_material("iron", (0.12, 0.12, 0.14))
    mat_wall = make_material("wall", (0.62, 0.48, 0.30))

    # 1) 单扇 4 格门（等距 + 顶视），沿 TR 方向摆便于看图
    gate_module(0, 0, (S, S / 2), mat_stone, mat_iron)
    render_scene(os.path.join(OUT_DIR, "gate_4cell_iso.png"), elevation=30.0, ortho_scale=820)
    render_scene(os.path.join(OUT_DIR, "gate_4cell_top.png"), elevation=90.0, ortho_scale=820)

    # 2) 8 格/边 基地菱形（RB 边 k=2..5 为 4 格门）
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    layout = ring_layout("RB")
    wall_count = 0
    for cell in layout:
        if cell["kind"] == "wall":
            add_object(block_mesh(f"w_{cell['key']}_{cell['k']}", cell["x"], cell["y"], h=H), mat_wall)
            wall_count += 1
    print(f"[gate4] 墙体块数 = {wall_count}，门格 = 4")
    ev = CELLV["RB"]
    frm = VERTS["RB"]
    gx = frm[0] + 2.5 * ev[0]
    gy = frm[1] + 2.5 * ev[1]
    gate_module(gx, gy, ev, mat_stone, mat_iron)
    render_scene(os.path.join(OUT_DIR, "base_diamond_gate4_top.png"), elevation=90.0, ortho_scale=2100)
    render_scene(os.path.join(OUT_DIR, "base_diamond_gate4_iso.png"), elevation=30.0, ortho_scale=2100)


main()
