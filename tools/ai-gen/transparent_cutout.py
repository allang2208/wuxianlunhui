#!/usr/bin/env python3
"""纯色底抠图 → 透明 RGBA（方案一：颜色阈值为主 + BiRefNet 边缘精修）。

配合 tools/comfyui-gen.py --transparent 使用：生成阶段已用 AI 选定的纯色底，
这里做 1) 自动检测/指定背景色 2) 颜色距离软掩码 3) 保留最大连通域
4) 可选 BiRefNet 精修边缘 5) 羽化 + 边缘去污染。

用法：
    python transparent_cutout.py --input raw.png --out final.png
    python transparent_cutout.py --input raw.png --out final.png --bg-color #FF00FF --tol 60
    python transparent_cutout.py --input raw.png --out final.png --refine auto|grabcut|birefnet|none

--refine auto：当前 Python 能 import torch 且权重目录存在 → 本进程跑 BiRefNet；
否则自动定位 ComfyUI .venv python 以子进程跑 GrabCut / BiRefNet；
都没有 → 纯阈值模式并提示。
"""

import argparse
import importlib.util
import os
import subprocess
import tempfile

import numpy as np
from PIL import Image
from scipy import ndimage

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
BACKUP_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(TOOLS_DIR)))  # 备份根（ComfyUI 所在）
BIRefNet_MODEL_DIR = os.path.join(
    BACKUP_ROOT, "ComfyUI", "models", "BiRefNet", "MS-BiRefNet")
COMFY_VENV_PY = os.path.join(
    BACKUP_ROOT, "ComfyUI", ".venv", "Scripts", "python.exe")
GRABCUT_ALPHA_PY = os.path.join(TOOLS_DIR, "grabcut-alpha.py")


def hex_to_rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def _hex(rgb):
    return "".join(f"{int(x):02X}" for x in rgb)


def detect_bg_color(image_rgb, margin=12):
    """用边框环中位数估计纯色背景（生成底色应为整幅图占比最大的单一颜色）。"""
    ring = np.concatenate([
        image_rgb[:margin].reshape(-1, 3),
        image_rgb[-margin:].reshape(-1, 3),
        image_rgb[:, :margin].reshape(-1, 3),
        image_rgb[:, -margin:].reshape(-1, 3),
    ])
    return np.median(ring, axis=0).astype(np.uint8).tolist()


def build_alpha(image_rgb, bg, tol=55, soft=45, feather=0.8, keep_largest=True):
    """颜色距离软掩码：dist<=tol 视为背景，tol~tol+soft 线性过渡。"""
    bg = np.asarray(bg, dtype=np.float32)
    img = image_rgb.astype(np.float32)
    dist = np.sqrt(((img - bg) ** 2).sum(axis=2))
    alpha = np.clip((dist - tol) / max(soft, 1.0), 0.0, 1.0)
    if keep_largest:
        mask = alpha > 0.5
        labels, n = ndimage.label(mask)
        if n:
            sizes = ndimage.sum(mask, labels, range(1, n + 1))
            keep = labels == (1 + int(np.argmax(sizes)))
            alpha = np.where(keep, alpha, 0.0)
    if feather > 0:
        alpha = ndimage.gaussian_filter(alpha, sigma=feather)
        alpha = np.clip(alpha, 0.0, 1.0)
    return alpha


def bg_uniformity(image_rgb, bg, tol=55, margin=12):
    """判断背景是否均匀纯色：边框色散小 + 底色占图比例高 → 均匀（阈值可靠）。

    返回 (uniform, info)。非均匀（模型没按纯色底渲染，渐变/发光底）时
    阈值会误切，应切换 BiRefNet 主导。
    """
    ring = np.concatenate([
        image_rgb[:margin].reshape(-1, 3),
        image_rgb[-margin:].reshape(-1, 3),
        image_rgb[:, :margin].reshape(-1, 3),
        image_rgb[:, -margin:].reshape(-1, 3),
    ]).astype(np.float32)
    max_std = float(ring.std(axis=0).max())
    d = np.sqrt(((image_rgb.astype(np.float32) - np.asarray(bg, dtype=np.float32)) ** 2).sum(axis=2))
    cover = float((d <= tol).sum()) / d.size
    uniform = max_std < 30.0 and cover > 0.5
    return uniform, {"std": round(max_std, 1), "cover": round(cover * 100, 1)}


