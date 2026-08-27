"""Build the 16-frame directional World-122 energy-vein master model.

Connectivity bits match the authoritative block grid:
  1 = +i (screen down-right), 2 = -i (screen up-left),
  4 = +j (screen down-left),  8 = -j (screen up-right).

The script reuses the newest modeled-road camera, 44.8-degree root, paver
scale, bevels, color management and neutral lighting.  It renders editable
high-resolution source frames; ``compose-energy-vein-directional-tiles.py``
packs those sources into runtime 128x64 spritesheets.
"""

from __future__ import annotations

import importlib.util
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[2]
ROAD_BUILDER = REPO / "tools" / "ai-gen" / "build-world122-street-decor.py"
OUT = REPO / "tools" / "ai-gen" / "_energy_vein_directional_20260826"
LIVE_OUT = OUT / "live_frames"
DEPLETED_OUT = OUT / "depleted_frames"
BLEND_OUT = OUT / "energy_vein_directional_master.blend"

BIT_I_POS = 1
BIT_I_NEG = 2
BIT_J_POS = 4
BIT_J_NEG = 8

# Calibrated in road-master local space so opposite projected endpoints differ
# by exactly one runtime block-grid translation: (+/-64, +/-32) at 128x64.
# The asymmetrical j vector compensates for the road camera's 44.8-degree root.
LOCAL_ENDPOINTS = {
    BIT_I_POS: (-0.289330, -1.320906),
    BIT_I_NEG: (-0.296492, 0.730980),
    BIT_J_POS: (-1.318853, -0.298544),
    BIT_J_NEG: (0.733032, -0.291382),
}


def load_road_builder():
    spec = importlib.util.spec_from_file_location("world122_street_master", ROAD_BUILDER)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load road master: {ROAD_BUILDER}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def setup_materials(road) -> None:
    road.setup_materials()
    road.material("vein_soil_0", (0.155, 0.165, 0.158), 1.0)
    road.material("vein_soil_1", (0.205, 0.205, 0.188), 1.0)
    for index, color in enumerate([
        (0.285, 0.30, 0.29), (0.36, 0.365, 0.34), (0.245, 0.26, 0.26),
        (0.405, 0.395, 0.35), (0.205, 0.225, 0.225), (0.33, 0.315, 0.275),
    ]):
        road.material(f"vein_stone_{index}", color, 0.95)
    road.material("vein_crack", (0.075, 0.095, 0.095), 1.0)
    road.material("vein_depleted", (0.20, 0.225, 0.23), 0.88, metallic=0.04)
    road.material("vein_depleted_highlight", (0.33, 0.35, 0.34), 0.90)
    road.emissive_material("vein_energy", (0.018, 0.19, 0.235), strength=0.42,
                           roughness=0.48)
    road.emissive_material("vein_energy_highlight", (0.04, 0.34, 0.38), strength=0.72,
                           roughness=0.42)


def distance_to_segment(px, py, ax, ay, bx, by) -> float:
    dx, dy = bx - ax, by - ay
    length2 = dx * dx + dy * dy
    if length2 <= 1e-8:
        return math.hypot(px - ax, py - ay)
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / length2))
    return math.hypot(px - (ax + dx * t), py - (ay + dy * t))


def branch_points(endpoint: tuple[float, float], rng: random.Random) -> list[tuple[float, float, float]]:
    ex, ey = endpoint
    length = max(0.001, math.hypot(ex, ey))
    px, py = -ey / length, ex / length
    bend_a = rng.uniform(-0.16, 0.16)
    bend_b = rng.uniform(-0.13, 0.13)
    return [
        (0.0, 0.0, 0.252),
        (ex * 0.34 + px * bend_a, ey * 0.34 + py * bend_a, 0.248),
        (ex * 0.68 + px * bend_b, ey * 0.68 + py * bend_b, 0.244),
        (ex, ey, 0.240),
    ]


def interpolate_polyline(points, t: float) -> tuple[float, float]:
    segment_count = len(points) - 1
    scaled = max(0.0, min(0.999999, t)) * segment_count
    index = min(segment_count - 1, int(scaled))
    local = scaled - index
    ax, ay, _az = points[index]
    bx, by, _bz = points[index + 1]
    return ax + (bx - ax) * local, ay + (by - ay) * local


