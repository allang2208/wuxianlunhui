#!/usr/bin/env python3
"""Round 5: inpaint the center subject (ice wall -> blizzard storm).

Base: blizzard_emblem_01.png (v3) — purple hexagon + gold trim + embossed base
are intact, only the center subject needs replacing. Inpaint masks only the
central region so the frame and base stay untouched.
"""

import json
import os
import random
import time
import urllib.request

from PIL import Image, ImageDraw

HOST, PORT = "127.0.0.1", 8188
BASE = r"E:\无尽轮回\长期备份\2026-7-13-1"
V3_DIR = os.path.join(BASE, "game-dev", "assets", "skills", "blizzard-icons-v3")
OUT_DIR = os.path.join(BASE, "game-dev", "assets", "skills", "blizzard-icons-v5")
INPUT_DIR = os.path.join(BASE, "ComfyUI", "input")
CKPT = "sd_xl_base_1.0.safetensors"

NEG = ("ice wall, brick wall, barrier, crystal cluster, frozen wall, masonry, "
       "text, watermark, signature, blurry, low quality, deformed")

PROMPT = ("swirling blizzard snowstorm in the center of the hexagonal emblem, "
          "spiral vortex of white snowflakes and icy blue wind, frost mist and "
          "small ice shards, glowing icy blue highlights, game icon style, "
          "high detail, crisp")


def make_mask():
    # ComfyUI LoadImage 的 MASK 输出 = alpha 通道；alpha 白色 = 重绘区
    mask = Image.new("RGBA", (1024, 1024), (0, 0, 0, 0))
    d = ImageDraw.Draw(mask)
    d.ellipse([512 - 400, 480 - 320, 512 + 400, 480 + 320], fill=(255, 255, 255, 255))
    path = os.path.join(INPUT_DIR, "blizzard_center_mask.png")
    mask.save(path)
    return path


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
        "10": {"class_type": "LoadImage", "inputs": {"image": "blizzard_base.png"}},
        "11": {"class_type": "LoadImage", "inputs": {"image": "blizzard_center_mask.png"}},
        "5": {"class_type": "VAEEncode", "inputs": {"pixels": ["10", 0], "vae": ["4", 2]}},
        "12": {"class_type": "SetLatentNoiseMask", "inputs": {"samples": ["5", 0], "mask": ["11", 1]}},
        "3": {
            "class_type": "KSampler",
            "inputs": {
                "seed": seed, "steps": 28, "cfg": 6.5,
                "sampler_name": "dpmpp_2m", "scheduler": "karras", "denoise": 0.88,
                "model": ["4", 0], "positive": ["6", 0], "negative": ["7", 0],
                "latent_image": ["12", 0],
            },
        },
        "8": {"class_type": "VAEDecode", "inputs": {"samples": ["3", 0], "vae": ["4", 2]}},
        "9": {"class_type": "SaveImage", "inputs": {"filename_prefix": "blz5", "images": ["8", 0]}},
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
    # 准备输入：底座图 + 中央遮罩
    base = os.path.join(V3_DIR, "blizzard_emblem_01.png")
    import shutil
    shutil.copyfile(base, os.path.join(INPUT_DIR, "blizzard_base.png"))
    make_mask()
    os.makedirs(OUT_DIR, exist_ok=True)

    manifest = []
    for i in range(1, 5):
        tag = f"blizzard_inpaint_{i:02d}"
        t0 = time.time()
        try:
            generate(random.randint(1, 2**31 - 1), tag)
            print(f"{tag}: {time.time()-t0:.1f}s", flush=True)
            manifest.append({"file": tag + ".png", "base": os.path.basename(base)})
        except Exception as exc:
            print(f"{tag} FAILED: {exc}", flush=True)
    with open(os.path.join(OUT_DIR, "manifest.json"), "w", encoding="utf-8") as fh:
        json.dump(manifest, fh, ensure_ascii=False, indent=2)
    print("done")


if __name__ == "__main__":
    main()