def decontaminate(image_rgb, alpha, bg):
    """边缘去污染：按 alpha 反推前景色，去掉底色泛色/白边。"""
    bg = np.asarray(bg, dtype=np.float32)
    img = image_rgb.astype(np.float32)
    a = alpha[..., None]
    fg = (img - (1.0 - a) * bg) / np.maximum(a, 1e-3)
    return np.clip(fg, 0, 255).astype(np.uint8)


def _birefnet_in_proc(image_rgb):
    spec = importlib.util.spec_from_file_location(
        "birefnet_cutout", os.path.join(TOOLS_DIR, "birefnet-cutout.py"))
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    model = mod.load_model()
    alpha_pil = mod.predict_alpha(model, Image.fromarray(image_rgb))
    return np.asarray(alpha_pil.convert("L")) / 255.0


def _birefnet_subprocess(image_rgb):
    tmp = tempfile.mkdtemp(prefix="refine_")
    src = os.path.join(tmp, "input.png")
    dst = os.path.join(tmp, "alpha.png")
    Image.fromarray(image_rgb).save(src)
    try:
        subprocess.run(
            [COMFY_VENV_PY, os.path.join(TOOLS_DIR, "birefnet-cutout.py"),
             "--predict-alpha", src, dst],
            check=True, capture_output=True, timeout=300)
    except subprocess.TimeoutExpired:
        raise RuntimeError("BiRefNet 子进程超时（300s）") from None
    return np.asarray(Image.open(dst).convert("L")) / 255.0


def _grabcut_subprocess(image_rgb):
    """GrabCut 对非均匀渐变底最稳：边框必为背景 + 中心必为主体（GMM 颜色建模）。"""
    tmp = tempfile.mkdtemp(prefix="grabcut_")
    src = os.path.join(tmp, "input.png")
    dst = os.path.join(tmp, "alpha.npy")
    Image.fromarray(image_rgb).save(src)
    try:
        subprocess.run(
            [COMFY_VENV_PY, GRABCUT_ALPHA_PY, "--input", src, "--out", dst],
            check=True, capture_output=True, timeout=300)
    except subprocess.TimeoutExpired:
        raise RuntimeError("GrabCut 子进程超时（300s）") from None
    return np.load(dst)


def refine_edges(image_rgb, alpha, method="auto", bg_uniform=True):
    """非均匀底兜底精修。

    均匀纯色底：阈值主导，过渡带采纳 BiRefNet alpha，阈值漏切区补回。
    非均匀底（模型没按纯色底渲染，渐变/发光）：GrabCut 主导（边框+中心种子建模），
    GrabCut 失败再回退 BiRefNet。auto 模式：背景均匀时阈值已足够干净，跳过 AI。
    """
    if method == "none":
        return alpha, "纯阈值"
    if method == "auto" and bg_uniform:
        return alpha, "阈值主导（背景均匀，跳过 AI）"
    if method in ("auto", "grabcut"):
        try:
            return _grabcut_subprocess(image_rgb), \
                "GrabCut 主导（背景非均匀，边框+中心 GMM 建模）"
        except Exception as exc:
            if method == "grabcut":
                raise
            print(f"[cutout] GrabCut 不可用，回退 BiRefNet（{exc}）", flush=True)
    note = None
    try:
        try:
            b = _birefnet_in_proc(image_rgb)
            note = "BiRefNet(本进程)"
        except Exception:
            if method == "birefnet":
                raise
            b = _birefnet_subprocess(image_rgb)
            note = "BiRefNet(venv 子进程)"
    except Exception as exc:
        if method == "birefnet":
            raise
        warn = "" if bg_uniform else "；警告：背景非均匀，纯阈值可能残留背景"
        return alpha, f"BiRefNet 不可用，纯阈值模式（{exc}）{warn}"

    if bg_uniform:
        refined = alpha.copy()
        band = (alpha > 0.15) & (alpha < 0.85)
        refined[band] = b[band]
        missed = (b > 0.6) & (alpha < 0.35)  # 底色不纯/发光/投影时阈值漏切的主体区
        refined[missed] = np.maximum(refined[missed], b[missed])
        mode_note = "阈值主导+BiRefNet 精修"
    else:
        refined = b.copy()
        agree_subject = (alpha > 0.8) & (b > 0.5)
        agree_bg = (alpha < 0.2) & (b < 0.5)
        refined[agree_subject] = alpha[agree_subject]
        refined[agree_bg] = alpha[agree_bg]
        mode_note = "BiRefNet 主导（背景非均匀）"
    return refined, f"{mode_note} via {note}"


