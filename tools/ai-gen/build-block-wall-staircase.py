#!/usr/bin/env python3
"""按 30° elevation / 45° azimuth 正交 dimetric 相机重建两段 1×1 城墙楼梯。

屏幕地面轴严格为 (±64, 32)，即斜率 ±0.5、角度 ±26.565°。模型使用真正的
正方形地块，不再用 azimuth=0 相机配合非对称进深做反解补偿。
"""
import json
import math
import os

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
ASSET_DIR = os.path.join(ROOT, "assets", "terrain")
OUT_DIR = os.path.join(HERE, "_block_wall_stair_rebuild")
STAIR_TEX = os.path.join(HERE, "_depth_templates", "stair_tread_whitegray.png")
WALL_TEX = os.path.join(ASSET_DIR, "obstacle_block.png")

SIZE = 1024
ORTHO_SCALE = 220.0
DISPLAY_SIZE = 220.0
CAMERA_ELEVATION = 30.0
CAMERA_AZIMUTH = 45.0

# 游戏的一格是屏幕菱形 128×64。30°/45°正交投影下，边长为 64√2 的真实
# 正方形会投影成两条 (±64, 32) 地面轴。
GRID_SIDE = 64.0 * math.sqrt(2.0)
GAME_RISE = 62.5
# 垂直轴在 elevation=30° 时投影系数为 cos(30°)；显示尺寸与 ortho_scale
# 同为200，因此1模型单位=1游戏屏幕像素。
MODEL_RISE = GAME_RISE / math.cos(math.radians(CAMERA_ELEVATION))
MODEL_WALL_H = MODEL_RISE * 2.0
STAIR_W = 80.0
TREADS = 9
GROUND_SLAB_H = 3.0
SUPPORT_BURY = 2.0

# entry -> exit 的游戏地面方向；实体高度增量会另外把屏幕 y 上抬 GAME_RISE。
GAME_DIRECTIONS = {
    "e1_pos": (64.0, 32.0),
    "e1_neg": (-64.0, -32.0),
    "e2_pos": (-64.0, 32.0),
    "e2_neg": (64.0, -32.0),
}

# 相机位于世界 +X/+Y 对角线：+Y 投影为 e1_pos，+X 投影为 e2_pos。
DIRECTIONS = {
    "e1_pos": (0.0, GRID_SIDE),
    "e1_neg": (0.0, -GRID_SIDE),
    "e2_pos": (GRID_SIDE, 0.0),
    "e2_neg": (-GRID_SIDE, 0.0),
}


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for datablocks in (
        bpy.data.meshes,
        bpy.data.curves,
        bpy.data.cameras,
        bpy.data.lights,
    ):
        for block in list(datablocks):
            if block.users == 0:
                datablocks.remove(block)


def material_from_image(
    name,
    image_path,
    roughness=0.9,
    tile_scale=0.025,
    value_boost=1.0,
):
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    nodes = material.node_tree.nodes
    links = material.node_tree.links
    bsdf = nodes.get("Principled BSDF")
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Specular IOR Level"].default_value = 0.2
    image = bpy.data.images.load(image_path, check_existing=True)
    texture = nodes.new("ShaderNodeTexImage")
    texture.image = image
    texture.interpolation = "Linear"
    texture.extension = "REPEAT"
    texture.projection = "BOX"
    texture.projection_blend = 0.08
    texcoord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    mapping.vector_type = "POINT"
    mapping.inputs["Scale"].default_value = (tile_scale, tile_scale, tile_scale)
    links.new(texcoord.outputs["Object"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], texture.inputs["Vector"])
    color_output = texture.outputs["Color"]
    if abs(value_boost - 1.0) > 1e-6:
        color_adjust = nodes.new("ShaderNodeHueSaturation")
        color_adjust.inputs["Saturation"].default_value = 0.9
        color_adjust.inputs["Value"].default_value = value_boost
        links.new(color_output, color_adjust.inputs["Color"])
        color_output = color_adjust.outputs["Color"]
    links.new(color_output, bsdf.inputs["Base Color"])
    return material


def bevel(obj, amount=0.8):
    modifier = obj.modifiers.new("bevel", "BEVEL")
    modifier.width = amount
    modifier.segments = 2


