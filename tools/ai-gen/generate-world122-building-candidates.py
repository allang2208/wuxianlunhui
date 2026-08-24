#!/usr/bin/env python3
"""Generate review-only World-122 building-body candidates for the road-fill pipeline.

Outputs only to the manifest scratch directory. It never copies a candidate into assets/terrain.
Jobs are resumable: a fully produced preview is skipped on the next run.
"""
from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path


REPO = Path(__file__).resolve().parents[2]
DEFAULT_MANIFEST = REPO / "tools/ai-gen/world122-building-candidate-manifest.json"
COMFY_PY = REPO.parent / "ComfyUI/.venv/Scripts/python.exe"
BLENDER = Path("E:/Program Files/Blender Foundation/Blender 5.1/blender.exe")
FOOTPRINT_FIT_SCALE = 1.42
CANONICAL_STYLE_VERSION = "world122-building-v2"
CANONICAL_STYLE_TEMPLATE = "tools/ai-gen/prompts/world122-building-style.md"


def run(command: list[str], *, label: str, timeout: int = 780) -> None:
    print(f"\n[{label}] {' '.join(command)}", flush=True)
    result = subprocess.run(command, cwd=REPO, timeout=timeout)
    if result.returncode != 0:
        raise RuntimeError(f"{label} failed with exit code {result.returncode}")


def resolve_repo_file(value: str, *, label: str) -> Path:
    path = Path(value)
    if not path.is_absolute():
        path = REPO / path
    if not path.is_file():
        raise FileNotFoundError(f"{label} missing: {path}")
    return path


def style_contract_for(manifest: dict) -> tuple[str, str, str]:
    style_version = str(manifest.get("styleVersion", "")).strip()
    style_template = str(manifest.get("styleTemplate", "")).strip()
    if style_version != CANONICAL_STYLE_VERSION:
        raise ValueError(
            f"official building candidates require styleVersion={CANONICAL_STYLE_VERSION}; "
            f"got {style_version or '<missing>'}"
        )
    if Path(style_template).as_posix() != CANONICAL_STYLE_TEMPLATE:
        raise ValueError(
            f"official building candidates require styleTemplate={CANONICAL_STYLE_TEMPLATE}; "
            f"got {style_template or '<missing>'}"
        )
    style_path = resolve_repo_file(style_template, label="style template")
    contract = style_path.read_text(encoding="utf-8").strip()
    if not contract:
        raise ValueError(f"style template is empty: {style_path}")
    return style_version, style_template, contract