def distance_to_branches(x: float, y: float,
                         branches: list[list[tuple[float, float, float]]]) -> float:
    return min(
        distance_to_segment(x, y, a[0], a[1], b[0], b[1])
        for points in branches
        for a, b in zip(points, points[1:])
    )


def add_irregular_stone(road, name: str, x: float, y: float,
                        rng: random.Random, energy: bool = False) -> None:
    radius = rng.uniform(0.13, 0.31) if not energy else rng.uniform(0.19, 0.28)
    depth = rng.uniform(0.075, 0.19) if not energy else rng.uniform(0.10, 0.16)
    material = (
        "vein_energy_highlight" if rng.random() < 0.34 else "vein_energy"
    ) if energy else f"vein_stone_{rng.randrange(6)}"
    road.cylinder(
        name,
        (x, y, 0.065 + depth / 2),
        radius,
        depth,
        material,
        rotation=(0, 0, rng.uniform(0, math.tau)),
        vertices=rng.randint(5, 8),
        scale=(rng.uniform(0.72, 1.48), rng.uniform(0.58, 1.12), 1.0),
        bevel=0.018,
    )


def build_mask(road, mask: int) -> str:
    name = f"energy_vein_mask_{mask:02d}"
    road.new_model(name, ((mask % 4) * 6.0, (mask // 4) * 6.0, 0))
    rng = random.Random(1222600 + mask * 7919)

    # Invisible 4x4 anchor keeps every frame on the exact same camera scale;
    # the visible substrate is intentionally ragged and transparent at its edge.
    anchor = road.box(f"{name}_BoundsAnchor", (0, 0, -0.08), (4.0, 4.0, 0.001),
                      "road_anchor", bevel=0)
    anchor.visible_shadow = False

    enabled = [endpoint for bit, endpoint in LOCAL_ENDPOINTS.items() if mask & bit]
    branches = [branch_points(endpoint, rng) for endpoint in enabled]
    if not branches:
        branches = [[(-0.56, 0.10, 0.248), (-0.16, -0.10, 0.252),
                     (0.20, -0.04, 0.248), (0.57, 0.12, 0.244)]]

    # Uneven soil lenses follow the vein instead of filling the whole cell.
    patch_index = 0
    for points in branches:
        for t in (0.10, 0.34, 0.58, 0.82):
            x, y = interpolate_polyline(points, t)
            radius = rng.uniform(0.42, 0.69)
            road.cylinder(
                f"{name}_BrokenSoil_{patch_index}",
                (x + rng.uniform(-0.12, 0.12), y + rng.uniform(-0.12, 0.12), 0.025),
                radius,
                0.05,
                f"vein_soil_{rng.randrange(2)}",
                rotation=(0, 0, rng.uniform(0, math.tau)),
                vertices=rng.randint(7, 10),
                scale=(rng.uniform(0.78, 1.30), rng.uniform(0.58, 1.02), 1.0),
                bevel=0.012,
            )
            patch_index += 1

    # Loose rubble uses low-sided, differently scaled stones.  Acceptance is
    # biased toward the vein but permits sparse outliers, avoiding a paved strip.
    stone_index = 0
    for _attempt in range(105):
        x = rng.uniform(-1.88, 1.88)
        y = rng.uniform(-1.88, 1.88)
        distance = distance_to_branches(x, y, branches)
        if distance > rng.uniform(0.48, 0.86) and rng.random() > 0.07:
            continue
        add_irregular_stone(road, f"{name}_Rubble_{stone_index}", x, y, rng)
        stone_index += 1
        if stone_index >= 38:
            break

    # Broken energy plates ride the same crooked path and still end exactly on
    # the four authoritative cell-edge midpoints for seamless adjacency.
    for branch_index, points in enumerate(branches):
        road.curve(
            f"{name}_BuriedFracture_{branch_index}",
            [(x, y, 0.17) for x, y, _z in points],
            0.040,
            "vein_crack",
        )
        road.curve(f"{name}_EnergyBranch_{branch_index}", points, 0.028,
                   "vein_energy_highlight")
        for plate_index, t in enumerate((0.10, 0.27, 0.46, 0.66, 0.84, 0.98)):
            x, y = interpolate_polyline(points, t)
            add_irregular_stone(
                road,
                f"{name}_EnergyRock_{branch_index}_{plate_index}",
                x + rng.uniform(-0.055, 0.055),
                y + rng.uniform(-0.055, 0.055),
                rng,
                energy=True,
            )
    # Each enabled direction gets an unobstructed cap centered exactly on the
    # authoritative shared-edge midpoint.  Opposite caps overlap after the
    # runtime (+/-64, +/-32) cell translation, so rubble cannot hide the seam.
    for seam_index, endpoint in enumerate(enabled):
        ex, ey = endpoint
        road.cylinder(
            f"{name}_SeamCap_{seam_index}",
            (ex, ey, 0.16),
            0.15,
            0.22,
            "vein_energy_highlight",
            rotation=(0, 0, rng.uniform(0, math.tau)),
            vertices=7,
            scale=(1.24, 0.82, 1.0),
            bevel=0.015,
        )
    return name


def camera_bounds(collection, camera):
    bpy.context.view_layer.update()
    inverse = camera.matrix_world.inverted()
    points = []
    anchors = [obj for obj in collection.all_objects if "BoundsAnchor" in obj.name]
    measured_objects = anchors or list(collection.all_objects)
    for obj in measured_objects:
        if obj.type != "MESH":
            continue
        points.extend(inverse @ (obj.matrix_world @ Vector(corner)) for corner in obj.bound_box)
    return (min(point.x for point in points), max(point.x for point in points),
            min(point.y for point in points), max(point.y for point in points))


def render_frame(road, name: str, scene, camera, path: Path) -> None:
    for collection in road.MODEL_COLLECTIONS.values():
        collection.hide_render = True
    collection = road.MODEL_COLLECTIONS[name]
    collection.hide_render = False
    root = road.MODEL_ROOTS[name]
    arranged = root.location.copy()
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 512
    min_x, max_x, min_y, max_y = camera_bounds(collection, camera)
    aspect = 2.0
    camera.data.ortho_scale = max((max_y - min_y) / 0.975,
                                  (max_x - min_x) / aspect / 0.975)
    camera.data.shift_x = ((min_x + max_x) / 2) / camera.data.ortho_scale
    camera.data.shift_y = ((min_y + max_y) / 2) / camera.data.ortho_scale
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)
    root.location = arranged


def set_depleted(road) -> None:
    for collection in road.MODEL_COLLECTIONS.values():
        for obj in collection.all_objects:
            if not hasattr(obj.data, "materials") or not obj.data.materials:
                continue
            material = obj.data.materials[0]
            if material and material.name == "vein_energy_highlight":
                obj.data.materials[0] = road.MATERIALS["vein_depleted_highlight"]
            elif material and material.name == "vein_energy":
                obj.data.materials[0] = road.MATERIALS["vein_depleted"]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    LIVE_OUT.mkdir(parents=True, exist_ok=True)
    DEPLETED_OUT.mkdir(parents=True, exist_ok=True)
    road = load_road_builder()
    road.clear_scene()
    setup_materials(road)
    scene, camera = road.setup_scene()
    names = [build_mask(road, mask) for mask in range(16)]
    for collection in road.MODEL_COLLECTIONS.values():
        collection.hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))
    for mask, name in enumerate(names):
        render_frame(road, name, scene, camera, LIVE_OUT / f"energy_vein_mask_{mask:02d}.png")
    set_depleted(road)
    for mask, name in enumerate(names):
        render_frame(road, name, scene, camera, DEPLETED_OUT / f"energy_vein_mask_{mask:02d}.png")

    manifest = {
        "version": 1,
        "status": "directional_model_sources",
        "reference": "tools/ai-gen/_world122_street_decor_20260825/world122_street_decor.blend",
        "bits": {"iPositive": 1, "iNegative": 2, "jPositive": 4, "jNegative": 8},
        "camera": {
            "projection": "orthographic",
            "elevation": road.CAMERA_ELEVATION_DEG,
            "modelRootRotationZ": road.ROOT_ROTATION_DEG,
            "sourceFrame": [1024, 512],
            "runtimeFrame": [128, 64],
            "postWarp": False,
        },
        "model": str(BLEND_OUT.relative_to(REPO)).replace("\\", "/"),
        "liveFrames": str(LIVE_OUT.relative_to(REPO)).replace("\\", "/"),
        "depletedFrames": str(DEPLETED_OUT.relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Built 16 directional live/depleted source frames in {OUT}")


if __name__ == "__main__":
    main()
