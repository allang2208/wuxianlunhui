#!/usr/bin/env python3
"""从参考图提取深度图（Depth-Anything-V2，ComfyUI venv 运行）。

用途：给 flux2-klein-4b-depth ControlNet 提供"固定视角/朝向"的深度模板——
从已定稿同风格道具图提深度，锁住构图/视角，主体由提示词换新。

用法（用 ComfyUI venv 的 python）：
    <venv>/python.exe tools/ai-gen/depth-extract.py <参考图.png> <深度图.png> [--model Small]
"""
import argparse
import sys

import numpy as np
from PIL import Image
import torch
from transformers import AutoImageProcessor, AutoModelForDepthEstimation


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("src")
    ap.add_argument("out")
    ap.add_argument("--model", default="depth-anything/Depth-Anything-V2-Small")
    args = ap.parse_args()

    print("loading model", args.model, flush=True)
    processor = AutoImageProcessor.from_pretrained(args.model)
    model = AutoModelForDepthEstimation.from_pretrained(args.model)
    model.eval()

    im = Image.open(args.src).convert("RGB")
    inputs = processor(images=im, return_tensors="pt")
    with torch.no_grad():
        out = model(**inputs)
    depth = out.predicted_depth[0].float().cpu().numpy()
    # 归一化到 0~255：近=白（DepthAnything 可视化惯例），远=黑
    dmin, dmax = depth.min(), depth.max()
    norm = (depth - dmin) / max(dmax - dmin, 1e-6) * 255.0
    norm = np.uint8(np.clip(norm, 0, 255))
    # 缩放到 1024×1024（ControlNet 输入与生图同尺寸）
    out_img = Image.fromarray(norm, "L").resize((1024, 1024), Image.BILINEAR)
    out_img.save(args.out)
    print("saved", args.out, "size", out_img.size, flush=True)


if __name__ == "__main__":
    main()
