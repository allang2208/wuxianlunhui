"""A-wall Dev + authored Depth material candidates; never install runtime assets.

Run prepare, generate, then compose. The last step restores the original alpha,
broad lighting and silhouette collar without moving or rescaling the wall.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageChops, ImageFilter

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "_mine_wall_pbr_kit_v2_20260830"
OUT = HERE / "_mine_wall_a_dev_depth_20260830"
SEEDS = (122083010, 122083011, 122083012)


def module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


def write_json(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def prepare():
    OUT.mkdir(exist_ok=True)
    beauty = Image.open(SOURCE / "wall_a.png").convert("RGBA")
    alpha = beauty.getchannel("A")
    depth_source = Image.open(SOURCE / "wall_a_body_depth.png")
    values = np.asarray(depth_source)
    # Raw 16-bit Blender depth must be scaled, not convert('L') clamped to white.
    if depth_source.mode.startswith("I"):
        depth = np.uint8(np.clip(np.rint(values.astype(np.float64) / 257.0), 0, 255))
    elif values.ndim == 2:
        depth = np.uint8(values)
    else:
        depth = np.asarray(depth_source.convert("L"))
    depth[np.asarray(alpha) == 0] = 0
    Image.fromarray(depth, "L").save(OUT / "mine_wall_a_v2_depth_control.png")
    alpha.save(OUT / "wall_a_authored_alpha.png")
    style = (HERE / "prompts/world122-building-style.md").read_text(encoding="utf-8")
    identity = """\nAsset identity: one solid continuous excavated mine wall block A, with EXACTLY the silhouette, camera, proportions and top diamond of the supplied Blender depth. It is a single mass of cool charcoal slate/siltstone, not stacked masonry or loose boulders. Preserve the plain side faces and existing shallow interrupted cleavage. Large calm stone planes, sparse shallow rock fissures and a few restrained excavation marks. Surface roughness is believable but quiet at gameplay size.
Asset class: modular wall, NOT a building. Foundation style: none; no foundation, plinth, foot band, cornice or separate top cap. The bottom silhouette and top perimeter remain exactly as authored. No new bulges or repeated bevel bands. Do not add a doorway, arch, windows, timber supports, rails, ore crystals, lights, props or scenery. No wall extension, loose rubble, markings, text, symbols or decorative edging.
Framing: the complete single wall module stays in the exact 1024x1024 depth-map composition. Neutral soft top-side illumination; do not create a contrasting bright top slab or large black border. One isolated object on an exactly flat uniform pure green #00FF00 background, with no shadow, horizon, floor plane, haze or gradient. Green is background only, never part of the rock.\n"""
    (OUT / "wall_a_structure_prompt.txt").write_text(style + identity, encoding="utf-8")
    write_json(OUT / "request.json", {
        "stage": "structure", "asset": "abandoned_mine_wall_block_a",
        "model": "flux2-dev-depth", "host": "192.168.3.142", "port": 8188,
        "steps": 12, "cfg": 3.5, "sampler": "euler", "scheduler": "simple",
        "controlStrength": 0.78, "size": [1024, 1024], "seeds": list(SEEDS),
        "styleVersion": "world122-building-v5", "styleTemplate": "../prompts/world122-building-style.md",
        "foundationStyle": "none (modular wall)", "prompt": "wall_a_structure_prompt.txt",
        "controlImage": "mine_wall_a_v2_depth_control.png",
        "depthSource": "../_mine_wall_pbr_kit_v2_20260830/wall_a_body_depth.png",
        "depthConversion": "16-bit / 257 to 8-bit; original extent and alpha; no reprojection",
        "depthSourceMode": depth_source.mode,
        "depthRange": [int(depth.min()), int(depth.max())],
        "geometry": "../_mine_wall_pbr_kit_v2_20260830/geometry.json",
        "modelSource": "../_mine_wall_pbr_kit_v2_20260830/mine_wall_and_gate_pbr_v2.blend",
        "runtimeInstalled": False, "approved": False,
    })
    print("Prepared Dev controls and prompt:", OUT, flush=True)


def generate():
    request = json.loads((OUT / "request.json").read_text(encoding="utf-8"))
    prefix = request.get("filePrefix", "wall_a_structure")
    for index, seed in enumerate(request["seeds"], 1):
        raw = OUT / f"{prefix}_v{index:02d}_raw.png"
        metadata = {**request, "seed": seed, "raw": raw.name, "status": "requested"}
        metadata_path = OUT / f"{prefix}_v{index:02d}_generation.json"
        if raw.exists():
            print("Keeping existing candidate:", raw.name, flush=True)
            continue
        command = [sys.executable, str(HERE / "comfyui-gen.py"),
                   "--host", request["host"], "--model", request["model"],
                   "--steps", str(request["steps"]), "--cfg", str(request["cfg"]),
                   "--sampler", request["sampler"], "--scheduler", request["scheduler"],
                   "--size", "1024x1024", "--seed", str(seed),
                   "--control-image", str(OUT / request["controlImage"]),
                   "--strength", str(request["controlStrength"]),
                   "--prompt-file", str(OUT / request["prompt"]),
                   "--out", str(raw), "--prefix", f"mine_wall_a_dev_v2_{index}",
                   "--timeout", "1800"]
        if request.get("initImage"):
            command += ["--init-image", str(OUT / request["initImage"]),
                        "--denoise", str(request["denoise"])]
        metadata["command"] = command
        write_json(metadata_path, metadata)
        subprocess.run(command, check=True)
        metadata["status"] = "generated; not approved"
        write_json(metadata_path, metadata)


