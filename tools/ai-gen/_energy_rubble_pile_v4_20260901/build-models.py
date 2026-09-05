"""Build five genuinely different low 1x1 rubble silhouettes for energy veins."""

import importlib.util
import json
import math
import random
import sys
from pathlib import Path

import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector


ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
OLD_ROOT = REPO / "tools/ai-gen/_energy_rubble_pile_20260831"
spec = importlib.util.spec_from_file_location("energy_rubble_v2", OLD_ROOT / "build-model.py")
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)

CAMERA = {
    "elevation": 30,
    "azimuth": 0,
    "buildingRotationZ": 44.8,
    "resolution": 1024,
    "bottomY": 848,
    "topMargin": 80,
    "widthMargin": 0.86,
}

VARIANTS = {
    1: {
        "id": "compact_plateau",
        "label": "紧凑平台",
        "seed": 122901,
        "ground": "compact",
        "ore": {1, 4, 7},
        "rocks": [
            (-49, -31, 45, 40, 18, -18), (-10, -37, 55, 45, 24, 12),
            (38, -30, 46, 39, 20, -9), (-50, 10, 43, 42, 17, 21),
            (-4, 7, 56, 50, 28, -4), (45, 9, 44, 42, 19, 17),
            (-29, 48, 43, 35, 15, -15), (19, 47, 49, 35, 17, 20),
        ],
    },
    2: {
        "id": "twin_saddle",
        "label": "双丘鞍部",
        "seed": 122902,
        "ground": "twin",
        "ore": {0, 3, 6},
        "rocks": [
            (-58, -29, 48, 44, 23, -12), (-24, -39, 40, 37, 17, 20),
            (28, -36, 41, 38, 16, -16), (59, -23, 47, 43, 25, 13),
            (-52, 14, 51, 46, 27, 8), (-5, 8, 37, 35, 13, -18),
            (48, 17, 52, 46, 29, -7), (-28, 49, 42, 33, 15, 22),
            (26, 51, 43, 34, 16, -14),
        ],
    },
    3: {
        "id": "diagonal_ridge",
        "label": "斜向低脊",
        "seed": 122903,
        "ground": "diagonal",
        "ore": {1, 4, 7},
        "rocks": [
            (-68, -47, 39, 33, 15, 18), (-45, -29, 49, 40, 20, -14),
            (-20, -12, 51, 43, 24, 9), (7, 6, 53, 45, 27, -8),
            (34, 24, 50, 43, 23, 17), (61, 43, 41, 34, 17, -12),
            (-51, 12, 39, 34, 14, -20), (-15, 35, 44, 36, 16, 12),
            (25, -31, 41, 35, 15, -17), (56, 1, 39, 34, 14, 11),
        ],
    },
    4: {
        "id": "front_scatter",
        "label": "前沿散堆",
        "seed": 122904,
        "ground": "front",
        "ore": {2, 5, 8},
        "rocks": [
            (-64, -54, 38, 32, 14, -19), (-27, -59, 48, 38, 17, 14),
            (15, -58, 51, 40, 19, -7), (58, -50, 39, 33, 14, 21),
            (-48, -18, 47, 42, 20, 9), (-5, -20, 55, 48, 25, -12),
            (44, -13, 48, 40, 20, 15), (-35, 22, 43, 38, 16, -17),
            (8, 20, 50, 42, 19, 7), (52, 24, 40, 34, 14, -11),
            (-8, 55, 43, 31, 13, 18),
        ],
    },
    5: {
        "id": "crescent_notch",
        "label": "月牙缺口",
        "seed": 122905,
        "ground": "crescent",
        "ore": {1, 5, 8},
        "rocks": [
            (-69, -22, 40, 36, 15, -12), (-53, 14, 47, 42, 20, 18),
            (-31, 43, 47, 38, 19, -8), (4, 57, 50, 36, 18, 13),
            (41, 44, 47, 38, 20, -17), (62, 13, 45, 40, 21, 9),
            (70, -24, 38, 35, 15, -15), (-35, -24, 44, 39, 17, 21),
            (35, -25, 45, 39, 17, -20), (0, 18, 45, 40, 15, 6),
        ],
    },
}


def inside_ground(shape, x, y):
    if shape == "compact":
        return (x / 88) ** 2 + (y / 76) ** 2 <= 1
    if shape == "twin":
        left = ((x + 43) / 58) ** 2 + (y / 76) ** 2 <= 1
        right = ((x - 43) / 58) ** 2 + (y / 76) ** 2 <= 1
        return left or right
    if shape == "diagonal":
        return abs(y - 0.62 * x) <= 42 and (x / 92) ** 2 + (y / 88) ** 2 <= 1.15
    if shape == "front":
        main = (x / 92) ** 2 + ((y + 20) / 72) ** 2 <= 1
        tail = (x / 56) ** 2 + ((y - 40) / 44) ** 2 <= 1
        return main or tail
    if shape == "crescent":
        outer = (x / 92) ** 2 + ((y - 5) / 82) ** 2 <= 1
        notch = (x / 37) ** 2 + ((y + 42) / 31) ** 2 <= 1
        return outer and not notch
    raise ValueError(shape)


