#!/usr/bin/env python3
"""Render the selected candidate-3 material on the accepted 48-frame arm rig."""
from pathlib import Path
import importlib.util
import math
import sys

import bpy


HERE = Path(__file__).resolve().parent
FRAMES = 48
ORTHO_SCALE = 400
SIZE = 1024


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, str(path))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


candidate_renderer = load_module(
    "defense_tower_candidate_renderer",
    HERE / "render-candidates-blender.py",
)
rdt = candidate_renderer.rdt
arm_frames = candidate_renderer.arm_frames


def main():
    argv = sys.argv[sys.argv.index("--") + 1:]
    if len(argv) != 2:
        raise SystemExit(
            "usage: blender --background --python "
            "render-selected-arm-frames-blender.py -- metal.png out_dir"
        )
    metal_path, out_dir = Path(argv[0]), Path(argv[1])
    out_dir.mkdir(parents=True, exist_ok=True)

    metal_tint = (0.88, 0.96, 1.04)
    metal = candidate_renderer.image_material(
        "selected_candidate_3_metal", metal_path,
        roughness=0.39, metallic=0.70, tile_u=1.45, tile_v=1.25,
        tint=metal_tint, bump_strength=0.045,
    )
    dark_metal = candidate_renderer.image_material(
        "selected_candidate_3_dark_metal", metal_path,
        roughness=0.47, metallic=0.74, tile_u=1.65, tile_v=1.35,
        tint=tuple(v * 0.74 for v in metal_tint), bump_strength=0.04,
    )
    service = rdt.flat_material(
        "selected_candidate_3_service", (0.58, 0.47, 0.20), 0.43, 0.48
    )
    brass = rdt.flat_material(
        "selected_candidate_3_brass", (0.46, 0.30, 0.11), 0.48, 0.66
    )

    rdt.clear_scene()
    rdt.setup_lighting()
    objects = arm_frames.build_arm_bent(metal, dark_metal, service, brass)
    camera = rdt.setup_camera(
        objects,
        ORTHO_SCALE,
        target=(20, 0, arm_frames.Z_PIVOT),
    )
    bpy.context.scene.camera = camera

    bpy.ops.object.empty_add(
        type="PLAIN_AXES",
        location=(0, 0, arm_frames.Z_PIVOT),
    )
    pivot = bpy.context.active_object
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = pivot
    bpy.ops.object.parent_set(type="OBJECT", keep_transform=True)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = SIZE
    scene.render.resolution_y = SIZE
    scene.render.resolution_percentage = 100
    scene.render.film_transparent = True
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    scene.render.dither_intensity = 0.0

    step = 360.0 / FRAMES
    for index in range(FRAMES):
        pivot.rotation_euler = (0, 0, math.radians(index * step))
        scene.render.filepath = str(out_dir / f"frame_{index:03d}.png")
        bpy.ops.render.render(write_still=True)
        print(f"selected arm frame {index + 1}/{FRAMES} saved")


if __name__ == "__main__":
    main()
