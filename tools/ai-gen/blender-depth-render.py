#!/usr/bin/env python3
"""3D 白模 → 深度图渲染管线（Blender 5.1 后台脚本，2026-08-05）。

用途：给 FLUX.2 Depth ControlNet 提供精确视角锁定的控制图，替代手绘剪影模板
（手绘版见 make-depth-templates.py）。输出约定与手绘模板完全一致：
1024×1024 灰度、黑(0)=远/背景、白(255)=近、主体水平居中、主体底边在 y≈880、
正面视角（默认俯仰 30°，与游戏地板线视觉角度一致；禁止 45° 等距俯视）。

用法（Git Bash 注意引号）：

    "E:/Program Files/Blender Foundation/Blender 5.1/blender.exe" \
        --background --factory-startup \
        --python blender-depth-render.py -- spec.json out.png [--mirror]

  --mirror  额外输出水平镜像版本：out 主文件名 _h 结尾则替换为 _v，否则追加 _v
            （用 Blender 自带 numpy 翻转，不依赖 PIL）。

Spec JSON 格式（单位语义：相对单位，只有比例有意义——取景会自动归一化，
可理解成 1 单位 ≈ 游戏内 1 格；坐标系 x=右、y=纵深(远离相机为正)、z=上，
pos 一律指图元中心，地面为 z=0 平面）：

{
  "elevation": 30,            // 可选，相机俯仰角(度)，默认 30；上限建议 ≤30
  "azimuth": 0,               // 可选，方位角(度)，默认 0=正面
  "bottom_y": 880,            // 可选，主体底边目标像素行，默认 880
  "max_width_frac": 0.8,      // 可选，主体宽占画面比例上限，默认 0.8
  "top_margin_px": 64,        // 可选，主体顶边最小上边距，默认 64
  "primitives": [
    {"type": "box",      "size": [w, d, h], "pos": [x, y, z], "rot": [rx, ry, rz]},
    {"type": "cylinder", "radius": r, "depth": h, ...},
    {"type": "cone",     "radius1": r1, "radius2": r2, "depth": h, ...},
    {"type": "sphere",   "radius": r, ...}
  ]
}

  rot 为欧拉角（度，XYZ 顺序），可省略。

实现要点（Blender 5.1 API 实测）：
  - 引擎标识为 BLENDER_EEVEE（5.1 已无 _NEXT 后缀）。
  - 合成器改为 scene.compositing_node_group（Scene.node_tree / use_nodes 已废弃）；
    Render Layers 节点需先开 view_layer.use_pass_z 才有 "Depth" 输出。
  - 深度链：RLayers.Depth → ShaderNodeMapRange(clamp, [zmin,zmax]→[1,0])
    → ×Alpha（保险，背景精确为 0）→ NodeGroupOutput。
  - film 不透明 + 世界纯黑；view_transform 用 Raw（深度是线性数据，Standard 会过
    sRGB 显示变换洗白对比度）；dither_intensity 必须设 0（默认 1.0 会在 float→8bit
    时抖动出 1/255 噪点底）；输出 8bit 灰度 PNG。
  - 镜像输出读 PNG 时须把 colorspace 设 Non-Color，否则 sRGB 解码→Raw 直存会二次变暗。
"""
import json
import math
import os
import sys

import bpy
import mathutils
import numpy as np

SIZE = 1024


def parse_args():
    argv = sys.argv[sys.argv.index("--") + 1:]
    mirror = "--mirror" in argv
    argv = [a for a in argv if a != "--mirror"]
    if len(argv) != 2:
        sys.exit("usage: blender --background --python blender-depth-render.py -- spec.json out.png [--mirror]")
    return argv[0], argv[1], mirror