def make_ground_rocks(shape, stones, rng):
    count = 0
    for row, y0 in enumerate(range(-81, 82, 27)):
        for column, x0 in enumerate(range(-81, 82, 27)):
            x = x0 + rng.uniform(-4.5, 4.5)
            y = y0 + rng.uniform(-4.5, 4.5)
            if not inside_ground(shape, x, y):
                continue
            width = rng.uniform(31, 42)
            depth = rng.uniform(29, 39)
            height = rng.uniform(6.0, 9.0) + 5.0 * max(0, 1 - max(abs(x), abs(y)) / 95)
            sides = rng.choice((5, 6, 7))
            polygon = []
            for side in range(sides):
                angle = math.tau * side / sides + rng.uniform(-0.12, 0.12)
                radius = rng.uniform(0.80, 1.0)
                polygon.append((
                    math.cos(angle) * width * 0.5 * radius,
                    math.sin(angle) * depth * 0.5 * radius,
                ))
            offset = (row * 3 + column) % len(stones)
            materials = [stones[offset], stones[(offset + 1) % 5], stones[(offset + 2) % 5]]
            obj = base.rock_half(f"Grounding_Rock_{count:02d}", polygon, height, materials)
            obj.rotation_euler.z = math.radians(rng.uniform(-42, 42))
            rotation = obj.rotation_euler.to_matrix()
            vertices = [rotation @ vertex.co for vertex in obj.data.vertices]
            obj.location = (x, y, 0.25 - min(vertex.z for vertex in vertices))
            obj.location.x += min(0, 97 - x - max(v.x for v in vertices)) + max(0, -97 - x - min(v.x for v in vertices))
            obj.location.y += min(0, 97 - y - max(v.y for v in vertices)) + max(0, -97 - y - min(v.y for v in vertices))
            count += 1
    return count


def build_upper_rock(index, values, stones, ores):
    """V4 copy of the authored split-rock builder without V2's fixed ore indices."""
    x, y, width, depth, height, rotation = values
    sides = base.RNG.choice((6, 7, 8))
    polygon = []
    for side in range(sides):
        angle = math.tau * side / sides + base.RNG.uniform(-0.07, 0.07)
        radius = base.RNG.uniform(0.86, 1.0)
        polygon.append((
            math.cos(angle) * width * 0.5 * radius,
            math.sin(angle) * depth * 0.5 * radius,
        ))
    z = 3.0 + 8.0 * max(0, 1 - max(abs(x), abs(y)) / 100)
    objects = []
    if index in base.ORE_ROCKS:
        rotation += (-22, 46, 8, -35)[index % 4]
        gap = 7.0
        for label, boundary, keep_left in (("A", -gap / 2, True), ("B", gap / 2, False)):
            half = base.cut_polygon(polygon, boundary, keep_left)
            objects.append(base.rock_half(
                f"OreBearingRock_{index:02d}_{label}", half, height, stones, boundary
            ))
        length = depth * 0.60
        samples = [-length * 0.5, -length * 0.25, 0, length * 0.25, length * 0.5]
        widths = [1.8, 2.7, 2.3, 2.8, 1.7]
        points = [(base.mineral_offset(py) - w, py) for py, w in zip(samples, widths)]
        points += [(base.mineral_offset(py) + w, py)
                   for py, w in reversed(list(zip(samples, widths)))]
        core = base.mesh_object(
            f"Embedded_Mineral_Seam_{index:02d}",
            [(px, py, height * 0.84 + 0.015 * py) for px, py in points],
            [tuple(reversed(range(len(points))))],
            [ores[index % len(ores)]],
        )
        objects.append(core)
    else:
        objects.append(base.rock_half(f"Fractured_Rubble_{index:02d}", polygon, height, stones))
    for obj in objects:
        obj.location = (x, y, z)
        obj.rotation_euler.z = math.radians(rotation)
    rotation_matrix = objects[0].rotation_euler.to_matrix()
    points = [rotation_matrix @ vertex.co + Vector((x, y, z))
              for obj in objects for vertex in obj.data.vertices]
    dx = min(0, 94 - max(point.x for point in points)) + max(0, -94 - min(point.x for point in points))
    dy = min(0, 94 - max(point.y for point in points)) + max(0, -94 - min(point.y for point in points))
    for obj in objects:
        obj.location.x += dx
        obj.location.y += dy


