#!/usr/bin/env python3
"""Generate 贤者项链 / 风灵项链 via Zhipu CogView API, download PNGs."""

import base64
import json
import os
import urllib.request

CFG_PATH = r"C:\Users\allan\.codex\skills\deepseek-vision-skill\config.json"
ENDPOINT = "https://open.bigmodel.cn/api/paas/v4/images/generations"
OUT_DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\tools\zhipu-raw"

STYLE = ("game equipment icon, realistic dark fantasy RPG necklace, "
         "single necklace fully inside frame with generous white margins, "
         "pure white background, no text, no watermark, no human, no hands, "
         "centered, high detail, dramatic rim lighting")

JOBS = [
    {
        "key": "xianzhe",
        "name": "贤者项链",
        "prompt": ("an elegant sage necklace, fine silver chain, center pendant is a "
                   "large oval deep blue sapphire wrapped in intricate silver filigree "
                   "with tiny rune engravings, arcane scholar style, mystic blue glow"),
    },
    {
        "key": "fengling",
        "name": "风灵项链",
        "prompt": ("a wind spirit necklace, delicate silver chain, center pendant is a "
                   "single emerald green feather with golden vane details and a small "
                   "swirling wind charm, airy graceful style, light green glow"),
    },
    {
        "key": "xingyun_ring",
        "name": "星陨之戒",
        "prompt": ("a fantasy ring shown at a 45 degree three-quarter angle, "
                   "the full elliptical band clearly visible, dark blackened silver "
                   "band with engraved falling-star patterns, center setting holds a "
                   "small glowing deep blue star gem, falling star motif, "
                   "same angle as classic RPG ring icons"),
    },
]


def gen(key, name, prompt):
    with open(CFG_PATH, "r", encoding="utf-8") as fh:
        cfg = json.load(fh)
    payload = {
        "model": "cogview-3-flash",
        "prompt": f"{prompt}, {STYLE}",
        "size": "1024x1024",
    }
    req = urllib.request.Request(
        ENDPOINT,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={
            "Authorization": f"Bearer {cfg['api_key']}",
            "Content-Type": "application/json",
        },
    )
    with urllib.request.urlopen(req, timeout=180) as resp:
        data = json.loads(resp.read().decode("utf-8"))
    img = data["data"][0]
    os.makedirs(OUT_DIR, exist_ok=True)
    out = os.path.join(OUT_DIR, f"{key}.png")
    if "url" in img:
        with urllib.request.urlopen(img["url"], timeout=180) as r2, open(out, "wb") as fh:
            fh.write(r2.read())
    elif "b64_json" in img:
        with open(out, "wb") as fh:
            fh.write(base64.b64decode(img["b64_json"]))
    print(f"{name} saved {out} ({os.path.getsize(out)/1024:.0f} KB)", flush=True)


def main():
    for job in JOBS:
        gen(job["key"], job["name"], job["prompt"])


if __name__ == "__main__":
    main()
