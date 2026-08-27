"""Build 18 low-luminance visual-only props for the zombie-dungeon brick floor.

Uses the accepted World-122 street/decor camera contract: orthographic 30-degree
camera, 44.8-degree model-root rotation, and one fixed prop camera scale. Runtime
supplies a mathematically periodic black square paver base and collision-free
world-grid placement; the rejected white rubble detail layer is not generated.
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
OUT = REPO / "tools" / "ai-gen" / "_zombie_dungeon_terrain_20260826"
PROP_OUT = OUT / "props"
BLEND_OUT = OUT / "zombie_dungeon_terrain.blend"


def load_street_helpers():
    spec = importlib.util.spec_from_file_location("world122_street_helpers", SOURCE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


S = load_street_helpers()


def setup_materials():
    S.material("dungeon_anchor", (0.0, 0.0, 0.0), 1.0, alpha=0.0)
    S.material("dungeon_stone_0", (0.105, 0.115, 0.12), 0.98)
    S.material("dungeon_stone_1", (0.12, 0.13, 0.13), 0.98)
    S.material("dungeon_stone_2", (0.075, 0.083, 0.087), 1.0)
    S.material("dungeon_mortar", (0.13, 0.125, 0.11), 1.0)
    S.material("dungeon_iron", (0.09, 0.08, 0.07), 0.82, metallic=0.58)
    S.material("dungeon_rust", (0.24, 0.095, 0.045), 0.93, metallic=0.32)
    S.material("dungeon_bone", (0.27, 0.25, 0.19), 1.0)
    S.material("dungeon_bone_dark", (0.17, 0.16, 0.13), 1.0)
    S.material("dungeon_clay", (0.31, 0.16, 0.095), 0.98)
    S.material("dungeon_clay_dark", (0.17, 0.08, 0.05), 1.0)
    S.material("dungeon_rope", (0.25, 0.18, 0.10), 1.0)
    S.material("dungeon_cloth", (0.19, 0.12, 0.10), 1.0)
    S.material("dungeon_cloth_dark", (0.085, 0.07, 0.07), 1.0)
    S.material("dungeon_wax", (0.34, 0.25, 0.14), 0.98)
    S.material("dungeon_parchment", (0.28, 0.23, 0.16), 1.0)
    S.material("dungeon_moss", (0.10, 0.16, 0.09), 1.0)
    S.material("dungeon_coin", (0.34, 0.25, 0.10), 0.72, metallic=0.48)


def start(name: str, x: float, y: float):
    S.new_model(name, (x, y, 0))
    S.add_shadow(2.2, 1.25, 0.006)
    return name


def loose_cobbles():
    name = start("dungeon_prop_loose_cobbles", 0, -6)
    rng = random.Random(71331)
    for i in range(11):
        x, y = rng.uniform(-0.9, 0.9), rng.uniform(-0.45, 0.45)
        s = rng.uniform(0.11, 0.24)
        S.sphere(f"{name}_Stone_{i}", (x, y, s * 0.38),
                 (s * rng.uniform(0.8, 1.35), s, s * 0.38), f"dungeon_stone_{i % 3}")
    return name


def brick_fragments():
    name = start("dungeon_prop_brick_fragments", 5, -6)
    rng = random.Random(71332)
    for i in range(7):
        w, d, h = rng.uniform(0.28, 0.55), rng.uniform(0.16, 0.28), rng.uniform(0.10, 0.20)
        S.box(f"{name}_Brick_{i}", (rng.uniform(-0.78, 0.78), rng.uniform(-0.38, 0.38), h / 2),
              (w, d, h), f"dungeon_stone_{i % 3}",
              rotation=(0, 0, rng.uniform(-math.pi, math.pi)), bevel=0.035)
    return name


def mortar_rubble():
    name = start("dungeon_prop_mortar_rubble", 10, -6)
    rng = random.Random(71333)
    for i in range(15):
        s = rng.uniform(0.06, 0.16)
        S.sphere(f"{name}_Chip_{i}", (rng.uniform(-0.85, 0.85), rng.uniform(-0.42, 0.42), s * 0.35),
                 (s * 1.3, s, s * 0.35), "dungeon_mortar")
    return name


def broken_chain():
    name = start("dungeon_prop_broken_chain", 15, -6)
    for i, (x, y, angle) in enumerate(((-0.65, -0.1, 12), (-0.25, 0.05, -18),
                                        (0.18, 0.0, 22), (0.58, 0.18, -9))):
        S.torus(f"{name}_Link_{i}", (x, y, 0.10), 0.19, 0.04, "dungeon_iron",
                rotation=(math.radians(72), 0, math.radians(angle)))
    return name


def iron_nails():
    name = start("dungeon_prop_iron_nails", 20, -6)
    for i, (x, y, angle) in enumerate(((-0.55, -0.18, 15), (-0.12, 0.16, -24),
                                        (0.32, -0.05, 38), (0.65, 0.20, -8), (0.58, -0.28, 12))):
        rot = (0, math.radians(90), math.radians(angle))
        S.cylinder(f"{name}_Nail_{i}", (x, y, 0.08), 0.035, 0.52,
                   "dungeon_rust", rotation=rot, vertices=10, bevel=0.012)
        S.cylinder(f"{name}_Head_{i}", (x - math.cos(math.radians(angle)) * 0.24,
                                         y - math.sin(math.radians(angle)) * 0.24, 0.09),
                   0.075, 0.035, "dungeon_iron", vertices=10, bevel=0.01)
    return name


def broken_shackles():
    name = start("dungeon_prop_broken_shackles", 25, -6)
    for side in (-1, 1):
        S.torus(f"{name}_Ring_{side}", (side * 0.44, 0, 0.12), 0.32, 0.065,
                "dungeon_rust", rotation=(math.radians(76), 0, math.radians(side * 14)))
    S.curve(f"{name}_Chain", [(-0.16, 0.02, 0.12), (0, 0.18, 0.13), (0.18, 0.04, 0.12)],
            0.055, "dungeon_iron")
    return name


def bone_splinters():
    name = start("dungeon_prop_bone_splinters", 0, -11)
    for i, (x, y, length, angle) in enumerate(((-0.58, -0.12, 0.62, 15), (0.05, 0.18, 0.78, -22),
                                                (0.62, -0.15, 0.45, 34))):
        S.cylinder(f"{name}_Bone_{i}", (x, y, 0.09), 0.055, length, "dungeon_bone",
                   rotation=(0, math.radians(90), math.radians(angle)), vertices=10, bevel=0.02)
    return name


def skull_shards():
    name = start("dungeon_prop_skull_shards", 5, -11)
    S.sphere(f"{name}_Crown", (-0.18, 0, 0.18), (0.42, 0.33, 0.23), "dungeon_bone")
    for i, (x, y, w, d, angle) in enumerate(((0.36, -0.17, 0.34, 0.22, 18),
                                               (0.48, 0.17, 0.28, 0.20, -23),
                                               (-0.55, 0.24, 0.25, 0.16, 31))):
        S.box(f"{name}_Shard_{i}", (x, y, 0.055), (w, d, 0.075), "dungeon_bone_dark",
              rotation=(0, 0, math.radians(angle)), bevel=0.04)
    return name


def torn_cloth():
    name = start("dungeon_prop_torn_cloth", 10, -11)
    for i, (x, y, w, d, angle) in enumerate(((-0.35, -0.08, 0.92, 0.32, -12),
                                               (0.25, 0.12, 0.76, 0.28, 19),
                                               (0.58, -0.18, 0.45, 0.22, -31))):
        S.box(f"{name}_Strip_{i}", (x, y, 0.045 + i * 0.015), (w, d, 0.05),
              "dungeon_cloth" if i % 2 == 0 else "dungeon_cloth_dark",
              rotation=(0, 0, math.radians(angle)), bevel=0.08)
    return name


def rope_coil():
    name = start("dungeon_prop_rope_coil", 15, -11)
    for i, radius in enumerate((0.28, 0.42, 0.56)):
        S.torus(f"{name}_Loop_{i}", (0, 0, 0.07 + i * 0.018), radius, 0.045, "dungeon_rope")
    S.curve(f"{name}_Tail", [(0.52, -0.08, 0.09), (0.76, -0.30, 0.075), (0.96, -0.12, 0.06)],
            0.04, "dungeon_rope")
    return name


def wax_drips():
    name = start("dungeon_prop_wax_drips", 20, -11)
    for i, (x, y, r) in enumerate(((-0.48, -0.08, 0.25), (-0.08, 0.08, 0.31),
                                     (0.35, -0.02, 0.22), (0.58, 0.18, 0.14))):
        S.sphere(f"{name}_Drip_{i}", (x, y, 0.035), (r, r * 0.55, 0.045), "dungeon_wax")
    return name


def broken_pottery():
    name = start("dungeon_prop_broken_pottery", 25, -11)
    S.cone(f"{name}_Body", (-0.25, 0, 0.28), 0.44, 0.28, 0.55, "dungeon_clay",
           rotation=(math.radians(72), 0, math.radians(-14)), vertices=14)
    S.torus(f"{name}_Rim", (0.02, -0.03, 0.25), 0.30, 0.05, "dungeon_clay_dark",
            rotation=(math.radians(72), 0, math.radians(-14)))
    for i, (x, y, a) in enumerate(((0.52, -0.22, 18), (0.64, 0.16, -24), (0.30, 0.36, 37))):
        S.box(f"{name}_Shard_{i}", (x, y, 0.05), (0.30, 0.20, 0.07), "dungeon_clay_dark",
              rotation=(0, 0, math.radians(a)), bevel=0.025)
    return name


def rusty_plate():
    name = start("dungeon_prop_rusty_plate", 0, -16)
    S.box(f"{name}_Plate", (0, 0, 0.075), (1.35, 0.70, 0.09), "dungeon_rust",
          rotation=(0, math.radians(-7), math.radians(18)), bevel=0.055)
    for i, (x, y) in enumerate(((-0.46, -0.19), (0.02, 0.15), (0.47, -0.08))):
        S.cylinder(f"{name}_Rivet_{i}", (x, y, 0.14), 0.06, 0.045, "dungeon_iron", vertices=10)
    return name


def key_ring():
    name = start("dungeon_prop_key_ring", 5, -16)
    S.torus(f"{name}_Ring", (-0.35, 0, 0.10), 0.26, 0.045, "dungeon_iron",
            rotation=(math.radians(76), 0, math.radians(12)))
    for i, (x, y, angle, length) in enumerate(((0.02, -0.13, 12, 0.68), (0.20, 0.08, -18, 0.60),
                                                (0.38, 0.22, 29, 0.52))):
        S.cylinder(f"{name}_Key_{i}", (x, y, 0.09), 0.04, length, "dungeon_rust",
                   rotation=(0, math.radians(90), math.radians(angle)), vertices=10)
        S.box(f"{name}_Tooth_{i}", (x + math.cos(math.radians(angle)) * length * 0.43,
                                     y + math.sin(math.radians(angle)) * length * 0.43, 0.10),
              (0.16, 0.12, 0.06), "dungeon_iron", rotation=(0, 0, math.radians(angle)), bevel=0.015)
    return name


def coin_scatter():
    name = start("dungeon_prop_coin_scatter", 10, -16)
    rng = random.Random(71345)
    for i in range(9):
        S.cylinder(f"{name}_Coin_{i}", (rng.uniform(-0.78, 0.78), rng.uniform(-0.38, 0.38),
                                         0.035 + (i % 3) * 0.018), 0.12, 0.035,
                   "dungeon_coin", vertices=16, bevel=0.008)
    return name


def torn_parchment():
    name = start("dungeon_prop_torn_parchment", 15, -16)
    S.box(f"{name}_Sheet", (-0.12, 0, 0.045), (1.25, 0.72, 0.045), "dungeon_parchment",
          rotation=(0, 0, math.radians(-11)), bevel=0.10)
    S.curve(f"{name}_Curl", [(0.38, -0.28, 0.08), (0.62, -0.20, 0.12), (0.70, -0.05, 0.07)],
            0.035, "dungeon_parchment")
    return name


def damp_moss():
    name = start("dungeon_prop_damp_moss", 20, -16)
    rng = random.Random(71347)
    for i in range(18):
        x, y = rng.uniform(-0.72, 0.72), rng.uniform(-0.36, 0.36)
        S.curve(f"{name}_Stem_{i}", [(x, y, 0.025), (x + rng.uniform(-0.12, 0.12),
                                                 y + rng.uniform(-0.08, 0.08), rng.uniform(0.10, 0.24))],
                0.018, "dungeon_moss")
    return name


def rat_bones():
    name = start("dungeon_prop_rat_bones", 25, -16)
    S.curve(f"{name}_Spine", [(-0.62, 0, 0.08), (-0.10, 0.03, 0.11), (0.48, -0.02, 0.07)],
            0.035, "dungeon_bone_dark")
    for i, x in enumerate((-0.38, -0.15, 0.08, 0.30)):
        S.curve(f"{name}_Rib_{i}", [(x, -0.22, 0.05), (x, 0, 0.22), (x, 0.22, 0.05)],
                0.023, "dungeon_bone")
    S.sphere(f"{name}_Skull", (0.62, 0, 0.12), (0.22, 0.17, 0.16), "dungeon_bone")
    return name


def bent_grate():
    name = start("dungeon_prop_bent_grate", 0, -21)
    for i, y in enumerate((-0.30, 0.30)):
        S.box(f"{name}_Rail_{i}", (0, y, 0.08), (1.45, 0.09, 0.09), "dungeon_iron",
              rotation=(0, math.radians(i * 3), math.radians(-7)), bevel=0.025)
    for i, x in enumerate((-0.55, -0.18, 0.20, 0.56)):
        S.box(f"{name}_Bar_{i}", (x, 0, 0.10 + (i % 2) * 0.025), (0.08, 0.72, 0.08),
              "dungeon_rust", rotation=(0, 0, math.radians(-7 + i * 2)), bevel=0.02)
    return name


def cracked_wood():
    name = start("dungeon_prop_cracked_wood", 5, -21)
    S.box(f"{name}_PlankA", (-0.18, -0.08, 0.09), (1.45, 0.30, 0.13), "dungeon_rope",
          rotation=(0, 0, math.radians(14)), bevel=0.035)
    S.box(f"{name}_PlankB", (0.24, 0.18, 0.08), (1.05, 0.25, 0.11), "dungeon_cloth_dark",
          rotation=(0, 0, math.radians(-19)), bevel=0.035)
    for i, x in enumerate((-0.42, 0.15, 0.48)):
        S.cylinder(f"{name}_Nail_{i}", (x, 0, 0.17), 0.035, 0.05, "dungeon_iron", vertices=10)
    return name


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PROP_OUT.mkdir(parents=True, exist_ok=True)
    S.clear_scene()
    S.setup_materials()
    setup_materials()
    scene, camera = S.setup_scene()

    tile_names = []
    prop_names = [
        loose_cobbles(), brick_fragments(), mortar_rubble(), broken_chain(), iron_nails(),
        broken_shackles(), bone_splinters(), skull_shards(), torn_cloth(), rope_coil(),
        wax_drips(), broken_pottery(), rusty_plate(), key_ring(), coin_scatter(),
        torn_parchment(), damp_moss(), rat_bones(),
    ]

    for collection in S.MODEL_COLLECTIONS.values():
        collection.hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))
    for name in prop_names:
        S.render_model(name, PROP_OUT / f"{name}.png", "prop", scene, camera)

    manifest = {
        "version": 1,
        "camera": {
            "projection": "orthographic",
            "elevation": S.CAMERA_ELEVATION_DEG,
            "modelRootRotationZ": S.ROOT_ROTATION_DEG,
            "tileProjection": "removed: no high-frequency rubble detail atlas",
            "propOrthoScale": S.PROP_ORTHO_SCALE,
            "propBottomRatio": S.PROP_BOTTOM_RATIO,
        },
        "baseContract": "mathematically seamless building-standard 2:1 black square paver grid; 26.565-degree axes, 128x64 brick period and 1024x512 texture period; material language sampled from legacy blackbrick.png",
        "collisionContract": "all 18 props are floor-baked visual-only decorations",
        "tiles": tile_names,
        "props": prop_names,
        "model": str(BLEND_OUT.relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Rendered {len(tile_names)} detail tiles and {len(prop_names)} props to {OUT}")


if __name__ == "__main__":
    main()
