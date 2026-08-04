#!/usr/bin/env python3
"""Batch-generate the rare equipment set icons via local ComfyUI.

Reads tools/rare-set-gen.json (sets + accessories), submits all prompts at once
(ComfyUI queues them), polls until each finishes,
then downloads the PNGs into tools/eclipse-raw/.
"""

import json
import os
import sys
import time
import urllib.request
import argparse

HOST, PORT = "127.0.0.1", 8188
BASE = os.path.dirname(os.path.abspath(__file__))
CONFIG = os.path.join(BASE, "rare-set-gen.json")
RAW_DIR = os.path.join(BASE, "eclipse-raw")
CKPT = "sd_xl_base_1.0.safetensors"


def api(path, method="GET", payload=None):
    url = f"http://{HOST}:{PORT}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def build_wf(prompt, negative, seed):
    return {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": prompt, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": negative, "clip": ["4", 1]}},
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
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "eclipse", "images": ["8", 0]}},
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", help="comma-separated keys to generate; default all")
    args, _ = ap.parse_known_args()
    only_keys = set(args.keys.split(",")) if args.keys else None

    with open(CONFIG, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    os.makedirs(RAW_DIR, exist_ok=True)

    neg = cfg["negative"]
    jobs = []

    def queue(key, name_cn, prompt, seed):
        pid = api("/prompt", "POST", {"prompt": build_wf(prompt, neg, seed)})["prompt_id"]
        jobs.append((key, name_cn, pid, seed))
        print(f"queued {key} ({name_cn}) pid={pid}", flush=True)

    for grp in cfg.get("sets", []):
        style = grp.get("style_prefix", "")
        for item in grp["pieces"]:
            if only_keys is not None and item["key"] not in only_keys:
                continue
            prompt = f"{item['prompt']}, {style}"
            queue(item["key"], item["name_cn"], prompt, item["seed"])
    for item in cfg.get("accessories", []):
        if only_keys is not None and item["key"] not in only_keys:
            continue
        style = item.get("style_prefix", "")
        prompt = f"{item['prompt']}, {style}"
        queue(item["key"], item["name_cn"], prompt, item["seed"])

    if not jobs:
        print("no jobs queued")
        sys.exit(1)

    deadline = time.time() + 900
    done = {}
    while len(done) < len(jobs) and time.time() < deadline:
        time.sleep(3)
        for key, name_cn, pid, seed in jobs:
            if key in done:
                continue
            entry = api(f"/history/{pid}").get(pid)
            if not entry:
                continue
            status = entry.get("status", {})
            if status.get("status_str") == "error":
                print(f"{key}: ERROR {json.dumps(status, ensure_ascii=False)}", flush=True)
                done[key] = None
                continue
            if status.get("completed"):
                images = entry.get("outputs", {}).get("9", {}).get("images", [])
                if not images:
                    print(f"{key}: completed but no image", flush=True)
                    done[key] = None
                    continue
                img = images[0]
                view = (f"/view?filename={img['filename']}&subfolder={img.get('subfolder', '')}"
                        f"&type={img.get('type', 'output')}")
                with urllib.request.urlopen(f"http://{HOST}:{PORT}{view}", timeout=60) as resp:
                    data = resp.read()
                out = os.path.join(RAW_DIR, f"{key}.png")
                with open(out, "wb") as fh:
                    fh.write(data)
                done[key] = out
                print(f"done {key} -> {out} ({len(data)/1024:.0f} KB)", flush=True)

    missing = [k for k, v in done.items() if v is None]
    pending = [k for k, _, p, _ in jobs if k not in done]
    if missing or pending:
        print(f"FAILED/INCOMPLETE: missing={missing} pending={pending}", file=sys.stderr)
        sys.exit(1)
    print("ALL DONE")


if __name__ == "__main__":
    main()
