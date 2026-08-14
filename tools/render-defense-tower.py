#!/usr/bin/env python3
"""世界-122 防御塔建模（路线：Blender 几何 + 纯色/贴图材质）：
塔基 = 圆柱柱身 + 底部法兰 + 顶部平台；机械臂 = 枢轴柱 + 上臂 + 肘关节 +
前臂 + 腕部武器挂载，绕塔顶 360°（游戏内屏幕空间旋转）。
相机：正交 + 30° 俯视（匹配世界-122 ry/rx=0.5 等距投影，与 render-cover-real.py 同口径）。
输出：base.png（仅塔基）、arm.png（仅机械臂，指向 +x，枢轴在左侧端部）。
可选第 4 参：底座混凝土贴图路径（PNG），给塔基全部部件上贴图。
"""
import bpy
import math

SIZE = 1024
ELEVATION = 30.0


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()


def _get_bsdf(nt):
    node = nt.nodes.get("Principled BSDF")
    if node is None:
        for n in nt.nodes:
            if n.type == "BSDF_PRINCIPLED":
                node = n
                break
    if node is None:
        node = nt.nodes.new("ShaderNodeBsdfPrincipled")
        out = nt.nodes.get("Material Output")
        if out is None:
            out = nt.nodes.new("ShaderNodeOutputMaterial")
        nt.links.new(node.outputs["BSDF"], out.inputs["Surface"])
    return node


def flat_material(name, color, roughness=0.7, metal=0.15):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = _get_bsdf(nt)
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


def add_hbeam(name, x0, x1, r, z_center, mat, seg=8, y=0.0):
    """水平横梁（圆柱沿 X 轴，机械臂节段用，多边形截面更机械感）。"""
    bpy.ops.mesh.primitive_cylinder_add(
        radius=r, depth=(x1 - x0), vertices=seg,
        location=((x0 + x1) / 2, y, z_center))
    o = bpy.context.active_object
    o.name = name
    o.rotation_euler = (0, math.radians(90), 0)
    bpy.ops.object.transform_apply(rotation=True)
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
    # 2026-08-14 重做：机械臂缩短到底座范围内（枢轴→尖端 ≈37 模型单位 ≈50 游戏px，
    # 底座半径 ≈63 单位），关节化结构（肩座/上臂横梁/肘关节/前臂/腕部挂载）。
    # 枢轴 z 保持 z_plat+23=177（与旧版一致，pivotWorldY=235 视觉锚点不变）。
    z_pivot = z_plat + 23.0
    # 肩座（枢轴柱，立在平台中心；枢轴=其中心）
    objs.append(add_cylinder("shoulder", 17, 40, z_pivot, dark))
    # 上臂横梁（六棱柱，8 段截面，指向 +x）
    objs.append(add_hbeam("upper_arm", 6, 22, 8.5, z_pivot - 4, steel, seg=8))
    # 上臂顶护板（机械感薄板）
    objs.append(add_box("upper_plate", 4, 23, -10, 10, z_pivot + 9, z_pivot + 15, light))
    # 肘关节（竖圆柱 + 顶部螺栓）
    objs.append(add_cylinder("elbow", 12, 28, z_pivot, dark, x=22))
    objs.append(add_sphere("bolt_elbow", 6, 22, 0, z_pivot + 14, light))
    # 前臂横梁（略细、略低，形成自然折角）
    objs.append(add_hbeam("forearm", 22, 37, 6, z_pivot - 5, steel, seg=8))
    # 前臂加强环
    objs.append(add_cylinder("forearm_ring", 7, 7, z_pivot - 5, dark, x=30))
    # 腕部挂载（竖圆柱 + 顶部 accent 挂载件；accent 质心 = 自动标定的尖端）
    objs.append(add_cylinder("wrist", 8, 22, z_pivot - 3, light, x=37))
    objs.append(add_cylinder("mount_acc", 4.5, 10, z_pivot + 8, accent, x=37))
    objs.append(add_sphere("bolt_pivot", 8, 0, 0, z_pivot, light))
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
    bg = world.node_tree.nodes.get("Background")
    if bg is None:
        for n in world.node_tree.nodes:
            if n.type == "BACKGROUND":
                bg = n
                break
    if bg is None:
        bg = world.node_tree.nodes.new("ShaderNodeBackground")
        out = world.node_tree.nodes.get("World Output")
        if out is None:
            out = world.node_tree.nodes.new("ShaderNodeOutputWorld")
        world.node_tree.links.new(bg.outputs["Background"], out.inputs["Surface"])
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


def textured_material(name, tex_path, base_scale=1.0):
    """混凝土贴图材质：Base Color = 图片纹理（EEVEE 直出，无 AO/Mix 防刷纯色）。"""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = _get_bsdf(nt)
    tex = nt.nodes.new("ShaderNodeTexImage")
    img = bpy.data.images.load(tex_path)
    tex.image = img
    tex.extension = "REPEAT"
    nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
    bsdf.inputs["Roughness"].default_value = 0.85
    bsdf.inputs["Metallic"].default_value = 0.05
    return mat


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
    if len(argv) < 3:
        sys.exit("usage: blender --background --python render-defense-tower.py -- base.png arm.png ortho_scale [concrete_tex.png]")
    base_path, arm_path, ortho_scale = argv[0], argv[1], float(argv[2])
    tex_path = argv[3] if len(argv) > 3 else None

    steel = flat_material("steel", (0.44, 0.47, 0.52), 0.6, 0.35)
    dark = flat_material("dark", (0.30, 0.33, 0.38), 0.7, 0.3)
    light = flat_material("light", (0.60, 0.63, 0.68), 0.5, 0.4)
    accent = flat_material("accent", (0.82, 0.44, 0.12), 0.5, 0.2)

    setup_lighting()

    # 塔基（可选：混凝土贴图材质）
    clear_scene()
    setup_lighting()
    if tex_path:
        concrete = textured_material("concrete", tex_path)
        base_objs = build_base(concrete, concrete, concrete)
    else:
        base_objs = build_base(steel, dark, light)
    cam = setup_camera(base_objs, ortho_scale, target=(0, 0, 75))
    bpy.context.scene.camera = cam
    render(base_path)

    # 机械臂（指向 +x，枢轴在原点）
    clear_scene()
    setup_lighting()
    arm_objs = build_arm(steel, dark, light, accent)
    cam2 = setup_camera(arm_objs, ortho_scale, target=(18, 0, 177))
    bpy.context.scene.camera = cam2
    render(arm_path)


if __name__ == "__main__":
    main()