def make_prism(length, width, height):
    """Create a triangular prism for deterministic gabled-roof depth silhouettes."""
    mesh = bpy.data.meshes.new("prism")
    vertices = [
        (-length / 2, -width / 2, 0),
        (-length / 2, width / 2, 0),
        (-length / 2, 0, height),
        (length / 2, -width / 2, 0),
        (length / 2, width / 2, 0),
        (length / 2, 0, height),
    ]
    faces = [
        (0, 2, 1), (3, 4, 5), (0, 1, 4, 3),
        (1, 2, 5, 4), (0, 3, 5, 2),
    ]
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new("prism", mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def build_primitives(prims):
    """按 spec 建白模图元，返回对象列表。"""
    objs = []
    for i, p in enumerate(prims):
        t = p["type"]
        if t == "box":
            bpy.ops.mesh.primitive_cube_add(size=2)
            o = bpy.context.active_object
            w, d, h = p["size"]
            o.scale = (w / 2, d / 2, h / 2)
        elif t == "prism":
            length, width, height = p["size"]
            o = make_prism(length, width, height)
        elif t == "cylinder":
            bpy.ops.mesh.primitive_cylinder_add(radius=p["radius"], depth=p["depth"])
            o = bpy.context.active_object
        elif t == "cone":
            bpy.ops.mesh.primitive_cone_add(
                radius1=p.get("radius1", p.get("radius", 1)),
                radius2=p.get("radius2", 0),
                depth=p["depth"])
            o = bpy.context.active_object
        elif t == "sphere":
            bpy.ops.mesh.primitive_uv_sphere_add(radius=p["radius"], segments=48, ring_count=24)
            o = bpy.context.active_object
        else:
            sys.exit(f"unknown primitive type: {t}")
        o.name = f"prim_{i}_{t}"
        o.location = p.get("pos", [0, 0, 0])
        rot = p.get("rot", [0, 0, 0])
        o.rotation_euler = [math.radians(a) for a in rot]
        # 纯白无光照材质（渲染只为喂 Alpha/Z 通道，颜色无所谓）
        mat = bpy.data.materials.new(f"m_{i}")
        mat.use_nodes = True
        bsdf = mat.node_tree.nodes.get("Principled BSDF")
        bsdf.inputs["Base Color"].default_value = (0.8, 0.8, 0.8, 1)
        bsdf.inputs["Roughness"].default_value = 1.0
        o.data.materials.append(mat)
        objs.append(o)
    return objs


def setup_camera(spec, objs):
    """正交相机：azimuth(默认0=正面) + elevation(默认30°)，自动取景。

    取景规则：水平居中；主体宽 ≤ max_width_frac×1024；主体底边落在 bottom_y。
    返回 (cam_obj, zmin, zmax)（沿视线深度范围，供 MapRange 用）。
    """
    elevation = math.radians(spec.get("elevation", 30))
    azimuth = math.radians(spec.get("azimuth", 0))
    bottom_y = spec.get("bottom_y", 880)
    max_w_frac = spec.get("max_width_frac", 0.8)
    top_margin = spec.get("top_margin_px", 64)

    bpy.context.view_layer.update()
    # 世界空间包围盒角点
    corners = []
    for o in objs:
        for c in o.bound_box:
            corners.append(o.matrix_world @ mathutils.Vector(c))
    ws = np.array([[c.x, c.y, c.z] for c in corners])
    extent = float(np.max(ws.max(axis=0) - ws.min(axis=0)))

    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.01
    cam_data.clip_end = max(100.0, extent * 10)
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)

    dist = max(20.0, extent * 4)
    cam.location = (
        dist * math.cos(elevation) * math.sin(azimuth),
        -dist * math.cos(elevation) * math.cos(azimuth),
        dist * math.sin(elevation),
    )
    # 相机 -Z 指向原点：先按正面(90°,0,0)，再绕 Z 转方位角、绕 X 抬俯仰
    cam.rotation_euler = (math.radians(90) - elevation, 0, azimuth)
    bpy.context.view_layer.update()

    inv = np.array(cam.matrix_world.inverted())
    pts = np.concatenate([ws, np.ones((len(ws), 1))], axis=1) @ inv.T
    minx, maxx = pts[:, 0].min(), pts[:, 0].max()
    miny, maxy = pts[:, 1].min(), pts[:, 1].max()
    depths = -pts[:, 2]
    zmin, zmax = float(depths.min()), float(depths.max())

    # ortho_scale：宽度约束 与 顶边约束 取大者（加 2% 保险）
    s_w = (maxx - minx) / max_w_frac
    s_h = (maxy - miny) / ((bottom_y - top_margin) / SIZE)
    s = max(s_w, s_h) * 1.02
    cam_data.ortho_scale = s

    # shift：水平居中；底边移到 bottom_y（shift>0 = 取景框上移 = 内容下移）
    if spec.get("center_on_origin", False):
        cam_data.shift_x = 0.0
    else:
        cam_data.shift_x = float((minx + maxx) / 2) / s
    target_bottom = (0.5 - bottom_y / SIZE) * s
    cam_data.shift_y = float(miny - target_bottom) / s

    span = max(zmax - zmin, 1e-6)
    return cam, zmin - span * 0.01, zmax + span * 0.01


