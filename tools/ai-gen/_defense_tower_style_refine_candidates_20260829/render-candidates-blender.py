#!/usr/bin/env python3
"""Render second-pass tower materials on the accepted geometry and camera."""
from pathlib import Path
import importlib.util
import sys

import bpy


HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


rdt = load_module("defense_tower_geometry", ROOT / "tools" / "render-defense-tower.py")
arm_frames = load_module("defense_tower_arm_geometry", ROOT / "tools" / "render-defense-tower-frames.py")


def image_material(name, image_path, roughness, metallic, tile_u, tile_v, tint, bump_strength):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = rdt._get_bsdf(nt)

    coord = nt.nodes.new("ShaderNodeTexCoord")
    mapping = nt.nodes.new("ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (tile_u, tile_v, 1.0)
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = bpy.data.images.load(str(image_path))
    tex.extension = "REPEAT"
    tex.interpolation = "Linear"
    tint_node = nt.nodes.new("ShaderNodeMixRGB")
    tint_node.blend_type = "MULTIPLY"
    tint_node.inputs[0].default_value = 1.0
    tint_node.inputs[2].default_value = (*tint, 1.0)
    gray = nt.nodes.new("ShaderNodeRGBToBW")
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = bump_strength
    bump.inputs["Distance"].default_value = 0.045

    nt.links.new(coord.outputs["UV"], mapping.inputs["Vector"])
    nt.links.new(mapping.outputs["Vector"], tex.inputs["Vector"])
    nt.links.new(tex.outputs["Color"], tint_node.inputs[1])
    nt.links.new(tint_node.outputs["Color"], bsdf.inputs["Base Color"])
    nt.links.new(tex.outputs["Color"], gray.inputs["Color"])
    nt.links.new(gray.outputs["Val"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], bsdf.inputs["Normal"])
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    return mat


def render_variant(variant_id, concrete_path, metal_path, out_dir):
    out_dir.mkdir(parents=True, exist_ok=True)
    cfg = {
        "candidate_1": {
            "concrete": (0.96, 0.94, 0.90), "metal": (0.95, 0.98, 1.02),
            "dark": 0.78, "light": 1.05, "rough": 0.42,
            "service": (0.25, 0.58, 0.61), "brass": (0.48, 0.27, 0.09),
        },
        "candidate_2": {
            "concrete": (0.91, 0.86, 0.78), "metal": (0.90, 0.94, 0.98),
            "dark": 0.74, "light": 1.08, "rough": 0.51,
            "service": (0.50, 0.46, 0.36), "brass": (0.42, 0.25, 0.10),
        },
        "candidate_3": {
            "concrete": (1.00, 1.01, 1.02), "metal": (0.88, 0.96, 1.04),
            "dark": 0.74, "light": 1.10, "rough": 0.39,
            "service": (0.58, 0.47, 0.20), "brass": (0.46, 0.30, 0.11),
        },
    }[variant_id]

    concrete = image_material(
        f"{variant_id}_concrete", concrete_path,
        roughness=0.76, metallic=0.01, tile_u=1.35, tile_v=1.65,
        tint=cfg["concrete"], bump_strength=0.085,
    )
    metal = image_material(
        f"{variant_id}_metal", metal_path,
        roughness=cfg["rough"], metallic=0.70, tile_u=1.45, tile_v=1.25,
        tint=cfg["metal"], bump_strength=0.045,
    )
    dark_metal = image_material(
        f"{variant_id}_dark_metal", metal_path,
        roughness=min(0.62, cfg["rough"] + 0.08), metallic=0.74,
        tile_u=1.65, tile_v=1.35,
        tint=tuple(v * cfg["dark"] for v in cfg["metal"]), bump_strength=0.04,
    )
    light_metal = image_material(
        f"{variant_id}_light_metal", metal_path,
        roughness=max(0.32, cfg["rough"] - 0.06), metallic=0.66,
        tile_u=1.35, tile_v=1.10,
        tint=tuple(min(1.15, v * cfg["light"]) for v in cfg["metal"]), bump_strength=0.035,
    )
    service = rdt.flat_material(f"{variant_id}_service", cfg["service"], 0.43, 0.48)
    brass = rdt.flat_material(f"{variant_id}_brass", cfg["brass"], 0.48, 0.66)

    rdt.clear_scene()
    rdt.setup_lighting()
    base_objs = rdt.build_base(concrete, dark_metal, light_metal)
    camera = rdt.setup_camera(base_objs, 400, target=(0, 0, 75))
    bpy.context.scene.camera = camera
    rdt.render(str(out_dir / f"{variant_id}_base_full.png"))

    rdt.clear_scene()
    rdt.setup_lighting()
    arm_objs = arm_frames.build_arm_bent(metal, dark_metal, service, brass)
    camera = rdt.setup_camera(arm_objs, 400, target=(20, 0, arm_frames.Z_PIVOT))
    bpy.context.scene.camera = camera
    rdt.render(str(out_dir / f"{variant_id}_arm_full.png"))


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    if len(argv) != 4:
        raise SystemExit("usage: blender --background --python render-candidates-blender.py -- variant concrete.png metal.png out_dir")
    variant_id, concrete_path, metal_path, out_dir = argv
    render_variant(variant_id, Path(concrete_path), Path(metal_path), Path(out_dir))


if __name__ == "__main__":
    main()