def _stats(image_rgb, alpha):
    n, m = alpha.shape
    opaque = float((alpha > 0.8).sum()) / (n * m)
    ys, xs = np.where(alpha > 0.05)
    if len(xs) == 0:
        return {"opaque": round(opaque * 100, 1), "bbox": None}
    return {
        "opaque": round(opaque * 100, 1),
        "bbox": {"w": int(xs.max() - xs.min()),
                 "h": int(ys.max() - ys.min()),
                 "cx": int(round((xs.min() + xs.max()) / 2 - n / 2)),
                 "cy": int(round((ys.min() + ys.max()) / 2 - m / 2))},
    }


def cutout_file(src_path, dst_path, bg_hex=None, tol=55, refine="auto"):
    """整条抠图链：读图 → 定底色 → 阈值掩码 → 精修 → 去污染 → 存 RGBA。

    返回 (stats, note)。底色优先用参数指定值；未指定则从边框自动检测。
    若检测色与指定色相差过大，以检测色为准（模型可能没完全按 hex 渲染）。
    """
    img = Image.open(src_path).convert("RGB")
    rgb = np.asarray(img)
    detected = detect_bg_color(rgb)

    bg = detected  # 以图里实际渲染的背景色为阈值基准（提示词 hex 只是期望，模型可能跑偏）
    if bg_hex:
        explicit = hex_to_rgb(bg_hex)
        d = sum((x - y) ** 2 for x, y in zip(explicit, detected)) ** 0.5
        if d > 90:
            print(f"[cutout] 检测底色 #{_hex(detected)} 与指定 #{bg_hex.lstrip('#')} "
                  "差异大（模型没按 hex 渲染），按实际检测色抠图", flush=True)

    alpha = build_alpha(rgb, bg, tol=tol)
    uniform, uinfo = bg_uniformity(rgb, bg, tol=tol)
    if not uniform:
        print(f"[cutout] 警告：背景非均匀（边框色散 std={uinfo['std']}, "
              f"底色占比 {uinfo['cover']}%），模型可能没按纯色底渲染；自动切 BiRefNet 主导", flush=True)
    alpha, note = refine_edges(rgb, alpha, method=refine, bg_uniform=uniform)
    fg = decontaminate(rgb, alpha, bg)
    out = np.dstack([fg, (alpha * 255).astype(np.uint8)]).astype(np.uint8)
    os.makedirs(os.path.dirname(os.path.abspath(dst_path)), exist_ok=True)
    Image.fromarray(out, "RGBA").save(dst_path)
    return _stats(rgb, alpha), f"底色 #{_hex(bg)}; {note}"


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--input", required=True, help="生成原图（纯色底 PNG）")
    ap.add_argument("--out", required=True, help="输出透明 RGBA PNG")
    ap.add_argument("--bg-color", default=None, help="期望底色 #RRGGBB（缺省自动检测）")
    ap.add_argument("--tol", type=int, default=55, help="颜色距离阈值（默认 55）")
    ap.add_argument("--refine", default="auto", choices=["auto", "grabcut", "birefnet", "none"],
                    help="非均匀底兜底模式（默认 auto：均匀→阈值，非均匀→GrabCut→BiRefNet）")
    args = ap.parse_args()

    stats, note = cutout_file(args.input, args.out, bg_hex=args.bg_color,
                              tol=args.tol, refine=args.refine)
    print(f"saved {args.out}: opaque%={stats['opaque']} bbox={stats['bbox']}")
    print(f"note: {note}")


if __name__ == "__main__":
    main()
