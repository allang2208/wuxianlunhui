#!/usr/bin/env python3
"""拐角闭合测试：按 render-cover-real.py 同相机渲染不同长度墙精灵（v/h），
再合成 flush 菱形测角部楔形覆盖率（2026-08-17）。"""
import math
import os
import sys

import bpy
import mathutils

OUT = os.path.normpath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "verify-shots"))
LENGTHS = [230, 330, 430]


def render_wall(length, mirror):
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    bpy.ops.mesh.primitive_cube_add(size=2, location=(0, 0, 75))
    o = bpy.context.active_object
    o.scale = (length / 2, 26, 75)
    o.rotation_euler = (0, 0, math.radians(52 if not mirror else -52))
    mat = bpy.data.materials.new(f"m_{length}_{mirror}")
    mat.use_nodes = True
    mat.node_tree.nodes["Principled BSDF"].inputs[0].default_value = (0.55, 0.42, 0.25, 1)
    o.data.materials.append(mat)
    bpy.context.view_layer.update()
    corners = [o.matrix_world @ mathutils.Vector(c) for c in o.bound_box]
    ws = [[c.x, c.y, c.z] for c in corners]
    extent = max(max(a) - min(a) for a in zip(*ws))
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.01
    cam_data.clip_end = max(100.0, extent * 10)
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    elevation = math.radians(30)
    azimuth = 0.0
    dist = extent * 4
    cam.location = (
        dist * math.cos(elevation) * math.sin(azimuth),
        -dist * math.cos(elevation) * math.cos(azimuth),
        dist * math.sin(elevation),
    )
    cam.rotation_euler = (math.radians(60), 0, 0)
    bpy.context.view_layer.update()
    inv = cam.matrix_world.inverted()
    pts = []
    for c in corners:
        v = inv @ c
        pts.append((v.x, v.y))
    minx = min(p[0] for p in pts); maxx = max(p[0] for p in pts)
    miny = min(p[1] for p in pts); maxy = max(p[1] for p in pts)
    s_w = (maxx - minx) / 0.8
    s_h = (maxy - miny) / ((880 - 64) / 1024)
    s = max(s_w, s_h) * 1.02
    cam_data.ortho_scale = s
    cam_data.shift_x = (minx + maxx) / 2 / s
    target_bottom = (0.5 - 880 / 1024) * s
    cam_data.shift_y = (miny - target_bottom) / s
    bpy.context.scene.camera = cam
    bpy.ops.object.light_add(type="SUN", location=(0, 0, 600))
    sun = bpy.context.active_object
    sun.rotation_euler = (math.radians(50), 0, math.radians(35))
    sun.data.energy = 4.0
    bpy.context.scene.render.image_settings.file_format = "PNG"
    bpy.context.scene.render.film_transparent = True
    p = os.path.join(OUT, f"wall_len_{length}_{'h' if mirror else 'v'}.png")
    bpy.context.scene.render.filepath = p
    bpy.context.scene.render.resolution_x = 1024
    bpy.context.scene.render.resolution_y = 1024
    bpy.ops.render.render(write_still=True)
    print("rendered", p)


def main():
    for L in LENGTHS:
        render_wall(L, False)
        render_wall(L, True)


main()
