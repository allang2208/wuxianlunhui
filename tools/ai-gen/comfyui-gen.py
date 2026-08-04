#!/usr/bin/env python3
"""Text-to-image client for the project's ComfyUI backend (local or remote).

Model switching is driven by tools/models.json: each named model maps to a
workflow type and default parameters, so you can switch with --model.

Usage examples:
    python comfyui-gen.py --list-models
    python comfyui-gen.py --host 192.168.3.142 --model sdxl --prompt "zombie sprite, full body" -o out.png
    python comfyui-gen.py --host 192.168.3.142 --model flux2-klein-4b --prompt "..." --out out.png
    python comfyui-gen.py --host 192.168.3.142 --model flux2-dev-fp8 --prompt "..." --out out.png
    python comfyui-gen.py --host 192.168.3.142 --model flux2-dev-depth --control-image depth.png --prompt "..." --out out.png
    python comfyui-gen.py --host 192.168.3.142 --model flux2-dev-mesh --prompt "..." --out out.png
    python comfyui-gen.py --host 192.168.3.142 --model flux2-dev-fp8 --transparent \
        --prompt "a white knight armor with gold trim" --out hero.png   # 透明主体：AI 选纯色底 + 自动抠图
    python comfyui-gen.py --model sdxl --prompt "..." --size 832x1216 --steps 25 --seed 123

Defaults (steps/cfg/sampler/scheduler/size/negative) come from models.json,
and any explicit flag overrides them. flux2 models with a "controlnet" field
take a --control-image (depth map / pose / edge) to lock viewpoint/composition.
"""

import argparse
import json
import os
import random
import sys
import time
import urllib.request

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)
from pick_bg_color import inject_background, name_for_hex, pick_bg_color  # noqa: E402
from transparent_cutout import cutout_file  # noqa: E402

DEFAULT_NEGATIVE = "blurry, low quality, watermark, text, signature"
REGISTRY_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "models.json")
SCRATCH_DIR = r"Y:\工作\无尽轮回\scratch"


def load_registry():
    with open(REGISTRY_FILE, "r", encoding="utf-8") as fh:
        return json.load(fh)


def build_checkpoint_workflow(prompt, negative, ckpt, seed, steps, cfg, width, height, sampler, scheduler, prefix):
    """SDXL-style workflow: CheckpointLoaderSimple -> CLIPTextEncode -> KSampler."""
    workflow = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": ckpt}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed, "steps": steps, "cfg": cfg,
                "sampler_name": sampler, "scheduler": scheduler, "denoise": 1.0,
                "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0], "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["8", 0]}},
    }
    return workflow, "9"


