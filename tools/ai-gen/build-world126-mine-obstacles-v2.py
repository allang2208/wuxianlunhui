"""Build four versioned high-detail World-126 mine obstacle models.

The collapsed support is calibrated separately in
build-world126-collapsed-support-v2.py. This file upgrades the remaining four
models while preserving their authored footprint, camera and component count.
"""

from __future__ import annotations

import importlib.util
import json
import math
from pathlib import Path

import bpy


REPO = Path(__file__).resolve().parents[2]
SUPPORT_BUILDER = REPO / "tools/ai-gen/build-world126-collapsed-support-v2.py"
OUT = REPO / "tools/ai-gen/_world126_mine_obstacles_20260829/models_v2_realistic"
BLEND = OUT / "world126_mine_obstacles_remaining_v2_realistic.blend"


def load_support_builder():
    spec = importlib.util.spec_from_file_location("world126_support_v2", SUPPORT_BUILDER)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


V = load_support_builder()
B = V.B
S = V.S


OBSTACLES = (
    {"key": "mine_obstacle_derailed_cart_v2", "source": "mine_obstacle_derailed_cart", "footprint": [3.15, 1.55]},
    {"key": "mine_obstacle_stone_pillar_v2", "source": "mine_obstacle_stone_pillar", "footprint": [1.90, 1.65]},
    {"key": "mine_obstacle_hand_winch_v2", "source": "mine_obstacle_hand_winch", "footprint": [2.60, 1.65]},
    {"key": "mine_obstacle_sorting_hopper_v2", "source": "mine_obstacle_sorting_hopper", "footprint": [2.35, 1.85]},
)


def register_materials() -> None:
    V.register_materials()
    S.MATERIALS["v2_ore"] = V.noisy_material(
        "V2 dense non-glowing ore", "#090c0f", "#293139", 6.4, 7.0, 0.40, 0.91, 0.08)
    S.MATERIALS["v2_rope"] = V.noisy_material(
        "V2 coal-dusted hemp cable", "#120e0a", "#3b2a1c", 9.0, 5.0, 0.34, 0.96)
    S.MATERIALS["v2_rust"] = V.noisy_material(
        "V2 restrained iron oxidation", "#1a1512", "#573224", 11.0, 5.0, 0.24, 0.91, 0.18)


def assign(obj, material: str):
    obj.data.materials.clear()
    obj.data.materials.append(S.MATERIALS[material])
    return obj


def rock(name: str, xy, scale, seed: int, material="v2_slate", rotation=(0, 0, 0)):
    obj = V.natural_rock(name, xy, scale, seed)
    obj.rotation_euler = rotation
    return assign(obj, material)


def pillar_rock(name: str, xy, scale, seed: int, rotation=(0, 0, 0)):
    """Higher-density fractured rock for tall pillars without low-poly triangles."""
    import random

    rng = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=4, radius=1.0, location=(xy[0], xy[1], 0))
    obj = B.link_to_active(bpy.context.object, name)
    phase = rng.uniform(-math.pi, math.pi)
    for vertex in obj.data.vertices:
        p = vertex.co.normalized()
        broad = (
            1.0
            + 0.095 * math.sin(p.x * 3.2 + p.z * 2.0 + phase)
            + 0.060 * math.sin(p.y * 4.4 - p.z * 2.7 - phase * 0.5)
        )
        strata = 1.0 + 0.022 * math.sin(p.z * 15.0 + phase * 1.3)
        vertex.co.x *= scale[0] * broad * strata
        vertex.co.y *= scale[1] * broad * strata
        vertex.co.z *= scale[2] * (1.0 + 0.040 * math.sin(p.x * 4.0 + p.y * 2.5 + phase))
    minimum_z = min(vertex.co.z for vertex in obj.data.vertices)
    obj.location.z = -minimum_z
    obj.rotation_euler = rotation
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj.data.materials.append(S.MATERIALS["v2_slate"])
    return obj


