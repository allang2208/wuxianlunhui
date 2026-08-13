#!/usr/bin/env python3
"""世界-122 防御塔建模（路线：Blender 几何 + 纯色材质，无贴图）：
塔基 = 圆柱柱身 + 底部法兰 + 顶部平台；机械臂 = 枢轴柱 + 上臂 + 肘关节 +
前臂 + 腕部武器挂载，绕塔顶 360°（游戏内屏幕空间旋转）。
相机：正交 + 30° 俯视（匹配世界-122 ry/rx=0.5 等距投影，与 render-cover-real.py 同口径）。
输出：base.png（仅塔基）、arm.png（仅机械臂，指向 +x，枢轴在左侧端部）。
"""
import bpy
import math

SIZE = 1024
ELEVATION = 30.0


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def flat_material(name, color, roughness=0.7, metal=0.15):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1.0)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metal
    return mat


def add_cylinder(name, r, h, z, mat, segments=28, x=0.0, y=0.0):
    bpy.ops.mesh.primitive_cylinder_add(
        radius=r, depth=h, vertices=segments, location=(x, y, z))
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    return o


def add_box(name, x0, x1, y0, y1, z0, z1, mat):
    bpy.ops.mesh.primitive_cube_add(size=1, location=((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2))
    o = bpy.context.active_object
    o.name = name
    o.scale = ((x1 - x0) / 2, (y1 - y0) / 2, (z1 - z0) / 2)
    bpy.ops.object.transform_apply(scale=True)
    o.data.materials.append(mat)
    return o


def add_sphere(name, r, x, y, z, mat):
    bpy.ops.mesh.primitive_uv_sphere_add(radius=r, location=(x, y, z), segments=20, ring_count=12)
    o = bpy.context.active_object
    o.name = name
    o.data.materials.append(mat)
    return o


def build_base(steel, dark, light):
    objs = []
    # 柱身：圆柱
    objs.append(add_cylinder("column", 50, 128, 64, steel))
    # 底部法兰
    objs.append(add_cylinder("flange_bottom", 58, 12, 6, dark))
    # 中部加固环
    objs.append(add_cylinder("ring_mid", 54, 8, 96, dark))
    # 顶部平台
    objs.append(add_cylinder("platform", 60, 14, 143, light))
    objs.append(add_cylinder("platform_rim", 63, 6, 151, dark))
    return objs


def build_arm(steel, dark, light, accent):
    objs = []
    z_plat = 154.0
    # 枢轴柱（立在平台中心）
    objs.append(add_cylinder("pivot", 17, 46, z_plat + 23, dark))
    # 上臂（指向 +x）
    objs.append(add_box("upper_arm", 8, 128, -10, 10, z_plat + 4, z_plat + 22, steel))
    # 肘关节
    objs.append(add_cylinder("elbow", 15, 42, z_plat + 13, dark, x=128))
    # 前臂
    objs.append(add_box("forearm", 128, 228, -8, 8, z_plat + 8, z_plat + 22, steel))
    # 腕部挂载
    objs.append(add_box("wrist", 228, 258, -13, 13, z_plat + 6, z_plat + 24, light))
    objs.append(add_box("mount_acc", 236, 252, -8, 8, z_plat + 24, z_plat + 32, accent))
    # 关节螺栓点缀
    objs.append(add_sphere("bolt_elbow", 6, 128, 0, z_plat + 13, light))
    objs.append(add_sphere("bolt_pivot", 8, 0, 0, z_plat + 23, light))
    return objs


def setup_camera(objs, ortho_scale, target=(0, 0, 0)):
    bpy.context.view_layer.update()
    cam_data = bpy.data.cameras.new("cam")
    cam_data.type = "ORTHO"
    cam_data.clip_start = 0.01
    cam_data.clip_end = 10000
    cam = bpy.data.objects.new("cam", cam_data)
    bpy.context.scene.collection.objects.link(cam)
    el = math.radians(ELEVATION)
    dist = 2000
    cam.location = (target[0], target[1] - dist * math.cos(el), target[2] + dist * math.sin(el))
    cam.rotation_euler = (math.radians(90) - el, 0, 0)
    cam_data.ortho_scale = ortho_scale
    cam_data.shift_x = 0
    cam_data.shift_y = 0
    return cam


def setup_lighting():
    world = bpy.data.worlds.new("env")
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    bg.inputs[0].default_value = (0.5, 0.5, 0.54, 1.0)
    bg.inputs[1].default_value = 1.0
    bpy.context.scene.world = world
    sun_data = bpy.data.lights.new("key", "SUN")
    sun_data.energy = 1.1
    sun_data.use_shadow = False
    sun = bpy.data.objects.new("key", sun_data)
    bpy.context.scene.collection.objects.link(sun)
    sun.rotation_euler = (math.radians(52), 0, math.radians(35))
    fill_data = bpy.data.lights.new("fill", "AREA")
    fill_data.energy = 40.0
    fill_data.size = 8.0
    fill_data.use_shadow = False
    fill = bpy.data.objects.new("fill", fill_data)
    bpy.context.scene.collection.objects.link(fill)
    fill.location = (-10, -8, 6)


def render(out_path):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.dither_intensity = 0.0
    scene.render.filepath = out_path
    bpy.ops.render.render(write_still=True)
    print("rendered ->", out_path)


def main():
    import sys
    argv = sys.argv[sys.argv.index("--") + 1:]
    if len(argv) != 3:
        sys.exit("usage: blender --background --python render-defense-tower.py -- base.png arm.png ortho_scale")
    base_path, arm_path, ortho_scale = argv[0], argv[1], float(argv[2])

    steel = flat_material("steel", (0.44, 0.47, 0.52), 0.6, 0.35)
    dark = flat_material("dark", (0.30, 0.33, 0.38), 0.7, 0.3)
    light = flat_material("light", (0.60, 0.63, 0.68), 0.5, 0.4)
    accent = flat_material("accent", (0.82, 0.44, 0.12), 0.5, 0.2)

    setup_lighting()

    # 塔基
    clear_scene()
    setup_lighting()
    base_objs = build_base(steel, dark, light)
    cam = setup_camera(base_objs, ortho_scale, target=(0, 0, 75))
    bpy.context.scene.camera = cam
    render(base_path)

    # 机械臂（指向 +x，枢轴在原点）
    clear_scene()
    setup_lighting()
    arm_objs = build_arm(steel, dark, light, accent)
    cam2 = setup_camera(arm_objs, ortho_scale, target=(129, 0, 175))
    bpy.context.scene.camera = cam2
    render(arm_path)


if __name__ == "__main__":
    main()