def build_flux2_workflow(prompt, negative, unet, clip, vae, seed, steps, cfg, width, height,
                         sampler, prefix, lora=None, controlnet=None, control_image=None,
                         strength=0.75):
    """FLUX.2 workflow: UNETLoader + CLIPLoader(flux2) + Flux2Scheduler + SamplerCustom.

    controlnet: file name under models/controlnet (e.g. FLUX.2-dev-Fun-Controlnet-Union.safetensors).
    control_image: file name in ComfyUI input dir (uploaded depth/pose/edge map) -> locks viewpoint.
    strength: ControlNet conditioning strength (0.6~0.8 for depth).
    """
    model_ref = ["1", 0]
    nodes = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": clip, "type": "flux2"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": vae}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["2", 0]}},
        "6": {"class_type": "Flux2Scheduler", "inputs": {"steps": steps, "width": width, "height": height}},
        "7": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "8": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": sampler}},
        "9": {
            "class_type": "SamplerCustom",
            "inputs": {
                "model": model_ref, "add_noise": True, "noise_seed": seed, "cfg": cfg,
                "positive": ["4", 0], "negative": ["5", 0], "sampler": ["8", 0],
                "sigmas": ["6", 0], "latent_image": ["7", 0],
            },
        },
        "10": {"class_type": "VAEDecode", "inputs": {"samples": ["9", 0], "vae": ["3", 0]}},
        "11": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["10", 0]}},
    }
    if lora:
        nodes["12"] = {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": model_ref, "lora_name": lora, "strength_model": 1.0}}
        model_ref = ["12", 0]
    nodes["9"]["inputs"]["model"] = model_ref

    if controlnet and control_image:
        nodes["20"] = {"class_type": "LoadImage", "inputs": {"image": control_image}}
        nodes["21"] = {"class_type": "Flux2FunControlNetLoader", "inputs": {"controlnet_name": controlnet}}
        nodes["22"] = {"class_type": "Flux2FunControlNetApply", "inputs": {
            "conditioning": ["4", 0], "controlnet": ["21", 0], "vae": ["3", 0],
            "strength": strength, "control_image": ["20", 0]}}
        nodes["9"]["inputs"]["positive"] = ["22", 0]
    return nodes, "11"


def build_mesh_workflow(prompt, unet, clip, vae, lora, seed, steps, guidance, width, height,
                        remote_host, remote_port, n_blocks, prefix):
    """FLUX.2 Dev cross-machine mesh workflow (Icarus client node).

    Requires the Daedalus back-half server running on remote_host:remote_port
    (e.g. 192.168.3.153:7777) with --n-blocks matching n_blocks. The turbo LoRA
    is loaded on BOTH sides locally (never forwarded) per the mesh project's
    guidance: server via --lora at startup, client via LoraLoaderModelOnly AFTER
    the MeshSplitFlux node.
    """
    nodes = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": unet, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": clip, "type": "flux2"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": vae}},
        "4": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["2", 0]}},
        "5": {"class_type": "MeshSplitFlux", "inputs": {
            "model": ["1", 0],
            "n_blocks_remote": n_blocks,
            "remote_host": remote_host,
            "remote_port": remote_port,
            "codec_mode": "nvenc",
            "codec_qp": 18,
            "codec_lossless": False,
            "codec_tile_dim": 8,
            "forward_client_loras": True,
        }},
        "6": {"class_type": "FluxGuidance", "inputs": {"conditioning": ["4", 0], "guidance": guidance}},
        "7": {"class_type": "BasicGuider", "inputs": {"model": ["5", 0], "conditioning": ["6", 0]}},
        "8": {"class_type": "Flux2Scheduler", "inputs": {"steps": steps, "width": width, "height": height}},
        "9": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": "euler"}},
        "10": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "11": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["10", 0], "guider": ["7", 0], "sampler": ["9", 0],
            "sigmas": ["8", 0], "latent_image": ["12", 0]}},
        "12": {"class_type": "EmptyFlux2LatentImage", "inputs": {"width": width, "height": height, "batch_size": 1}},
        "13": {"class_type": "VAEDecode", "inputs": {"samples": ["11", 0], "vae": ["3", 0]}},
        "14": {"class_type": "SaveImage", "inputs": {"filename_prefix": prefix, "images": ["13", 0]}},
    }
    if lora:
        nodes["15"] = {"class_type": "LoraLoaderModelOnly", "inputs": {
            "model": ["5", 0], "lora_name": lora, "strength_model": 1.0}}
        nodes["7"]["inputs"]["model"] = ["15", 0]
    return nodes, "14"


def upload_image(host, port, path):
    """Upload a local control image (depth map etc.) into the ComfyUI input dir."""
    filename = os.path.basename(path)
    boundary = "----ComfyUIFormBoundary" + str(random.randint(0, 2**31 - 1))
    with open(path, "rb") as fh:
        data = fh.read()
    head = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
        f"Content-Type: image/png\r\n\r\n"
    ).encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        f"http://{host}:{port}/upload/image",
        data=head + data + tail,
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=60) as resp:
        j = json.loads(resp.read().decode("utf-8"))
    name = j.get("name") or filename
    print(f"control image uploaded: {name}", flush=True)
    return name


def api(host, port, path, method="GET", payload=None):
    url = f"http://{host}:{port}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def print_registry(registry):
    print(f"{'model':<18}{'type':<12}files / defaults")
    print("-" * 90)
    for name, entry in registry.items():
        if entry["type"] == "checkpoint":
            files = entry.get("checkpoint", "?")
        elif entry["type"] == "flux2":
            files = f"unet={entry.get('unet')}, clip={entry.get('clip')}, vae={entry.get('vae')}"
            if entry.get("controlnet"):
                files += f", controlnet={entry['controlnet']} @{entry.get('control_strength', 0.75)}"
        elif entry["type"] == "mesh":
            files = f"unet={entry.get('unet')}, lora={entry.get('lora')}"
        else:
            files = "?"
        defaults = f"steps={entry.get('steps')}, cfg={entry.get('cfg')}, sampler={entry.get('sampler')}, size={entry.get('size')}"
        if entry["type"] == "mesh":
            defaults = (f"steps={entry.get('steps')}, guidance={entry.get('guidance')}, "
                        f"n_blocks={entry.get('n_blocks')}, daedalus={entry.get('remote_host')}:{entry.get('remote_port')}")
        note = f"  ({entry.get('note', '')})" if entry.get("note") else ""
        print(f"{name:<18}{entry['type']:<12}{files} | {defaults}{note}")


