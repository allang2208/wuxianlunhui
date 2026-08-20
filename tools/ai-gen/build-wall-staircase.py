#!/usr/bin/env python3
"""
以世界-122当前掩体墙模型为基准重建两段1×1城墙楼梯。

流程：
1. Blender内搭建当前墙（230×52×150, rot.z=44.8）；
2. 在墙前放置下段/上段，校验地面、段间、墙顶三处接触；
3. 渲染一张墙+楼梯参考装配图；
4. 清空场景（删除参考墙），分别渲染上下两段；
5. 每段输出两种登高正负方向，并派生水平镜像，总计8张方向资产。
"""

import importlib.util
import math
import os

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
RENDER_SCRIPT = os.path.join(HERE, "render-cover-real.py")
WALL_TEXTURE = os.path.join(ROOT, "assets", "terrain", "obstacle_cover_D_v.png")
STAIR_TEXTURE = os.path.join(HERE, "_depth_templates", "stair_tread.png")
OUT_DIR = os.path.join(HERE, "_wall_stair_rebuild")
ASSET_DIR = os.path.join(ROOT, "assets", "terrain")

ROT_Z = 44.8
WALL_W = 230.0
WALL_D = 52.0
WALL_H = 150.0
WALL_FRONT_Y = -WALL_D / 2.0

# 当前墙150模型单位对应游戏topZ=98；每段模型抬升75，对应游戏49。
MODULE_RUN = 106.0
MODULE_RISE = WALL_H / 2.0
STAIR_W = 110.0
TREAD_COUNT = 9
TOE_EXTEND = 6.0
TOP_LANDING_EXTEND = 6.0
FIRST_TREAD_H = 2.0
SEGMENT_ORTHO_SCALE = 300.0
SUPPORT_BURY = 18.0

REFERENCE_UPPER_TOP = WALL_FRONT_Y
REFERENCE_UPPER_BOTTOM = REFERENCE_UPPER_TOP - MODULE_RUN
REFERENCE_LOWER_TOP = REFERENCE_UPPER_BOTTOM
REFERENCE_LOWER_BOTTOM = REFERENCE_LOWER_TOP - MODULE_RUN

SPEC = {
    "elevation": 30,
    "azimuth": 0,
    "bottom_y": 944,
    "max_width_frac": 0.95,
    "top_margin_px": 40,
    "soil_margin": 0.02,
}


