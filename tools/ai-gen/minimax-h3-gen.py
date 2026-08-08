#!/usr/bin/env python3
"""Remote MiniMax H3 text-to-video generation via the RTX 5080 ComfyUI (192.168.3.142).

Implements the official ComfyUI MiniMax H3 T2V workflow:
UNETLoader(fl2va) + CLIPLoader(qwen3vl minimax) + video/audio VAELoader ->
MiniMaxH3ImageToVideo -> BasicGuider + RandomNoise + KSamplerSelect(res_multistep)
+ BasicScheduler(simple) -> SamplerCustomAdvanced -> VAEDecode + VAEDecodeAudio
-> CreateVideo(24fps) -> SaveVideo(mp4). Video and native stereo audio are
generated together in one pass.

With --ref-image the workflow switches to the reference mode
(MiniMaxH3ReferenceToVideo, ref2va): the image is uploaded to the ComfyUI input
folder, referenced via LoadImage + ref_images (prompt tag <Picture 1>), which
locks character/style/sound. --ref-size max gives best identity fidelity.

Usage:
    python minimax-h3-gen.py --prompt "..." --duration 5 --out video.mp4
    python minimax-h3-gen.py --prompt-file prompt.txt --size 1024x576 --seed 42
    python minimax-h3-gen.py --ref-image idle.png --prompt "the character in <Picture 1> walks ..." --out video.mp4
"""

import argparse
import json
import math
import os
import random
import sys
import time
import urllib.request

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)
from pick_bg_color import inject_background, name_for_hex, pick_bg_color_from_image  # noqa: E402

UNET = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
REF2VA_UNET = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
CLIP = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VAE_VIDEO = "minimax_h3_video_vae_fp16.safetensors"
VAE_AUDIO = "minimax_h3_audio_vae_fp32.safetensors"
SCRATCH_DIR = r"Y:\工作\无尽轮回\scratch"


def build_workflow(prompt, seed, width, height, length, steps, scheduler, sampler, prefix,
                   ref_images=None, ref_image_size="max", first_frame=None, last_frame=None):
    ref_images = ref_images or []
    unet_name = REF2VA_UNET if ref_images else UNET
    wf = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": unet_name, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": CLIP, "type": "minimax"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE_VIDEO}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": VAE_AUDIO}},
    }
    if first_frame or last_frame:
        if ref_images:
            raise ValueError("--ref-image cannot be combined with --first-frame/--last-frame")
        if first_frame:
            wf["15"] = {"class_type": "LoadImage", "inputs": {"image": first_frame}}
        if last_frame:
            wf["16"] = {"class_type": "LoadImage", "inputs": {"image": last_frame}}
        i2v_inputs = {
            "clip": ["2", 0], "vae": ["3", 0],
            "prompt": prompt, "width": width, "height": height, "length": length,
        }
        if first_frame:
            i2v_inputs["first_frame"] = ["15", 0]
        if last_frame:
            i2v_inputs["last_frame"] = ["16", 0]
        wf["5"] = {"class_type": "MiniMaxH3ImageToVideo", "inputs": i2v_inputs}
    elif ref_images:
        for i, fname in enumerate(ref_images):
            wf[str(15 + i)] = {"class_type": "LoadImage", "inputs": {"image": fname}}
        wf["5"] = {
            "class_type": "MiniMaxH3ReferenceToVideo",
            "inputs": {
                "clip": ["2", 0], "vae": ["3", 0], "audio_vae": ["4", 0],
                "prompt": prompt, "width": width, "height": height, "length": length,
                "ref_image_size": ref_image_size,
                "ref_images": {f"ref_image_{i}": [str(15 + i), 0] for i in range(len(ref_images))},
            },
        }
    else:
        wf["5"] = {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["2", 0], "vae": ["3", 0],
                "prompt": prompt, "width": width, "height": height, "length": length,
            },
        }
    wf.update({
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
    })
    return wf


def duration_to_frames(duration):
    """Frame count at 24fps snapped up to the model's 17k+5 grid."""
    n = max(5, round(duration * 24))
    return n + (5 - n % 17) % 17


