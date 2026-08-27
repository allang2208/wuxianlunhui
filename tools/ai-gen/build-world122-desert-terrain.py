"""Build World-122 desert terrain detail tiles and small ground props.

The script reuses the accepted street-workflow camera/material helpers:
orthographic 30-degree camera, 44.8-degree model root, exact 2:1 tile renders,
and one fixed prop camera scale. Terrain tiles contain details only; the
runtime keeps a world-aligned seamless sand layer below them to prevent seams.
"""

from __future__ import annotations

import importlib.util
import json
import math
import random
from pathlib import Path

import bpy


REPO = Path(__file__).resolve().parents[2]
SOURCE_SCRIPT = REPO / "tools" / "ai-gen" / "build-world122-street-decor.py"
OUT = REPO / "tools" / "ai-gen" / "_world122_desert_terrain_20260826"
TILE_OUT = OUT / "tile_frames"
PROP_OUT = OUT / "props"
BLEND_OUT = OUT / "world122_desert_terrain.blend"


def load_street_helpers():
    spec = importlib.util.spec_from_file_location("world122_street_helpers", SOURCE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


S = load_street_helpers()


def setup_desert_materials():
    S.material("desert_anchor", (0.0, 0.0, 0.0), 1.0, alpha=0.0)
    S.material("desert_stone_0", (0.36, 0.30, 0.23), 0.98)
    S.material("desert_stone_1", (0.47, 0.37, 0.25), 0.97)
    S.material("desert_stone_2", (0.27, 0.25, 0.22), 0.98)
    S.material("desert_wood", (0.22, 0.125, 0.065), 1.0)
    S.material("desert_wood_light", (0.35, 0.22, 0.11), 0.98)
    S.material("desert_bone", (0.72, 0.68, 0.54), 0.94)
    S.material("desert_bone_dark", (0.47, 0.43, 0.32), 0.98)
    S.material("desert_clay", (0.48, 0.24, 0.12), 0.96)
    S.material("desert_clay_dark", (0.30, 0.135, 0.075), 0.98)
    S.material("desert_sandstone", (0.55, 0.39, 0.22), 0.98)
    S.material("desert_sandstone_light", (0.69, 0.52, 0.31), 0.96)
    S.material("desert_grass", (0.31, 0.27, 0.12), 1.0)
    S.material("desert_thorn", (0.18, 0.15, 0.075), 1.0)
    S.material("desert_rust", (0.31, 0.13, 0.055), 0.92, metallic=0.42)
    S.material("desert_metal", (0.24, 0.23, 0.20), 0.86, metallic=0.55)
    S.material("desert_rope", (0.37, 0.27, 0.14), 1.0)
    S.material("desert_cloth", (0.39, 0.28, 0.18), 0.98)
    S.material("desert_cloth_dark", (0.22, 0.18, 0.13), 1.0)
    S.material("desert_salt", (0.70, 0.68, 0.60), 0.78)


def pebble_tile_model(index: int):
    name = f"desert_detail_pebbles_{index:02d}"
    S.new_model(name, (index * 5.5, 0, 0))
    S.box(f"{name}_ProjectionAnchor", (0, 0, 0.003), (4.0, 4.0, 0.006),
          "desert_anchor", bevel=0)
    rng = random.Random(122804 + index)
    for pebble in range(12 + index * 4):
        x = rng.uniform(-1.55, 1.55)
        y = rng.uniform(-1.45, 1.45)
        scale = rng.uniform(0.055, 0.14)
        S.sphere(f"{name}_Pebble_{pebble}", (x, y, scale * 0.42),
                 (scale * rng.uniform(0.8, 1.35), scale, scale * 0.42),
                 f"desert_stone_{pebble % 3}")
    return name


def pebble_prop(index: int):
    name = f"desert_prop_pebbles_{index}"
    S.new_model(name, (index * 4.8, -6.2, 0))
    rng = random.Random(122860 + index)
    S.add_shadow(2.2, 1.25, 0.006)
    for item in range(8 + index * 3):
        x = rng.uniform(-0.9, 0.9)
        y = rng.uniform(-0.48, 0.48)
        scale = rng.uniform(0.10, 0.24)
        S.sphere(f"{name}_Stone_{item}", (x, y, scale * 0.46),
                 (scale * rng.uniform(0.85, 1.35), scale, scale * 0.46),
                 f"desert_stone_{item % 3}")
    return name


def dry_branch_prop():
    name = "desert_prop_dry_branch"
    S.new_model(name, (10.0, -6.2, 0))
    S.add_shadow(2.4, 1.15, 0.006)
    S.curve(f"{name}_Trunk", [(-1.05, -0.25, 0.13), (-0.45, -0.08, 0.17),
                              (0.18, 0.08, 0.14), (1.0, 0.28, 0.12)],
            0.09, "desert_wood")
    S.curve(f"{name}_ForkA", [(-0.28, -0.02, 0.16), (-0.02, 0.46, 0.20),
                              (0.20, 0.72, 0.16)], 0.055, "desert_wood_light")
    S.curve(f"{name}_ForkB", [(0.30, 0.11, 0.14), (0.56, -0.34, 0.18),
                              (0.82, -0.55, 0.13)], 0.05, "desert_wood")
    return name


def bone_scatter_prop():
    name = "desert_prop_bone_scatter"
    S.new_model(name, (15.0, -6.2, 0))
    S.add_shadow(2.2, 1.2, 0.006)
    bones = [(-0.65, -0.12, 0.52, 12), (0.25, 0.20, 0.62, -18), (0.72, -0.28, 0.38, 34)]
    for index, (x, y, length, angle) in enumerate(bones):
        rot = (0, math.radians(90), math.radians(angle))
        S.cylinder(f"{name}_Bone_{index}", (x, y, 0.10), 0.075, length,
                   "desert_bone", rotation=rot, vertices=12, bevel=0.025)
        dx = math.cos(math.radians(angle)) * length * 0.48
        dy = math.sin(math.radians(angle)) * length * 0.48
        for end, sign in enumerate((-1, 1)):
            S.sphere(f"{name}_Joint_{index}_{end}",
                     (x + dx * sign, y + dy * sign, 0.105),
                     (0.11, 0.085, 0.075), "desert_bone_dark")
    return name


def clay_shards_prop():
    name = "desert_prop_clay_shards"
    S.new_model(name, (20.0, -6.2, 0))
    S.add_shadow(2.0, 1.0, 0.006)
    pieces = [(-0.62, -0.18, 0.48, 0.31, 18), (-0.10, 0.14, 0.38, 0.27, -12),
              (0.40, -0.08, 0.52, 0.24, 31), (0.72, 0.22, 0.30, 0.22, -28)]
    for index, (x, y, w, d, angle) in enumerate(pieces):
        S.box(f"{name}_Shard_{index}", (x, y, 0.06), (w, d, 0.09),
              "desert_clay" if index % 2 == 0 else "desert_clay_dark",
              rotation=(0, 0, math.radians(angle)), bevel=0.025)
    return name


def dead_root_prop():
    name = "desert_prop_dead_root"
    S.new_model(name, (25.0, -6.2, 0))
    S.add_shadow(2.4, 1.3, 0.006)
    S.curve(f"{name}_Core", [(-0.75, 0, 0.12), (-0.15, 0.02, 0.20),
                             (0.45, -0.02, 0.15)], 0.105, "desert_wood")
    roots = [(-0.28, 0.12, -0.90, 0.55), (-0.02, 0.10, 0.18, 0.72),
             (0.22, 0.08, 0.92, 0.45), (0.18, -0.02, 0.58, -0.68)]
    for index, (x, y, ex, ey) in enumerate(roots):
        S.curve(f"{name}_Root_{index}", [(x, y, 0.14),
                                         ((x + ex) * 0.5, (y + ey) * 0.5, 0.10),
                                         (ex, ey, 0.055)], 0.045,
                "desert_wood_light" if index % 2 else "desert_wood")
    return name


def stone_slab_prop():
    name = "desert_prop_stone_slab"
    S.new_model(name, (0.0, -11.0, 0))
    S.add_shadow(2.3, 1.25, 0.006)
    slabs = [(-0.32, 0.02, 1.18, 0.70, 11, 0.13),
             (0.38, 0.16, 0.78, 0.48, -17, 0.20),
             (-0.52, -0.28, 0.52, 0.34, 28, 0.18)]
    for index, (x, y, w, d, angle, z) in enumerate(slabs):
        S.box(f"{name}_Slab_{index}", (x, y, z / 2), (w, d, z),
              f"desert_stone_{index % 3}", rotation=(0, 0, math.radians(angle)),
              bevel=0.055)
    return name


def sandstone_chunks_prop():
    name = "desert_prop_sandstone_chunks"
    S.new_model(name, (5.0, -11.0, 0))
    S.add_shadow(2.25, 1.30, 0.006)
    chunks = [(-0.62, -0.12, 0.48, 0.40, 0.32, 13),
              (-0.12, 0.17, 0.62, 0.46, 0.44, -9),
              (0.48, -0.15, 0.50, 0.36, 0.27, 24),
              (0.72, 0.22, 0.28, 0.24, 0.20, -16)]
    for index, (x, y, w, d, h, angle) in enumerate(chunks):
        S.box(f"{name}_Chunk_{index}", (x, y, h / 2), (w, d, h),
              "desert_sandstone_light" if index % 2 else "desert_sandstone",
              rotation=(0, 0, math.radians(angle)), bevel=0.075)
    return name


def thorn_scrub_prop():
    name = "desert_prop_thorn_scrub"
    S.new_model(name, (10.0, -11.0, 0))
    S.add_shadow(2.4, 1.35, 0.006)
    spokes = [(-0.95, -0.32, 0.18), (-0.72, 0.45, 0.30), (-0.20, 0.80, 0.42),
              (0.38, 0.72, 0.35), (0.92, 0.18, 0.24), (0.72, -0.55, 0.31),
              (0.02, -0.78, 0.39), (-0.55, -0.68, 0.28)]
    for index, (x, y, z) in enumerate(spokes):
        S.curve(f"{name}_Spoke_{index}", [(0, 0, 0.16),
                                           (x * 0.56, y * 0.56, z + 0.09),
                                           (x, y, z * 0.55)],
                0.035 if index % 2 else 0.045, "desert_thorn")
    S.sphere(f"{name}_Core", (0, 0, 0.18), (0.25, 0.22, 0.18), "desert_wood")
    return name


def grass_tuft_prop():
    name = "desert_prop_dry_grass_tuft"
    S.new_model(name, (15.0, -11.0, 0))
    S.add_shadow(1.8, 1.05, 0.006)
    rng = random.Random(122891)
    for index in range(15):
        x = rng.uniform(-0.24, 0.24)
        y = rng.uniform(-0.18, 0.18)
        lean_x = rng.uniform(-0.55, 0.55)
        lean_y = rng.uniform(-0.28, 0.28)
        height = rng.uniform(0.48, 0.92)
        S.curve(f"{name}_Blade_{index}", [(x, y, 0.04),
                                           (x + lean_x * 0.42, y + lean_y * 0.42, height * 0.62),
                                           (x + lean_x, y + lean_y, height)],
                0.018 + (index % 3) * 0.004, "desert_grass")
    return name


def animal_skull_prop():
    name = "desert_prop_animal_skull"
    S.new_model(name, (20.0, -11.0, 0))
    S.add_shadow(2.0, 1.1, 0.006)
    S.sphere(f"{name}_Cranium", (-0.08, 0, 0.24), (0.42, 0.32, 0.30), "desert_bone")
    S.box(f"{name}_Snout", (0.40, -0.02, 0.18), (0.62, 0.28, 0.22),
          "desert_bone", rotation=(0, 0, math.radians(7)), bevel=0.08)
    for side in (-1, 1):
        S.curve(f"{name}_Horn_{side}", [(-0.27, side * 0.20, 0.36),
                                         (-0.55, side * 0.46, 0.47),
                                         (-0.83, side * 0.62, 0.34)],
                0.045, "desert_bone_dark")
        S.sphere(f"{name}_Socket_{side}", (0.02, side * 0.22, 0.30),
                 (0.105, 0.055, 0.075), "desert_bone_dark")
    return name


def rib_cage_prop():
    name = "desert_prop_rib_cage"
    S.new_model(name, (25.0, -11.0, 0))
    S.add_shadow(2.5, 1.25, 0.006)
    S.curve(f"{name}_Spine", [(-0.88, 0, 0.12), (0, 0, 0.16), (0.88, 0, 0.13)],
            0.055, "desert_bone_dark")
    for index, x in enumerate((-0.62, -0.30, 0.02, 0.34, 0.66)):
        width = 0.44 - abs(index - 2) * 0.045
        S.curve(f"{name}_Rib_{index}", [(x, -width, 0.08),
                                         (x, 0, 0.42 + (2 - abs(index - 2)) * 0.045),
                                         (x, width, 0.08)],
                0.033, "desert_bone")
    return name


def broken_pot_prop():
    name = "desert_prop_broken_pot"
    S.new_model(name, (0.0, -16.0, 0))
    S.add_shadow(1.9, 1.1, 0.006)
    S.cone(f"{name}_Body", (-0.20, 0, 0.30), 0.46, 0.30, 0.58,
           "desert_clay", rotation=(math.radians(72), 0, math.radians(-12)), vertices=14)
    S.torus(f"{name}_Rim", (0.08, -0.03, 0.27), 0.31, 0.055,
            "desert_clay_dark", rotation=(math.radians(72), 0, math.radians(-12)))
    for index, (x, y, angle) in enumerate(((0.54, -0.24, 18), (0.66, 0.16, -25), (0.34, 0.37, 37))):
        S.box(f"{name}_Shard_{index}", (x, y, 0.055), (0.30, 0.20, 0.075),
              "desert_clay_dark" if index == 1 else "desert_clay",
              rotation=(0, 0, math.radians(angle)), bevel=0.025)
    return name


def weathered_jar_prop():
    name = "desert_prop_weathered_jar"
    S.new_model(name, (5.0, -16.0, 0))
    S.add_shadow(1.7, 1.0, 0.006)
    S.sphere(f"{name}_Body", (0, 0, 0.34), (0.38, 0.34, 0.43), "desert_clay_dark")
    S.cylinder(f"{name}_Neck", (0, 0, 0.78), 0.18, 0.32,
               "desert_clay", vertices=14, bevel=0.025)
    S.torus(f"{name}_Rim", (0, 0, 0.95), 0.20, 0.04, "desert_clay_dark")
    S.curve(f"{name}_Handle", [(0.18, 0, 0.78), (0.45, 0, 0.68),
                                (0.43, 0, 0.42), (0.28, 0, 0.34)],
            0.035, "desert_clay")
    return name


def rusted_scrap_prop():
    name = "desert_prop_rusted_scrap"
    S.new_model(name, (10.0, -16.0, 0))
    S.add_shadow(2.1, 1.15, 0.006)
    S.box(f"{name}_Plate", (-0.18, 0.02, 0.08), (1.18, 0.62, 0.09),
          "desert_rust", rotation=(0, math.radians(-8), math.radians(19)), bevel=0.035)
    S.cylinder(f"{name}_Pipe", (0.48, -0.22, 0.18), 0.10, 0.78,
               "desert_metal", rotation=(0, math.radians(90), math.radians(-18)),
               vertices=12, bevel=0.018)
    for index, (x, y) in enumerate(((-0.48, -0.15), (-0.10, 0.17), (0.32, 0.12))):
        S.cylinder(f"{name}_Rivet_{index}", (x, y, 0.145), 0.055, 0.045,
                   "desert_metal", vertices=10, bevel=0.01)
    return name


def rope_coil_prop():
    name = "desert_prop_rope_coil"
    S.new_model(name, (15.0, -16.0, 0))
    S.add_shadow(1.9, 1.1, 0.006)
    for index, radius in enumerate((0.28, 0.42, 0.56)):
        S.torus(f"{name}_Loop_{index}", (0, 0, 0.07 + index * 0.018),
                radius, 0.045, "desert_rope")
    S.curve(f"{name}_Tail", [(0.53, -0.12, 0.10), (0.78, -0.28, 0.08),
                              (0.96, -0.08, 0.065)], 0.042, "desert_rope")
    return name


def cloth_scrap_prop():
    name = "desert_prop_cloth_scrap"
    S.new_model(name, (20.0, -16.0, 0))
    S.add_shadow(2.0, 1.15, 0.006)
    strips = [(-0.42, -0.12, 0.78, 0.34, -10), (0.18, 0.08, 0.92, 0.30, 22),
              (0.52, -0.22, 0.52, 0.24, -31)]
    for index, (x, y, w, d, angle) in enumerate(strips):
        S.box(f"{name}_Strip_{index}", (x, y, 0.045 + index * 0.018),
              (w, d, 0.055), "desert_cloth" if index % 2 == 0 else "desert_cloth_dark",
              rotation=(0, 0, math.radians(angle)), bevel=0.07)
    S.cylinder(f"{name}_Buckle", (-0.06, 0.03, 0.105), 0.12, 0.045,
               "desert_metal", vertices=10, bevel=0.012)
    return name


def salt_crystals_prop():
    name = "desert_prop_salt_crystals"
    S.new_model(name, (25.0, -16.0, 0))
    S.add_shadow(2.0, 1.15, 0.006)
    crystals = [(-0.48, -0.14, 0.18, 0.44, 8), (-0.18, 0.12, 0.22, 0.62, -6),
                (0.18, -0.05, 0.20, 0.52, 11), (0.46, 0.16, 0.15, 0.38, -12),
                (0.66, -0.20, 0.12, 0.30, 18)]
    for index, (x, y, radius, height, lean) in enumerate(crystals):
        S.cone(f"{name}_Crystal_{index}", (x, y, height / 2), radius, radius * 0.58,
               height, "desert_salt", rotation=(math.radians(lean), 0, math.radians(index * 31)),
               vertices=6)
    return name


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    TILE_OUT.mkdir(parents=True, exist_ok=True)
    PROP_OUT.mkdir(parents=True, exist_ok=True)
    S.clear_scene()
    S.setup_materials()
    setup_desert_materials()
    scene, camera = S.setup_scene()

    tile_names = [pebble_tile_model(index) for index in range(3)]
    prop_names = [
        pebble_prop(0), pebble_prop(1), dry_branch_prop(), bone_scatter_prop(),
        clay_shards_prop(), dead_root_prop(), stone_slab_prop(), sandstone_chunks_prop(),
        thorn_scrub_prop(), grass_tuft_prop(), animal_skull_prop(), rib_cage_prop(),
        broken_pot_prop(), weathered_jar_prop(), rusted_scrap_prop(), rope_coil_prop(),
        cloth_scrap_prop(), salt_crystals_prop(),
    ]

    for collection in S.MODEL_COLLECTIONS.values():
        collection.hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))

    for name in tile_names:
        S.render_model(name, TILE_OUT / f"{name}.png", "road", scene, camera)
    for name in prop_names:
        S.render_model(name, PROP_OUT / f"{name}.png", "prop", scene, camera)

    manifest = {
        "version": 4,
        "camera": {
            "projection": "orthographic",
            "elevation": S.CAMERA_ELEVATION_DEG,
            "modelRootRotationZ": S.ROOT_ROTATION_DEG,
            "tileProjection": "2:1 diamond details only, no post-warp",
            "propOrthoScale": S.PROP_ORTHO_SCALE,
            "propBottomRatio": S.PROP_BOTTOM_RATIO,
        },
        "baseContract": "world-aligned seamless sand remains below transparent details",
        "tiles": tile_names,
        "props": prop_names,
        "model": str(BLEND_OUT.relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Rendered {len(tile_names)} desert detail tiles and {len(prop_names)} props to {OUT}")


if __name__ == "__main__":
    main()