def load_render_module():
    spec = importlib.util.spec_from_file_location("render_cover_real", RENDER_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


R = load_render_module()


def clear_scene():
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete()
    for material in list(bpy.data.materials):
        bpy.data.materials.remove(material)


def rotate_xy(x, y, degrees=ROT_Z):
    angle = math.radians(degrees)
    c = math.cos(angle)
    s = math.sin(angle)
    return x * c - y * s, x * s + y * c


def box_primitive(size, local_pos, material="stair", bevel=1.5):
    x, y = rotate_xy(local_pos[0], local_pos[1])
    return {
        "type": "box",
        "size": list(size),
        "pos": [x, y, local_pos[2]],
        "rot": [0, 0, ROT_Z],
        "bevel": bevel,
        "bevelSegments": 2,
        "material": material,
    }


def stair_primitives(local_bottom_y, local_top_y, base_z, top_z, upper=False):
    """构造一个实心阶梯模块；entry=bottom_y，exit=top_y。"""
    direction = 1.0 if local_top_y > local_bottom_y else -1.0
    run = abs(local_top_y - local_bottom_y)
    tread_run = run / TREAD_COUNT
    rise = top_z - base_z
    rise_after_toe = (rise - FIRST_TREAD_H) / (TREAD_COUNT - 1)
    primitives = []

    for index in range(TREAD_COUNT):
        start = local_bottom_y + direction * tread_run * index
        end = local_top_y
        if index == 0:
            start -= direction * TOE_EXTEND
        if upper and index == TREAD_COUNT - 1:
            end += direction * TOP_LANDING_EXTEND
        top_height = base_z + FIRST_TREAD_H + rise_after_toe * index
        height = max(2.0, top_height - base_z)
        depth = abs(end - start)
        center_y = (start + end) * 0.5
        primitives.append(box_primitive(
            (STAIR_W, depth, height),
            (0, center_y, base_z + height * 0.5),
            material="stair",
            bevel=1.5,
        ))
    return primitives


def upper_support_primitive(local_bottom_y, local_top_y):
    """靠墙上段的实心承重基座：从地面一直托到第二段入口高度。"""
    center_y = (local_bottom_y + local_top_y) * 0.5
    support_height = MODULE_RISE + SUPPORT_BURY
    return box_primitive(
        (STAIR_W, abs(local_top_y - local_bottom_y), support_height),
        (0, center_y, (MODULE_RISE - SUPPORT_BURY) * 0.5),
        material="wall",
        bevel=2.0,
    )


def wall_primitive():
    return box_primitive(
        (WALL_W, WALL_D, WALL_H),
        (0, 0, WALL_H * 0.5),
        material="wall",
        bevel=10,
    )


def setup_scene(primitives, ortho_scale=None):
    clear_scene()
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 1024
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.image_settings.color_depth = "8"
    scene.render.dither_intensity = 0.0
    objects, _gate_bars = R.build_wall(
        primitives,
        WALL_TEXTURE,
        None,
        STAIR_TEXTURE,
    )
    R.setup_lighting(scene)
    camera_spec = dict(SPEC)
    if ortho_scale is not None:
        camera_spec["ortho_scale"] = ortho_scale
    camera = R.setup_camera(camera_spec, objects)
    scene.camera = camera
    return scene, camera, objects


def render(primitives, output_path, mirror=False, print_anchors=None, ortho_scale=None):
    scene, camera, _objects = setup_scene(primitives, ortho_scale=ortho_scale)
    scene.render.filepath = os.path.abspath(output_path)
    bpy.ops.render.render(write_still=True)
    print("rendered ->", scene.render.filepath)
    if mirror:
        R.mirror_png(scene.render.filepath, scene)
    if print_anchors:
        for name, point in print_anchors:
            px, py = rotate_xy(point[0], point[1])
            ndc = world_to_camera_view(scene, camera, Vector((px, py, point[2])))
            image_x = ndc.x * 1024
            image_y = (1.0 - ndc.y) * 1024
            print(f"{os.path.basename(output_path)} {name}: ({image_x:.3f}, {image_y:.3f})")


def normalized_segment(ascending_sign=1, upper=False):
    half = MODULE_RUN * 0.5
    bottom = -half * ascending_sign
    top = half * ascending_sign
    if upper:
        primitives = [upper_support_primitive(bottom, top)]
        primitives += stair_primitives(bottom, top, MODULE_RISE, WALL_H, upper=True)
        return primitives, (
            ("entry", (0, bottom, MODULE_RISE)),
            ("exit", (0, top, WALL_H)),
            ("ground_center", (0, 0, 0)),
            ("surface_center", (0, 0, (MODULE_RISE + WALL_H) * 0.5)),
        )
    return stair_primitives(bottom, top, 0.0, MODULE_RISE, upper=False), (
        ("entry", (0, bottom, 0)),
        ("exit", (0, top, MODULE_RISE)),
        ("ground_center", (0, 0, 0)),
        ("surface_center", (0, 0, MODULE_RISE * 0.5)),
    )


def validate_reference():
    angle = math.degrees(math.atan2(WALL_H, MODULE_RUN * 2))
    checks = {
        "lower_ground_contact": 0.0,
        "lower_to_upper_height_gap": MODULE_RISE - MODULE_RISE,
        "lower_to_upper_run_gap": REFERENCE_LOWER_TOP - REFERENCE_UPPER_BOTTOM,
        "upper_to_wall_height_gap": WALL_H - WALL_H,
        "upper_to_wall_run_gap": REFERENCE_UPPER_TOP - WALL_FRONT_Y,
    }
    print("== wall stair reference ==")
    print(f"wall size: {WALL_W} x {WALL_D} x {WALL_H}, rot.z={ROT_Z}")
    print(f"module footprint: {STAIR_W} x {MODULE_RUN}, rise={MODULE_RISE}")
    print(f"two-module physical slope: {angle:.3f} deg")
    for name, value in checks.items():
        print(f"{name}: {value:.6f}")
        if abs(value) > 1e-6:
            raise RuntimeError(f"alignment failed: {name}={value}")
    print(f"upper_support_bottom_z: {-SUPPORT_BURY:.6f} (buried below ground)")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    os.makedirs(ASSET_DIR, exist_ok=True)
    validate_reference()

    render(
        [wall_primitive()],
        os.path.join(OUT_DIR, "wall_calibration.png"),
        mirror=False,
        print_anchors=(
            ("entry", (0, WALL_FRONT_Y, 0)),
            ("exit", (0, WALL_FRONT_Y, WALL_H)),
        ),
    )

    reference_primitives = [wall_primitive()]
    reference_primitives += stair_primitives(
        REFERENCE_LOWER_BOTTOM,
        REFERENCE_LOWER_TOP,
        0.0,
        MODULE_RISE,
        upper=False,
    )
    reference_primitives.append(upper_support_primitive(
        REFERENCE_UPPER_BOTTOM,
        REFERENCE_UPPER_TOP,
    ))
    reference_primitives += stair_primitives(
        REFERENCE_UPPER_BOTTOM,
        REFERENCE_UPPER_TOP,
        MODULE_RISE,
        WALL_H,
        upper=True,
    )
    render(
        reference_primitives,
        os.path.join(OUT_DIR, "wall_stair_reference.png"),
        mirror=False,
    )

    # 参考墙到此删除；以下场景只包含需要导入游戏的两块楼梯。
    for segment_name, upper in (("lower", False), ("upper", True)):
        for sign_name, sign in (("pos", 1), ("neg", -1)):
            primitives, anchors = normalized_segment(sign, upper)
            out_h = os.path.join(
                ASSET_DIR,
                f"wall_stair_{segment_name}_{sign_name}_h.png",
            )
            render(
                primitives,
                out_h,
                mirror=True,
                print_anchors=anchors,
                ortho_scale=SEGMENT_ORTHO_SCALE,
            )

    print("reference wall removed before final segment exports")


if __name__ == "__main__":
    main()