def fractured_column(name: str, xy, scale, seed: int, rotation=(0, 0, 0)):
    """Build an angular slate column from irregular stacked cross-sections."""
    import random

    rng = random.Random(seed)
    sides = 9
    levels = 7
    height = scale[2] * 2.0
    base_radius = [1.0 + rng.uniform(-0.14, 0.12) for _ in range(sides)]
    vertices = []
    for level in range(levels):
        t = level / (levels - 1)
        taper = 0.78 + 0.26 * math.sin(t * math.pi)
        if level == levels - 1:
            taper *= 0.72
        drift_x = math.sin(t * math.pi * 1.35 + seed * 0.01) * scale[0] * 0.08
        drift_y = math.sin(t * math.pi * 1.10 + seed * 0.013) * scale[1] * 0.06
        twist = math.sin(t * math.pi) * 0.10
        for side in range(sides):
            angle = side * math.tau / sides + twist
            local = base_radius[side] * (1.0 + rng.uniform(-0.035, 0.035))
            top_chip = rng.uniform(-0.055, 0.025) * height if level == levels - 1 else 0.0
            vertices.append((
                xy[0] + math.cos(angle) * scale[0] * taper * local + drift_x,
                xy[1] + math.sin(angle) * scale[1] * taper * local + drift_y,
                height * t + top_chip,
            ))
    faces = [tuple(reversed(range(sides)))]
    for level in range(levels - 1):
        base = level * sides
        nxt = base + sides
        for side in range(sides):
            other = (side + 1) % sides
            faces.append((base + side, base + other, nxt + other, nxt + side))
    top = (levels - 1) * sides
    faces.append(tuple(top + side for side in range(sides)))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    assert S.ACTIVE_COLLECTION is not None
    S.ACTIVE_COLLECTION.objects.link(obj)
    obj.parent = S.ACTIVE_ROOT
    obj.rotation_euler = rotation
    obj.data.materials.append(S.MATERIALS["v2_slate"])
    for polygon in obj.data.polygons:
        polygon.use_smooth = True
    bevel = obj.modifiers.new("Fracture-edge relief", "BEVEL")
    bevel.width = 0.018
    bevel.segments = 2
    return obj


def metal_beam(name: str, start, end, thickness: float):
    return B.add_beam(name, start, end, thickness, "v2_iron")


def cart_wheel(key: str, index: int, center) -> None:
    x, y, z = center
    S.torus(f"{key}_Wheel_{index:02d}_Rim", center, 0.30, 0.060, "v2_iron",
            rotation=(math.radians(90), 0, math.radians(-7)))
    S.cylinder(f"{key}_Wheel_{index:02d}_Hub", center, 0.105, 0.17, "v2_iron",
               rotation=(math.radians(90), 0, math.radians(-7)), vertices=20, bevel=0.018)
    for spoke_index, angle in enumerate((0, math.pi / 4, math.pi / 2, 3 * math.pi / 4), start=1):
        dx, dz = math.cos(angle) * 0.235, math.sin(angle) * 0.235
        metal_beam(f"{key}_Wheel_{index:02d}_Spoke_{spoke_index:02d}",
                   (x - dx, y, z - dz), (x + dx, y, z + dz), 0.040)


