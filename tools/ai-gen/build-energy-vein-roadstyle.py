"""Build road-style World-122 energy-vein model and texture candidates.

This is intentionally an isolated candidate pipeline.  It reuses the latest
street master's orthographic camera, 44.8-degree model root, stone scale,
bevel language, color management and neutral lighting, but does not overwrite
the accepted runtime energy-node textures.

Run with Blender 5.1 from the repository root:

    blender --background --factory-startup --python \
      tools/ai-gen/build-energy-vein-roadstyle.py
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[2]
ROAD_BUILDER_PATH = REPO / "tools" / "ai-gen" / "build-world122-street-decor.py"
OUT = REPO / "tools" / "ai-gen" / "_energy_vein_roadstyle_20260826"

VARIANTS = {
    1: {
        "label": "diagonal_fissure",
        "seams": [
            [(-1.72, 1.18, 0.24), (-1.05, 0.75, 0.24), (-0.52, 0.38, 0.25),
             (0.05, -0.05, 0.25), (0.72, -0.45, 0.24), (1.68, -1.12, 0.24)],
            [(-0.15, 0.10, 0.255), (0.18, 0.58, 0.25), (0.52, 0.88, 0.245)],
        ],
        "ore_cells": {(0, -1), (1, -1), (1, 0), (2, 0), (2, 1), (3, 1), (4, 2)},
        "rubble": [(-1.48, -0.42, 0.54, 0.36, -12), (1.35, 0.64, 0.48, 0.32, 18)],
    },
    2: {
        "label": "central_pocket",
        "seams": [
            [(-1.35, 0.18, 0.24), (-0.72, 0.08, 0.25), (-0.18, -0.02, 0.26),
             (0.35, 0.02, 0.26), (0.88, 0.20, 0.25), (1.42, 0.52, 0.24)],
            [(-0.62, 0.08, 0.25), (-0.42, 0.72, 0.245), (-0.16, 1.18, 0.24)],
            [(0.42, 0.08, 0.25), (0.32, -0.55, 0.245), (0.62, -1.18, 0.24)],
        ],
        "ore_cells": {(1, -1), (1, 0), (2, -1), (2, 0), (2, 1), (3, -1), (3, 0)},
        "rubble": [(-1.52, 0.86, 0.50, 0.34, 22), (1.46, -0.82, 0.56, 0.32, -16)],
    },
    3: {
        "label": "branching_y",
        "seams": [
            [(0.02, -1.72, 0.24), (0.02, -0.96, 0.245), (0.0, -0.30, 0.255),
             (-0.12, 0.18, 0.26)],
            [(-0.12, 0.18, 0.26), (-0.64, 0.60, 0.25), (-1.10, 0.92, 0.245),
             (-1.60, 1.30, 0.24)],
            [(-0.12, 0.18, 0.26), (0.48, 0.58, 0.25), (0.96, 0.92, 0.245),
             (1.52, 1.26, 0.24)],
        ],
        "ore_cells": {(0, -1), (1, -1), (1, 0), (2, -1), (2, 0), (2, 1), (3, 0), (3, 1), (4, 1)},
        "rubble": [(-1.52, -0.64, 0.48, 0.33, -8), (1.42, -0.48, 0.52, 0.35, 14)],
    },
}


def load_road_builder():
    spec = importlib.util.spec_from_file_location("world122_street_master", ROAD_BUILDER_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load road master: {ROAD_BUILDER_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def add_candidate_materials(road) -> None:
    # Keep the newest road palette as the visual parent, shifting only the
    # resource bed toward cooler charcoal so the deposit reads as ore.
    road.material("vein_mortar", (0.205, 0.205, 0.195), 0.98)
    for index, color in enumerate([
        (0.38, 0.39, 0.37),
        (0.43, 0.43, 0.40),
        (0.34, 0.35, 0.34),
        (0.47, 0.46, 0.41),
        (0.30, 0.32, 0.32),
        (0.41, 0.40, 0.36),
    ]):
        road.material(f"vein_stone_{index}", color, 0.95)
    road.material("vein_crack", (0.075, 0.095, 0.095), 1.0)
    road.material("vein_depleted", (0.20, 0.225, 0.23), 0.88, metallic=0.04)
    road.material("vein_depleted_highlight", (0.33, 0.35, 0.34), 0.9)
    road.emissive_material("vein_energy", (0.018, 0.19, 0.235), strength=0.42,
                           roughness=0.48)
    road.emissive_material("vein_energy_highlight", (0.04, 0.34, 0.38), strength=0.72,
                           roughness=0.42)


def add_plate(road, name: str, x: float, y: float, width: float, depth: float,
              height: float, material: str, angle_deg: float = 0.0):
    return road.box(
        name,
        (x, y, 0.09 + height / 2),
        (width, depth, height),
        material,
        rotation=(0, 0, math.radians(angle_deg)),
        bevel=0.025,
    )


def build_variant(road, variant: int) -> str:
    spec = VARIANTS[variant]
    name = f"energy_vein_roadstyle_{variant}"
    road.new_model(name, (0, 0, 0))

    # Same complete square construction and thickness as the newest road tile;
    # the shared 44.8-degree root projects it directly into a 2:1 diamond.
    road.box(f"{name}_OneCellBed", (0, 0, 0.02), (4.0, 4.0, 0.08),
             "vein_mortar", bevel=0)

    row_height = 0.8
    plate_width = 0.8
    for row in range(5):
        y0 = -2.0 + row * row_height
        shift = plate_width / 2 if row % 2 else 0.0
        column = -4
        while column < 8:
            x0 = column * plate_width + shift
            left = max(-2.0, x0)
            right = min(2.0, x0 + plate_width)
            if right - left > 0.08:
                logical_col = int(round((left + right) / 2 / plate_width + 2))
                cell = (logical_col, row - 2)
                is_ore = cell in spec["ore_cells"]
                material = ("vein_energy_highlight" if (row + column + variant) % 3 == 0
                            else "vein_energy") if is_ore else f"vein_stone_{(variant * 5 + row * 3 + column) % 6}"
                height = 0.115 + (0.018 if is_ore else ((row + column + variant) % 3) * 0.006)
                add_plate(
                    road,
                    f"{name}_{'Ore' if is_ore else 'Stone'}_{row}_{column}",
                    (left + right) / 2,
                    y0 + row_height / 2,
                    max(0.02, right - left - 0.05),
                    row_height - 0.05,
                    height,
                    material,
                    angle_deg=(0.45 if is_ore else 0.0) * ((row + column) % 3 - 1),
                )
            column += 1

    # The energy seam uses the road master's own poly-curve language: it is
    # broad enough to survive 48px presentation, but remains below the plates.
    for seam_index, seam in enumerate(spec["seams"]):
        # The dark fracture sits below the plate tops and is visible only in
        # their gaps.  The thinner cyan trace stays above it, so the silhouette
        # reads as a mineral seam instead of a pipe laid over the surface.
        shadow_points = [(x, y, 0.17) for x, y, _z in seam]
        road.curve(f"{name}_Fracture_{seam_index}", shadow_points, 0.040,
                   "vein_crack")
        road.curve(f"{name}_EnergySeam_{seam_index}", seam, 0.030,
                   "vein_energy_highlight")

    for rubble_index, (x, y, width, depth, angle) in enumerate(spec["rubble"]):
        add_plate(road, f"{name}_LowRubble_{rubble_index}", x, y, width, depth,
                  0.14, f"vein_stone_{(variant + rubble_index + 2) % 6}", angle)
    return name


def collection_camera_bounds(collection, camera):
    bpy.context.view_layer.update()
    inverse = camera.matrix_world.inverted()
    points = []
    for obj in collection.all_objects:
        if obj.type != "MESH":
            continue
        points.extend(inverse @ (obj.matrix_world @ Vector(corner)) for corner in obj.bound_box)
    return (min(point.x for point in points), max(point.x for point in points),
            min(point.y for point in points), max(point.y for point in points))


def render_candidate(road, name: str, scene, camera, path: Path) -> None:
    collection = road.MODEL_COLLECTIONS[name]
    root = road.MODEL_ROOTS[name]
    root.location = (0, 0, 0)
    bpy.context.view_layer.update()
    scene.render.resolution_x = 1024
    scene.render.resolution_y = 512
    min_x, max_x, min_y, max_y = collection_camera_bounds(collection, camera)
    aspect = scene.render.resolution_x / scene.render.resolution_y
    camera.data.ortho_scale = max((max_y - min_y) / 0.975,
                                  (max_x - min_x) / aspect / 0.975)
    camera.data.shift_x = ((min_x + max_x) / 2) / camera.data.ortho_scale
    camera.data.shift_y = ((min_y + max_y) / 2) / camera.data.ortho_scale
    path.parent.mkdir(parents=True, exist_ok=True)
    scene.render.filepath = str(path)
    bpy.ops.render.render(write_still=True)


def set_depleted_materials(road, name: str) -> None:
    collection = road.MODEL_COLLECTIONS[name]
    for obj in collection.all_objects:
        if not hasattr(obj.data, "materials") or not obj.data.materials:
            continue
        current = obj.data.materials[0]
        if current and current.name == "vein_energy_highlight":
            obj.data.materials[0] = road.MATERIALS["vein_depleted_highlight"]
        elif current and current.name == "vein_energy":
            obj.data.materials[0] = road.MATERIALS["vein_depleted"]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    road = load_road_builder()
    outputs = []
    for variant in sorted(VARIANTS):
        road.MODEL_COLLECTIONS.clear()
        road.MODEL_ROOTS.clear()
        road.MATERIALS.clear()
        road.clear_scene()
        road.setup_materials()
        add_candidate_materials(road)
        scene, camera = road.setup_scene()
        name = build_variant(road, variant)
        variant_dir = OUT / name
        variant_dir.mkdir(parents=True, exist_ok=True)
        blend_path = variant_dir / f"{name}_model.blend"
        live_path = variant_dir / f"{name}_live.png"
        depleted_path = variant_dir / f"{name}_depleted.png"
        bpy.ops.wm.save_as_mainfile(filepath=str(blend_path))
        render_candidate(road, name, scene, camera, live_path)
        set_depleted_materials(road, name)
        render_candidate(road, name, scene, camera, depleted_path)
        outputs.append({
            "id": name,
            "label": VARIANTS[variant]["label"],
            "model": str(blend_path.relative_to(REPO)).replace("\\", "/"),
            "live": str(live_path.relative_to(REPO)).replace("\\", "/"),
            "depleted": str(depleted_path.relative_to(REPO)).replace("\\", "/"),
        })

    manifest = {
        "version": 1,
        "status": "candidate_only_not_installed",
        "reference": "tools/ai-gen/_world122_street_decor_20260825/world122_street_decor.blend",
        "camera": {
            "projection": "orthographic",
            "elevation": road.CAMERA_ELEVATION_DEG,
            "modelRootRotationZ": road.ROOT_ROTATION_DEG,
            "output": [1024, 512],
            "runtimeProjection": "one 128x64 cell; no post-warp",
        },
        "style": {
            "materialParent": "latest modeled road palette and bevel scale",
            "lightingParent": "World122_Street_Neutral_World",
            "liveEnergy": "restrained cyan seams; no bloom",
            "depleted": "same geometry; cool gray non-emissive material",
        },
        "variants": outputs,
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"Built {len(outputs)} isolated road-style energy-vein candidates in {OUT}")


if __name__ == "__main__":
    main()
