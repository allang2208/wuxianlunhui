#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Export a semantic, foundation-free shadow proxy from the current .blend."""

from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import os
import sys
from pathlib import Path

import bpy


SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[1]


def _load_core():
    path = SCRIPT_DIR / "building-shadow-proxy-core.py"
    spec = importlib.util.spec_from_file_location("world122_shadow_proxy_core", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


core = _load_core()


def _repo_relative(value, label):
    resolved = Path(value).resolve()
    relative = os.path.relpath(resolved, REPO_ROOT)
    if relative == os.pardir or relative.startswith(os.pardir + os.sep):
        raise ValueError(f"{label} must stay inside repository root: {resolved}")
    return Path(relative).as_posix()


def _root_local_mesh_record(root, obj, depsgraph, role):
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    try:
        transform = root.matrix_world.inverted() @ evaluated.matrix_world
        vertices = [transform @ vertex.co for vertex in mesh.vertices]
    finally:
        evaluated.to_mesh_clear()
    if not vertices:
        return None
    return {
        "name": obj.name,
        "role": role,
        "group": obj.get("shadow_group"),
        "points": [[vertex.x, vertex.y] for vertex in vertices],
        "zMin": min(vertex.z for vertex in vertices),
        "zMax": max(vertex.z for vertex in vertices),
    }


def _semantic_role(obj, asset_id, explicit_ground_names):
    explicit = str(obj.get("shadow_role") or "").strip().lower()
    if explicit in ("ground", "body", "part", "ignore"):
        return explicit
    if obj.hide_render:
        return "ignore"
    lower_name = obj.name.lower()
    if obj.name in explicit_ground_names:
        return "ground"
    authored_prefix = (asset_id + "_Foundation").lower()
    if lower_name == authored_prefix or lower_name.startswith(authored_prefix + "_"):
        return "ground"
    return "body"


def _foundation_spec(spec):
    dimensions = spec.get("dimensions") or {}
    foundation = dimensions.get("foundation")
    if not isinstance(foundation, list) or len(foundation) < 3:
        raise ValueError("semantic shadow proxy requires dimensions.foundation [width, depth, height]")
    width, depth, height = (float(value) for value in foundation[:3])
    if width <= 0 or depth <= 0 or height < 0:
        raise ValueError("invalid dimensions.foundation for semantic shadow proxy")
    return width, depth, height


def export_shadow_proxy(root, spec, asset_id, output_path, *, source_manifest=None):
    width, depth, ground_z = _foundation_spec(spec)
    explicit_ground_names = set(spec.get("bodyDepthExclude") or [])
    depsgraph = bpy.context.evaluated_depsgraph_get()
    records = []
    ground_names = []
    ignored_names = []
    for obj in root.children_recursive:
        if obj.type != "MESH":
            continue
        role = _semantic_role(obj, asset_id, explicit_ground_names)
        if role == "ground":
            ground_names.append(obj.name)
        elif role == "ignore":
            ignored_names.append(obj.name)
        record = _root_local_mesh_record(root, obj, depsgraph, role)
        if record is not None:
            records.append(record)
    if not ground_names and str(spec.get("foundationStyle") or "") != "none":
        raise ValueError(
            f"{asset_id} has a modeled foundation but no ground semantic; "
            "use kit.set_shadow_role(..., 'ground') or bodyDepthExclude")

    proxy = core.build_shadow_proxy(
        records,
        width,
        depth,
        ground_z,
        band_count=int(spec.get("shadowProxyBands", 4)),
        cluster_gap_ratio=float(spec.get("shadowProxyClusterGapRatio", 0.0125)),
        max_points=int(spec.get("shadowProxyMaxPoints", 12)),
        max_parts=int(spec.get("shadowProxyMaxParts", 32)),
    )
    blend_path = Path(bpy.data.filepath).resolve()
    blend_hash = hashlib.sha256(blend_path.read_bytes()).hexdigest() if blend_path.is_file() else None
    output = {
        "algorithmVersion": 2,
        "assetId": asset_id,
        "sourceKind": "semantic_shadow_proxy_v2",
        "generator": "tools/ai-gen/building-shadow-proxy.py",
        "sourceBlend": _repo_relative(blend_path, "source blend")
        if blend_path.is_file() else None,
        "sourceBlendSha256": blend_hash,
        "sourceManifest": _repo_relative(source_manifest, "source manifest")
        if source_manifest else None,
        "foundation": {
            "width": width,
            "depth": depth,
            "groundZ": ground_z,
            "excluded": True,
            "exclusionMode": "semantic-role-or-exact-authored-name",
            "groundObjects": sorted(ground_names),
        },
        "ignoredObjects": sorted(ignored_names),
        **proxy,
    }
    destination = Path(output_path).resolve()
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(
        json.dumps(output, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return output


def _cli_args():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-id", required=True)
    parser.add_argument("--manifest", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    return parser.parse_args(values)


def main():
    args = _cli_args()
    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8-sig"))
    spec = manifest["buildings"][args.asset_id]
    root = bpy.data.objects.get(args.asset_id.upper() + "_ROOT_ROT_Z_44_8")
    if root is None:
        raise SystemExit(f"missing model root for {args.asset_id}")
    result = export_shadow_proxy(
        root, spec, args.asset_id, args.output, source_manifest=manifest_path)
    print("semantic shadow proxy ->", args.output.resolve())
    print("ground objects excluded ->", len(result["foundation"]["groundObjects"]))
    print("body objects ->", result["bodyObjectCount"])
    print("shadow parts ->", len(result["parts"]))


if __name__ == "__main__":
    main()
