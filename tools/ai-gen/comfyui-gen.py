#!/usr/bin/env python3
"""Local text-to-image client for the project's ComfyUI backend.

Usage examples:
    python comfyui-gen.py --prompt "zombie sprite, full body, transparent background" -o out.png
    python comfyui-gen.py --prompt-file prompt.txt --size 832x1216 --steps 25 --seed 123
    python comfyui-gen.py --prompt "..." --checkpoint sd_xl_base_1.0.safetensors --cfg 7

Defaults match the installed SDXL base 1.0 setup on the local RTX 3080 Ti.
"""

import argparse
import json
import os
import random
import sys
import time
import urllib.request

DEFAULT_NEGATIVE = "blurry, low quality, watermark, text, signature"


def build_workflow(prompt, negative, ckpt, seed, steps, cfg, width, height, sampler, scheduler, prefix):
    return {
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


def api(host, port, path, method="GET", payload=None):
    url = f"http://{host}:{port}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser(description="Generate images through local ComfyUI (SDXL).")
    ap.add_argument("--prompt", help="positive prompt text")
    ap.add_argument("--prompt-file", help="read prompt from a text file")
    ap.add_argument("--negative", default=DEFAULT_NEGATIVE, help="negative prompt")
    ap.add_argument("--checkpoint", default="sd_xl_base_1.0.safetensors")
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--cfg", type=float, default=6.0)
    ap.add_argument("--sampler", default="euler")
    ap.add_argument("--scheduler", default="normal")
    ap.add_argument("--size", default="1024x1024", help="widthxheight, e.g. 832x1216")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default=None, help="output PNG path; defaults to ./<prefix>_<seed>.png")
    ap.add_argument("--prefix", default="comfyui")
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--port", type=int, default=8188)
    ap.add_argument("--timeout", type=int, default=600, help="max seconds to wait for generation")
    args = ap.parse_args()

    if args.prompt_file:
        with open(args.prompt_file, "r", encoding="utf-8") as fh:
            prompt = fh.read().strip()
    else:
        prompt = args.prompt
    if not prompt:
        ap.error("provide --prompt or --prompt-file")

    try:
        width, height = (int(x) for x in args.size.lower().split("x"))
    except ValueError:
        ap.error("--size must be like 1024x1024")

    seed = args.seed if args.seed is not None else random.randint(0, 2**31 - 1)
    wf = build_workflow(prompt, args.negative, args.checkpoint, seed, args.steps, args.cfg,
                        width, height, args.sampler, args.scheduler, args.prefix)

    print(f"Submitting to {args.host}:{args.port} (seed={seed}, {width}x{height}, {args.steps} steps)...", flush=True)
    t0 = time.time()
    queued = api(args.host, args.port, "/prompt", "POST", {"prompt": wf})
    pid = queued["prompt_id"]
    if queued.get("node_errors"):
        print("Workflow errors:", json.dumps(queued["node_errors"], ensure_ascii=False, indent=2))
        sys.exit(1)

    deadline = time.time() + args.timeout
    images = None
    while time.time() < deadline:
        time.sleep(2)
        history = api(args.host, args.port, f"/history/{pid}")
        entry = history.get(pid)
        if not entry:
            continue
        if entry.get("status", {}).get("status_str") == "error":
            print("Generation error:", json.dumps(entry["status"], ensure_ascii=False, indent=2))
            sys.exit(1)
        if entry.get("status", {}).get("completed"):
            images = entry["outputs"].get("9", {}).get("images", [])
            break

    if not images:
        print("Timed out waiting for generation", file=sys.stderr)
        sys.exit(1)

    img = images[0]
    view_path = f"/view?filename={img['filename']}&subfolder={img.get('subfolder', '')}&type={img.get('type', 'output')}"
    out_path = args.out or f"{args.prefix}_{seed}.png"
    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)

    with urllib.request.urlopen(f"http://{args.host}:{args.port}{view_path}", timeout=60) as resp:
        data = resp.read()
    with open(out_path, "wb") as fh:
        fh.write(data)

    print(f"Saved {out_path} ({len(data)/1024:.0f} KB) in {time.time()-t0:.1f}s")


if __name__ == "__main__":
    main()
