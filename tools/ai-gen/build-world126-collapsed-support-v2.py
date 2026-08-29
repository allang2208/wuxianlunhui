"""Build a versioned high-detail collapsed mine support model for style calibration."""

from __future__ import annotations

import importlib.util
import json
import math
import random
from pathlib import Path

import bpy
from mathutils import Vector


REPO = Path(__file__).resolve().parents[2]
BASE_PATH = REPO / "tools/ai-gen/build-world126-mine-obstacles.py"
OUT = REPO / "tools/ai-gen/_world126_mine_obstacles_20260829/support_model_v2_realistic"
BLEND = OUT / "mine_obstacle_collapsed_support_v2_realistic.blend"
PREVIEW = OUT / "mine_obstacle_collapsed_support_v2_model_preview.png"
INIT = OUT / "mine_obstacle_collapsed_support_v2_textured_init.png"
DEPTH = OUT / "mine_obstacle_collapsed_support_v2_body_depth.png"
KEY = "mine_obstacle_collapsed_support_v2"


def load_base():
    spec = importlib.util.spec_from_file_location("world126_mine_base", BASE_PATH)
    module = importlib.util.module_from_spec(spec)
    assert spec and spec.loader
    spec.loader.exec_module(module)
    return module


B = load_base()
S = B.S