def upload_image(host, port, path, timeout=120):
    """Upload a local image to the ComfyUI input folder (multipart /upload/image)."""
    import mimetypes
    boundary = "----codexboundary%08x" % random.randint(0, 0xFFFFFFFF)
    filename = os.path.basename(path)
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    with open(path, "rb") as fh:
        blob = fh.read()
    body = bytearray()
    body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode()
    body += blob
    body += f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\ninput\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"http://{host}:{port}/upload/image", data=bytes(body), method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


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
    ap.add_argument("--ref-image", action="append", default=None,
                    help="local reference image for ref2va (repeatable; <Picture 1..N> in prompt)")
    ap.add_argument("--ref-size", choices=["match", "max"], default="max",
                    help="reference sizing: match=faster, max=best identity fidelity")
    ap.add_argument("--first-frame", default=None, help="local image used as the exact first video frame (H3 I2V)")
    ap.add_argument("--last-frame", default=None, help="local image used as the exact last video frame (H3 I2V)")
    ap.add_argument("--host", default="192.168.3.142")
    ap.add_argument("--port", type=int, default=8188)
    ap.add_argument("--timeout", type=int, default=2400, help="max seconds to wait for generation")
    ap.add_argument("--bg-color", default=None,
                    help="背景色 #RRGGBB 或 auto（用 --first-frame 参考图自动选主体没有的颜色，"
                         "强制注入纯色底+无阴影条款；缺省不注入=沿用提示词原背景描述）")
    args = ap.parse_args()

    if args.prompt_file:
        with open(args.prompt_file, "r", encoding="utf-8") as fh:
            prompt = fh.read().strip()
    else:
        prompt = args.prompt
    if not prompt:
        ap.error("provide --prompt or --prompt-file")
    if args.bg_color:
        if args.bg_color.lower() == "auto":
            ref = args.first_frame or (args.ref_image[0] if args.ref_image else None)
            if not ref:
                print("[minimax-h3] --bg-color auto 但无参考图，跳过注入", flush=True)
            else:
                pick = pick_bg_color_from_image(ref)
                prompt = inject_background(prompt, pick["name"], pick["hex"])
                print(f"[minimax-h3] bg-color auto: {pick['name']} #{pick['hex']} "
                      f"({pick['reason']})", flush=True)
        else:
            h = args.bg_color.lstrip("#")
            name = name_for_hex(h)
            prompt = inject_background(prompt, name, h)
            print(f"[minimax-h3] bg-color: {name} #{h}", flush=True)
    try:
        width, height = (int(x) for x in args.size.lower().split("x"))
    except ValueError:
        ap.error("--size must be like 1344x768")

    seed = args.seed if args.seed is not None else random.randint(0, 2**31 - 1)
    length = duration_to_frames(args.duration)
    ref_images = []
    if args.ref_image:
        for p in args.ref_image:
            up = upload_image(args.host, args.port, p)
            sub = up.get("subfolder", "")
            ref_images.append(f"{sub}/{up['name']}" if sub else up["name"])
        print(f"[minimax-h3] uploaded {len(ref_images)} ref image(s): {ref_images} (ref_size={args.ref_size})", flush=True)
    first_frame = last_frame = None
    if args.first_frame:
        up = upload_image(args.host, args.port, args.first_frame)
        sub = up.get("subfolder", "")
        first_frame = f"{sub}/{up['name']}" if sub else up["name"]
        print(f"[minimax-h3] uploaded first frame: {first_frame}", flush=True)
    if args.last_frame:
        up = upload_image(args.host, args.port, args.last_frame)
        sub = up.get("subfolder", "")
        last_frame = f"{sub}/{up['name']}" if sub else up["name"]
        print(f"[minimax-h3] uploaded last frame: {last_frame}", flush=True)
    wf = build_workflow(prompt, seed, width, height, length, args.steps, args.scheduler,
                        args.sampler, args.prefix, ref_images=ref_images, ref_image_size=args.ref_size,
                        first_frame=first_frame, last_frame=last_frame)

    mode = "ref2va" if ref_images else ("i2v_firstframe" if (first_frame or last_frame) else "t2v")
    print(f"[minimax-h3] {args.host}:{args.port} mode={mode} seed={seed} {width}x{height} "
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
