"""Build four swamp-floor detail cells and 18 visual-only small props.

The camera contract matches the accepted road/desert/dungeon terrain workflow:
orthographic 30-degree camera, 44.8-degree model root, exact 2:1 detail cells,
and a fixed prop camera. Runtime bakes every prop into the floor canvas; props
contain no baked cast-shadow layer.
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
OUT = REPO / "tools" / "ai-gen" / "_swamp_dungeon_terrain_20260826"
TILE_OUT = OUT / "tile_frames"
PROP_OUT = OUT / "props"
BLEND_OUT = OUT / "swamp_dungeon_terrain.blend"


def load_helpers():
    spec = importlib.util.spec_from_file_location("world122_street_helpers", SOURCE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


S = load_helpers()


def setup_materials():
    S.material("swamp_anchor", (0.0, 0.0, 0.0), 1.0, alpha=0.0)
    S.material("swamp_mud_0", (0.12, 0.13, 0.075), 1.0)
    S.material("swamp_mud_1", (0.18, 0.17, 0.09), 0.98)
    S.material("swamp_stone", (0.16, 0.18, 0.14), 0.99)
    S.material("swamp_moss", (0.17, 0.25, 0.075), 1.0)
    S.material("swamp_moss_dark", (0.08, 0.14, 0.045), 1.0)
    S.material("swamp_reed", (0.31, 0.30, 0.105), 1.0)
    S.material("swamp_reed_dark", (0.18, 0.19, 0.065), 1.0)
    S.material("swamp_cattail", (0.20, 0.10, 0.04), 1.0)
    S.material("swamp_leaf", (0.12, 0.25, 0.075), 0.98)
    S.material("swamp_leaf_light", (0.25, 0.37, 0.10), 0.98)
    S.material("swamp_water", (0.07, 0.16, 0.14), 0.72, metallic=0.05)
    S.material("swamp_wood", (0.16, 0.095, 0.045), 1.0)
    S.material("swamp_wood_dark", (0.075, 0.055, 0.035), 1.0)
    S.material("swamp_mushroom", (0.42, 0.33, 0.16), 0.98)
    S.material("swamp_mushroom_red", (0.34, 0.11, 0.065), 0.98)
    S.material("swamp_shell", (0.38, 0.31, 0.18), 0.98)
    S.material("swamp_bone", (0.50, 0.47, 0.32), 0.97)
    S.material("swamp_clay", (0.31, 0.15, 0.08), 0.98)
    S.material("swamp_rust", (0.24, 0.095, 0.035), 0.9, metallic=0.34)
    S.material("swamp_flower", (0.45, 0.20, 0.34), 0.94)
    S.material("swamp_egg", (0.62, 0.58, 0.36), 0.84)


def start(name: str, x: float, y: float):
    S.new_model(name, (x, y, 0))
    return name


def detail_tile(index: int):
    name = f"swamp_detail_mud_{index:02d}"
    S.new_model(name, (index * 5.5, 0, 0))
    S.box(f"{name}_ProjectionAnchor", (0, 0, 0.003), (4.0, 4.0, 0.006),
          "swamp_anchor", bevel=0)
    rng = random.Random(81220 + index)
    for patch in range(5 + index):
        x, y = rng.uniform(-1.45, 1.45), rng.uniform(-1.2, 1.2)
        rx, ry = rng.uniform(0.12, 0.34), rng.uniform(0.07, 0.18)
        material = "swamp_water" if patch % 3 == 0 else f"swamp_mud_{patch % 2}"
        S.sphere(f"{name}_Patch_{patch}", (x, y, 0.025), (rx, ry, 0.025), material)
    for pebble in range(3 + index):
        s = rng.uniform(0.05, 0.12)
        S.sphere(f"{name}_Pebble_{pebble}", (rng.uniform(-1.4, 1.4), rng.uniform(-1.1, 1.1), s * 0.35),
                 (s * 1.2, s, s * 0.35), "swamp_stone")
    return name


def mud_clods():
    name = start("swamp_prop_mud_clods", 0, -6)
    rng = random.Random(81231)
    for i in range(11):
        s = rng.uniform(0.10, 0.24)
        S.sphere(f"{name}_Clod_{i}", (rng.uniform(-0.82, 0.82), rng.uniform(-0.40, 0.40), s * 0.34),
                 (s * rng.uniform(0.9, 1.4), s, s * 0.34), f"swamp_mud_{i % 2}")
    return name


def wet_pebbles():
    name = start("swamp_prop_wet_pebbles", 5, -6)
    rng = random.Random(81232)
    for i in range(9):
        s = rng.uniform(0.11, 0.22)
        S.sphere(f"{name}_Pebble_{i}", (rng.uniform(-0.85, 0.85), rng.uniform(-0.42, 0.42), s * 0.40),
                 (s * rng.uniform(0.85, 1.30), s, s * 0.40), "swamp_stone")
    return name


def moss_stones():
    name = start("swamp_prop_moss_stones", 10, -6)
    for i, (x, y, s) in enumerate(((-0.50, -0.10, 0.35), (0.05, 0.12, 0.44), (0.52, -0.12, 0.28))):
        S.sphere(f"{name}_Stone_{i}", (x, y, s * 0.42), (s * 1.15, s, s * 0.55), "swamp_stone")
        S.sphere(f"{name}_Moss_{i}", (x - 0.03, y, s * 0.75), (s * 0.82, s * 0.72, s * 0.18),
                 "swamp_moss" if i % 2 == 0 else "swamp_moss_dark")
    return name


def reed_tuft():
    name = start("swamp_prop_reed_tuft", 15, -6)
    rng = random.Random(81234)
    for i in range(17):
        x, y = rng.uniform(-0.28, 0.28), rng.uniform(-0.20, 0.20)
        h = rng.uniform(0.50, 1.10)
        S.curve(f"{name}_Reed_{i}", [(x, y, 0.03), (x + rng.uniform(-0.18, 0.18),
                                                  y + rng.uniform(-0.10, 0.10), h)],
                0.018 + (i % 3) * 0.004, "swamp_reed" if i % 2 else "swamp_reed_dark")
    return name


def cattails():
    name = start("swamp_prop_cattails", 20, -6)
    for i, (x, y, h) in enumerate(((-0.35, -0.08, 0.95), (-0.05, 0.10, 1.18),
                                     (0.26, -0.02, 0.82), (0.48, 0.15, 1.05))):
        S.curve(f"{name}_Stem_{i}", [(x, y, 0.03), (x + 0.04, y, h)], 0.022, "swamp_reed_dark")
        S.cylinder(f"{name}_Head_{i}", (x + 0.04, y, h + 0.12), 0.055, 0.28,
                   "swamp_cattail", vertices=12, bevel=0.018)
    return name


def lily_pads():
    name = start("swamp_prop_lily_pads", 25, -6)
    for i, (x, y, r) in enumerate(((-0.45, -0.10, 0.32), (0.02, 0.14, 0.40), (0.48, -0.12, 0.28))):
        S.cylinder(f"{name}_Pad_{i}", (x, y, 0.035 + i * 0.008), r, 0.035,
                   "swamp_leaf" if i % 2 == 0 else "swamp_leaf_light", vertices=18, bevel=0.025)
    return name


def duckweed():
    name = start("swamp_prop_duckweed", 0, -11)
    rng = random.Random(81237)
    for i in range(24):
        rx = rng.uniform(0.045, 0.095)
        S.sphere(f"{name}_Leaf_{i}", (rng.uniform(-0.80, 0.80), rng.uniform(-0.35, 0.35), 0.035),
                 (rx, rx * 0.62, 0.025), "swamp_leaf_light" if i % 4 == 0 else "swamp_leaf")
    return name


def mushrooms():
    name = start("swamp_prop_mushrooms", 5, -11)
    for i, (x, y, h, r) in enumerate(((-0.42, -0.04, 0.38, 0.18), (-0.08, 0.12, 0.55, 0.23),
                                       (0.28, -0.10, 0.43, 0.19), (0.52, 0.15, 0.31, 0.15))):
        S.cylinder(f"{name}_Stem_{i}", (x, y, h / 2), 0.055, h, "swamp_mushroom", vertices=12)
        S.sphere(f"{name}_Cap_{i}", (x, y, h), (r, r, r * 0.42),
                 "swamp_mushroom_red" if i % 2 else "swamp_mushroom")
    return name


def rotten_planks():
    name = start("swamp_prop_rotten_planks", 10, -11)
    S.box(f"{name}_A", (-0.18, -0.08, 0.08), (1.45, 0.28, 0.11), "swamp_wood",
          rotation=(0, 0, math.radians(13)), bevel=0.035)
    S.box(f"{name}_B", (0.22, 0.16, 0.07), (1.05, 0.24, 0.10), "swamp_wood_dark",
          rotation=(0, 0, math.radians(-20)), bevel=0.035)
    return name


def root_tangle():
    name = start("swamp_prop_root_tangle", 15, -11)
    paths = [((-0.78, -0.12), (0.02, 0.20), (0.78, 0.05)),
             ((-0.62, 0.28), (-0.08, -0.18), (0.70, -0.26)),
             ((-0.18, -0.36), (0.16, 0.08), (0.42, 0.38))]
    for i, points in enumerate(paths):
        S.curve(f"{name}_Root_{i}", [(x, y, 0.10 + (i % 2) * 0.025) for x, y in points],
                0.055 + i * 0.008, "swamp_wood" if i % 2 == 0 else "swamp_wood_dark")
    return name


def twig_bundle():
    name = start("swamp_prop_twig_bundle", 20, -11)
    for i, (y, angle) in enumerate(((-0.24, 8), (-0.08, -11), (0.10, 14), (0.25, -7))):
        S.curve(f"{name}_Twig_{i}", [(-0.78, y, 0.09), (0, y + 0.05, 0.12), (0.78, y - 0.03, 0.08)],
                0.035, "swamp_wood" if i % 2 == 0 else "swamp_wood_dark")
    return name


def snail_shells():
    name = start("swamp_prop_snail_shells", 25, -11)
    for i, (x, y, r) in enumerate(((-0.45, -0.08, 0.22), (0.02, 0.12, 0.27), (0.48, -0.10, 0.18))):
        S.torus(f"{name}_Shell_{i}", (x, y, r), r, r * 0.20, "swamp_shell",
                rotation=(math.radians(82), 0, math.radians(i * 27)))
    return name


def frog_bones():
    name = start("swamp_prop_frog_bones", 0, -16)
    S.sphere(f"{name}_Skull", (0, 0.04, 0.12), (0.24, 0.18, 0.14), "swamp_bone")
    legs = [((-0.12, 0, 0.10), (-0.58, -0.28, 0.06), (-0.82, -0.12, 0.05)),
            ((0.12, 0, 0.10), (0.58, -0.28, 0.06), (0.82, -0.12, 0.05)),
            ((-0.10, 0.06, 0.10), (-0.48, 0.30, 0.05), (-0.66, 0.44, 0.04)),
            ((0.10, 0.06, 0.10), (0.48, 0.30, 0.05), (0.66, 0.44, 0.04))]
    for i, points in enumerate(legs):
        S.curve(f"{name}_Leg_{i}", list(points), 0.026, "swamp_bone")
    return name


def broken_bowl():
    name = start("swamp_prop_broken_bowl", 5, -16)
    S.sphere(f"{name}_Bowl", (-0.22, 0, 0.17), (0.42, 0.34, 0.20), "swamp_clay")
    S.torus(f"{name}_Rim", (-0.22, 0, 0.29), 0.35, 0.045, "swamp_clay")
    for i, (x, y, a) in enumerate(((0.34, -0.18, 18), (0.58, 0.12, -24), (0.26, 0.30, 35))):
        S.box(f"{name}_Shard_{i}", (x, y, 0.05), (0.28, 0.18, 0.07), "swamp_clay",
              rotation=(0, 0, math.radians(a)), bevel=0.025)
    return name


def rusty_hook():
    name = start("swamp_prop_rusty_hook", 10, -16)
    S.curve(f"{name}_Hook", [(-0.62, -0.08, 0.09), (-0.10, 0, 0.12), (0.42, 0.06, 0.11),
                              (0.64, 0.20, 0.10), (0.42, 0.36, 0.08)], 0.065, "swamp_rust")
    S.torus(f"{name}_Eye", (-0.74, -0.10, 0.10), 0.16, 0.04, "swamp_rust",
            rotation=(math.radians(78), 0, 0))
    return name


def reed_coil():
    name = start("swamp_prop_reed_coil", 15, -16)
    for i, radius in enumerate((0.28, 0.42, 0.56)):
        S.torus(f"{name}_Loop_{i}", (0, 0, 0.07 + i * 0.016), radius, 0.04, "swamp_reed")
    S.curve(f"{name}_Tail", [(0.52, -0.10, 0.09), (0.78, -0.28, 0.07), (0.94, -0.08, 0.055)],
            0.038, "swamp_reed_dark")
    return name


def swamp_flowers():
    name = start("swamp_prop_swamp_flowers", 20, -16)
    for i, (x, y, h) in enumerate(((-0.42, -0.06, 0.48), (-0.12, 0.12, 0.62),
                                     (0.22, -0.08, 0.50), (0.48, 0.14, 0.42))):
        S.curve(f"{name}_Stem_{i}", [(x, y, 0.03), (x + 0.03, y, h)], 0.018, "swamp_leaf")
        for petal in range(5):
            a = math.tau * petal / 5
            S.sphere(f"{name}_Petal_{i}_{petal}",
                     (x + math.cos(a) * 0.09, y + math.sin(a) * 0.09, h),
                     (0.07, 0.045, 0.025), "swamp_flower")
    return name


def egg_cluster():
    name = start("swamp_prop_egg_cluster", 25, -16)
    rng = random.Random(81248)
    for i in range(13):
        x, y = rng.uniform(-0.52, 0.52), rng.uniform(-0.28, 0.28)
        S.sphere(f"{name}_Egg_{i}", (x, y, 0.08 + (i % 3) * 0.025), (0.10, 0.08, 0.09),
                 "swamp_egg")
    return name


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    TILE_OUT.mkdir(parents=True, exist_ok=True)
    PROP_OUT.mkdir(parents=True, exist_ok=True)
    S.clear_scene()
    S.setup_materials()
    setup_materials()
    scene, camera = S.setup_scene()

    tile_names = [detail_tile(index) for index in range(4)]
    prop_names = [
        mud_clods(), wet_pebbles(), moss_stones(), reed_tuft(), cattails(), lily_pads(),
        duckweed(), mushrooms(), rotten_planks(), root_tangle(), twig_bundle(), snail_shells(),
        frog_bones(), broken_bowl(), rusty_hook(), reed_coil(), swamp_flowers(), egg_cluster(),
    ]

    for collection in S.MODEL_COLLECTIONS.values():
        collection.hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))
    for name in tile_names:
        S.render_model(name, TILE_OUT / f"{name}.png", "road", scene, camera)
    for name in prop_names:
        S.render_model(name, PROP_OUT / f"{name}.png", "prop", scene, camera)

    manifest = {
        "version": 1,
        "camera": {
            "projection": "orthographic",
            "elevation": S.CAMERA_ELEVATION_DEG,
            "modelRootRotationZ": S.ROOT_ROTATION_DEG,
            "tileProjection": "2:1 diamond details only, no post-warp",
            "propOrthoScale": S.PROP_ORTHO_SCALE,
            "propBottomRatio": S.PROP_BOTTOM_RATIO,
        },
        "baseContract": "color-graded seamless wet mud beneath transparent details",
        "collisionContract": "all 18 props are floor-baked visual-only decorations",
        "shadowPolicy": "no-authored-cast-shadow",
        "tiles": tile_names,
        "props": prop_names,
        "model": str(BLEND_OUT.relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Rendered {len(tile_names)} detail tiles and {len(prop_names)} props to {OUT}")


if __name__ == "__main__":
    main()
