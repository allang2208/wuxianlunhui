#!/usr/bin/env python3
"""抠图统一入口：强制使用 ComfyUI-RMBG 插件（BiRefNet-general）。

2026-08-08 工作流定稿：所有精灵图/掩膜抠图一律走本模块（rebuild-h3-birefnet、
single-idle-prep、后续新增工具），不再用 transformers 直载 MS-BiRefNet。
模型：ComfyUI/models/RMBG/BiRefNet（birefnet.py + BiRefNet-general.safetensors，
离线缓存，check_model_cache 验证通过才加载）。必须用 ComfyUI venv python 运行。

用法：
    from rmbg_cutout import get_model, predict_alpha
    model = get_model()
    alpha = predict_alpha(model, pil_rgb)   # 0-255 uint8，与原图同尺寸
"""

import os
import sys
from pathlib import Path

import numpy as np
import torch

PROJECT_ROOT = Path(__file__).resolve().parents[6]
COMFY_ROOT = os.environ.get("COMFYUI_ROOT", str(PROJECT_ROOT.parent / "ComfyUI"))
for p in (COMFY_ROOT, os.path.join(COMFY_ROOT, "custom_nodes", "ComfyUI-RMBG", "py")):
    if p not in sys.path:
        sys.path.insert(0, p)

import folder_paths  # noqa: E402
import AILab_BiRefNet as rmbg  # noqa: E402

MODEL_NAME = "BiRefNet-general"
PROCESS_RES = 1024

_model = None


class BiRefNetModel:
    """ComfyUI-RMBG BiRefNet-general 封装（单例）。"""

    def __init__(self):
        self.node = rmbg.BiRefNetModel()
        ok, msg = self.node.check_model_cache(MODEL_NAME)
        if not ok:
            raise RuntimeError(f"RMBG model cache: {msg}")
        self.node.load_model(MODEL_NAME)
        self.device = rmbg.device
        print(f"[rmbg] BiRefNet-general on {self.device}", flush=True)

    def predict_alpha(self, pil_rgb):
        """返回与输入同尺寸的 0-255 uint8 alpha。"""
        arr = np.array(pil_rgb).astype(np.float32) / 255.0
        tensor = torch.from_numpy(arr).unsqueeze(0)  # BHWC，ComfyUI 约定
        mask = self.node.process_image(tensor, {"process_res": PROCESS_RES})
        return np.array(mask)


def get_model():
    global _model
    if _model is None:
        _model = BiRefNetModel()
    return _model


def predict_alpha(model, pil_rgb):
    return model.predict_alpha(pil_rgb)


if __name__ == "__main__":
    import argparse
    from PIL import Image

    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True)
    ap.add_argument("--out", required=True)
    args = ap.parse_args()
    m = get_model()
    alpha = predict_alpha(m, Image.open(args.src).convert("RGB"))
    Image.fromarray(alpha, "L").save(args.out)
    print(f"alpha saved {args.out} {alpha.shape}")
