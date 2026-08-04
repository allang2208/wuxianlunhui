#!/usr/bin/env python3
"""Remote MiniMax H3 text-to-video generation via the RTX 5080 ComfyUI (192.168.3.142).

Implements the official ComfyUI MiniMax H3 T2V workflow:
UNETLoader(fl2va) + CLIPLoader(qwen3vl minimax) + video/audio VAELoader ->
MiniMaxH3ImageToVideo -> BasicGuider + RandomNoise + KSamplerSelect(res_multistep)
+ BasicScheduler(simple) -> SamplerCustomAdvanced -> VAEDecode + VAEDecodeAudio
-> CreateVideo(24fps) -> SaveVideo(mp4). Video and native stereo audio are
generated together in one pass.

Usage:
    python minimax-h3-gen.py --prompt "..." --duration 5 --out video.mp4
    python minimax-h3-gen.py --prompt-file prompt.txt --size 1024x576 --seed 42
"""

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.request

UNET = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
CLIP = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VAE_VIDEO = "minimax_h3_video_vae_fp16.safetensors"
VAE_AUDIO = "minimax_h3_audio_vae_fp32.safetensors"
SCRATCH_DIR = r"Y:\工作\无尽轮回\scratch"


def build_workflow(prompt, seed, width, height, length, steps, scheduler, sampler, prefix):
    return {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": UNET, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": CLIP, "type": "minimax"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE_VIDEO}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": VAE_AUDIO}},
        "5": {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["2", 0], "vae": ["3", 0],
                "prompt": prompt, "width": width, "height": height, "length": length,
            },
        },
        "6": {"class_type": "BasicGuider", "inputs": {"model": ["1", 0], "conditioning": ["5", 0]}},
        "7": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "8": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": sampler}},
        "9": {"class_type": "BasicScheduler", "inputs": {
            "model": ["1", 0], "scheduler": scheduler, "steps": steps, "denoise": 1.0}},
        "10": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["7", 0], "guider": ["6", 0], "sampler": ["8", 0],
            "sigmas": ["9", 0], "latent_image": ["5", 1]}},
        "11": {"class_type": "VAEDecode", "inputs": {"samples": ["10", 0], "vae": ["3", 0]}},
        "12": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["10", 0], "vae": ["4", 0]}},
        "13": {"class_type": "CreateVideo", "inputs": {
            "images": ["11", 0], "fps": 24, "audio": ["12", 0], "bit_depth": 8}},
        "14": {"class_type": "SaveVideo", "inputs": {
            "video": ["13", 0], "filename_prefix": prefix, "format": "mp4", "codec": "h264"}},
    }


def duration_to_frames(duration):
    """Frame count at 24fps snapped up to the model's 17k+5 grid."""
    n = max(5, round(duration * 24))
    return n + (5 - n % 17) % 17


def api(host, port, path, method="GET", payload=None, timeout=60):
    url = f"http://{host}:{port}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser(description="Remote MiniMax H3 text-to-video (RTX 5080).")
    ap.add_argument("--prompt", help="video prompt (scene + shots + audio)")
    ap.add_argument("--prompt-file", help="read prompt from a text file")
    ap.add_argument("--duration", type=float, default=2.0, help="duration in seconds (24fps, 17k+5 grid)")
    ap.add_argument("--size", default="1344x768", help="widthxheight, multiples of 32 (H3 native 1344x768)")
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--scheduler", default="simple")
    ap.add_argument("--sampler", default="res_multistep")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--out", default=None, help="output mp4 path")
    ap.add_argument("--prefix", default="video/minimax_h3")
    ap.add_argument("--host", default="192.168.3.142")
    ap.add_argument("--port", type=int, default=8188)
    ap.add_argument("--timeout", type=int, default=2400, help="max seconds to wait for generation")
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
        ap.error("--size must be like 1344x768")

    seed = args.seed if args.seed is not None else random.randint(0, 2**31 - 1)
    length = duration_to_frames(args.duration)
    wf = build_workflow(prompt, seed, width, height, length, args.steps, args.scheduler, args.sampler, args.prefix)

    print(f"[minimax-h3] {args.host}:{args.port} seed={seed} {width}x{height} "
          f"{args.duration}s -> {length} frames, {args.steps} steps ({args.sampler}/{args.scheduler})", flush=True)
    t0 = time.time()
    queued = api(args.host, args.port, "/prompt", "POST", {"prompt": wf})
    pid = queued["prompt_id"]
    if queued.get("node_errors"):
        print("Workflow errors:", json.dumps(queued["node_errors"], ensure_ascii=False, indent=2))
        sys.exit(1)

    deadline = time.time() + args.timeout
    video = None
    while time.time() < deadline:
        time.sleep(5)
        history = api(args.host, args.port, f"/history/{pid}")
        entry = history.get(pid)
        if not entry:
            continue
        if entry.get("status", {}).get("status_str") == "error":
            print("Generation error:", json.dumps(entry["status"], ensure_ascii=False, indent=2))
            sys.exit(1)
        if entry.get("status", {}).get("completed"):
            video = entry["outputs"].get("14", {}).get("videos", [])
            if not video:
                video = entry["outputs"].get("14", {}).get("images", [])
            break

    if not video:
        print("Timed out waiting for generation", file=sys.stderr)
        sys.exit(1)

    item = video[0]
    view = (f"/view?filename={item['filename']}&subfolder={item.get('subfolder', '')}"
            f"&type={item.get('type', 'output')}")
    out_path = args.out or os.path.join(SCRATCH_DIR, f"minimax_h3_{seed}.mp4")
    out_dir = os.path.dirname(os.path.abspath(out_path))
    os.makedirs(out_dir, exist_ok=True)
    with urllib.request.urlopen(f"http://{args.host}:{args.port}{view}", timeout=300) as resp:
        data = resp.read()
    with open(out_path, "wb") as fh:
        fh.write(data)
    print(f"Saved {out_path} ({len(data)/1024/1024:.1f} MB) in {time.time()-t0:.0f}s")


if __name__ == "__main__":
    main()
