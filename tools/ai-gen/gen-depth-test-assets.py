#!/usr/bin/env python3
"""ControlNet 固定视角 + 水平/垂直双方向稳定性测试——防守组件库批量生图 v2（2026-08-04）。

模型：flux2-dev-depth（FLUX.2 dev fp8 + Fun-Controlnet-Union 深度控制）。
深度模板：tools/ai-gen/_depth_templates/depth_<shape>_<h|v>.png（手绘剪影，镜像非对称），
同一形状 h/v 提示词完全一致、只换模板——验证 ControlNet 能否稳定锁住视角与朝向。
产出：Y:\\工作\\无尽轮回\\scratch\\world122\\depth-test\\raw\\*.png。

用法：
    python tools/ai-gen/gen-depth-test-assets.py                # 全量（36 张）
    python tools/ai-gen/gen-depth-test-assets.py --keys scarecrow cottage   # 指定组件（自动展开 h/v）
"""
import argparse
import os
import subprocess
import sys
import time

DIR = os.path.dirname(os.path.abspath(__file__))
GEN = os.path.join(DIR, "comfyui-gen.py")
TEMPLATES = os.path.join(DIR, "_depth_templates")
HOST = "192.168.3.142"
MODEL = "flux2-dev-depth"
OUT_DIR = r"Y:\工作\无尽轮回\scratch\world122\depth-test\raw"

STYLE = (
    "game asset prop, photorealistic 3D render, dark realistic materials, "
    "soft studio lighting from upper-left, subtle drop shadow, "
    "centered composition, isolated on plain pure white background, high detail, "
    "no text, no watermark"
)
VIEW = (
    "frontal view, straight-on, slight three-quarter perspective, facing the camera, "
    "flat bottom edge sitting on the ground"
)
NEG = (
    "blurry, low quality, watermark, text, signature, gradient background, gray background, "
    "dark background, vignette, frame, border, people, hands, grass, floor texture, "
    "shadows on walls, isometric view, top-down view, multiple objects, duplicate items"
)

# (name, shape, 主题块)
FAMILIES = [
    ("farmland", "wide", "a small farmland patch, neat rows of young green crops on dark brown soil"),
    ("scarecrow", "figure", "a rustic scarecrow, wooden cross frame, straw hat, old patched burlap clothes"),
    ("haystack", "box", "a haystack, golden dried straw pile with a rounded top"),
    ("stump", "box", "a chopped tree stump with visible rings and peeling bark"),
    ("boulder", "box", "a large weathered grey boulder with moss patches"),
    ("fence", "wide", "a low wooden fence segment, three vertical planks with pointed tops and a cross rail"),
    ("woodpile", "box", "a stacked woodpile, cut logs piled up with rough bark"),
    ("barrel", "box_tall", "a wooden barrel with metal hoops, weathered planks"),
    ("well", "box_tall", "an old stone well with a wooden roof and a rope crank"),
    ("tent", "triangle", "a rustic canvas tent with a wooden frame, weathered fabric"),
    ("campfire", "box", "a campfire with burning logs and lively flames"),
    ("banner", "figure", "a war banner on a tall wooden pole, slightly torn red fabric"),
    ("cart", "wide", "a wooden farm cart with two big spoked wheels"),
    ("cottage", "box_tall", "a small thatched-roof farm cottage with a wooden door"),
]

ITEMS = []
for name, shape, theme in FAMILIES:
    for orient in ("h", "v"):
        ITEMS.append({
            "key": f"{name}_{orient}",
            "tpl": f"depth_{shape}_{orient}.png",
            "prompt": f"{theme}, {VIEW}, {STYLE}",
            "orient": orient,
        })


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--keys", nargs="*", default=None)
    ap.add_argument("--timeout", type=int, default=900)
    args = ap.parse_args()

    os.makedirs(OUT_DIR, exist_ok=True)
    items = ITEMS
    if args.keys:
        wanted = set(args.keys)
        items = [it for it in items if it["key"] in wanted or it["key"].rsplit("_", 1)[0] in wanted]

    print(f"[depth-test] 共 {len(items)} 张，模型 {MODEL}@{HOST}", flush=True)
    failed = []
    for i, it in enumerate(items, 1):
        print(f"[{i}/{len(items)}] {it['key']} (depth={it['tpl']}) ...", flush=True)
        pf = os.path.join(OUT_DIR, f"_prompt_{it['key']}.txt")
        with open(pf, "w", encoding="utf-8") as fh:
            fh.write(it["prompt"])
        depth = os.path.join(TEMPLATES, it["tpl"])
        out = os.path.join(OUT_DIR, f"{it['key']}.png")
        cmd = [
            sys.executable, GEN,
            "--host", HOST, "--model", MODEL,
            "--prompt-file", pf,
            "--negative", NEG,
            "--control-image", depth,
            "--seed", str(4000 + i * 17),
            "--out", out,
            "--timeout", str(args.timeout),
        ]
        t0 = time.time()
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=args.timeout + 120)
        except subprocess.TimeoutExpired:
            print(f"    FAIL 生图子进程超时（{args.timeout + 120}s）", flush=True)
            failed.append(it["key"])
            if os.path.exists(pf):
                os.remove(pf)
            continue
        cost = time.time() - t0
        if r.returncode == 0 and os.path.exists(out):
            print(f"    OK {cost:.0f}s -> {out}", flush=True)
        else:
            print(f"    FAIL {cost:.0f}s rc={r.returncode}", flush=True)
            print((r.stdout or "")[-900:], flush=True)
            print((r.stderr or "")[-900:], flush=True)
            failed.append(it["key"])
        if os.path.exists(pf):
            os.remove(pf)

    print(f"\n[depth-test] 完成：成功 {len(items) - len(failed)}，失败 {len(failed)}", flush=True)
    if failed:
        print("失败: " + ", ".join(failed), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