def build_derailed_cart() -> None:
    key = "mine_obstacle_derailed_cart_v2"
    S.new_model(key, (0, 0, 0))
    for y in (-0.42, 0.42):
        S.box(f"{key}_Rail_{y:+.2f}", (0, y, 0.12), (3.00, 0.12, 0.18),
              "v2_iron", rotation=(0, 0, math.radians(4)), bevel=0.018)
    for index, x in enumerate((-1.12, -0.36, 0.40, 1.16), start=1):
        V.irregular_beam(f"{key}_Sleeper_{index:02d}", (x, -0.70, 0.08), (x, 0.70, 0.08),
                         0.16, 0.30, "v2_wood_dark", 12630 + index, sections=6)
    cart = B.add_frustum(f"{key}_CartBody", (0.08, -0.02, 0.91),
                         (1.70, 0.94), (2.25, 1.22), 1.08, "v2_iron")
    cart.rotation_euler = (math.radians(2), math.radians(-7), math.radians(-7))
    # Rolled lip and seam strips stay attached to the authored cart body.
    S.box(f"{key}_TopLipFront", (0.08, -0.625, 1.45), (2.27, 0.085, 0.105),
          "v2_iron", rotation=(0, math.radians(-7), math.radians(-7)), bevel=0.025)
    S.box(f"{key}_TopLipRear", (0.08, 0.585, 1.45), (2.27, 0.085, 0.105),
          "v2_iron", rotation=(0, math.radians(-7), math.radians(-7)), bevel=0.025)
    for index, x in enumerate((-0.80, -0.40, 0.00, 0.40, 0.80), start=1):
        V.rivet(f"{key}_FrontRivet_{index:02d}", (x + 0.08, -0.666, 1.36), 0.030)
    wheel_centers = [
        (-0.60, -0.62, 0.45), (0.76, -0.62, 0.45),
        (-0.60, 0.62, 0.45), (0.76, 0.62, 0.45),
    ]
    for index, center in enumerate(wheel_centers, start=1):
        cart_wheel(key, index, center)
    ore_specs = (
        ((-0.55, -0.18), (0.34, 0.28, 0.24), 12641),
        ((-0.10, 0.10), (0.38, 0.31, 0.26), 12642),
        ((0.38, -0.06), (0.36, 0.30, 0.24), 12643),
        ((0.72, 0.19), (0.28, 0.25, 0.22), 12644),
    )
    for index, (xy, scale, seed) in enumerate(ore_specs, start=1):
        obj = rock(f"{key}_OreLoad_{index:02d}", xy, scale, seed, "v2_ore")
        obj.location.z += 1.28


def build_stone_pillar() -> None:
    key = "mine_obstacle_stone_pillar_v2"
    S.new_model(key, (0, 0, 0))
    S.cylinder(f"{key}_ConnectedBase", (0, 0, 0.12), 0.90, 0.24,
               "v2_slate", vertices=12, scale=(1.0, 0.82, 1.0), bevel=0.035)
    pillars = (
        ((-0.15, 0.02), (0.66, 0.58, 1.38), 12651, (0.03, -0.10, 0.08)),
        ((0.60, 0.16), (0.42, 0.38, 0.86), 12652, (-0.04, 0.12, -0.14)),
        ((-0.70, 0.20), (0.34, 0.32, 0.66), 12653, (0.10, 0.04, 0.18)),
        ((0.18, -0.48), (0.50, 0.35, 0.53), 12654, (-0.12, 0.06, -0.08)),
    )
    for index, (xy, scale, seed, rotation) in enumerate(pillars, start=1):
        fractured_column(f"{key}_Pillar_{index:02d}", xy, scale, seed, rotation=rotation)
    # Fractures stay in the deformed rock topology/material pass. Raised curve
    # geometry reads as a twig at game scale and is intentionally excluded.