def build_variant(index):
    cfg = VARIANTS[index]
    out = ROOT / f"variant_{index}_{cfg['id']}"
    out.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.read_factory_settings(use_empty=True)

    rng = random.Random(cfg["seed"])
    base.RNG = rng
    base.ORE_ROCKS = set(cfg["ore"])
    base.COLLECTION = bpy.data.collections.new(f"Energy_Rubble_V4_{index}")
    bpy.context.scene.collection.children.link(base.COLLECTION)
    base.ROOT = bpy.data.objects.new(f"Energy_Rubble_V4_Root_{index}_44_8deg", None)
    base.COLLECTION.objects.link(base.ROOT)
    base.ROOT.rotation_euler.z = math.radians(CAMERA["buildingRotationZ"])

    stones = [base.kit.material(f"V4_{index}_Rubble_{i}", (*rgb, 1), roughness=0.92)
              for i, rgb in enumerate(((0.24, 0.26, 0.27), (0.285, 0.30, 0.305),
                                       (0.325, 0.335, 0.33), (0.255, 0.27, 0.275),
                                       (0.305, 0.31, 0.295)))]
    ores = [base.kit.material(f"V4_{index}_Energy_{i}", (*rgb, 1), roughness=0.65,
                              emission=((*rgb, 1), 0.12))
            for i, rgb in enumerate(((0.035, 0.30, 0.36), (0.065, 0.38, 0.43)))]

    for rock_index, values in enumerate(cfg["rocks"]):
        offset = rock_index % len(stones)
        build_upper_rock(
            rock_index,
            values,
            [stones[offset], stones[(offset + 1) % 5], stones[(offset + 2) % 5]],
            ores,
        )
    grounding_count = make_ground_rocks(cfg["ground"], stones, rng)

    preview = out / "model_preview.png"
    base.kit.setup_scene({"camera": CAMERA}, str(preview))
    scene = bpy.context.scene
    scene.view_settings.look = "Medium High Contrast"
    scene.view_settings.exposure = -0.12
    # Keep all five variants in the exact same nominal 1x1 camera frame. The
    # four vertices participate in camera fitting but have no faces and are
    # removed before the blend/render is written.
    framing = base.mesh_object(
        "Temporary_Footprint_Framing",
        [(-100, -100, 0), (100, -100, 0), (100, 100, 0), (-100, 100, 0)],
        [],
        [],
    )
    camera = base.kit.setup_camera({"camera": CAMERA}, base.ROOT)
    framing_mesh = framing.data
    bpy.data.objects.remove(framing, do_unlink=True)
    bpy.data.meshes.remove(framing_mesh)
    scene.camera = camera
    bpy.context.view_layer.update()
    bpy.ops.wm.save_as_mainfile(filepath=str(out / "model.blend"))
    bpy.ops.render.render(write_still=True)
    base.kit.render_depth(scene, base.ROOT, camera, str(out / "body_depth.png"), f"EnergyRubbleV4_{index}")

    footprint = []
    for x, y in ((-100, -100), (100, -100), (100, 100), (-100, 100)):
        point = world_to_camera_view(scene, camera, base.ROOT.matrix_world @ Vector((x, y, 0)))
        footprint.append([round(point.x * 1024, 3), round((1 - point.y) * 1024, 3)])
    return {
        "variant": index,
        "id": cfg["id"],
        "label": cfg["label"],
        "seed": cfg["seed"],
        "upperRockCount": len(cfg["rocks"]),
        "groundingRockCount": grounding_count,
        "oreBearingRockCount": len(cfg["ore"]),
        "preview": str(preview.relative_to(ROOT)).replace("\\", "/"),
        "depth": str((out / "body_depth.png").relative_to(ROOT)).replace("\\", "/"),
        "model": str((out / "model.blend").relative_to(ROOT)).replace("\\", "/"),
        "footprintProjectionPixels": footprint,
    }


def main():
    chosen = None
    if "--" in sys.argv:
        args = sys.argv[sys.argv.index("--") + 1:]
        if args:
            chosen = int(args[0])
    indices = [chosen] if chosen else sorted(VARIANTS)
    records = [build_variant(index) for index in indices]
    manifest_path = ROOT / "model-manifest.json"
    existing = {"variants": []}
    if manifest_path.exists():
        existing = json.loads(manifest_path.read_text(encoding="utf-8"))
    merged = {record["variant"]: record for record in existing.get("variants", [])}
    merged.update({record["variant"]: record for record in records})
    manifest = {
        "date": "2026-09-01",
        "status": "five_distinct_low_rubble_models",
        "sourceAuthority": "tools/ai-gen/_energy_rubble_pile_20260831 selected low v03",
        "camera": CAMERA,
        "footprintCells": 1,
        "contracts": {
            "noGroundPlane": True,
            "noFoundation": True,
            "sameCameraAndFootline": True,
            "lowProfile": True,
            "fixedLightDirection": True,
        },
        "variants": [merged[index] for index in sorted(merged)],
        "runtimeInstalled": False,
    }
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(records, ensure_ascii=False))


if __name__ == "__main__":
    main()
