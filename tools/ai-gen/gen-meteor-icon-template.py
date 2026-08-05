#!/usr/bin/env python3
"""Template-locked meteor icon regeneration on the remote RTX 5080.

Uses fireball_icon.png (flattened onto white) as the img2img reference so the
output inherits the magic-series hexagonal badge template box. Then auto-cuts
to transparent, measures the content box, scores against the series reference
(fireball: 788x939 @ (3,29), aspect 0.84) and replaces the in-game icon with
the best match. All variants + stats are kept in meteor-icons-v5-template/.
"""

import json
import os
import shutil
import subprocess
import sys
import time

import numpy as np
import requests
from PIL import Image

HOST, PORT = "192.168.3.142", 8188
BASE = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))  # game-dev
TOOLS = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(BASE, "assets", "skills", "meteor-icons-v5-template")
REF_SRC = os.path.join(BASE, "assets", "skills", "fireball_icon.png")
REF_LOCAL = os.path.join(TOOLS, "_fireball_white.png")
REF_NAME = "fireball_white.png"
DST_ICON = os.path.join(BASE, "assets", "skills", "陨星坠落.png")
BACKUP_DIR = os.path.join(BASE, "backup", "current", "assets", "skills")
MAKE_CUT = os.path.join(TOOLS, "make-transparent-icon.py")
CKPT = "sd_xl_base_1.0.safetensors"

TARGET = {"w": 788, "h": 939, "aspect": 0.84, "cx": 3, "cy": 29, "fill": 70.6}

NEG = ("fireball, floating fire orb, ice, snow, blizzard, frost, blue crystal, gemstone, "
       "text, watermark, signature, blurry, low quality, deformed, extra frame, dark background")

PROMPT = (
    "game skill icon emblem, keep the exact same hexagonal badge template, size, "
    "position and layout as the reference image: purple hexagonal badge with gold trim "
    "and embossed translucent crystal block base at the bottom, the center shows a massive "
    "dark volcanic meteor rock falling diagonally, charred black stone with glowing orange "
    "lava cracks, long fiery tail and ember sparks trailing behind, clearly a falling meteorite "
    "not a fireball, centered, game asset art, high detail, crisp, isolated on a plain pure "
    "white background"
)

DENOISES = [0.62, 0.68, 0.74, 0.80]
SEEDS = [20260810, 20260811]


def api(path, method="GET", payload=None, timeout=120):
    url = f"http://{HOST}:{PORT}{path}"
    resp = requests.post(url, json=payload, timeout=timeout) if payload is not None else requests.get(url, timeout=timeout)
    resp.raise_for_status()
    return resp.json()


def prepare_reference():
    img = Image.open(REF_SRC).convert("RGBA")
    canvas = Image.new("RGBA", img.size, (255, 255, 255, 255))
    canvas.alpha_composite(img)
    canvas.convert("RGB").save(REF_LOCAL)
    with open(REF_LOCAL, "rb") as fh:
        resp = requests.post(
            f"http://{HOST}:{PORT}/upload/image",
            files={"image": (REF_NAME, fh, "image/png")},
            data={"overwrite": "true"},
            timeout=60,
        )
    resp.raise_for_status()
    print(f"reference uploaded: {resp.json()}", flush=True)


def wait_complete(pid, timeout=600):
    deadline = time.time() + timeout
    while time.time() < deadline:
        time.sleep(2)
        entry = api(f"/history/{pid}").get(pid)
        if not entry:
            continue
        if entry.get("status", {}).get("status_str") == "error":
            raise RuntimeError(json.dumps(entry["status"], ensure_ascii=False))
        if entry.get("status", {}).get("completed"):
            imgs = entry["outputs"].get("9", {}).get("images", [])
            if imgs:
                return imgs[0]
    raise RuntimeError("timeout")