def rgba(hex_color: str):
    value = hex_color.lstrip("#")
    return tuple(int(value[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (1.0,)


def noisy_material(name: str, dark: str, light: str, scale: float,
                   detail: float, bump_strength: float, roughness: float,
                   metallic: float = 0.0):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    noise = nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = scale
    noise.inputs["Detail"].default_value = detail
    noise.inputs["Roughness"].default_value = 0.72
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = rgba(dark)
    ramp.color_ramp.elements[1].color = rgba(light)
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = 0.09
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    mat.diffuse_color = rgba(dark)
    return mat


def wood_material():
    mat = bpy.data.materials.new("V2 hand-hewn damp oak")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    links = mat.node_tree.links
    for node in list(nodes):
        nodes.remove(node)
    output = nodes.new("ShaderNodeOutputMaterial")
    bsdf = nodes.new("ShaderNodeBsdfPrincipled")
    texcoord = nodes.new("ShaderNodeTexCoord")
    mapping = nodes.new("ShaderNodeMapping")
    # The beam mesh's local X axis follows its length. Compress variation on
    # that axis so the surface reads as long timber fibres, not zebra bands.
    mapping.inputs["Scale"].default_value = (0.42, 4.8, 5.6)
    noise = nodes.new("ShaderNodeTexNoise")
    noise.noise_dimensions = "4D"
    noise.inputs["Scale"].default_value = 3.7
    noise.inputs["Detail"].default_value = 5.0
    noise.inputs["Roughness"].default_value = 0.66
    noise.inputs["Distortion"].default_value = 0.28
    noise.inputs["W"].default_value = 0.37
    ramp = nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.22
    ramp.color_ramp.elements[0].color = rgba("#21150e")
    ramp.color_ramp.elements[1].position = 0.80
    ramp.color_ramp.elements[1].color = rgba("#5a3924")
    bump = nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.20
    bump.inputs["Distance"].default_value = 0.045
    bsdf.inputs["Roughness"].default_value = 0.89
    links.new(texcoord.outputs["Generated"], mapping.inputs["Vector"])
    links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    links.new(ramp.outputs["Color"], bsdf.inputs["Base Color"])
    links.new(noise.outputs["Fac"], bump.inputs["Height"])
    links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    links.new(bsdf.outputs["BSDF"], output.inputs["Surface"])
    mat.diffuse_color = rgba("#342116")
    return mat


def register_materials() -> None:
    S.MATERIALS["v2_wood"] = wood_material()
    S.MATERIALS["v2_wood_dark"] = noisy_material(
        "V2 tar-dark oak", "#130d09", "#4b3020", 7.2, 6.0, 0.32, 0.92)
    S.MATERIALS["v2_iron"] = noisy_material(
        "V2 blackened pitted iron", "#111315", "#3b312b", 10.0, 7.0, 0.34, 0.76, 0.56)
    S.MATERIALS["v2_slate"] = noisy_material(
        "V2 damp charcoal slate", "#111519", "#39444c", 5.4, 8.0, 0.48, 0.95)
    S.MATERIALS["v2_crack"] = noisy_material(
        "V2 timber split", "#090705", "#22140d", 12.0, 4.0, 0.18, 0.96)


def irregular_beam(name: str, start, end, width: float, depth: float,
                    material: str, seed: int, sections: int = 7):
    rng = random.Random(seed)
    a, b = Vector(start), Vector(end)
    direction = b - a
    vertices = []
    for index in range(sections):
        t = index / (sections - 1)
        x = -direction.length / 2 + direction.length * t
        end_weight = abs(t - 0.5) * 2.0
        center_y = rng.uniform(-0.018, 0.018) + math.sin(t * math.pi * 1.4) * 0.014
        center_z = rng.uniform(-0.016, 0.016) + math.sin(t * math.pi * 1.1) * 0.012
        half_y = depth * 0.5 * (1.0 + rng.uniform(-0.055, 0.045) + end_weight * 0.018)
        half_z = width * 0.5 * (1.0 + rng.uniform(-0.06, 0.05) + end_weight * 0.025)
        vertices.extend([
            (x, center_y - half_y, center_z - half_z),
            (x, center_y + half_y, center_z - half_z),
            (x, center_y + half_y, center_z + half_z),
            (x, center_y - half_y, center_z + half_z),
        ])
    faces = [(0, 3, 2, 1)]
    for index in range(sections - 1):
        base = index * 4
        nxt = base + 4
        faces.extend([
            (base, nxt, nxt + 3, base + 3),
            (base + 1, base + 2, nxt + 2, nxt + 1),
            (base, base + 1, nxt + 1, nxt),
            (base + 3, nxt + 3, nxt + 2, base + 2),
        ])
    last = (sections - 1) * 4
    faces.append((last, last + 1, last + 2, last + 3))
    mesh = bpy.data.meshes.new(f"{name}_Mesh")
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    assert S.ACTIVE_COLLECTION is not None
    S.ACTIVE_COLLECTION.objects.link(obj)
    obj.parent = S.ACTIVE_ROOT
    obj.location = (a + b) * 0.5
    obj.rotation_mode = "QUATERNION"
    obj.rotation_quaternion = direction.to_track_quat("X", "Z")
    obj.data.materials.append(S.MATERIALS[material])
    bevel = obj.modifiers.new("Hand-hewn softened edges", "BEVEL")
    bevel.width = min(0.035, width * 0.10)
    bevel.segments = 3
    return obj


def natural_rock(name: str, xy, scale, seed: int, raise_z: float = 0.0):
    rng = random.Random(seed)
    bpy.ops.mesh.primitive_ico_sphere_add(subdivisions=3, radius=1.0, location=(xy[0], xy[1], 0))
    obj = B.link_to_active(bpy.context.object, name)
    phase = rng.uniform(-math.pi, math.pi)
    for vertex in obj.data.vertices:
        p = vertex.co.normalized()
        factor = (
            1.0
            + 0.115 * math.sin(p.x * 3.7 + p.z * 2.4 + phase)
            + 0.075 * math.sin(p.y * 5.1 - p.z * 3.2 - phase * 0.6)
            + 0.040 * math.sin((p.x + p.y) * 8.0 + phase * 1.7)
        )
        # Slight plane quantisation introduces broken quarry faces while the
        # subdivision level keeps them from reading as a deliberate low-poly prop.
        factor *= 1.0 + 0.025 * round((p.x * 0.7 + p.y * 0.4 + p.z) * 4.0)
        vertex.co.x *= scale[0] * factor
        vertex.co.y *= scale[1] * factor
        vertex.co.z *= scale[2] * (1.0 + 0.035 * math.sin(p.x * 5.0 + phase))
    minimum_z = min(vertex.co.z for vertex in obj.data.vertices)
    obj.location.z = -minimum_z + raise_z
    for polygon in obj.data.polygons:
        polygon.use_smooth = False
    obj.data.materials.append(S.MATERIALS["v2_slate"])
    return obj


def rivet(name: str, location, radius: float = 0.036):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=20, ring_count=10, radius=radius, location=location)
    obj = B.link_to_active(bpy.context.object, name)
    obj.scale = (1.0, 0.48, 1.0)
    S.apply_dimensions(obj)
    obj.data.materials.append(S.MATERIALS["v2_iron"])
    return obj


def build_model() -> None:
    S.new_model(KEY, (0, 0, 0))
    irregular_beam(f"{KEY}_Post_L", (-1.02, 0.02, 0.02), (-1.00, -0.01, 2.34),
                   0.34, 0.38, "v2_wood", 12601)
    irregular_beam(f"{KEY}_Post_R", (1.02, 0.02, 0.02), (0.98, 0.01, 2.34),
                   0.34, 0.38, "v2_wood", 12602)
    irregular_beam(f"{KEY}_CrackedCrossbeam", (-1.26, 0.02, 2.34), (1.24, 0.00, 2.42),
                   0.38, 0.42, "v2_wood", 12603, sections=9)
    irregular_beam(f"{KEY}_DiagonalBrace", (-0.88, -0.06, 0.34), (0.78, 0.02, 1.92),
                   0.24, 0.24, "v2_wood_dark", 12604)

    for side in (-1, 1):
        x = side * 1.01
        for band_index, z in enumerate((0.34, 1.72)):
            S.box(f"{KEY}_IronBand_{side:+d}_{band_index}", (x, 0.01, z),
                  (0.42, 0.46, 0.13), "v2_iron", bevel=0.018)
            for bolt_side in (-1, 1):
                rivet(f"{KEY}_Rivet_{side:+d}_{band_index}_{bolt_side:+d}",
                      (x + bolt_side * 0.105, -0.225, z), 0.034)

    # A shallow split line is modeled on the front of the cap, without changing
    # its silhouette or creating another structural component.
    S.curve(f"{KEY}_CrossbeamSplit", [
        (-0.69, -0.218, 2.50), (-0.58, -0.220, 2.43),
        (-0.64, -0.222, 2.36), (-0.51, -0.220, 2.31),
    ], 0.012, "v2_crack")

    rock_specs = (
        ((-0.52, 0.08), (0.62, 0.50, 0.43), 12611, 0.00),
        ((0.18, -0.03), (0.72, 0.55, 0.51), 12612, 0.015),
        ((0.72, 0.18), (0.48, 0.42, 0.33), 12613, 0.00),
        ((-0.85, -0.23), (0.38, 0.33, 0.25), 12614, 0.00),
    )
    for index, (xy, scale, seed, lift) in enumerate(rock_specs, start=1):
        natural_rock(f"{KEY}_Rockfall_{index:02d}", xy, scale, seed, lift)


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    S.clear_scene()
    S.setup_materials()
    B.setup_materials()
    register_materials()
    scene, camera = S.setup_scene()
    build_model()
    obstacle = {"key": KEY, "footprint": [2.70, 1.55]}
    B.create_footprint_guide(obstacle, (0, 0, 0))

    B.set_visibility(KEY, guides=False)
    shift_y = B.body_bottom_shift(scene, camera, S.MODEL_COLLECTIONS[KEY])
    calibration = OUT / "_bottom_calibration.png"
    B.configure_preview(scene, camera, calibration, shift_y=shift_y, transparent=True)
    shift_y += B.rendered_alpha_bottom_ndc(calibration) - (1.0 - B.BOTTOM_RATIO)
    calibration.unlink(missing_ok=True)
    B.configure_preview(scene, camera, INIT, shift_y=shift_y, transparent=True)
    B.set_visibility(KEY, guides=True)
    B.configure_preview(scene, camera, PREVIEW, shift_y=shift_y, transparent=True)
    B.set_visibility(KEY, guides=False)
    zmin, zmax = B.camera_depth_range(S.MODEL_COLLECTIONS[KEY], camera)
    B.configure_depth(scene, zmin, zmax, DEPTH)
    bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))

    contract = {
        "version": 2,
        "assetId": KEY,
        "sourceAssetId": "mine_obstacle_collapsed_support",
        "stage": "versioned realistic model calibration; no runtime promotion",
        "camera": {
            "projection": "orthographic",
            "elevationDegrees": B.CAMERA_ELEVATION_DEG,
            "modelRootRotationZDegrees": B.ROOT_ROTATION_DEG,
            "orthoScale": B.ORTHO_SCALE,
            "groundContactBottomRatio": B.BOTTOM_RATIO,
        },
        "structure": {
            "verticalPosts": 2,
            "topCrossbeams": 1,
            "diagonalBraces": 1,
            "connectedRockMasses": 4,
            "upgrades": [
                "seven-to-nine-section hand-hewn beam meshes",
                "subdivision-4 smoothly deformed natural rocks",
                "eight visible iron-band rivets",
                "modeled shallow crossbeam split",
                "procedural anisotropic wood, pitted iron and damp slate materials",
            ],
        },
        "footprint": [2.70, 1.55],
        "blend": str(BLEND.relative_to(REPO)).replace("\\", "/"),
        "preview": str(PREVIEW.relative_to(REPO)).replace("\\", "/"),
        "texturedInit": str(INIT.relative_to(REPO)).replace("\\", "/"),
        "bodyDepth": str(DEPTH.relative_to(REPO)).replace("\\", "/"),
    }
    (OUT / "model-contract-v2.json").write_text(
        json.dumps(contract, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved V2 model: {BLEND}")
    print(f"Approval preview: {PREVIEW}")
    print(f"Textured init: {INIT}")
    print(f"Body Depth: {DEPTH}")


if __name__ == "__main__":
    main()