def compose(match_native_color=False, comparison_path=None, comparison_label="原生 PBR"):
    request = json.loads((OUT / "request.json").read_text(encoding="utf-8"))
    prefix = request.get("filePrefix", "wall_a_structure")
    seeds = request["seeds"]
    count = len(seeds)
    steps = request["steps"]
    finalize = module("mine_alpha_lighting", HERE / "finalize-abandoned-mine-wall-kit-ai12.py")
    assembly = module("mine_assembly", HERE / "compose-mine-wall-pbr-kit.py")
    base = Image.open(SOURCE / "wall_a.png").convert("RGBA")
    src = np.asarray(base)
    alpha = src[..., 3]
    def low_frequency(rgb):
        if match_native_color:
            return np.stack([
                finalize._masked_low_frequency(rgb[..., channel].astype(np.float32) / 255.0, alpha)
                for channel in range(3)
            ], axis=-1)
        return finalize._masked_low_frequency(finalize._luminance(rgb), alpha)[..., None]

    base_low = low_frequency(src[..., :3])
    # Exact original RGB along the silhouette; smoothly admit material in the interior.
    opaque = base.getchannel("A").point(lambda x: 255 if x == 255 else 0)
    collar = opaque.filter(ImageFilter.MinFilter(17))
    feather = opaque.filter(ImageFilter.MinFilter(33)).filter(ImageFilter.GaussianBlur(6))
    weight = np.asarray(ImageChops.multiply(collar, feather), dtype=np.float32) / 255.0
    weight *= 0.85
    candidates = []
    for index in range(1, count + 1):
        raw = OUT / f"{prefix}_v{index:02d}_raw.png"
        material = finalize.exact_alpha_material(base, raw)
        mat = np.asarray(material)
        generated_low = low_frequency(mat[..., :3])
        gain = np.clip(base_low / np.maximum(generated_low, 1 / 255), 0.15, 4.0)
        adjusted = np.clip(mat[..., :3].astype(np.float32) * gain, 0, 255)
        rgb = np.uint8(np.rint(adjusted * weight[..., None] + src[..., :3] * (1 - weight[..., None])))
        result = Image.fromarray(np.dstack((rgb, alpha)), "RGBA")
        result.save(OUT / f"{prefix}_v{index:02d}_candidate.png")
        candidates.append(result)
    contact = Image.new("RGBA", (400 * (count + 1), 900), (26, 31, 35, 255))
    assembly.label(contact, (24, 22), f"矿洞 A · Dev + Depth / {steps}步{count}候选", 30)
    assembly.label(contact, (24, 68), "原Alpha、原尺寸、原光照包络；不是游戏截图，尚未接入。", 20)
    comparison = Image.open(comparison_path).convert("RGBA") if comparison_path else base
    titles = [comparison_label] + [f"Dev {steps}步 / {i:02d}" for i in range(1, count + 1)]
    for column, (sprite, title) in enumerate(zip([comparison] + candidates, titles)):
        contact.alpha_composite(sprite.resize((380, 380), Image.Resampling.LANCZOS), (10 + column * 400, 112))
        assembly.label(contact, (30 + column * 400, 510), title, 23)
        geometry = json.loads((SOURCE / "geometry.json").read_text(encoding="utf-8"))["wall"]
        assembly.kit.paste_ground(contact, sprite, (200 + column * 400, 830), geometry)
    contact.save(OUT / "wall_a_dev_candidates.png")
    for index, sprite in enumerate(candidates, 1):
        canvas = Image.new("RGBA", (1700, 680), (26, 31, 35, 255))
        assembly.label(canvas, (25, 20), f"Dev {index:02d} · 双轴固定步长连续墙（离线候选）", 28)
        for reverse in (False, True):
            origin = (1550 if reverse else 150, 300)
            cells = [(0, i) if reverse else (i, 0) for i in range(9)]
            sprites = {key: sprite for key in "abc"}
            jobs = assembly.mixed_jobs(cells, origin, sprites, geometry)
            for _, _, payload in sorted(jobs, key=lambda item: item[0]):
                assembly.kit.paste_ground(canvas, *payload)
        canvas.save(OUT / f"{prefix}_v{index:02d}_seams.png")
    write_json(OUT / "manifest.json", {
        "stage": f"{count} Dev {steps}-step material candidates; awaiting visual selection",
        "runtimeInstalled": False, "approved": False, "request": "request.json",
        "provider": "remote ComfyUI", "model": "flux2-dev-depth", "controlNetUsed": True,
        "exactAlphaSource": "../_mine_wall_pbr_kit_v2_20260830/wall_a.png",
        "size": [1024, 1024], "preserveGeometry": True,
        "postprocess": "exact authored alpha; native masked low-frequency " + ("RGB" if match_native_color else "luminance") + "; original silhouette RGB collar; 0.85 material blend",
        "nativeColorMatched": match_native_color,
        "lowFrequencyChannels": "RGB" if match_native_color else "luminance",
        "preview": "wall_a_dev_candidates.png", "variants": [
            {"id": i, "seed": seeds[i - 1], "raw": f"{prefix}_v{i:02d}_raw.png",
             "candidate": f"{prefix}_v{i:02d}_candidate.png", "seams": f"{prefix}_v{i:02d}_seams.png"}
            for i in range(1, count + 1)],
        "limitations": ["No B/C/gate generation or runtime installation in this batch",
                        "Offline assemblies are not runtime evidence; finite repeats remain",
                        "Original alpha fixes outline, not any internal material hallucination"],
        "tests": "未运行测试或运行时验证，按约定由用户测试。",
    })
    print("Prepared alpha-restored candidates and offline assemblies:", OUT, flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("prepare", "generate", "compose"))
    args = parser.parse_args()
    {"prepare": prepare, "generate": generate, "compose": compose}[args.stage]()
