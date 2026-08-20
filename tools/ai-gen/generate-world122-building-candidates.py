#!/usr/bin/env python3
"""Generate review-only World-122 building-body candidates through the fixed-foundation pipeline.

Outputs only to the manifest scratch directory. It never copies a candidate into assets/terrain.
Jobs are resumable: a fully produced preview is skipped on the next run.
"""
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO / "tools/ai-gen/world122-building-candidate-manifest.json"
COMFY_PY = REPO.parent / "ComfyUI/.venv/Scripts/python.exe"
BLENDER = Path("E:/Program Files/Blender Foundation/Blender 5.1/blender.exe")
FOUNDATION_FIT_SCALE = 1.42


def run(command: list[str], *, label: str) -> None:
    print(f"\n[{label}] {' '.join(command)}", flush=True)
    result = subprocess.run(command, cwd=REPO, timeout=780)
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed with exit code {result.returncode}")


def prompt_for(asset: dict) -> str:
    return f"""Use case: stylized-concept
Asset type: World-122 RTS building body, to be composited above an immutable separate marble foundation
Primary request: exactly one {asset['primaryRequest']}
Style/medium: detailed but sober semi-realistic RTS building sprite matching the existing World-122 barracks; low-saturation realistic PBR materials; crisp readable roof tiles, stone courses and timber grain; no exaggerated fantasy ornament
Composition/framing: strictly follow the supplied depth-control silhouette and its orthographic 2.5D isometric view; centered; architecture ends exactly at the supplied ground line; all walls remain vertical; no perspective convergence
Component fidelity: preserve every major component indicated by the control silhouette (main square hall, roof masses, towers, annexes, chimneys and observatory/portal elements); do not omit, merge, flatten or replace any supplied component
Lighting/mood: evenly lit neutral studio lighting; no bloom; no cast shadow
Scene/backdrop: perfectly uniform flat chroma-key green #00FF00 background filling the entire canvas; no horizon; no texture; no scenery
Negative constraints: no plumbing, pipes, water tubes, steam pipes, laboratory tubing, modern utilities, contemporary fixtures, industrial conduits, antennas, satellite dishes, exposed machinery, futuristic parts; no flat rooftop terrace, elevated deck, raised square platform, roof plaza, or detached upper block; the upper tower must sit directly on the supplied roof mass; one building only; building body only; absolutely no foundation; no plinth; no raised stone slab; no floor; no paving; no terrain; no grass; no trees; no stairs; no fence; no props outside the architecture; no people; no animals; no flags; no text; no watermark; at the ground line the lower wall material must continue unchanged to the bottom edge; render architecture only with transparent pixels outside the supplied silhouette; absolutely no platform, pavement, steps, curb, pedestal, foundation slab, floor tile, white marble skirt, pale stone band, or contrasting base strip (the fixed marble foundation is added only by the separate review composite)
"""


def load_spec(asset: dict, destination: Path) -> None:
    if asset.get("sourceSpec"):
        source = REPO / asset["sourceSpec"]
        data = json.loads(source.read_text(encoding="utf-8"))
    else:
        data = {}
    data.update({
        "elevation": 30,
        "azimuth": 0,
        "resolution": 1024,
        "bottom_y": 880,
        "max_width_frac": 0.80,
        "top_margin_px": 48,
        "center_on_origin": True,
        "foundation_fit_scale": FOUNDATION_FIT_SCALE,
    })
    if asset.get("primitives"):
        data["primitives"] = json.loads(json.dumps(asset["primitives"]))
    if asset.get("footprintMode", "square_2x2") == "square_2x2":
        _normalize_square_footprint(data)
    destination.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _primitive_xy_bounds(primitive: dict) -> tuple[float, float, float, float] | None:
    pos = primitive.get("pos", [0, 0, 0])
    px, py = float(pos[0]), float(pos[1])
    kind = primitive.get("type")
    if kind in {"box", "prism"} and len(primitive.get("size", [])) >= 2:
        sx, sy = float(primitive["size"][0]), float(primitive["size"][1])
    elif kind in {"cylinder", "cone", "sphere"}:
        radius = float(primitive.get("radius1", primitive.get("radius", 0)))
        sx = sy = radius * 2.0
    else:
        return None
    # The depth whitebox uses a fixed 44.8° footprint rotation for World-122.
    # Use the rotated AABB so towers/offset wings are included in the square fit.
    angle = float((primitive.get("rot") or [0, 0, 44.8])[2])
    import math
    c, s = abs(math.cos(math.radians(angle))), abs(math.sin(math.radians(angle)))
    hx = (sx * c + sy * s) * 0.5
    hy = (sx * s + sy * c) * 0.5
    return px - hx, px + hx, py - hy, py + hy