def prompt_for(asset: dict, manifest: dict, stage: str = "legacy") -> str:
    if stage == "structure":
        request = asset.get("structureRequest", asset["primaryRequest"])
    elif stage == "refine":
        request = asset.get("detailRequest", asset["primaryRequest"])
    else:
        request = asset["primaryRequest"]
    if stage == "structure":
        stage_contract = """Generation stage: structural massing draft only
Structure contract: create closed, continuous, solid architecture; preserve the exact count and placement of the main hall, roof masses and towers from the supplied controls; every tower wall must intersect the supporting roof or hall; all tower corners, roof faces and lower walls must be complete; windows are shallow closed recesses, never open holes
Detail budget: omit telescopes, armillary spheres, books, signs, pipes, furniture and small ornaments; use plain readable stone, timber and roof materials so structural completeness can be judged"""
    elif stage == "refine":
        stage_contract = """Generation stage: detail refinement of the supplied initial image
Structure contract: preserve the initial image's exact building silhouette, tower count, tower placement, roofline, camera, center and ground-contact edge; do not rebuild, move, merge, remove or add any major architectural mass
Detail budget: improve only materials, masonry courses, roof tiles, windows and the specifically requested scholarly details; keep all existing walls solid and continuous"""
    else:
        stage_contract = """Generation stage: single-pass legacy candidate
Structure contract: preserve every major component indicated by the control silhouette; do not omit, merge, flatten or replace any supplied component"""
    palette_contract = ""
    if asset.get("paletteConstraint"):
        palette_contract = f"Palette lock: {asset['paletteConstraint']}\n"
    style_version, _style_template, style_contract = style_contract_for(manifest)
    return f"""Use case: stylized-concept
Asset type: World-122 RTS building body, previewed above the runtime 2x2 road-tile fill
Pipeline/style version: {style_version}
Primary request: exactly one {request}
{stage_contract}
{palette_contract}{style_contract}
Composition/framing: strictly follow the supplied depth-control silhouette and its orthographic 2.5D isometric view; centered; architecture ends exactly at the supplied ground line; all walls remain vertical; no perspective convergence
Lighting/mood: evenly lit neutral studio lighting; no bloom; no cast shadow
Scene/backdrop: perfectly uniform flat chroma-key green #00FF00 background filling the entire canvas; no horizon; no texture; no scenery
Negative constraints: no plumbing, pipes, water tubes, steam pipes, laboratory tubing, modern utilities, contemporary fixtures, industrial conduits, antennas, satellite dishes, exposed machinery, futuristic parts; no flat rooftop terrace, elevated deck, raised square platform, roof plaza, or detached upper block; the upper tower must sit directly on the supplied roof mass; one building only; building body only; absolutely no separate foundation; no plinth; no raised stone slab; no floor; no baked paving; no terrain; no grass; no trees; no stairs; no fence; no props outside the architecture; no people; no animals; no flags; no text; no watermark; at the ground line the lower wall material must continue unchanged to the bottom edge; render architecture only with transparent pixels outside the supplied silhouette; absolutely no platform, pavement, steps, curb, pedestal, foundation slab, floor tile, white marble skirt, pale stone band, or contrasting base strip (runtime road tiles are added only by the separate review composite)
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
        "footprint_fit_scale": FOOTPRINT_FIT_SCALE,
    })
    if asset.get("primitives"):
        data["primitives"] = json.loads(json.dumps(asset["primitives"]))
    overlap_z = float(asset.get("structuralOverlapZ", 0))
    if overlap_z > 0:
        _extend_upper_masses_downward(data, overlap_z)
    if asset.get("footprintMode", "square_2x2") == "square_2x2":
        _normalize_square_footprint(data)
    destination.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def _extend_upper_masses_downward(data: dict, overlap_z: float) -> None:
    """Make upper whitebox masses intersect their supports instead of merely touching.

    Diffusion models interpret coplanar primitive contacts as ledges, voids or
    detached towers.  Extending only the bottom of non-grounded boxes/prisms
    gives the depth and edge controls an unambiguous continuous intersection
    while preserving the authored top height.
    """
    changed = 0
    for primitive in data.get("primitives") or []:
        if primitive.get("type") not in {"box", "prism"}:
            continue
        size = primitive.get("size")
        pos = primitive.get("pos")
        if not isinstance(size, list) or len(size) < 3 or not isinstance(pos, list) or len(pos) < 3:
            continue
        bottom_z = float(pos[2]) - float(size[2]) * 0.5
        if bottom_z <= 2.0:
            continue
        size[2] = float(size[2]) + overlap_z
        pos[2] = float(pos[2]) - overlap_z * 0.5
        changed += 1
    data["structural_overlap"] = {"extendedPrimitiveCount": changed, "overlapZ": overlap_z}


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

    The runtime collision footprint is a fixed 2x2 square. A rectangular main hall
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
        # beyond the fixed 2x2 footprint after sprite masking.
        pos = primitive.get("pos") or [0, 0, 0]
        bottom_z = float(pos[2]) - float(size[2]) * 0.5
        if bottom_z > 2.0 or min(float(size[0]), float(size[1])) < 32:
            continue
        side = max(float(size[0]), float(size[1])) * float(data.get("footprint_fit_scale", FOOTPRINT_FIT_SCALE))
        if abs(float(size[0]) - float(size[1])) > 0.5:
            size[0] = side
            size[1] = side
            changed += 1
    data["square_footprint_normalization"] = {
        "squarePrimitiveCount": changed,
        "fitScale": float(data.get("footprint_fit_scale", FOOTPRINT_FIT_SCALE)),
    }


def generate_asset(asset: dict, manifest: dict, output_root: Path, variants: int, *,
                   stage: str = "legacy", init_image: Path | None = None,
                   edge_image: Path | None = None, steps_override: int | None = None,
                   denoise_override: float | None = None, seed_override: int | None = None,
                   use_edge_control: bool = False,
                   generation_timeout: int | None = None,
                   rebuild_derived: bool = False) -> None:
    asset_dir = output_root / asset["id"]
    asset_dir.mkdir(parents=True, exist_ok=True)
    prompt_suffix = "" if stage == "legacy" else f"_{stage}"
    # Keep staged controls separate from legacy outputs.  Otherwise an older
    # cached whitebox can silently survive a manifest geometry change.
    spec = asset_dir / f"{asset['id']}{prompt_suffix}_depth_spec.json"
    depth = asset_dir / f"{asset['id']}{prompt_suffix}_depth.png"
    generated_edge = asset_dir / f"{asset['id']}{prompt_suffix}_edge.png"
    control_edge = edge_image or generated_edge
    prompt = asset_dir / f"{asset['id']}{prompt_suffix}_prompt.txt"
    load_spec(asset, spec)
    prompt.write_text(prompt_for(asset, manifest, stage), encoding="utf-8")
    if asset.get("controlImage"):
        source_depth = Path(asset["controlImage"])
        if not source_depth.is_absolute():
            source_depth = REPO / source_depth
        if not source_depth.is_file():
            raise FileNotFoundError(f"control image missing: {source_depth}")
        if source_depth.resolve() != depth.resolve():
            shutil.copy2(source_depth, depth)
        print(f"[{asset['id']} depth] using authored control {source_depth}", flush=True)
    elif not depth.exists():
        run([
            str(BLENDER), "--background", "--factory-startup", "--python",
            str(REPO / "tools/ai-gen/blender-depth-render.py"), "--", str(spec), str(depth),
        ], label=f"{asset['id']} depth")
    if stage != "legacy" and not control_edge.exists():
        run([
            str(COMFY_PY), str(REPO / "tools/ai-gen/make-world122-building-edge-control.py"),
            str(depth), str(control_edge),
        ], label=f"{asset['id']} edge")

    if stage == "legacy":
        steps = steps_override or int(manifest["steps"])
        depth_strength = float(manifest["strength"])
        edge_strength = None
        denoise = None
        mask_edge_pad = int(manifest.get("legacyMaskEdgePad", 3))
    elif stage == "structure":
        steps = steps_override or int(manifest.get("structureSteps", 12))
        depth_strength = float(manifest.get("structureDepthStrength", manifest.get("strength", 0.78)))
        edge_strength = float(manifest.get("structureEdgeStrength", 0.38))
        denoise = None
        mask_edge_pad = int(manifest.get("maskEdgePad", 16))
    else:
        steps = steps_override or int(manifest.get("refineSteps", 48))
        depth_strength = float(manifest.get("refineDepthStrength", 0.75))
        edge_strength = float(manifest.get("refineEdgeStrength", 0.38))
        denoise = (denoise_override if denoise_override is not None
                   else float(manifest.get("refineDenoise", 0.30)))
        mask_edge_pad = int(manifest.get("maskEdgePad", 16))

    request_timeout = int(generation_timeout or manifest.get("generationTimeout", 3600))
    style_version, style_template, _style_contract = style_contract_for(manifest)
    cfg = float(manifest.get("cfg", 3.5))
    sampler = str(manifest.get("sampler", "euler"))
    scheduler = str(manifest.get("scheduler", "simple"))
    size = str(manifest.get("size", "1024x1024"))
    standard_steps = int(manifest.get(
        "structureSteps" if stage == "structure" else "refineSteps" if stage == "refine" else "steps",
        12 if stage == "structure" else 48))
    standard_denoise = float(manifest.get("refineDenoise", 0.30)) if stage == "refine" else None

    for variant in range(1, variants + 1):
        stage_tag = "" if stage == "legacy" else f"_{stage}"
        stem = f"{asset['id']}{stage_tag}_v{variant:02d}"
        raw = asset_dir / f"{stem}_raw.png"
        keyed = asset_dir / f"{stem}_keyed.png"
        cleaned = asset_dir / f"{stem}_cleaned.png"
        anchored = asset_dir / f"{stem}_anchored.png"
        final = asset_dir / f"{stem}_body.png"
        preview = asset_dir / f"{stem}_preview.png"
        generation_metadata = asset_dir / f"{stem}_generation.json"
        if preview.exists() and not rebuild_derived:
            print(f"[{asset['id']} v{variant:02d}] already complete; skipping", flush=True)
            continue
        if seed_override is not None:
            seed = seed_override + variant - 1
        else:
            seed_base = int(manifest.get(
                "refineSeedBase" if stage == "refine" else "structureSeedBase", 122200))
            seed = seed_base + (list_index[asset["id"]] * 10) + variant
        if not raw.exists():
            command = [
                str(COMFY_PY), str(REPO / "tools/ai-gen/comfyui-gen.py"),
                "--host", manifest["host"], "--model", manifest["model"],
                "--steps", str(steps), "--control-image", str(depth),
                "--cfg", str(cfg), "--sampler", sampler,
                "--scheduler", scheduler, "--size", size,
                "--bg-color", "#00FF00", "--seed", str(seed),
                "--prompt-file", str(prompt), "--out", str(raw),
                "--timeout", str(request_timeout),
            ]
            if stage == "legacy" or not use_edge_control:
                command.extend(["--strength", str(depth_strength)])
            else:
                command.extend([
                    "--control-image", str(control_edge),
                    "--control-strength", str(depth_strength),
                    "--control-strength", str(edge_strength),
                ])
            if stage == "refine":
                command.extend(["--init-image", str(init_image), "--denoise", str(denoise)])
            run(command, label=f"{asset['id']} {stage} v{variant:02d} generate",
                timeout=request_timeout + 60)
        generation_metadata.write_text(json.dumps({
            "pipeline": "world122-building-candidates",
            "styleVersion": style_version,
            "styleTemplate": style_template,
            "assetId": asset["id"],
            "stage": stage,
            "model": manifest["model"],
            "size": size,
            "steps": steps,
            "cfg": cfg,
            "sampler": sampler,
            "scheduler": scheduler,
            "depthStrength": depth_strength,
            "edgeControl": bool(stage != "legacy" and use_edge_control),
            "edgeStrength": edge_strength if stage != "legacy" and use_edge_control else None,
            "denoise": denoise,
            "seed": seed,
            "promptFile": str(prompt.relative_to(REPO)) if prompt.is_relative_to(REPO) else str(prompt),
            "depthImage": str(depth.relative_to(REPO)) if depth.is_relative_to(REPO) else str(depth),
            "initImage": str(init_image) if init_image else None,
            "nonstandardOverride": bool(
                steps != standard_steps
                or (stage == "refine" and abs(float(denoise) - standard_denoise) > 1e-9)
            ),
        }, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        if rebuild_derived or not keyed.exists():
            key_command = [str(COMFY_PY), str(REPO / "tools/ai-gen/key-world122-building-body.py"),
                           str(raw), str(keyed)]
            if asset.get("removeAllGreen"):
                key_command.append("--remove-all-green")
            run(key_command, label=f"{asset['id']} v{variant:02d} key")
        if rebuild_derived or not cleaned.exists():
            run([str(COMFY_PY), str(REPO / "tools/ai-gen/remove-world122-building-pseudo-plinth.py"), str(keyed), str(cleaned)], label=f"{asset['id']} v{variant:02d} clean")
        if rebuild_derived or not anchored.exists():
            run([str(COMFY_PY), str(REPO / "tools/ai-gen/anchor-world122-building-body.py"), str(cleaned), str(depth), str(anchored),
                 "--display-width", "256", "--display-height", "256", "--nominal-width", "256", "--nominal-height", "128"],
                label=f"{asset['id']} v{variant:02d} anchor")
        if rebuild_derived or not final.exists():
            run([str(COMFY_PY), str(REPO / "tools/ai-gen/mask-world122-building-body.py"),
                 str(anchored), str(depth), str(final), "--edge-pad", str(mask_edge_pad)],
                label=f"{asset['id']} v{variant:02d} mask")
        preview_command = [str(COMFY_PY), str(REPO / "tools/ai-gen/compose-world122-building-preview.py"),
                           str(final), str(preview)]
        if asset.get("removeAllGreen"):
            preview_command.append("--remove-all-green")
        run(preview_command, label=f"{asset['id']} v{variant:02d} preview")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--out", type=Path, default=None)
    parser.add_argument("--variants", type=int, default=None)
    parser.add_argument("--only", nargs="*", default=None, help="asset ids to generate")
    parser.add_argument("--stage", choices=("legacy", "structure", "refine"), default="legacy",
                        help="legacy one-pass, 12-step structure draft, or img2img refinement")
    parser.add_argument("--init-image", type=Path,
                        help="selected structure image; required by --stage refine")
    parser.add_argument("--edge-image", type=Path,
                        help="optional authored edge control; defaults to edges derived from depth")
    parser.add_argument("--edge-control", action="store_true",
                        help="chain the derived edge map as a second ControlNet; requires a compatible remote plugin")
    parser.add_argument("--steps", type=int, help="override the selected stage's step count")
    parser.add_argument("--denoise", type=float, help="override refine img2img denoise")
    parser.add_argument("--seed", type=int, help="first candidate seed; subsequent variants increment it")
    parser.add_argument("--timeout", type=int,
                        help="per-image ComfyUI wait timeout in seconds; default from manifest")
    parser.add_argument("--rebuild-derived", action="store_true",
                        help="rebuild keyed/cleaned/anchored/body/preview files from existing raw images")
    parser.add_argument("--allow-nonstandard", action="store_true",
                        help="allow step/denoise values outside the manifest contract; recorded in metadata")
    args = parser.parse_args()
    manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
    output_root = args.out or Path(manifest["outputRoot"])
    if args.stage == "structure":
        variants = args.variants or manifest.get("structureVariants", 5)
    elif args.stage == "refine":
        variants = args.variants or manifest.get("refineVariants", 3)
    else:
        variants = args.variants or manifest.get("variants", 2)
    selected = [a for a in manifest["assets"] if not args.only or a["id"] in args.only]
    if args.stage == "refine":
        if not args.init_image:
            parser.error("--stage refine requires --init-image")
        if not args.init_image.exists():
            parser.error(f"--init-image not found: {args.init_image}")
        if len(selected) != 1:
            parser.error("--stage refine requires exactly one selected asset via --only <asset_id>")
    if args.edge_image and not args.edge_image.exists():
        parser.error(f"--edge-image not found: {args.edge_image}")
    if args.denoise is not None and args.stage != "refine":
        parser.error("--denoise is valid only with --stage refine")
    if args.denoise is not None and not 0.0 < args.denoise <= 1.0:
        parser.error("--denoise must be in (0,1]")
    expected_steps = (manifest.get("structureSteps", 12) if args.stage == "structure"
                      else manifest.get("refineSteps", 48) if args.stage == "refine"
                      else manifest.get("steps", 48))
    if args.steps is not None and args.steps != int(expected_steps) and not args.allow_nonstandard:
        parser.error(f"--steps {args.steps} breaks the standard {args.stage} contract "
                     f"({expected_steps}); add --allow-nonstandard for an explicitly recorded experiment")
    expected_denoise = float(manifest.get("refineDenoise", 0.30))
    if (args.denoise is not None and abs(args.denoise - expected_denoise) > 1e-9
            and not args.allow_nonstandard):
        parser.error(f"--denoise {args.denoise} breaks the standard refine contract "
                     f"({expected_denoise}); add --allow-nonstandard for an explicitly recorded experiment")
    if args.timeout is not None and args.timeout < 60:
        parser.error("--timeout must be at least 60 seconds")
    global list_index
    list_index = {a["id"]: i for i, a in enumerate(manifest["assets"])}
    if not COMFY_PY.exists():
        raise FileNotFoundError(f"ComfyUI Python missing: {COMFY_PY}")
    if not BLENDER.exists():
        raise FileNotFoundError(f"Blender missing: {BLENDER}")
    print(f"output={output_root} stage={args.stage} assets={len(selected)} variants={variants}", flush=True)
    for asset in selected:
        staged_asset = json.loads(json.dumps(asset))
        if args.stage != "legacy":
            staged_asset.setdefault(
                "structuralOverlapZ", manifest.get("structuralOverlapZ", 8))
        generate_asset(
            staged_asset, manifest, output_root, variants,
            stage=args.stage, init_image=args.init_image, edge_image=args.edge_image,
            steps_override=args.steps, denoise_override=args.denoise, seed_override=args.seed,
            use_edge_control=args.edge_control or bool(manifest.get("useEdgeControl", False)),
            generation_timeout=args.timeout,
            rebuild_derived=args.rebuild_derived,
        )
    print("all requested candidates complete", flush=True)


if __name__ == "__main__":
    main()