def add_box(name, center, size, angle, material, bevel_amount=0.8):
    bpy.ops.mesh.primitive_cube_add(size=2)
    obj = bpy.context.active_object
    obj.name = name
    obj.location = center
    obj.scale = (size[0] / 2, size[1] / 2, size[2] / 2)
    obj.rotation_euler = (0, 0, angle)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    bevel(obj, bevel_amount)
    obj.data.materials.append(material)
    return obj


def add_square_prism(name, center_xy, min_z, max_z, material, bevel_amount=0.8):
    return add_box(
        name,
        (center_xy[0], center_xy[1], (min_z + max_z) / 2),
        (GRID_SIDE, GRID_SIDE, max_z - min_z),
        0,
        material,
        bevel_amount,
    )


def add_block_wall(material):
    return add_square_prism(
        "obstacle_block_reference",
        (0, 0),
        0,
        MODEL_WALL_H,
        material,
        1.2,
    )


def add_stair_segment(
    name,
    center_xy,
    ascent,
    base_z,
    top_z,
    stair_material,
    support_material,
    upper,
):
    length = math.hypot(ascent[0], ascent[1])
    ux, uy = ascent[0] / length, ascent[1] / length
    angle = math.atan2(uy, ux) - math.pi / 2
    run = length / TREADS
    objects = []

    # 两段各自都有齐踏步宽度的接地体。上段支撑从地面一直到第二段起点，确保靠墙段
    # 不悬空；长度仍覆盖完整1×1格，但宽度与80宽踏步一致，避免整格方柱两侧凸出。
    if upper:
        support_height = base_z + SUPPORT_BURY
        objects.append(add_box(
            f"{name}_grounded_support",
            (center_xy[0], center_xy[1], (-SUPPORT_BURY + base_z) / 2),
            (STAIR_W, length, support_height),
            angle,
            support_material,
            0.65,
        ))
    else:
        slab_height = GROUND_SLAB_H + SUPPORT_BURY
        objects.append(add_box(
            f"{name}_ground_slab",
            (center_xy[0], center_xy[1], (-SUPPORT_BURY + GROUND_SLAB_H) / 2),
            (STAIR_W, length, slab_height),
            angle,
            support_material,
            0.65,
        ))

    # 每级从自身前缘延伸到格子后缘，构成无缝实心楼梯；首尾不超出地块边界。
    for index in range(TREADS):
        start = -length / 2 + run * index
        end = length / 2
        tread_top = base_z + (top_z - base_z) * (index + 1) / TREADS
        height = tread_top - base_z
        along = (start + end) / 2
        cx = center_xy[0] + ux * along
        cy = center_xy[1] + uy * along
        objects.append(add_box(
            f"{name}_tread_{index + 1:02d}",
            (cx, cy, base_z + height / 2),
            (STAIR_W, end - start, height),
            angle,
            stair_material,
            0.65,
        ))
    return objects


def setup_camera(objects):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.view_settings.view_transform = "Standard"
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = 0
    scene.view_settings.gamma = 1

    corners = []
    bpy.context.view_layer.update()
    for obj in objects:
        for corner in obj.bound_box:
            corners.append(obj.matrix_world @ Vector(corner))
    extent = max(
        max(axis) - min(axis)
        for axis in zip(*[(point.x, point.y, point.z) for point in corners])
    )

    camera_data = bpy.data.cameras.new("camera")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = ORTHO_SCALE
    camera_data.clip_start = 0.01
    camera_data.clip_end = max(1000, extent * 20)
    camera = bpy.data.objects.new("camera", camera_data)
    scene.collection.objects.link(camera)

    elevation = math.radians(CAMERA_ELEVATION)
    azimuth = math.radians(CAMERA_AZIMUTH)
    distance = max(500, extent * 6)
    horizontal = distance * math.cos(elevation)
    target = Vector((0, 0, MODEL_WALL_H / 2))
    camera.location = (
        target.x + horizontal * math.cos(azimuth),
        target.y + horizontal * math.sin(azimuth),
        target.z + distance * math.sin(elevation),
    )
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera

    # 固定正交尺度，只平移取景：内容水平居中，最低像素落在约 y=950，给背向
    # 相机的上段最高一级预留顶部安全边距；四方向尺度始终一致。
    bpy.context.view_layer.update()
    inverse = camera.matrix_world.inverted()
    camera_points = [inverse @ point for point in corners]
    min_x = min(point.x for point in camera_points)
    max_x = max(point.x for point in camera_points)
    min_y = min(point.y for point in camera_points)
    camera_data.shift_x = ((min_x + max_x) / 2) / ORTHO_SCALE
    target_bottom = (0.5 - 950 / SIZE) * ORTHO_SCALE
    camera_data.shift_y = (min_y - target_bottom) / ORTHO_SCALE
    return scene, camera