def main():
    ap = argparse.ArgumentParser(description="Generate images through ComfyUI (local or remote), model registry driven.")
    ap.add_argument("--model", default=None, help="model name from tools/models.json (default: sdxl)")
    ap.add_argument("--list-models", action="store_true", help="list registered models and exit")
    ap.add_argument("--prompt", help="positive prompt text")
    ap.add_argument("--prompt-file", help="read prompt from a text file")
    ap.add_argument("--negative", default=None, help="negative prompt (model default if omitted)")
    ap.add_argument("--checkpoint", default=None, help="override checkpoint file (checkpoint-type models)")
    ap.add_argument("--steps", type=int, default=None)
    ap.add_argument("--cfg", type=float, default=None)
    ap.add_argument("--sampler", default=None)
    ap.add_argument("--scheduler", default=None)
    ap.add_argument("--size", default=None, help="widthxheight, e.g. 832x1216")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default=None, help="output PNG path; defaults to ./<prefix>_<seed>.png")
    ap.add_argument("--prefix", default="comfyui")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8188)
    ap.add_argument("--timeout", type=int, default=600, help="max seconds to wait for generation")
    ap.add_argument("--control-image", default=None,
                    help="local image (depth map / pose / edge) to lock viewpoint via ControlNet "
                         "(required for flux2 models registered with a controlnet)")
    ap.add_argument("--strength", type=float, default=None,
                    help="ControlNet strength (default from models.json, ~0.75)")
    ap.add_argument("--transparent", action="store_true",
                    help="透明主体模式：AI 选纯色底写入提示词，出图后自动阈值抠图 + BiRefNet 精修")
    ap.add_argument("--bg-color", default=None,
                    help="透明模式底色：#RRGGBB 或 auto（默认 auto，AI 按提示词选）")
    ap.add_argument("--cutout-tol", type=int, default=55, help="抠图颜色距离阈值（默认 55）")
    ap.add_argument("--no-refine", action="store_true", help="透明模式跳过 BiRefNet 边缘精修")
    args = ap.parse_args()

    registry = load_registry()
    if args.list_models:
        print_registry(registry)
        return

    model_name = args.model or "sdxl"
    if model_name not in registry:
        ap.error(f"--model '{model_name}' not in {REGISTRY_FILE}; run --list-models to see options")
    entry = registry[model_name]
    mtype = entry["type"]

    if args.prompt_file:
        with open(args.prompt_file, "r", encoding="utf-8") as fh:
            prompt = fh.read().strip()
    else:
        prompt = args.prompt
    if not prompt:
        ap.error("provide --prompt or --prompt-file")

    size = args.size or entry.get("size", "1024x1024")
    try:
        width, height = (int(x) for x in size.lower().split("x"))
    except ValueError:
        ap.error("--size must be like 1024x1024")

    steps = args.steps if args.steps is not None else entry.get("steps", 20)
    cfg = args.cfg if args.cfg is not None else entry.get("cfg", 6.0)
    sampler = args.sampler or entry.get("sampler", "euler")
    scheduler = args.scheduler or entry.get("scheduler", "normal")
    negative = args.negative if args.negative is not None else entry.get("negative", DEFAULT_NEGATIVE)

    bg_hex = None
    if args.transparent:
        if args.bg_color and args.bg_color.lower() != "auto":
            bg_hex = args.bg_color.lstrip("#").upper()
            if len(bg_hex) != 6:
                ap.error("--bg-color must be like #FF00FF or auto")
            bg_name = name_for_hex(bg_hex)
            print(f"[transparent] 底色（人工指定）: {bg_name} #{bg_hex}", flush=True)
        else:
            pick = pick_bg_color(prompt)
            bg_hex, bg_name = pick["hex"], pick["name"]
            print(f"[transparent] 底色 AI 选择: {bg_name} #{bg_hex} — {pick['reason']}", flush=True)
        prompt = inject_background(prompt, bg_name, bg_hex)
        negative = (f"{negative}, gradient background, textured background, "
                    "shadow on background, glow behind subject, frame, border").strip(" ,")
        print(f"[transparent] 最终提示词: {prompt[:260]}{'...' if len(prompt) > 260 else ''}", flush=True)

    seed = args.seed if args.seed is not None else random.randint(0, 2**31 - 1)

    if mtype == "checkpoint":
        ckpt = args.checkpoint or entry.get("checkpoint")
        if not ckpt:
            ap.error(f"model '{model_name}' has no checkpoint file in registry")
        workflow, save_node = build_checkpoint_workflow(
            prompt, negative, ckpt, seed, steps, cfg, width, height, sampler, scheduler, args.prefix)
    elif mtype == "flux2":
        if args.checkpoint:
            print(f"note: --checkpoint ignored for flux2 model '{model_name}'", file=sys.stderr)
        controlnet = entry.get("controlnet")
        control_image = None
        if controlnet:
            if not args.control_image:
                ap.error(f"model '{model_name}' uses ControlNet '{controlnet}' — "
                         f"provide --control-image (depth map / pose / edge)")
            control_image = upload_image(args.host, args.port, args.control_image)
        strength = args.strength if args.strength is not None else entry.get("control_strength", 0.75)
        workflow, save_node = build_flux2_workflow(
            prompt, negative, entry.get("unet"), entry.get("clip"), entry.get("vae"),
            seed, steps, cfg, width, height, sampler, args.prefix, lora=entry.get("lora"),
            controlnet=controlnet, control_image=control_image, strength=strength)
    elif mtype == "mesh":
        if args.checkpoint:
            print(f"note: --checkpoint ignored for mesh model '{model_name}'", file=sys.stderr)
        remote_host = entry.get("remote_host", "192.168.3.153")
        remote_port = int(entry.get("remote_port", 7777))
        n_blocks = int(entry.get("n_blocks", 4))
        guidance = args.cfg if args.cfg is not None else entry.get("guidance", 4.0)
        print(f"[mesh] requires Daedalus on {remote_host}:{remote_port} (n_blocks={n_blocks})", flush=True)
        workflow, save_node = build_mesh_workflow(
            prompt, entry.get("unet"), entry.get("clip"), entry.get("vae"), entry.get("lora"),
            seed, steps, guidance, width, height, remote_host, remote_port, n_blocks, args.prefix)
    else:
        ap.error(f"model '{model_name}' has unsupported type '{mtype}' in registry")

    param_label = f"guidance={guidance}" if mtype == "mesh" else f"cfg={cfg}"
    print(f"[{model_name} / {mtype}] Submitting to {args.host}:{args.port} "
          f"(seed={seed}, {width}x{height}, {steps} steps, {param_label})...", flush=True)
    t0 = time.time()
    queued = api(args.host, args.port, "/prompt", "POST", {"prompt": workflow})
    pid = queued["prompt_id"]
    if queued.get("node_errors"):
        print("Workflow errors:", json.dumps(queued["node_errors"], ensure_ascii=False, indent=2))
        sys.exit(1)

    deadline = time.time() + args.timeout
    images = None
    while time.time() < deadline:
        time.sleep(2)
        history = api(args.host, args.port, f"/history/{pid}")
        entry_status = history.get(pid)
        if not entry_status:
            continue
        if entry_status.get("status", {}).get("status_str") == "error":
            print("Generation error:", json.dumps(entry_status["status"], ensure_ascii=False, indent=2))
            sys.exit(1)
        if entry_status.get("status", {}).get("completed"):
            images = entry_status["outputs"].get(save_node, {}).get("images", [])
            break

    if not images:
        print("Timed out waiting for generation", file=sys.stderr)
        sys.exit(1)

    img = images[0]
    view_path = f"/view?filename={img['filename']}&subfolder={img.get('subfolder', '')}&type={img.get('type', 'output')}"
    out_path = args.out or os.path.join(SCRATCH_DIR, f"{args.prefix}_{seed}.png")
    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)

    with urllib.request.urlopen(f"http://{args.host}:{args.port}{view_path}", timeout=60) as resp:
        data = resp.read()
    raw_path = out_path
    if args.transparent:
        stem, ext = os.path.splitext(out_path)
        raw_path = f"{stem}_raw{ext}"
    with open(raw_path, "wb") as fh:
        fh.write(data)

    print(f"Saved {raw_path} ({len(data)/1024:.0f} KB) in {time.time()-t0:.1f}s")

    if args.transparent:
        stats, note = cutout_file(
            raw_path, out_path, bg_hex=bg_hex, tol=args.cutout_tol,
            refine="none" if args.no_refine else "auto")
        print(f"[transparent] 抠图完成: {out_path} opaque%={stats['opaque']} "
              f"bbox={stats['bbox']} | {note}", flush=True)


if __name__ == "__main__":
    main()