def generate(seed, denoise, tag):
    wf = {
        "4": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": CKPT}},
        "6": {"class_type": "CLIPTextEncode", "inputs": {"text": PROMPT, "clip": ["4", 1]}},
        "7": {"class_type": "CLIPTextEncode", "inputs": {"text": NEG, "clip": ["4", 1]}},
        "10": {"class_type": "LoadImage", "inputs": {"image": REF_NAME}},
        "5": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["4", 2]}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed, "steps": 28, "cfg": 6.0,
                "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": denoise,
                "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
                "latent_image": ["5", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "meteor5", "images": ["8", 0]}},
    }
    queued = api("/prompt", "POST", {"prompt": wf})
    if queued.get("node_errors"):
        raise RuntimeError(json.dumps(queued["node_errors"], ensure_ascii=False))
    img = wait_complete(queued["prompt_id"])
    view = (f"/view?filename={img['filename']}&subfolder={img.get('subfolder', '')}"
            f"&type={img.get('type', 'output')}")
    data = requests.get(f"http://{HOST}:{PORT}{view}", timeout=120).content
    raw = os.path.join(OUT_DIR, f"{tag}_raw.png")
    with open(raw, "wb") as fh:
        fh.write(data)
    cut = os.path.join(OUT_DIR, f"{tag}_cut.png")
    try:
        subprocess.run([sys.executable, MAKE_CUT, raw, cut], check=True, capture_output=True, timeout=300)
    except subprocess.TimeoutExpired:
        raise RuntimeError(f"抠图子进程超时（300s）: {raw}") from None
    return raw, cut


def measure(path):
    im = Image.open(path).convert("RGBA")
    a = np.asarray(im)[:, :, 3]
    w, h = im.size
    ys, xs = np.where(a > 8)
    if len(xs) == 0:
        return None
    bw, bh = xs.max() - xs.min() + 1, ys.max() - ys.min() + 1
    return {
        "bbox_w": int(bw), "bbox_h": int(bh),
        "aspect": round(bw / bh, 2),
        "fill": round(bw * bh / (w * h) * 100, 1),
        "cx": int(round((xs.min() + xs.max()) / 2 - w / 2)),
        "cy": int(round((ys.min() + ys.max()) / 2 - h / 2)),
    }


def score(stats):
    t = TARGET
    if stats is None:
        return 1e9
    return (abs(stats["bbox_w"] - t["w"]) / 40 +
            abs(stats["bbox_h"] - t["h"]) / 40 +
            abs(stats["aspect"] - t["aspect"]) * 4 +
            abs(stats["cy"] - t["cy"]) / 15 +
            abs(stats["fill"] - t["fill"]) / 12)


def main():
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    os.makedirs(OUT_DIR, exist_ok=True)
    prepare_reference()

    results = []
    for denoise in DENOISES:
        for seed in SEEDS:
            tag = f"meteor_tmpl_d{denoise:.2f}_s{seed}"
            t0 = time.time()
            try:
                raw, cut = generate(seed, denoise, tag)
                stats = measure(cut)
                s = score(stats)
                results.append({"tag": tag, "denoise": denoise, "seed": seed,
                                "raw": os.path.basename(raw), "cut": os.path.basename(cut),
                                "stats": stats, "score": round(s, 2)})
                print(f"{tag}: {time.time()-t0:.1f}s {stats} score={s:.2f}", flush=True)
            except Exception as exc:
                print(f"{tag} FAILED: {exc}", flush=True)

    good = [r for r in results if r.get("stats") and 0.7 <= r["stats"]["aspect"] <= 1.1 and 55 <= r["stats"]["fill"] <= 82]
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(results, fh, ensure_ascii=False, indent=2)

    if not good:
        print("no usable variant; keeping current icon", flush=True)
        return

    best = min(good, key=lambda r: r["score"])
    print(f"\nBEST: {best['tag']} score={best['score']} {best['stats']}", flush=True)
    os.makedirs(BACKUP_DIR, exist_ok=True)
    cur_bak = os.path.join(BACKUP_DIR, "陨星坠落.flux2-20260804.png")
    if os.path.exists(DST_ICON):
        shutil.copyfile(DST_ICON, cur_bak)
    shutil.copyfile(os.path.join(OUT_DIR, best["cut"]), DST_ICON)
    print(f"replaced in-game icon with {best['cut']}", flush=True)


if __name__ == "__main__":
    main()