def setup_compositor(scene, zmin, zmax):
    """深度链：Depth → MapRange([zmin,zmax]→[1,0], clamp) → ×Alpha → 输出。"""
    bpy.context.view_layer.use_pass_z = True
    ng = bpy.data.node_groups.new("DepthComp", "CompositorNodeTree")
    scene.compositing_node_group = ng
    nodes, links = ng.nodes, ng.links

    rl = nodes.new("CompositorNodeRLayers")
    mr = nodes.new("ShaderNodeMapRange")
    mr.clamp = True
    mr.inputs["From Min"].default_value = zmin
    mr.inputs["From Max"].default_value = zmax
    mr.inputs["To Min"].default_value = 1.0
    mr.inputs["To Max"].default_value = 0.0
    mult = nodes.new("ShaderNodeMath")
    mult.operation = "MULTIPLY"
    out = nodes.new("NodeGroupOutput")
    ng.interface.new_socket(name="Image", in_out="OUTPUT", socket_type="NodeSocketColor")

    links.new(rl.outputs["Depth"], mr.inputs["Value"])
    links.new(mr.outputs["Result"], mult.inputs[0])
    links.new(rl.outputs["Alpha"], mult.inputs[1])
    links.new(mult.outputs[0], out.inputs["Image"])


def mirror_png(path, scene):
    """用 Blender 自带 numpy 水平翻转 PNG，输出 _v 版本（沿用主输出 BW/8bit 设置）。"""
    stem, ext = os.path.splitext(path)
    vpath = (stem[:-2] + "_v" if stem.endswith("_h") else stem + "_v") + ext
    img = bpy.data.images.load(path)
    img.colorspace_settings.name = "Non-Color"  # 原始数值，不做 sRGB 解码
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)
    px = px[:, ::-1, :]
    out = bpy.data.images.new(os.path.basename(vpath), width=w, height=h)
    out.colorspace_settings.name = "Non-Color"
    out.pixels = px.ravel()
    out.save_render(vpath, scene=scene)
    print("mirrored ->", vpath)


def main():
    spec_path, out_path, mirror = parse_args()
    with open(spec_path, "r", encoding="utf-8") as f:
        spec = json.load(f)

    # 清场（--factory-startup 下仍可能有默认立方体）
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = False
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "BW"
    scene.render.image_settings.color_depth = "8"
    # 深度是线性数据，用 Raw 绕过 sRGB 显示变换（Standard 会把 0.67 提到 ~212，洗白对比度）
    scene.view_settings.view_transform = "Raw"
    try:
        scene.view_settings.look = "None"
    except TypeError:
        pass
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1
    scene.render.dither_intensity = 0.0  # 默认 1.0 会在 float→8bit 时抖动出 1/255 噪点底
    # 世界纯黑
    world = bpy.data.worlds.new("black")
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs[0].default_value = (0, 0, 0, 1)
    scene.world = world

    objs = build_primitives(spec["primitives"])
    cam, zmin, zmax = setup_camera(spec, objs)
    scene.camera = cam
    setup_compositor(scene, zmin, zmax)

    scene.render.filepath = os.path.abspath(out_path)
    bpy.ops.render.render(write_still=True)
    print("rendered ->", scene.render.filepath)

    if mirror:
        mirror_png(scene.render.filepath, scene)


if __name__ == "__main__":
    main()