def _normalize_square_footprint(data: dict) -> None:
    """Make the control whitebox square in world XY before Blender renders it.

    The runtime foundation is a fixed 2x2 square. A rectangular main hall
    cannot be repaired by a sprite translation, so make every ground-contacting
    architectural box/prism square in XY while leaving upper roofs, windows,
    doors, braces and decorative props untouched. This only changes the derived
    depth spec in scratch.
    """
    primitives = data.get("primitives") or []
    changed = 0
    for primitive in primitives:
        size = primitive.get("size")
        if primitive.get("type") not in {"box", "prism"}:
            continue
        if not isinstance(size, list) or len(size) < 3:
            continue
        # Only geometry that actually touches z=0 defines the placement
        # footprint.  Upper roofs and trim may stay rectangular; ground-level
        # wings and annexes must be square too, otherwise they still protrude
        # beyond the fixed 2x2 foundation after sprite masking.
        pos = primitive.get("pos") or [0, 0, 0]
        bottom_z = float(pos[2]) - float(size[2]) * 0.5
        if bottom_z > 2.0 or min(float(size[0]), float(size[1])) < 32:
            continue
        side = max(float(size[0]), float(size[1])) * float(data.get("foundation_fit_scale", FOUNDATION_FIT_SCALE))
        if abs(float(size[0]) - float(size[1])) > 0.5:
            size[0] = side
            size[1] = side
            changed += 1
    data["square_footprint_normalization"] = {
        "squarePrimitiveCount": changed,
        "foundation": "building_foundation_2x2",
        "fitScale": float(data.get("foundation_fit_scale", FOUNDATION_FIT_SCALE)),
    }


def generate_asset(asset: dict, manifest: dict, output_root: Path, variants: int) -> None:
    asset_dir = output_root / asset["id"]
    asset_dir.mkdir(parents=True, exist_ok=True)
    spec = asset_dir / f"{asset['id']}_depth_spec.json"
    depth = asset_dir / f"{asset['id']}_depth.png"
    prompt = asset_dir / f"{asset['id']}_prompt.txt"
    load_spec(asset, spec)
    prompt.write_text(prompt_for(asset), encoding="utf-8")
    if not depth.exists():
        run([
            str(BLENDER), "--background", "--factory-startup", "--python",
            str(REPO / "tools/ai-gen/blender-depth-render.py"), "--", str(spec), str(depth),
        ], label=f"{asset['id']} depth")

    for variant in range(1, variants + 1):
        stem = f"{asset['id']}_v{variant:02d}"
        raw = asset_dir / f"{stem}_raw.png"
        keyed = asset_dir / f"{stem}_keyed.png"
        cleaned = asset_dir / f"{stem}_cleaned.png"
        anchored = asset_dir / f"{stem}_anchored.png"
        final = asset_dir / f"{stem}_body.png"
        preview = asset_dir / f"{stem}_preview.png"
        if preview.exists():
            print(f"[{asset['id']} v{variant:02d}] already complete; skipping", flush=True)
            continue
        seed = 122200 + (list_index[asset["id"]] * 10) + variant
        if not raw.exists():
            run([
                str(COMFY_PY), str(REPO / "tools/ai-gen/comfyui-gen.py"),
                "--host", manifest["host"], "--model", manifest["model"],
                "--steps", str(manifest["steps"]), "--strength", str(manifest["strength"]),
                "--control-image", str(depth), "--bg-color", "#00FF00", "--seed", str(seed),
                "--prompt-file", str(prompt), "--out", str(raw), "--timeout", "720",
            ], label=f"{asset['id']} v{variant:02d} generate")
        if not keyed.exists():
            run([str(COMFY_PY), str(REPO / "tools/ai-gen/key-world122-building-body.py"), str(raw), str(keyed)], label=f"{asset['id']} v{variant:02d} key")
        if not cleaned.exists():
            run([str(COMFY_PY), str(REPO / "tools/ai-gen/remove-world122-building-pseudo-plinth.py"), str(keyed), str(cleaned)], label=f"{asset['id']} v{variant:02d} clean")
        if not anchored.exists():
            run([str(COMFY_PY), str(REPO / "tools/ai-gen/anchor-world122-building-body.py"), str(cleaned), str(depth), str(anchored),
                 "--display-width", "256", "--display-height", "256", "--nominal-width", "256", "--nominal-height", "128"],
                label=f"{asset['id']} v{variant:02d} anchor")
        if not final.exists():
            run([str(COMFY_PY), str(REPO / "tools/ai-gen/mask-world122-building-body.py"), str(anchored), str(depth), str(final)], label=f"{asset['id']} v{variant:02d} mask")
        run([str(COMFY_PY), str(REPO / "tools/ai-gen/compose-world122-building-preview.py"), str(final), str(preview)], label=f"{asset['id']} v{variant:02d} preview")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--variants", type=int, default=None)
    parser.add_argument("--only", nargs="*", default=None, help="asset ids to generate")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    output_root = args.out or Path(manifest["outputRoot"])
    variants = args.variants or manifest.get("variants", 2)
    selected = [a for a in manifest["assets"] if not args.only or a["id"] in args.only]
    global list_index
    list_index = {a["id"]: i for i, a in enumerate(manifest["assets"])}
    if not COMFY_PY.exists():
        raise FileNotFoundError(f"ComfyUI Python missing: {COMFY_PY}")
    if not BLENDER.exists():
        raise FileNotFoundError(f"Blender missing: {BLENDER}")
    print(f"output={output_root} assets={len(selected)} variants={variants}", flush=True)
    for asset in selected:
        generate_asset(asset, manifest, output_root, variants)
    print("all requested candidates complete", flush=True)


if __name__ == "__main__":
    main()
