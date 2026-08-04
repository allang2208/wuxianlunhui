#!/usr/bin/env python3
"""BiRefNet background removal via local ModelScope weights (transformers format).

Loads ComfyUI/models/BiRefNet/MS-BiRefNet (official birefnet remote code),
removes background from input images and writes transparent RGBA PNGs.
"""

import argparse
import os
import sys

import cv2
import numpy as np
import torch
from PIL import Image
from torchvision import transforms
from transformers import AutoModelForImageSegmentation

MODEL_DIR = r"E:\无尽轮回\长期备份\2026-7-13-1\ComfyUI\models\BiRefNet\MS-BiRefNet"
device = "cuda" if torch.cuda.is_available() else "cpu"
HALF = True


def load_model():
    model = AutoModelForImageSegmentation.from_pretrained(
        MODEL_DIR, trust_remote_code=True
    )
    model.to(device)
    model.eval()
    if HALF and torch.cuda.is_available():
        model.half()
    return model


_prep = transforms.Compose([
    transforms.Resize((1024, 1024)),
    transforms.ToTensor(),
    transforms.Normalize([0.485, 0.456, 0.406], [0.229, 0.224, 0.225]),
])


def refine_foreground(image, mask, r=90):
    if mask.size != image.size:
        mask = mask.resize(image.size)
    im = np.array(image) / 255.0
    m = np.array(mask) / 255.0
    m = m[:, :, None]
    blurred_alpha = cv2.blur(m, (r, r))[:, :, None]
    blurred_FA = cv2.blur(im * m, (r, r))
    blurred_F = blurred_FA / (blurred_alpha + 1e-5)
    blurred_B1A = cv2.blur(im * (1 - m), (r, r))
    blurred_B = blurred_B1A / ((1 - blurred_alpha) + 1e-5)
    F = blurred_F + m * (im - m * blurred_F - (1 - m) * blurred_B)
    F = np.clip(F, 0, 1)
    return Image.fromarray((F * 255.0).astype(np.uint8))


def predict_alpha(model, image):
    """Return PIL 'L' alpha mask (0-255), sized like the input RGB image.

    Used by tools/transparent_cutout.py for edge refinement after a solid-color
    threshold cutout (方案一：纯色底出图 → 阈值抠图 → BiRefNet 精修).
    """
    w, h = image.size
    inp = _prep(image).unsqueeze(0).to(device)
    if HALF and torch.cuda.is_available():
        inp = inp.half()
    with torch.no_grad():
        preds = model(inp)[-1].sigmoid().cpu()
    pred = preds[0].squeeze()
    return transforms.ToPILImage()(pred).resize((w, h), Image.BILINEAR)


def cutout(model, src_path, dst_path):
    image_ori = Image.open(src_path).convert("RGB")
    w, h = image_ori.size
    inp = _prep(image_ori).unsqueeze(0).to(device)
    if HALF and torch.cuda.is_available():
        inp = inp.half()
    with torch.no_grad():
        preds = model(inp)[-1].sigmoid().cpu()
    pred = preds[0].squeeze()
    pred_pil = transforms.ToPILImage()(pred).resize((w, h), Image.BILINEAR)
    fg = refine_foreground(image_ori, pred_pil)
    out = fg.convert("RGBA")
    out.putalpha(pred_pil)
    out.save(dst_path)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--input", help="input image or folder")
    ap.add_argument("--out", default=None, help="output PNG path or folder")
    ap.add_argument("--suffix", default="_cutout", help="suffix when folder mode")
    ap.add_argument("--predict-alpha", nargs=2, metavar=("INPUT", "OUTPUT"),
                    help=argparse.SUPPRESS)
    args = ap.parse_args()

    if args.predict_alpha:
        src_p, dst_p = args.predict_alpha
        model = load_model()
        alpha = predict_alpha(model, Image.open(src_p).convert("RGB"))
        alpha.save(dst_p)
        print("alpha saved", dst_p, flush=True)
        return

    if not args.input:
        ap.error("--input is required unless --predict-alpha is used")

    src = args.input
    if os.path.isdir(src):
        files = [f for f in sorted(os.listdir(src)) if f.lower().endswith(".png")]
        out_dir = args.out or os.path.join(src, "cutout")
        os.makedirs(out_dir, exist_ok=True)
    else:
        files = [os.path.basename(src)]
        out_dir = args.out or os.path.dirname(src) or "."

    model = load_model()
    print(f"model loaded ({device})", flush=True)
    for f in files:
        sp = os.path.join(src, f) if os.path.isdir(src) else src
        base, ext = os.path.splitext(f)
        dp = args.out if (args.out and not os.path.isdir(args.out)) else os.path.join(
            out_dir, f"{base}{args.suffix}{ext}")
        cutout(model, sp, dp)
        print("saved", dp, flush=True)


if __name__ == "__main__":
    main()
