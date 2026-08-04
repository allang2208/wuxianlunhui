#!/usr/bin/env python3
"""Generate several robe candidates, keep ones that are a single object."""

import json
import os
import time
import urllib.request

HOST, PORT = "127.0.0.1", 8188
BASE = os.path.dirname(os.path.abspath(__file__))
RAW_DIR = os.path.join(BASE, "eclipse-raw")
CKPT = "sd_xl_base_1.0.safetensors"

PROMPT = ("(exactly one robe:1.6), (a single mage robe only:1.6), dark midnight blue, "
          "seen straight on from the front, flat frontal view, symmetric robe layout "
          "with centered high collar, silver moon-phase embroidery and star runes "
          "along the hem and sleeves, subtle arcane glow, "
          "(one garment only, no lineup, no multiple outfits, no clothing rack:1.6), "
          "(single front view:1.4), no perspective, no side view, no ring, no halo, "
          "no circular frame, no floating ornament, no extra decoration")

NEG = ("blurry, low quality, watermark, text, signature, frame, border, UI element, "
       "multiple subjects, human, character, hands, cluttered background, circular halo, "
       "circular frame, circular emblem, circular ornament, floating circle, "
       "glowing circle behind object, ring-shaped decoration around the object, "
       "ornamental circle, magic circle, multiple views, turnaround, design sheet, "
       "blueprint, multiple robes, duplicate items, clothing rack, mannequin, store display")

SEEDS = [20300271, 20300272, 20300273, 20300274]


def api(path, method="GET", payload=None):
    url = f"http://{HOST}:{PORT}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def build_wf(seed):
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["4", 1]}},
        "5": {"class_type": "EmptyLatentImage", "inputs": {"width": 1024, "height": 1024, "batch_size": 1}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed, "steps": 24, "cfg": 6.5,
                "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 1.0,
                "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "robe", "images": ["8", 0]}},
    }


def main():
    jobs = []
    for seed in SEEDS:
        pid = api("/prompt", "POST", {"prompt": build_wf(seed)})["prompt_id"]
        jobs.append((seed, pid))
        print(f"queued seed={seed} pid={pid}", flush=True)

    deadline = time.time() + 900
    done = {}
    while len(done) < len(jobs) and time.time() < deadline:
        time.sleep(3)
        for seed, pid in jobs:
            if seed in done:
                continue
            entry = api(f"/history/{pid}").get(pid)
            if not entry:
                continue
            if entry.get("status", {}).get("status_str") == "error":
                print(f"seed={seed} ERROR", flush=True)
                done[seed] = None
                continue
            if entry.get("status", {}).get("completed"):
                images = entry.get("outputs", {}).get("9", {}).get("images", [])
                if images:
                    img = images[0]
                    view = (f"/view?filename={img['filename']}&subfolder={img.get('subfolder', '')}"
                            f"&type={img.get('type', 'output')}")
                    with urllib.request.urlopen(f"http://{HOST}:{PORT}{view}", timeout=60) as resp:
                        data = resp.read()
                    out = os.path.join(RAW_DIR, f"robe_cand_{seed}.png")
                    with open(out, "wb") as fh:
                        fh.write(data)
                    done[seed] = out
                    print(f"done seed={seed} -> {out}", flush=True)

    print("ALL DONE")


if __name__ == "__main__":
    main()
