#!/usr/bin/env python3
"""Finalize the user-selected 12-step mine wall/gate set on authored Blender alpha.

FLUX supplies RGB/material only. Blender remains authoritative for every wall
silhouette, ground anchor, gate frame alpha and rigid lift trajectory.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFilter


ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "tools" / "ai-gen" / "_abandoned_mine_wall_kit_20260828"
GEN = SOURCE / "generation"
OUT = GEN / "final_12step"
ASSETS = ROOT / "assets" / "terrain"
WALL_KEYS = ["abandoned_mine_wall_block_a", "abandoned_mine_wall_block_b", "abandoned_mine_wall_block_c"]
WALL_RAWS = [
    GEN / "wall_a_structure_candidates" / "wall_a_structure_v01_raw.png",
    GEN / "selected_12step_set" / "wall_b_structure_v01_raw.png",
    GEN / "selected_12step_set" / "wall_c_structure_v01_raw.png",
]
GATE_RAW = GEN / "selected_12step_set" / "gate_closed_structure_v01_raw.png"
CELL = 640
FRAMES = 16


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def rgba(path: Path) -> Image.Image:
    return Image.open(path).convert("RGBA")


def exact_alpha_material(base: Image.Image, generated_path: Path) -> Image.Image:
    """Use generated RGB where it is subject, with exact authored base alpha."""
    generated = Image.open(generated_path).convert("RGB").resize(base.size, Image.Resampling.LANCZOS)
    gen = np.asarray(generated, dtype=np.uint8)
    src = np.asarray(base.convert("RGBA"), dtype=np.uint8)

    border = np.concatenate((
        gen[:12].reshape(-1, 3), gen[-12:].reshape(-1, 3),
        gen[:, :12].reshape(-1, 3), gen[:, -12:].reshape(-1, 3),
    ), axis=0)
    background = np.median(border, axis=0)
    distance = np.linalg.norm(gen.astype(np.float32) - background.reshape((1, 1, 3)), axis=2)
    subject = Image.fromarray(np.uint8(distance > 8.0) * 255, "L").filter(ImageFilter.MaxFilter(5))
    subject_mask = np.asarray(subject, dtype=np.uint8) > 0
    alpha_mask = src[..., 3] > 0
    use_generated = subject_mask & alpha_mask

    rgb = src[..., :3].copy()
    rgb[use_generated] = gen[use_generated]
    result = np.dstack((rgb, src[..., 3]))
    return Image.fromarray(result, "RGBA")


def _luminance(rgb: np.ndarray) -> np.ndarray:
    values = rgb.astype(np.float32) / 255.0
    return values[..., 0] * 0.2126 + values[..., 1] * 0.7152 + values[..., 2] * 0.0722


def _masked_low_frequency(values: np.ndarray, alpha: np.ndarray, radius: int = 42) -> np.ndarray:
    """Blur subject luminance without bleeding transparent black into its edges."""
    weight = alpha.astype(np.float32) / 255.0
    weighted = Image.fromarray(
        np.uint8(np.clip(values * weight * 255.0, 0.0, 255.0)), "L"
    ).filter(ImageFilter.GaussianBlur(radius))
    blurred_weight = Image.fromarray(
        np.uint8(np.clip(weight * 255.0, 0.0, 255.0)), "L"
    ).filter(ImageFilter.GaussianBlur(radius))
    weighted_array = np.asarray(weighted, dtype=np.float32) / 255.0
    weight_array = np.asarray(blurred_weight, dtype=np.float32) / 255.0
    return weighted_array / np.maximum(weight_array, 1.0 / 255.0)


def harmonize_wall_lighting(
    material_walls: list[Image.Image], authored_walls: list[Image.Image]
) -> tuple[list[Image.Image], dict]:
    """Give every variant the authored kit's shared broad light/shadow envelope.

    FLUX remains responsible for high-frequency material detail. The editable
    Blender renders are the authority for low-frequency light direction, while
    a common median exposure prevents alternating bright/dark wall blocks.
    """
    source_medians = []
    for wall in material_walls:
        data = np.asarray(wall, dtype=np.uint8)
        mask = data[..., 3] > 32
        source_medians.append(float(np.median(_luminance(data[..., :3])[mask])))
    common_median = float(np.median(source_medians))

    harmonized = []
    report = {
        "method": "shared exposure plus Blender-authored low-frequency light envelope",
        "commonMedian": common_median,
        "blurRadius": 42,
        "gainClamp": [0.72, 1.42],
        "variants": [],
    }
    for key, material, authored in zip(WALL_KEYS, material_walls, authored_walls):
        data = np.asarray(material, dtype=np.uint8)
        authored_data = np.asarray(authored, dtype=np.uint8)
        alpha = data[..., 3]
        mask = alpha > 32
        rgb = data[..., :3].astype(np.float32)
        before_lum = _luminance(data[..., :3])
        authored_lum = _luminance(authored_data[..., :3])
        generated_low = _masked_low_frequency(before_lum, alpha)
        authored_low = _masked_low_frequency(authored_lum, alpha)
        authored_median = float(np.median(authored_low[mask]))
        authored_envelope = authored_low / max(authored_median, 1.0 / 255.0)
        target_low = common_median * np.clip(authored_envelope, 0.48, 1.8)
        gain = np.clip(target_low / np.maximum(generated_low, 1.0 / 255.0), 0.72, 1.42)
        adjusted_rgb = np.clip(rgb * gain[..., None], 0.0, 255.0)

        provisional = np.uint8(np.round(adjusted_rgb))
        provisional_lum = _luminance(provisional)
        median_after_first_pass = float(np.median(provisional_lum[mask]))
        exposure_trim = np.clip(common_median / max(median_after_first_pass, 1.0 / 255.0), 0.92, 1.08)
        adjusted_rgb = np.clip(adjusted_rgb * exposure_trim, 0.0, 255.0)
        final_rgb = np.uint8(np.round(adjusted_rgb))
        final_lum = _luminance(final_rgb)
        result = Image.fromarray(np.dstack((final_rgb, alpha)), "RGBA")
        harmonized.append(result)
        report["variants"].append({
            "key": key,
            "beforeMedian": float(np.median(before_lum[mask])),
            "beforeMean": float(np.mean(before_lum[mask])),
            "afterMedian": float(np.median(final_lum[mask])),
            "afterMean": float(np.mean(final_lum[mask])),
            "exposureTrim": float(exposure_trim),
        })
    return harmonized, report


def gate_frames_from_closed(closed: Image.Image, authored: list[Image.Image]) -> list[Image.Image]:
    """Translate one materialized closed leaf along the authored Blender lift."""
    closed_bottom = authored[0].getchannel("A").getbbox()[3]
    frames = []
    for target in authored:
        target_alpha = target.getchannel("A")
        bbox = target_alpha.getbbox()
        lift = closed_bottom - bbox[3] if bbox else closed_bottom
        shifted = Image.new("RGBA", closed.size, (0, 0, 0, 0))
        shifted.alpha_composite(closed, (0, -lift))
        shifted_data = np.asarray(shifted, dtype=np.uint8)
        target_data = np.asarray(target, dtype=np.uint8)
        target_mask = np.asarray(target_alpha, dtype=np.uint8) > 0
        shifted_mask = shifted_data[..., 3] > 0
        rgb = target_data[..., :3].copy()
        use_shifted = target_mask & shifted_mask
        rgb[use_shifted] = shifted_data[..., :3][use_shifted]
        frames.append(Image.fromarray(np.dstack((rgb, np.asarray(target_alpha))), "RGBA"))
    return frames


def paste_ground(canvas: Image.Image, image: Image.Image, center, geo: dict, flip=False):
    sx = geo["display"][0] / image.width
    sy = geo["display"][1] / image.height
    resized = image.resize((round(image.width * sx), round(image.height * sy)), Image.Resampling.LANCZOS)
    ground_x = image.width - geo["groundCenter"][0] if flip else geo["groundCenter"][0]
    if flip:
        resized = resized.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
    x = round(center[0] - ground_x * sx)
    y = round(center[1] - geo["groundCenter"][1] * sy)
    canvas.alpha_composite(resized, (x, y))


def paste_gate(canvas: Image.Image, image: Image.Image, a, b, geo: dict):
    p0, p1 = geo["base"]
    sx = (b[0] - a[0]) / (p1[0] - p0[0])
    sy = (b[1] - a[1]) / (p1[1] - p0[1])
    resized = image.resize((round(image.width * sx), round(image.height * sy)), Image.Resampling.LANCZOS)
    canvas.alpha_composite(resized, (round(a[0] - p0[0] * sx), round(a[1] - p0[1] * sy)))


def gate_slice(image: Image.Image, x0: int, x1: int) -> Image.Image:
    result = Image.new("RGBA", image.size, (0, 0, 0, 0))
    result.alpha_composite(image.crop((x0, 0, x1, image.height)), (x0, 0))
    return result


def build_preview(walls, frames, wall_geos, gate_geo):
    preview = Image.new("RGBA", (1900, 1180), (12, 13, 15, 255))
    draw = ImageDraw.Draw(preview)
    draw.text((34, 24), "Abandoned Mine - selected FLUX.2 Dev 12-step material on Blender geometry", fill=(230, 220, 200, 255))
    for index, wall in enumerate(walls):
        view = wall.copy()
        view.thumbnail((520, 520), Image.Resampling.LANCZOS)
        x = 30 + index * 620
        preview.alpha_composite(view, (x, 70))
        draw.text((x + 10, 560), f"wall {chr(65 + index)} | exact Blender alpha", fill=(194, 177, 145, 255))
    for slot, frame_index in enumerate((0, 7, 15)):
        view = frames[frame_index].copy()
        view.thumbnail((520, 520), Image.Resampling.LANCZOS)
        x = 30 + slot * 620
        preview.alpha_composite(view, (x, 640))
        draw.text((x + 10, 1128), f"gate frame {frame_index:02d}", fill=(194, 177, 145, 255))
    preview.save(OUT / "abandoned-mine-ai12-kit-preview.png", optimize=True)

    proof_layer = Image.new("RGBA", (1900, 1050), (0, 0, 0, 0))
    for index, center in enumerate((270 + i * 64, 300 + i * 32) for i in range(7)):
        variant = index % 3
        paste_ground(proof_layer, walls[variant], center, wall_geos[variant], flip=False)
    gate_a = (500, 700)
    gate_b = (gate_a[0] + 6 * 64, gate_a[1] + 6 * 32)
    hole_x0, hole_x1 = gate_geo["gateX"]
    layered = [
        (gate_a[1] + 4, "wall", (walls[1], gate_a, wall_geos[1], False)),
        (gate_b[1] + 4, "wall", (walls[2], gate_b, wall_geos[2], False)),
    ]
    for index in range(int(gate_geo.get("depthSlices", 1))):
        tx0 = hole_x0 + (hole_x1 - hole_x0) * index / gate_geo["depthSlices"]
        tx1 = hole_x0 + (hole_x1 - hole_x0) * (index + 1) / gate_geo["depthSlices"]
        world_y1 = gate_a[1] + (tx1 - gate_geo["base"][0][0]) / (
            gate_geo["base"][1][0] - gate_geo["base"][0][0]) * (gate_b[1] - gate_a[1])
        layered.append((world_y1 + 3.9, "gate", gate_slice(frames[0], math.floor(tx0), math.ceil(tx1))))
    for _, kind, payload in sorted(layered, key=lambda item: item[0]):
        if kind == "gate":
            paste_gate(proof_layer, payload, gate_a, gate_b, gate_geo)
        else:
            paste_ground(proof_layer, payload[0], payload[1], payload[2], payload[3])
    proof = Image.new("RGBA", proof_layer.size, (10, 11, 13, 255))
    proof.alpha_composite(proof_layer)
    draw = ImageDraw.Draw(proof)
    draw.text((34, 24), "AI12 runtime seam proof: normalized A/B/C repeat + six-cell lift gate", fill=(230, 220, 200, 255))
    draw.text((34, 50), "shared Blender light envelope / no baked-light flip / exact 1x1 anchors", fill=(162, 169, 174, 255))
    proof.save(OUT / "abandoned-mine-ai12-seam-proof.png", optimize=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--install", action="store_true", help="copy finalized files into assets/terrain")
    args = parser.parse_args()
    if args.install:
        successor = ROOT / "tools/ai-gen/_mine_visual_finish_v3_20260830/dev-candidate/installation.json"
        if successor.exists():
            raise RuntimeError("Legacy installation retired; follow docs/abandoned-mine-visual-delivery-20260830.md")
        previous = json.loads((SOURCE / "manifest.json").read_text(encoding="utf-8"))
        if previous.get("supersededBy"):
            raise RuntimeError("Legacy AI12 installation retired; follow " + previous["supersededBy"])
    required = [*WALL_RAWS, GATE_RAW, *(SOURCE / f"{key}.png" for key in WALL_KEYS)]
    required.extend(SOURCE / "gate_frames" / f"gate_{index:02d}.png" for index in range(FRAMES))
    missing = [str(path) for path in required if not path.is_file()]
    if missing:
        raise FileNotFoundError("missing finalization inputs: " + ", ".join(missing))

    OUT.mkdir(parents=True, exist_ok=True)
    material_walls = []
    authored_walls = []
    for key, generated_path in zip(WALL_KEYS, WALL_RAWS):
        authored_wall = rgba(SOURCE / f"{key}.png")
        final = exact_alpha_material(authored_wall, generated_path)
        if ImageChops.difference(final.getchannel("A"), authored_wall.getchannel("A")).getbbox():
            raise RuntimeError(f"wall alpha drifted: {key}")
        authored_walls.append(authored_wall)
        material_walls.append(final)

    walls, lighting_report = harmonize_wall_lighting(material_walls, authored_walls)
    for key, final, authored_wall in zip(WALL_KEYS, walls, authored_walls):
        if ImageChops.difference(final.getchannel("A"), authored_wall.getchannel("A")).getbbox():
            raise RuntimeError(f"wall alpha drifted after lighting normalization: {key}")
        final.save(OUT / f"{key}.png", optimize=True)
    (OUT / "lighting-normalization-report.json").write_text(
        json.dumps(lighting_report, ensure_ascii=False, indent=2), encoding="utf-8")

    authored_frames = [rgba(SOURCE / "gate_frames" / f"gate_{index:02d}.png") for index in range(FRAMES)]
    closed = exact_alpha_material(authored_frames[0], GATE_RAW)
    frames = gate_frames_from_closed(closed, authored_frames)
    for index, (frame, authored) in enumerate(zip(frames, authored_frames)):
        if ImageChops.difference(frame.getchannel("A"), authored.getchannel("A")).getbbox():
            raise RuntimeError(f"gate frame alpha drifted: {index}")
    frame_dir = OUT / "gate_frames"
    frame_dir.mkdir(exist_ok=True)
    sheet = Image.new("RGBA", (CELL * 4, CELL * 4), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        frame.save(frame_dir / f"gate_{index:02d}.png", optimize=True)
        sheet.alpha_composite(frame, ((index % 4) * CELL, (index // 4) * CELL))
    sheet.save(OUT / "abandoned_mine_gate.png", optimize=True)

    geometry = json.loads((SOURCE / "geometry.json").read_text(encoding="utf-8"))
    build_preview(walls, frames, geometry["walls"], geometry["gate"])

    installed = {}
    if args.install:
        ASSETS.mkdir(parents=True, exist_ok=True)
        for key, image in zip(WALL_KEYS, walls):
            target = ASSETS / f"{key}.png"
            image.save(target, optimize=True)
            installed[key] = {"path": target.relative_to(ROOT).as_posix(), "sha256": digest(target)}
        gate_target = ASSETS / "abandoned_mine_gate.png"
        sheet.save(gate_target, optimize=True)
        installed["abandoned_mine_gate"] = {"path": gate_target.relative_to(ROOT).as_posix(), "sha256": digest(gate_target)}

        source_manifest_path = SOURCE / "manifest.json"
        source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
        source_manifest["pipeline"] = "Blender editable geometry -> selected FLUX.2 Dev 12-step material -> exact-alpha runtime"
        for key, image in zip(WALL_KEYS, walls):
            source_manifest["runtime"][key] = {
                "path": f"assets/terrain/{key}.png",
                "size": list(image.size),
                "sha256": installed[key]["sha256"],
            }
        source_manifest["runtime"]["abandoned_mine_gate"] = {
            "path": "assets/terrain/abandoned_mine_gate.png",
            "sheetSize": list(sheet.size),
            "frameSize": [CELL, CELL],
            "frames": FRAMES,
            "sha256": installed["abandoned_mine_gate"]["sha256"],
        }
        source_manifest["materialGeneration"] = {
            "manifest": (OUT / "manifest.json").relative_to(ROOT).as_posix(),
            "model": "flux2-dev-depth",
            "steps": 12,
            "seed": 122082810,
            "depthStrength": 0.78,
            "refine48Step": False,
            "alphaAuthority": "Blender wall renders and 16 authored gate frames",
            "lightingNormalization": {
                "method": lighting_report["method"],
                "report": (OUT / "lighting-normalization-report.json").relative_to(ROOT).as_posix(),
                "flipX": False,
            },
        }
        source_manifest_path.write_text(json.dumps(source_manifest, ensure_ascii=False, indent=2), encoding="utf-8")

    manifest = {
        "version": 1,
        "pipeline": "selected FLUX.2 Dev 12-step RGB -> exact Blender alpha and gate lift",
        "selectedWallCandidate": WALL_RAWS[0].relative_to(ROOT).as_posix(),
        "wallCandidates": [path.relative_to(ROOT).as_posix() for path in WALL_RAWS],
        "gateCandidate": GATE_RAW.relative_to(ROOT).as_posix(),
        "model": "flux2-dev-depth",
        "steps": 12,
        "seed": 122082810,
        "depthStrength": 0.78,
        "no48StepRefine": True,
        "geometryAuthority": (SOURCE / "abandoned_mine_wall_kit.blend").relative_to(ROOT).as_posix(),
        "lightingNormalization": {
            "method": lighting_report["method"],
            "report": (OUT / "lighting-normalization-report.json").relative_to(ROOT).as_posix(),
            "flipX": False,
        },
        "runtimeInstalled": bool(args.install),
        "installed": installed,
        "preview": (OUT / "abandoned-mine-ai12-kit-preview.png").relative_to(ROOT).as_posix(),
        "seamProof": (OUT / "abandoned-mine-ai12-seam-proof.png").relative_to(ROOT).as_posix(),
    }
    (OUT / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