def setup_light():
    # 柔和均匀照明、无地面/投影。两盏大面积灯只塑造材质层次，不产生硬阴影。
    scene = bpy.context.scene
    world = scene.world
    world.use_nodes = True
    world.node_tree.nodes["Background"].inputs["Color"].default_value = (0.32, 0.30, 0.28, 1)
    world.node_tree.nodes["Background"].inputs["Strength"].default_value = 0.8
    for name, location, energy in (
        ("key", (-300, -400, 600), 850),
        ("fill", (420, 250, 420), 500),
    ):
        bpy.ops.object.light_add(type="AREA", location=location)
        light = bpy.context.active_object
        light.name = name
        light.data.energy = energy
        light.data.shape = "DISK"
        light.data.size = 500
        light.data.use_shadow = False
        light.rotation_euler = (
            Vector((0, 0, MODEL_WALL_H / 2)) - light.location
        ).to_track_quat("-Z", "Y").to_euler()


def project(scene, camera, point):
    ndc = world_to_camera_view(scene, camera, Vector(point))
    return [ndc.x * SIZE, (1 - ndc.y) * SIZE]


def render_variant(key, part, objects, anchors):
    scene, camera = setup_camera(objects)
    setup_light()
    output = os.path.join(ASSET_DIR, f"wall_stair_{part}_{key}.png")
    scene.render.filepath = output
    bpy.ops.render.render(write_still=True)
    data = {name: project(scene, camera, point) for name, point in anchors.items()}
    print(key, part, json.dumps(data))
    return output, data


def build_isolated(key, ascent, part, stair_material, support_material):
    clear_scene()
    if part == "lower":
        base_z, top_z = 0.0, MODEL_RISE
    else:
        base_z, top_z = MODEL_RISE, MODEL_WALL_H
    objects = add_stair_segment(
        part,
        (0, 0),
        ascent,
        base_z,
        top_z,
        stair_material,
        support_material,
        part == "upper",
    )
    length = math.hypot(*ascent)
    ux, uy = ascent[0] / length, ascent[1] / length
    cross_x, cross_y = uy, -ux
    entry_x, entry_y = -ux * length / 2, -uy * length / 2
    exit_x, exit_y = ux * length / 2, uy * length / 2
    half_walk = STAIR_W / 2
    anchors = {
        "entryPx": (entry_x, entry_y, base_z),
        "exitPx": (exit_x, exit_y, top_z),
        "surfacePx": (0, 0, (base_z + top_z) / 2),
        "walkEntryAPx": (
            entry_x + cross_x * half_walk,
            entry_y + cross_y * half_walk,
            base_z,
        ),
        "walkEntryBPx": (
            entry_x - cross_x * half_walk,
            entry_y - cross_y * half_walk,
            base_z,
        ),
        "walkExitAPx": (
            exit_x + cross_x * half_walk,
            exit_y + cross_y * half_walk,
            top_z,
        ),
        "walkExitBPx": (
            exit_x - cross_x * half_walk,
            exit_y - cross_y * half_walk,
            top_z,
        ),
    }
    return render_variant(key, part, objects, anchors)


