#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Render a shadow-only Body Depth from an approved building .blend.

The source model, camera and source artwork are not changed. Only the authored
whole-building foundation meshes are hidden; attached thresholds, annexes,
chimney shoes and other body supports remain part of the caster silhouette.
"""

import importlib.util
import json
import os
import sys
from pathlib import Path

import bpy


SCRIPT_DIR = Path(__file__).resolve().parent


def load_kit():
    module_path = SCRIPT_DIR / "building-component-kit.py"
    spec = importlib.util.spec_from_file_location("shadow_body_depth_kit", module_path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    if len(values) != 2:
        raise SystemExit(
            "usage: blender --background --factory-startup approved.blend --python "
            "render-foundation-free-building-depth.py -- asset_id output.png"
        )
    return values[0], Path(os.path.abspath(values[1]))


def main():
    asset_id, output_path = parse_args()
    expected_root = asset_id.upper() + "_ROOT_ROT_Z_44_8"
    root = bpy.data.objects.get(expected_root)
    if root is None:
        raise RuntimeError(f"missing approved model root: {expected_root}")
    scene = bpy.context.scene
    if scene.camera is None:
        raise RuntimeError("approved model has no active camera")

    foundation_prefixes = [
        asset_id + "_Foundation",
        "".join(part.capitalize() for part in asset_id.split("_")) + "_Foundation",
    ]
    excluded = []
    foundation_prefix = foundation_prefixes[0]
    for candidate_prefix in foundation_prefixes:
        candidate_objects = [
            obj for obj in root.children_recursive
            if obj.type == "MESH"
            and (obj.name == candidate_prefix or obj.name.startswith(candidate_prefix + "_"))
        ]
        if candidate_objects:
            foundation_prefix = candidate_prefix
            excluded = candidate_objects
            break
    if not excluded:
        raise RuntimeError(
            "no authored whole-building foundation meshes match "
            + " or ".join(foundation_prefixes))
    for obj in excluded:
        obj.hide_render = True

    output_path.parent.mkdir(parents=True, exist_ok=True)
    kit = load_kit()
    kit.render_depth(scene, root, scene.camera, str(output_path), asset_id + "_ShadowBody")

    metadata_path = output_path.with_suffix(".json")
    metadata = {
        "algorithmVersion": 1,
        "assetId": asset_id,
        "sourceBlend": os.path.relpath(bpy.data.filepath, os.getcwd()).replace("\\", "/"),
        "output": os.path.relpath(output_path, os.getcwd()).replace("\\", "/"),
        "bodyDepthIncludesFoundation": False,
        "foundationExclusionMode": "exact-authored-building-foundation-prefix",
        "foundationObjectPrefix": foundation_prefix,
        "excludedObjects": sorted(obj.name for obj in excluded),
        "cameraName": scene.camera.name,
        "generator": "tools/ai-gen/render-foundation-free-building-depth.py",
    }
    metadata_path.write_text(
        json.dumps(metadata, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print("foundation-free body depth ->", output_path)
    print("excluded foundation objects ->", ", ".join(metadata["excludedObjects"]))
    print("metadata ->", metadata_path)


if __name__ == "__main__":
    main()
