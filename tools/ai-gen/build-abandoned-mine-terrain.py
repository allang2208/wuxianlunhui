"""Build the abandoned-mine floor prop kit with the accepted terrain contract.

The floor itself is generated through floor-asset.py. This script builds exactly
18 visual-only mine props with the road/dungeon fixed camera contract: orthographic
30-degree camera, 44.8-degree model-root rotation and one shared prop ortho scale.
The floor-baked props contain no authored cast-shadow layer.
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
OUT = REPO / "tools" / "ai-gen" / "_abandoned_mine_terrain_20260828"
PROP_OUT = OUT / "props"
BLEND_OUT = OUT / "abandoned_mine_terrain.blend"


def load_helpers():
    spec = importlib.util.spec_from_file_location("world122_street_helpers", SOURCE_SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


S = load_helpers()


def setup_materials():
    S.material("mine_anchor", (0.0, 0.0, 0.0), 1.0, alpha=0.0)
    S.material("mine_slate", (0.105, 0.115, 0.125), 0.98)
    S.material("mine_slate_light", (0.17, 0.18, 0.19), 0.96)
    S.material("mine_coal", (0.025, 0.03, 0.035), 0.82, metallic=0.08)
    S.material("mine_ore", (0.20, 0.23, 0.25), 0.78, metallic=0.30)
    S.material("mine_ore_glint", (0.34, 0.39, 0.40), 0.56, metallic=0.48)
    S.material("mine_wood", (0.24, 0.135, 0.065), 0.96)
    S.material("mine_wood_dark", (0.105, 0.06, 0.032), 1.0)
    S.material("mine_iron", (0.09, 0.10, 0.105), 0.72, metallic=0.52)
    S.material("mine_rust", (0.25, 0.09, 0.035), 0.92, metallic=0.30)
    S.material("mine_rope", (0.29, 0.205, 0.105), 1.0)
    S.material("mine_canvas", (0.33, 0.285, 0.205), 1.0)
    S.material("mine_helmet", (0.34, 0.245, 0.06), 0.88, metallic=0.06)
    S.material("mine_dynamite", (0.38, 0.075, 0.045), 0.90)
    S.material("mine_fuse", (0.12, 0.10, 0.075), 1.0)
    S.material("mine_glass", (0.46, 0.30, 0.10), 0.42, alpha=0.78)
    S.emissive_material("mine_lantern_core", (0.92, 0.46, 0.08), strength=2.4,
                        roughness=0.28, alpha=0.90)


def start(name: str, x: float, y: float, _legacy_shadow_size=None):
    S.new_model(name, (x, y, 0))
    return name


def slate_rubble():
    name = start("abandoned_mine_prop_slate_rubble", 0, -6)
    rng = random.Random(82201)
    for i in range(12):
        w, d, h = rng.uniform(0.16, 0.42), rng.uniform(0.11, 0.28), rng.uniform(0.05, 0.14)
        S.box(f"{name}_{i}", (rng.uniform(-0.82, 0.82), rng.uniform(-0.36, 0.36), h / 2),
              (w, d, h), "mine_slate" if i % 3 else "mine_slate_light",
              rotation=(0, 0, rng.uniform(-math.pi, math.pi)), bevel=0.025)
    return name


def coal_chunks():
    name = start("abandoned_mine_prop_coal_chunks", 5, -6)
    rng = random.Random(82202)
    for i in range(10):
        s = rng.uniform(0.10, 0.24)
        S.sphere(f"{name}_{i}", (rng.uniform(-0.75, 0.75), rng.uniform(-0.34, 0.34), s * 0.38),
                 (s * rng.uniform(0.8, 1.4), s, s * 0.55), "mine_coal")
    return name


def ore_fragments():
    name = start("abandoned_mine_prop_ore_fragments", 10, -6)
    rng = random.Random(82203)
    for i in range(8):
        s = rng.uniform(0.11, 0.25)
        mat = "mine_ore_glint" if i in (1, 5) else "mine_ore"
        S.sphere(f"{name}_{i}", (rng.uniform(-0.72, 0.72), rng.uniform(-0.34, 0.34), s * 0.45),
                 (s * 1.25, s * 0.82, s * 0.62), mat)
    return name


def broken_sleepers():
    name = start("abandoned_mine_prop_broken_sleepers", 15, -6)
    for i, (x, y, length, angle) in enumerate(((-0.25, -0.12, 1.20, 16), (0.28, 0.16, 0.92, -24))):
        S.box(f"{name}_{i}", (x, y, 0.11), (length, 0.24, 0.16),
              "mine_wood" if i == 0 else "mine_wood_dark",
              rotation=(0, 0, math.radians(angle)), bevel=0.035)
    return name


def rail_spikes():
    name = start("abandoned_mine_prop_rail_spikes", 20, -6)
    for i, (x, y, angle) in enumerate(((-0.58, -0.12, 12), (-0.16, 0.16, -18),
                                        (0.26, -0.08, 31), (0.58, 0.16, -9))):
        S.cylinder(f"{name}_shaft_{i}", (x, y, 0.075), 0.04, 0.50, "mine_rust",
                   rotation=(0, math.radians(90), math.radians(angle)), vertices=10, bevel=0.01)
        S.box(f"{name}_head_{i}", (x, y, 0.10), (0.16, 0.12, 0.06), "mine_iron",
              rotation=(0, 0, math.radians(angle)), bevel=0.015)
    return name


def broken_rail():
    name = start("abandoned_mine_prop_broken_rail", 25, -6, (2.2, 1.1))
    S.box(f"{name}_web", (0, 0, 0.14), (1.70, 0.09, 0.22), "mine_rust",
          rotation=(0, 0, math.radians(11)), bevel=0.018)
    S.box(f"{name}_head", (0, 0, 0.27), (1.72, 0.16, 0.07), "mine_iron",
          rotation=(0, 0, math.radians(11)), bevel=0.018)
    S.box(f"{name}_foot", (0, 0, 0.045), (1.70, 0.22, 0.07), "mine_rust",
          rotation=(0, 0, math.radians(11)), bevel=0.018)
    return name


def rotten_planks():
    name = start("abandoned_mine_prop_rotten_planks", 0, -11)
    for i, (x, y, length, angle) in enumerate(((-0.18, -0.12, 1.45, 13), (0.20, 0.14, 1.18, -18))):
        S.box(f"{name}_{i}", (x, y, 0.075 + i * 0.025), (length, 0.27, 0.11),
              "mine_wood_dark" if i else "mine_wood", rotation=(0, 0, math.radians(angle)), bevel=0.04)
    return name


def timber_offcuts():
    name = start("abandoned_mine_prop_timber_offcuts", 5, -11)
    for i, (x, y, length, angle) in enumerate(((-0.42, -0.12, 0.72, 28), (0.08, 0.10, 0.90, -12),
                                                (0.48, -0.08, 0.62, 18))):
        S.cylinder(f"{name}_{i}", (x, y, 0.13), 0.12, length, "mine_wood",
                   rotation=(0, math.radians(90), math.radians(angle)), vertices=10, bevel=0.02)
    return name


def rope_coil():
    name = start("abandoned_mine_prop_rope_coil", 10, -11)
    for i, radius in enumerate((0.27, 0.40, 0.53)):
        S.torus(f"{name}_{i}", (0, 0, 0.065 + i * 0.016), radius, 0.045, "mine_rope")
    S.curve(f"{name}_tail", [(0.48, -0.04, 0.07), (0.76, -0.25, 0.06), (0.94, -0.10, 0.045)],
            0.04, "mine_rope")
    return name


def broken_chain():
    name = start("abandoned_mine_prop_broken_chain", 15, -11)
    for i, (x, y, angle) in enumerate(((-0.62, -0.08, 14), (-0.23, 0.08, -19),
                                        (0.18, -0.02, 23), (0.58, 0.15, -11))):
        S.torus(f"{name}_{i}", (x, y, 0.11), 0.19, 0.045, "mine_iron",
                rotation=(math.radians(74), 0, math.radians(angle)))
    return name


def pickaxe():
    name = start("abandoned_mine_prop_pickaxe", 20, -11, (2.1, 1.05))
    angle = math.radians(18)
    S.cylinder(f"{name}_handle", (0, 0, 0.12), 0.055, 1.65, "mine_wood",
               rotation=(0, math.radians(90), angle), vertices=12, bevel=0.016)
    S.curve(f"{name}_head", [(-0.72, -0.40, 0.16), (-0.52, -0.30, 0.25),
                              (-0.30, -0.18, 0.20), (-0.08, -0.08, 0.13)],
            0.07, "mine_iron")
    return name


def shovel():
    name = start("abandoned_mine_prop_shovel", 25, -11, (2.1, 1.05))
    angle = math.radians(-20)
    S.cylinder(f"{name}_handle", (0, 0, 0.12), 0.052, 1.55, "mine_wood",
               rotation=(0, math.radians(90), angle), vertices=12, bevel=0.015)
    S.box(f"{name}_blade", (0.73, -0.27, 0.12), (0.40, 0.34, 0.07), "mine_iron",
          rotation=(0, 0, angle), bevel=0.07)
    return name


def floor_lantern():
    name = start("abandoned_mine_prop_floor_lantern", 0, -16)
    S.cylinder(f"{name}_base", (0, 0, 0.08), 0.29, 0.12, "mine_rust", vertices=14)
    S.cylinder(f"{name}_glass", (0, 0, 0.38), 0.20, 0.50, "mine_glass", vertices=14, bevel=0.02)
    S.cylinder(f"{name}_core", (0, 0, 0.35), 0.075, 0.32, "mine_lantern_core", vertices=12)
    S.torus(f"{name}_handle", (0, 0, 0.72), 0.31, 0.035, "mine_iron",
            rotation=(math.radians(90), 0, 0))
    return name


def helmet():
    name = start("abandoned_mine_prop_helmet", 5, -16)
    S.sphere(f"{name}_dome", (0, 0, 0.24), (0.52, 0.42, 0.30), "mine_helmet")
    S.box(f"{name}_brim", (0, -0.05, 0.15), (1.05, 0.60, 0.08), "mine_helmet", bevel=0.09)
    S.cylinder(f"{name}_lamp", (0.0, -0.38, 0.30), 0.11, 0.12, "mine_iron",
               rotation=(math.radians(90), 0, 0), vertices=12)
    return name


def dynamite():
    name = start("abandoned_mine_prop_dynamite", 10, -16)
    for i, (x, y, angle) in enumerate(((-0.34, -0.10, 12), (0.05, 0.08, -18), (0.38, -0.04, 24))):
        S.cylinder(f"{name}_{i}", (x, y, 0.10), 0.095, 0.72, "mine_dynamite",
                   rotation=(0, math.radians(90), math.radians(angle)), vertices=14, bevel=0.015)
    S.curve(f"{name}_fuse", [(0.70, 0.18, 0.12), (0.82, 0.30, 0.16), (0.92, 0.22, 0.12)],
            0.025, "mine_fuse")
    return name


def fuse_spool():
    name = start("abandoned_mine_prop_fuse_spool", 15, -16)
    S.cylinder(f"{name}_hub", (0, 0, 0.18), 0.18, 0.44, "mine_wood_dark",
               rotation=(math.radians(90), 0, 0), vertices=14)
    for y in (-0.25, 0.25):
        S.cylinder(f"{name}_flange_{y}", (0, y, 0.18), 0.48, 0.07, "mine_wood",
                   rotation=(math.radians(90), 0, 0), vertices=16)
    S.torus(f"{name}_coil", (0, 0, 0.18), 0.33, 0.08, "mine_fuse", rotation=(math.radians(90), 0, 0))
    S.curve(f"{name}_tail", [(0.40, 0.18, 0.10), (0.68, 0.32, 0.06), (0.90, 0.12, 0.045)],
            0.028, "mine_fuse")
    return name


def minecart_wheel():
    name = start("abandoned_mine_prop_minecart_wheel", 20, -16)
    S.torus(f"{name}_rim", (0, 0, 0.28), 0.52, 0.07, "mine_rust", rotation=(math.radians(77), 0, math.radians(12)))
    S.cylinder(f"{name}_hub", (0, 0, 0.28), 0.13, 0.18, "mine_iron",
               rotation=(math.radians(77), 0, math.radians(12)), vertices=12)
    for angle in range(0, 180, 45):
        a = math.radians(angle)
        S.box(f"{name}_spoke_{angle}", (0, 0, 0.28), (0.92, 0.055, 0.055), "mine_iron",
              rotation=(math.radians(13), 0, a + math.radians(12)), bevel=0.012)
    return name


def ore_sack():
    name = start("abandoned_mine_prop_ore_sack", 25, -16)
    S.sphere(f"{name}_body", (0, 0, 0.34), (0.53, 0.42, 0.46), "mine_canvas")
    S.cylinder(f"{name}_neck", (0, 0, 0.75), 0.16, 0.22, "mine_canvas", vertices=12)
    S.torus(f"{name}_tie", (0, 0, 0.68), 0.18, 0.035, "mine_rope")
    for i, (x, y) in enumerate(((-0.18, -0.04), (0.02, 0.02), (0.19, -0.02))):
        S.sphere(f"{name}_ore_{i}", (x, y, 0.87 + i * 0.025), (0.12, 0.10, 0.10), "mine_ore_glint")
    return name


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    PROP_OUT.mkdir(parents=True, exist_ok=True)
    S.clear_scene()
    S.setup_materials()
    setup_materials()
    scene, camera = S.setup_scene()
    props = [
        slate_rubble(), coal_chunks(), ore_fragments(), broken_sleepers(), rail_spikes(), broken_rail(),
        rotten_planks(), timber_offcuts(), rope_coil(), broken_chain(), pickaxe(), shovel(),
        floor_lantern(), helmet(), dynamite(), fuse_spool(), minecart_wheel(), ore_sack(),
    ]
    for collection in S.MODEL_COLLECTIONS.values():
        collection.hide_render = False
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND_OUT))
    for name in props:
        S.render_model(name, PROP_OUT / f"{name}.png", "prop", scene, camera)
    manifest = {
        "version": 1,
        "camera": {
            "projection": "orthographic",
            "elevation": S.CAMERA_ELEVATION_DEG,
            "modelRootRotationZ": S.ROOT_ROTATION_DEG,
            "propOrthoScale": S.PROP_ORTHO_SCALE,
            "propBottomRatio": S.PROP_BOTTOM_RATIO,
        },
        "floorPipeline": "floor-asset.py abandoned-mine -> make-seamless -> desaturate",
        "collisionContract": "all 18 props are floor-baked visual-only decorations",
        "shadowPolicy": "no-authored-cast-shadow",
        "props": props,
        "model": str(BLEND_OUT.relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Rendered {len(props)} abandoned-mine props to {PROP_OUT}")


if __name__ == "__main__":
    main()