def build_reference(stair_material, wall_material):
    clear_scene()
    wall = add_block_wall(wall_material)
    ascent = DIRECTIONS["e1_pos"]
    upper_center = (-ascent[0], -ascent[1])
    lower_center = (-ascent[0] * 2, -ascent[1] * 2)
    objects = [wall]
    objects += add_stair_segment(
        "lower_reference",
        lower_center,
        ascent,
        0,
        MODEL_RISE,
        stair_material,
        stair_material,
        False,
    )
    objects += add_stair_segment(
        "upper_reference",
        upper_center,
        ascent,
        MODEL_RISE,
        MODEL_WALL_H,
        stair_material,
        stair_material,
        True,
    )
    scene, camera = setup_camera(objects)
    setup_light()
    scene.render.filepath = os.path.join(OUT_DIR, "block_wall_stair_reference.png")
    bpy.ops.render.render(write_still=True)
    bpy.ops.wm.save_as_mainfile(
        filepath=os.path.join(OUT_DIR, "block_wall_stair_reference.blend")
    )
    return scene, camera


def audit_projection(scene, camera):
    origin = project(scene, camera, (0, 0, 0))
    x_axis = project(scene, camera, (GRID_SIDE, 0, 0))
    y_axis = project(scene, camera, (0, GRID_SIDE, 0))
    vertical = project(scene, camera, (0, 0, MODEL_RISE))

    def delta(point):
        return [point[0] - origin[0], point[1] - origin[1]]

    def slope(vector):
        return vector[1] / vector[0]

    x_delta = delta(x_axis)
    y_delta = delta(y_axis)
    z_delta = delta(vertical)
    return {
        "cameraElevation": CAMERA_ELEVATION,
        "cameraAzimuth": CAMERA_AZIMUTH,
        "projection": "ORTHO",
        "displayScale": DISPLAY_SIZE / SIZE,
        "xAxisRawPx": x_delta,
        "yAxisRawPx": y_delta,
        "riseRawPx": z_delta,
        "xAxisDisplayPx": [value * DISPLAY_SIZE / SIZE for value in x_delta],
        "yAxisDisplayPx": [value * DISPLAY_SIZE / SIZE for value in y_delta],
        "riseDisplayPx": [value * DISPLAY_SIZE / SIZE for value in z_delta],
        "xAxisScreenSlope": slope(x_delta),
        "yAxisScreenSlope": slope(y_delta),
    }


def validate_variant(key, anchors):
    desired_ground = GAME_DIRECTIONS[key]
    desired = (desired_ground[0], desired_ground[1] - GAME_RISE)
    raw = (
        anchors["exitPx"][0] - anchors["entryPx"][0],
        anchors["exitPx"][1] - anchors["entryPx"][1],
    )
    actual = (
        raw[0] * DISPLAY_SIZE / SIZE,
        raw[1] * DISPLAY_SIZE / SIZE,
    )
    error = (actual[0] - desired[0], actual[1] - desired[1])
    if abs(error[0]) > 1e-3 or abs(error[1]) > 1e-3:
        raise RuntimeError(f"{key} anchor mismatch: actual={actual}, desired={desired}")
    return {
        "desiredEntryExit": desired,
        "actualEntryExit": actual,
        "error": error,
    }


def main():
    os.makedirs(ASSET_DIR, exist_ok=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    stair_material = material_from_image(
        "stair_whitegray_brick",
        STAIR_TEX,
        tile_scale=0.025,
        value_boost=1.10,
    )
    wall_material = material_from_image("wall_reference", WALL_TEX, tile_scale=0.01)
    reference_scene, reference_camera = build_reference(stair_material, wall_material)
    report = {
        "_audit": audit_projection(reference_scene, reference_camera),
    }
    for key, ascent in DIRECTIONS.items():
        lower_path, lower = build_isolated(
            key, ascent, "lower", stair_material, stair_material
        )
        upper_path, upper = build_isolated(
            key, ascent, "upper", stair_material, stair_material
        )
        report[key] = {
            "displayWidth": DISPLAY_SIZE,
            "displayHeight": DISPLAY_SIZE,
            "lower": {
                "texture": os.path.splitext(os.path.basename(lower_path))[0],
                **lower,
            },
            "upper": {
                "texture": os.path.splitext(os.path.basename(upper_path))[0],
                **upper,
            },
            "anchorAudit": validate_variant(key, lower),
        }
        validate_variant(key, upper)
    with open(
        os.path.join(OUT_DIR, "anchors.json"), "w", encoding="utf-8"
    ) as handle:
        json.dump(report, handle, ensure_ascii=False, indent=2)
    print(json.dumps(report, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
