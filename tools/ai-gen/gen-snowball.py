#!/usr/bin/env python3
"""Generate a fluffy snowball texture (white bg) for the blizzard effect."""

import json
import os
import random
import time
import urllib.request

HOST, PORT = "127.0.0.1", 8188
BASE = r"E:\无尽轮回\长期备份\2026-7-13-1"
OUT_DIR = os.path.join(BASE, "game-dev", "assets", "skills", "snowball-variants")
CKPT = "sd_xl_base_1.0.safetensors"

NEG = ("gradient background, dark background, frame, border, watermark, text, "
       "signature, blurry, low quality, multiple objects")

PROMPT = ("sticker style, one fluffy white snowball, round compact ice ball with "
          "icy blue highlights and frost texture, isolated on a plain pure white "
          "background, centered, game asset, high detail")


def api(path, method="GET", payload=None):
    url = f"http://{HOST}:{PORT}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def generate(seed, tag):
    wf = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["4", 1]}},
        "5": {"class_type": "EmptyLatentImage",
              "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed, "steps": 26, "cfg": 7.0,
                "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0,
                "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "snow", "images": ["8", 0]}},
    }
    pid = api("/prompt", "POST", {"prompt": wf})["prompt_id"]
    deadline = time.time() + 600
    while time.time() < deadline:
        time.sleep(2)
        entry = api(f"/history/{pid}").get(pid)
        if not entry:
            continue
        if entry.get("status", {}).get("status_str") == "error":
            raise RuntimeError(json.dumps(entry["status"], ensure_ascii=False))
        if entry.get("status", {}).get("completed"):
            img = entry["outputs"]["9"]["images"][0]
            view = (f"/view?filename={img['filename']}&subfolder={img.get('subfolder','')}"
                    f"&type={img.get('type','output')}")
            with urllib.request.urlopen(f"http://{HOST}:{PORT}{view}", timeout=120) as resp:
                data = resp.read()
            out = os.path.join(OUT_DIR, f"{tag}.png")
            with open(out, "wb") as fh:
                fh.write(data)
            return out
    raise RuntimeError("timeout")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    manifest = []
    for i in range(1, 5):
        tag = f"snowball_{i:02d}"
        t0 = time.time()
        try:
            generate(random.randint(1, 2**31 - 1), tag)
            print(f"{tag}: {time.time()-t0:.1f}s", flush=True)
            manifest.append({"file": tag + ".png"})
        except Exception as exc:
            print(f"{tag} FAILED: {exc}", flush=True)
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    print("done")


if __name__ == "__main__":
    main()
