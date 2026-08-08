#!/usr/bin/env python3
"""红狼人贴图多模型抠图对比：BiRefNet-general / BiRefNet_toonout / RMBG-2.0 / BEN2。

用法（ComfyUI venv python）：
  $env:PYTHONPATH='<ComfyUI根>;<ComfyUI根>/custom_nodes/ComfyUI-RMBG/py'
  python rw-rmbg-compare-models.py

输出到 <out>/ 目录：run_frame_<model>.png / idle_frame_<model>.png（品红底合成，
便于视觉验证残留），并在终端打印前景/半透明像素统计。
"""
import os
import sys
import time

import numpy as np
from PIL import Image
import torch

ASSETS = os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "enemies"
)
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "rw-rmbg-compare-out")

import AILab_BiRefNet as rmbg  # noqa: E402
import AILab_RMBG as rmbg2  # noqa: E402


def composite_white(rgba):
    a = np.array(rgba.convert("RGBA")).astype(np.float64)
    rgb = a[..., :3].copy()
    alpha = a[..., 3:4] / 255.0
    comp = rgb * alpha + 255.0 * (1 - alpha)
    return Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8), "RGB")


def stats(name, mask, label):
    m = np.array(mask)
    fg = int((m > 128).sum())
    semi = int(((m > 5) & (m < 250)).sum())
    opaque = int((m > 250).sum())
    print(f"  [{label}] {name}: opaque={opaque} semi={semi} fg>128={fg}", flush=True)
    return m


def run_birefnet(model, img, mname, label):
    t0 = time.time()
    tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0).unsqueeze(0)
    mask = model.process_image(tensor, {"process_res": 1024})
    m = stats(label, mask, mname)
    a = m.astype(np.float64) / 255.0
    comp = np.array(img).astype(np.float64) * a[..., None] + np.array([255, 0, 255])[None, None, :] * (1 - a[..., None])
    Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8), "RGB").save(
        os.path.join(OUT, f"{label}_{mname}.png")
    )
    print(f"    took {time.time()-t0:.1f}s -> {label}_{mname}.png", flush=True)


def run_rmbg2(model, img, mname, label):
    t0 = time.time()
    tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0).unsqueeze(0)
    masks = model.process_image(tensor, mname, {"process_res": 1024, "sensitivity": 1.0})
    m = np.array(masks[0])
    m = stats(label, m, mname)
    a = m.astype(np.float64) / 255.0
    comp = np.array(img).astype(np.float64) * a[..., None] + np.array([255, 0, 255])[None, None, :] * (1 - a[..., None])
    Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8), "RGB").save(
        os.path.join(OUT, f"{label}_{mname}.png")
    )
    print(f"    took {time.time()-t0:.1f}s -> {label}_{mname}.png", flush=True)


def run_ben2(model, img, mname, label):
    t0 = time.time()
    tensor = torch.from_numpy(np.array(img).astype(np.float32) / 255.0).unsqueeze(0)
    masks = model.process_image(tensor, mname, {"process_res": 1024, "sensitivity": 1.0})
    if isinstance(masks, list):
        m = np.array(masks[0])
    else:
        m = np.array(masks)
    m = stats(label, m, mname)
    a = m.astype(np.float64) / 255.0
    comp = np.array(img).astype(np.float64) * a[..., None] + np.array([255, 0, 255])[None, None, :] * (1 - a[..., None])
    Image.fromarray(np.clip(comp, 0, 255).astype(np.uint8), "RGB").save(
        os.path.join(OUT, f"{label}_{mname}.png")
    )
    print(f"    took {time.time()-t0:.1f}s -> {label}_{mname}.png", flush=True)


def main():
    os.makedirs(OUT, exist_ok=True)

    # 取红狼人奔跑第 3 帧（row0 col2）
    run = Image.open(os.path.join(ASSETS, "red_wolf_king_changed_run.png")).convert("RGBA")
    w, h = run.size
    cw, ch = w // 7, h // 2
    run_frame = composite_white(run.crop((2 * cw, 0, 3 * cw, ch)))
    run_frame.save(os.path.join(OUT, "run_frame_src.png"))

    idle = Image.open(os.path.join(ASSETS, "red_wolf_king_transformed_idle.png")).convert("RGBA")
    idle_frame = composite_white(idle)
    idle_frame.save(os.path.join(OUT, "idle_frame_src.png"))

    model = rmbg.BiRefNetModel()
    for mname in ["BiRefNet-general", "BiRefNet_toonout"]:
        ok, msg = model.check_model_cache(mname)
        if not ok:
            print(f"[skip] {mname}: {msg}", flush=True)
            continue
        model.load_model(mname)
        print(f"[model] {mname} loaded, device={rmbg.device}", flush=True)
        for label, img in [("run", run_frame), ("idle", idle_frame)]:
            run_birefnet(model, img, mname, label)

    model2 = rmbg2.RMBGModel()
    ok2, msg2 = model2.check_model_cache("RMBG-2.0")
    print(f"[cache] RMBG-2.0: {ok2} {msg2}", flush=True)
    if ok2:
        for label, img in [("run", run_frame), ("idle", idle_frame)]:
            run_rmbg2(model2, img, "RMBG-2.0", label)

    model3 = rmbg2.BEN2Model()
    ok3, msg3 = model3.check_model_cache("BEN2")
    print(f"[cache] BEN2: {ok3} {msg3}", flush=True)
    if ok3:
        for label, img in [("run", run_frame), ("idle", idle_frame)]:
            run_ben2(model3, img, "BEN2", label)

    print(f"[done] -> {OUT}", flush=True)


if __name__ == "__main__":
    main()