def build_hand_winch() -> None:
    key = "mine_obstacle_hand_winch_v2"
    S.new_model(key, (0, 0, 0))
    for index, y in enumerate((-0.63, 0.63), start=1):
        V.irregular_beam(f"{key}_BaseRunner_{index:02d}", (-1.18, y, 0.12), (1.18, y, 0.12),
                         0.24, 0.22, "v2_wood_dark", 12660 + index, sections=7)
    for side_index, side in enumerate((-1, 1), start=1):
        x = side * 0.78
        V.irregular_beam(f"{key}_FrameFront_{side_index:02d}", (x, -0.60, 0.22),
                         (x, -0.17, 1.82), 0.25, 0.25, "v2_wood", 12663 + side_index)
        V.irregular_beam(f"{key}_FrameRear_{side_index:02d}", (x, 0.60, 0.22),
                         (x, 0.17, 1.82), 0.25, 0.25, "v2_wood", 12666 + side_index)
        S.box(f"{key}_Bearing_{side_index:02d}", (x, 0, 1.55), (0.22, 0.40, 0.40),
              "v2_iron", bevel=0.030)
        for bolt_y in (-0.13, 0.13):
            V.rivet(f"{key}_BearingRivet_{side_index:02d}_{bolt_y:+.2f}",
                    (x, -0.215, 1.55 + bolt_y), 0.030)
    S.cylinder(f"{key}_Drum", (0, 0, 1.25), 0.46, 1.30, "v2_iron",
               rotation=(0, math.radians(90), 0), vertices=40, bevel=0.025)
    for x in (-0.68, 0.68):
        S.cylinder(f"{key}_DrumFlange_{x:+.2f}", (x, 0, 1.25), 0.56, 0.11,
                   "v2_iron", rotation=(0, math.radians(90), 0), vertices=36, bevel=0.020)
    for ring in range(9):
        x = -0.45 + ring * 0.1125
        S.torus(f"{key}_CableCoil_{ring + 1:02d}", (x, 0, 1.25), 0.475, 0.024,
                "v2_rope", rotation=(0, math.radians(90), 0))
    # A true spoked crank wheel replaces the old solid torus-only symbol.
    center = (0.96, 0.0, 1.42)
    S.torus(f"{key}_CrankWheel", center, 0.55, 0.055, "v2_iron",
            rotation=(0, math.radians(90), 0))
    S.cylinder(f"{key}_CrankHub", center, 0.105, 0.22, "v2_iron",
               rotation=(0, math.radians(90), 0), vertices=24, bevel=0.015)
    for index, angle in enumerate((0, math.pi / 4, math.pi / 2, 3 * math.pi / 4), start=1):
        dy, dz = math.cos(angle) * 0.45, math.sin(angle) * 0.45
        metal_beam(f"{key}_CrankSpoke_{index:02d}",
                   (0.96, -dy, 1.42 - dz), (0.96, dy, 1.42 + dz), 0.045)
    metal_beam(f"{key}_CrankArm", (1.08, 0, 1.42), (1.08, -0.37, 0.98), 0.075)
    S.cylinder(f"{key}_CrankGrip", (1.08, -0.44, 0.91), 0.075, 0.38, "v2_wood_dark",
               rotation=(0, math.radians(90), 0), vertices=20, bevel=0.018)


def build_sorting_hopper() -> None:
    key = "mine_obstacle_sorting_hopper_v2"
    S.new_model(key, (0, 0, 0))
    for index, (x, y) in enumerate(((-0.78, -0.58), (-0.78, 0.58), (0.78, -0.58), (0.78, 0.58)), start=1):
        V.irregular_beam(f"{key}_Leg_{index:02d}", (x, y, 0.04), (x, y, 1.66),
                         0.22, 0.22, "v2_wood", 12670 + index)
        S.box(f"{key}_LegShoe_{index:02d}", (x, y, 0.16), (0.28, 0.28, 0.20),
              "v2_iron", bevel=0.022)
    for index, y in enumerate((-0.58, 0.58), start=1):
        V.irregular_beam(f"{key}_LongBrace_{index:02d}", (-0.78, y, 0.34), (0.78, y, 1.24),
                         0.15, 0.15, "v2_wood_dark", 12676 + index)
    hopper = B.add_frustum(f"{key}_OreHopper", (0, 0, 1.72),
                           (0.76, 0.66), (1.86, 1.36), 1.18, "v2_iron")
    hopper.rotation_euler.z = math.radians(-2)
    chute = B.add_frustum(f"{key}_LowerChute", (0, -0.36, 0.92),
                          (0.46, 0.42), (0.82, 0.66), 0.86, "v2_iron")
    chute.rotation_euler.x = math.radians(24)
    # Rolled top rim, vertical seams and restrained rivets remain part of the hopper shell.
    for name, loc, dims in (
        ("TopRimFront", (0, -0.70, 2.31), (1.92, 0.09, 0.10)),
        ("TopRimRear", (0, 0.70, 2.31), (1.92, 0.09, 0.10)),
        ("TopRimLeft", (-0.95, 0, 2.31), (0.09, 1.36, 0.10)),
        ("TopRimRight", (0.95, 0, 2.31), (0.09, 1.36, 0.10)),
    ):
        S.box(f"{key}_{name}", loc, dims, "v2_iron", rotation=(0, 0, math.radians(-2)), bevel=0.018)
    for index, x in enumerate((-0.68, -0.34, 0.0, 0.34, 0.68), start=1):
        V.rivet(f"{key}_FrontRivet_{index:02d}", (x, -0.712, 2.23), 0.028)
    S.box(f"{key}_ScreenDeck", (0, 0.38, 1.12), (1.70, 0.62, 0.12),
          "v2_iron", rotation=(math.radians(-10), 0, 0), bevel=0.018)
    for index, x in enumerate((-0.62, -0.37, -0.12, 0.13, 0.38, 0.63), start=1):
        S.box(f"{key}_ScreenBar_{index:02d}", (x, 0.37, 1.18), (0.055, 0.60, 0.055),
              "v2_iron", rotation=(math.radians(-10), 0, 0), bevel=0.010)
    ore_specs = (
        ((-0.45, -0.18), (0.28, 0.22, 0.18), 12681),
        ((0.05, 0.08), (0.34, 0.26, 0.20), 12682),
        ((0.48, -0.05), (0.25, 0.21, 0.17), 12683),
    )
    for index, (xy, scale, seed) in enumerate(ore_specs, start=1):
        obj = rock(f"{key}_Ore_{index:02d}", xy, scale, seed, "v2_ore")
        obj.location.z += 2.16


BUILDERS = {
    "mine_obstacle_derailed_cart_v2": build_derailed_cart,
    "mine_obstacle_stone_pillar_v2": build_stone_pillar,
    "mine_obstacle_hand_winch_v2": build_hand_winch,
    "mine_obstacle_sorting_hopper_v2": build_sorting_hopper,
}


def render_asset(scene, camera, obstacle: dict) -> dict:
    key = obstacle["key"]
    B.set_visibility(key, guides=False)
    shift_y = B.body_bottom_shift(scene, camera, S.MODEL_COLLECTIONS[key])
    calibration = OUT / f"_{key}_bottom_calibration.png"
    B.configure_preview(scene, camera, calibration, shift_y=shift_y, transparent=True)
    shift_y += B.rendered_alpha_bottom_ndc(calibration) - (1.0 - B.BOTTOM_RATIO)
    calibration.unlink(missing_ok=True)
    init = OUT / f"{key}_textured_init.png"
    preview = OUT / f"{key}_model_preview.png"
    depth = OUT / f"{key}_body_depth.png"
    B.configure_preview(scene, camera, init, shift_y=shift_y, transparent=True)
    B.set_visibility(key, guides=True)
    B.configure_preview(scene, camera, preview, shift_y=shift_y, transparent=True)
    B.set_visibility(key, guides=False)
    zmin, zmax = B.camera_depth_range(S.MODEL_COLLECTIONS[key], camera)
    B.configure_depth(scene, zmin, zmax, depth)
    return {
        "assetId": key,
        "sourceAssetId": obstacle["source"],
        "footprint": obstacle["footprint"],
        "preview": str(preview.relative_to(REPO)).replace("\\", "/"),
        "texturedInit": str(init.relative_to(REPO)).replace("\\", "/"),
        "bodyDepth": str(depth.relative_to(REPO)).replace("\\", "/"),
        "bottomRatio": B.BOTTOM_RATIO,
    }


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    S.clear_scene()
    S.setup_materials()
    B.setup_materials()
    register_materials()
    scene, camera = S.setup_scene()
    for obstacle in OBSTACLES:
        BUILDERS[obstacle["key"]]()
        B.create_footprint_guide({"key": obstacle["key"], "footprint": obstacle["footprint"]}, (0, 0, 0))
    contracts = [render_asset(scene, camera, obstacle) for obstacle in OBSTACLES]
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
    payload = {
        "version": 2,
        "stage": "versioned realistic models; candidate only; no runtime promotion",
        "camera": {
            "projection": "orthographic",
            "elevationDegrees": B.CAMERA_ELEVATION_DEG,
            "modelRootRotationZDegrees": B.ROOT_ROTATION_DEG,
            "orthoScale": B.ORTHO_SCALE,
            "groundContactBottomRatio": B.BOTTOM_RATIO,
        },
        "materials": ["anisotropic damp oak", "pitted blackened iron", "fractured charcoal slate", "coal-dusted cable", "non-glowing ore"],
        "blend": str(BLEND.relative_to(REPO)).replace("\\", "/"),
        "assets": contracts,
    }
    (OUT / "model-contracts-v2.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved V2 model set: {BLEND}")
    for contract in contracts:
        print(contract["preview"])


if __name__ == "__main__":
    main()
