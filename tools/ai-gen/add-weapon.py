#!/usr/bin/env python3
"""add-weapon.py - 全自动添加武器管线（wuxianlunhui / 无尽轮回）

标准工作流依据 game-dev/SKILL.md「武器添加标准工作流（2026-07-28 定稿）」与
game-dev/tools/ai-gen/WORKFLOW.md「生图标准工作流」。

子命令：
  scaffold        --spec <weapon-spec.json>
                  自动完成：equipment.json(双份)/craft-config.json(双份)/
                  weapon-anim-config.json 数据写入 + 深度剪影模板 +
                  出图/视频提示词 + 开火/换弹/装备音效合成 + 完整性校验。
                  注：JS 源码（EDM/商店/弹药/动画/改造槽位/纹理注册等）由本脚本
                  输出精确锚点补丁清单，配合 apply_patch 落盘。
  gen-image       --spec <spec> --host <host> --model <model> [--seeds 1,2,3]
                  用 comfyui-gen.py 批量出候选图（默认落 tools/ai-gen/_weapon_candidates/）。
  process-image   --spec <spec> --raw <png>
                  白底抠图 + 按 spec.layout 步枪布局归一（2048²/内容宽0.915/
                  中心(0.5,0.543)）→ 写入 assets/weapons/<key>-equip.png 并复制图标。
  gen-video       --spec <spec> [--host 192.168.3.142] [--duration 2]
                  用 minimax-h3-gen.py（MiniMax H3，远程 5080）生成展示视频。
  verify          --spec <spec>
                  JSON 双份一致性 + 引用资产存在性 + node --check 改动 JS。
"""

import argparse
import io
import json
import os
import random
import shutil
import subprocess
import sys
import time
import urllib.request

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageOps

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_ROOT = os.path.dirname(os.path.dirname(TOOLS_DIR))
CAND_DIR = os.path.join(TOOLS_DIR, "_weapon_candidates")
PROMPT_DIR = os.path.join(TOOLS_DIR, "_weapon_prompts")
DEPTH_DIR = os.path.join(TOOLS_DIR, "_depth_templates")

JSON_WRITES = [
    ("data/equipment.json", "data/equipment.json"),
    ("public/data/equipment.json", "data/equipment.json"),
    ("data/craft-config.json", "data/craft-config.json"),
    ("public/data/craft-config.json", "data/craft-config.json"),
    ("public/data/weapon-anim-config.json", None),
]


def log(msg):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass
    print(msg, flush=True)


def repo_path(*parts):
    return os.path.join(REPO_ROOT, *parts)


def read_json(rel):
    with open(repo_path(rel), "r", encoding="utf-8-sig") as fh:
        return json.load(fh)


def detect_newline(rel):
    with open(repo_path(rel), "rb") as fh:
        raw = fh.read(8192)
    return "\r\n" if b"\r\n" in raw else "\n"


def detect_style(rel):
    with open(repo_path(rel), "rb") as fh:
        raw = fh.read(16384)
    nl = "\r\n" if b"\r\n" in raw else "\n"
    indent = 2
    for line in raw.decode("utf-8", "ignore").split(nl):
        if line.strip() and line.startswith((" ", "\t")):
            indent = len(line) - len(line.lstrip(" "))
            break
    bom = raw.startswith(b"\xef\xbb\xbf")
    return nl, indent, bom


def write_json(rel, obj, force_nl=None):
    nl, indent, bom = detect_style(rel)
    if force_nl:
        nl = force_nl
    s = json.dumps(obj, ensure_ascii=False, indent=indent).replace("\n", nl) + nl
    if bom:
        s = "\ufeff" + s
    path = repo_path(rel)
    if os.path.exists(path):
        shutil.copy2(path, path + ".bak")
    with open(path, "w", encoding="utf-8", newline="") as fh:
        fh.write(s)
    log(f"wrote {rel} ({os.path.getsize(path)} bytes, bak saved)")


def insert_after(mapping, anchor, key, value):
    out = {}
    inserted = False
    for k, v in mapping.items():
        out[k] = v
        if k == anchor:
            out[key] = value
            inserted = True
    if not inserted:
        out[key] = value
        log(f"WARN: anchor '{anchor}' not found, appended at end", )
    return out


# ---------------------------------------------------------------------------
# 1. 数据写入（equipment / craft-config / weapon-anim-config）
# ---------------------------------------------------------------------------

def build_equipment_entry(spec):
    a = spec["assets"]
    return {
        "weaponId": spec["weaponId"],
        "name": spec["name"],
        "type": spec["type"],
        "icon": spec["icon"],
        "iconImage": a["iconImage"],
        "slotImage": a["slotImage"],
        "equipImage": a["equipImage"],
        "category": spec["category"],
        "rarity": spec["rarity"],
        "level": spec["level"],
        "weaponCategory": spec["weaponCategory"],
        "weaponType": spec["weaponType"],
        "weaponTypeTag": spec["weaponTypeTag"],
        "isTwoHanded": spec["isTwoHanded"],
        "weaponAsset": {
            "image": a["weaponAssetImage"],
            "muzzleImage": "assets/effects/muzzle_flash_01.png",
        },
        "stats": spec["statsJson"],
        "desc": spec["desc"],
        "equipSlot": spec["equipSlot"],
        "attack": spec["attack"],
        "animation": spec["animation"],
    }


def build_shop_entry(spec):
    a = spec["assets"]
    return {
        "id": spec["key"],
        "weaponId": spec["weaponId"],
        "name": spec["name"],
        "icon": spec["icon"],
        "iconImage": a["iconImage"],
        "category": spec["category"],
        "rarity": spec["rarity"],
        "type": spec["type"],
        "price": spec["price"],
        "equipSlot": spec["equipSlot"],
        "weaponType": spec["weaponType"],
        "weaponCategory": spec["weaponCategory"],
        "weaponTypeTag": spec["weaponTypeTag"],
        "isTwoHanded": spec["isTwoHanded"],
        "dropImage": a["dropImage"],
        "equipImage": a["equipImage"],
        "slotImage": a["slotImage"],
        "stats": spec["statsDisplay"],
        "desc": spec["desc"],
        "level": spec["level"],
        "attack": spec["attack"],
        "animation": spec["animation"],
        "weaponAsset": {
            "image": a["weaponAssetImage"],
            "muzzleImage": "assets/effects/muzzle_flash_01.png",
        },
    }


def scaffold_data(spec):
    # equipment.json（双份）
    entry = build_equipment_entry(spec)
    for rel, src in JSON_WRITES[:2]:
        data = read_json(src)
        data["equipment"] = insert_after(data["equipment"], "akm", spec["key"], entry)
        write_json(rel, data)

    # craft-config.json（双份，克隆模板武器槽位）
    tpl = spec["craftTemplateWeaponId"]
    for rel, src in JSON_WRITES[2:4]:
        cfg = read_json(src)
        if tpl not in cfg:
            log(f"WARN: craft template '{tpl}' missing in {rel}; skip craft entry")
            continue
        cfg = insert_after(cfg, tpl, spec["weaponId"], cfg[tpl])
        write_json(rel, cfg)

    # weapon-anim-config.json（仅 public 单份；克隆同族基准武器）
    rel = "public/data/weapon-anim-config.json"
    anim = read_json(rel)
    tpl_type = spec["animTemplateWeaponType"]
    if tpl_type not in anim:
        log(f"WARN: anim template '{tpl_type}' missing in {rel}; skip anim entry")
    else:
        anim = insert_after(anim, tpl_type, spec["weaponType"], anim[tpl_type])
        write_json(rel, anim)


# ---------------------------------------------------------------------------
# 2. 深度剪影模板（徽章灰 130 + 武器白 255，黑底 1024²）
# ---------------------------------------------------------------------------

def _m416_polygons(cx, cy, s):
    """M416 侧视（朝右）剪影多边形（相对中心 cx,cy，比例因子 s）。"""
    return [
        # 枪管 + 消焰器
        [(cx + 150 * s, cy - 24 * s), (cx + 420 * s, cy - 24 * s),
         (cx + 420 * s, cy - 8 * s), (cx + 150 * s, cy - 8 * s)],
        [(cx + 418 * s, cy - 28 * s), (cx + 448 * s, cy - 28 * s),
         (cx + 448 * s, cy - 4 * s), (cx + 418 * s, cy - 4 * s)],
        # 准星座
        [(cx + 320 * s, cy - 40 * s), (cx + 338 * s, cy - 40 * s),
         (cx + 330 * s, cy - 24 * s), (cx + 312 * s, cy - 24 * s)],
        # 护木（M4 圆筒护木）
        [(cx + 46 * s, cy - 40 * s), (cx + 200 * s, cy - 40 * s),
         (cx + 200 * s, cy + 10 * s), (cx + 46 * s, cy + 10 * s)],
        # 上机匣
        [(cx - 182 * s, cy - 46 * s), (cx + 52 * s, cy - 46 * s),
         (cx + 52 * s, cy - 6 * s), (cx - 182 * s, cy - 6 * s)],
        # 顶部导轨（平顶 + 后照门 + 拉机柄）
        [(cx - 172 * s, cy - 58 * s), (cx + 22 * s, cy - 58 * s),
         (cx + 22 * s, cy - 46 * s), (cx - 172 * s, cy - 46 * s)],
        [(cx - 168 * s, cy - 70 * s), (cx - 146 * s, cy - 70 * s),
         (cx - 146 * s, cy - 58 * s), (cx - 168 * s, cy - 58 * s)],
        [(cx + 16 * s, cy - 68 * s), (cx + 34 * s, cy - 68 * s),
         (cx + 34 * s, cy - 56 * s), (cx + 16 * s, cy - 56 * s)],
        # 下机匣 + 扳机护圈
        [(cx - 150 * s, cy - 6 * s), (cx + 44 * s, cy - 6 * s),
         (cx + 44 * s, cy + 22 * s), (cx - 150 * s, cy + 22 * s)],
        [(cx - 96 * s, cy + 10 * s), (cx - 52 * s, cy + 10 * s),
         (cx - 58 * s, cy + 30 * s), (cx - 90 * s, cy + 30 * s)],
        # 握把
        [(cx - 104 * s, cy + 22 * s), (cx - 70 * s, cy + 22 * s),
         (cx - 92 * s, cy + 98 * s), (cx - 136 * s, cy + 98 * s)],
        # 弯弹匣（STANAG 30 发）
        [(cx + 8 * s, cy + 22 * s), (cx + 48 * s, cy + 22 * s),
         (cx + 62 * s, cy + 86 * s), (cx + 36 * s, cy + 132 * s),
         (cx + 2 * s, cy + 122 * s), (cx - 10 * s, cy + 62 * s)],
        # 缓冲管 + 可伸缩托
        [(cx - 320 * s, cy - 14 * s), (cx - 182 * s, cy - 14 * s),
         (cx - 182 * s, cy - 4 * s), (cx - 320 * s, cy - 4 * s)],
        [(cx - 334 * s, cy - 40 * s), (cx - 188 * s, cy - 40 * s),
         (cx - 188 * s, cy + 6 * s), (cx - 334 * s, cy + 6 * s)],
        [(cx - 346 * s, cy - 32 * s), (cx - 334 * s, cy - 32 * s),
         (cx - 334 * s, cy + 6 * s), (cx - 346 * s, cy + 6 * s)],
    ]


def build_depth_template(spec, out_rel):
    size = 1024
    canvas = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(canvas)
    # 徽章剪影：圆角菱形（大徽章），灰 130
    cx, cy = size // 2, int(size * 0.53)
    half = 480
    r = 72
    pts = [
        (cx, cy - half), (cx + r, cy - half + r),
        (cx + half - r, cy - r), (cx + half, cy),
        (cx + half - r, cy + r), (cx + r, cy + half - r),
        (cx, cy + half), (cx - r, cy + half - r),
        (cx - half + r, cy + r), (cx - half, cy),
        (cx - half + r, cy - r), (cx - r, cy - half + r),
    ]
    d.polygon(pts, fill=130)
    # M416 剪影：白 255（徽章内部）
    s = 0.92
    for poly in _m416_polygons(cx, cy, s):
        d.polygon(poly, fill=255)
    canvas = canvas.filter(ImageFilter.GaussianBlur(0.8))
    arr = np.asarray(canvas)
    arr = np.where(arr >= 252, 255, np.where(arr >= 120, 130, 0)).astype(np.uint8)
    Image.fromarray(arr).save(repo_path(out_rel))
    log(f"depth template -> {out_rel}")


# ---------------------------------------------------------------------------
# 3. 提示词
# ---------------------------------------------------------------------------

def scaffold_prompts(spec):
    os.makedirs(repo_path(PROMPT_DIR), exist_ok=True)
    key = spec["key"]
    icon = repo_path(PROMPT_DIR, f"{key}_icon.txt")
    video = repo_path(PROMPT_DIR, f"{key}_video.txt")
    with open(icon, "w", encoding="utf-8", newline="") as fh:
        fh.write("\n".join(spec["imagePrompts"]["icon"]) + "\n")
    with open(video, "w", encoding="utf-8", newline="") as fh:
        fh.write("\n".join(spec["imagePrompts"]["video"]) + "\n")
    log(f"prompts -> {icon}, {video}")


# ---------------------------------------------------------------------------
# 4. 音效合成（开火 / 换弹 / 装备）
# ---------------------------------------------------------------------------

SR = 44100


def _noise(n, seed=0):
    rng = np.random.default_rng(seed)
    return rng.standard_normal(n)


def _bandpass(x, lo, hi, sr=SR):
    spec = np.fft.rfft(x)
    freqs = np.fft.rfftfreq(len(x), 1 / sr)
    mask = (freqs >= lo) & (freqs <= hi)
    spec *= mask
    return np.fft.irfft(spec, len(x))


def _env_exp(n, tau):
    t = np.arange(n) / SR
    return np.exp(-t / tau)


def _click(amp, dur, lo, hi, seed):
    n = int(dur * SR)
    x = _bandpass(_noise(n, seed), lo, hi) * _env_exp(n, dur / 3)
    return x * amp / (np.abs(x).max() + 1e-9)


def synth_fire(seed=100):
    n = int(0.26 * SR)
    t = np.arange(n) / SR
    out = np.zeros(n)
    # 主爆音：宽带噪声快速衰减
    crack = _bandpass(_noise(n, seed), 300, 4200) * _env_exp(n, 0.045)
    out += crack * 0.85
    # 低频轰
    thump = np.sin(2 * np.pi * 92 * t) * _env_exp(n, 0.09)
    out += thump * 0.5
    # 中高频裂音
    snap = _bandpass(_noise(n, seed + 1), 1500, 7000) * _env_exp(n, 0.018)
    out += snap * 0.9
    # 机械回膛
    i0 = int(0.16 * SR)
    mech = np.zeros(n)
    mech[i0:] += _bandpass(_noise(n - i0, seed + 2), 700, 2600) * _env_exp(n - i0, 0.02)
    out += mech * 0.35
    # 混响尾
    tail = _bandpass(_noise(n, seed + 3), 200, 1800) * _env_exp(n, 0.11)
    out += tail * 0.18
    out *= 0.9 / (np.abs(out).max() + 1e-9)
    return np.stack([out, np.roll(out, 3)], axis=1)


def synth_reload(seed=200):
    n = int(1.15 * SR)
    out = np.zeros(n)
    # 弹匣释放卡扣
    c0 = _click(0.9, 0.05, 700, 3200, seed)
    out[:len(c0)] += c0
    # 旧弹匣抽出（下滑摩擦）
    i0 = int(0.16 * SR)
    seg = _bandpass(_noise(int(0.28 * SR), seed + 1), 500, 2200)
    fade = np.linspace(1, 0.15, len(seg))
    out[i0:i0 + len(seg)] += seg * fade * 0.32
    # 新弹匣装入两下咔哒
    for i, s in [(0.52, seed + 2), (0.66, seed + 3)]:
        j = int(i * SR)
        c = _click(0.85, 0.05, 900, 3400, s)
        out[j:j + len(c)] += c
    # 枪机释放：响亮金属拍 + 弹簧尾
    j = int(0.82 * SR)
    c = _click(1.0, 0.07, 300, 2800, seed + 4)
    out[j:j + len(c)] += c
    j2 = int(0.88 * SR)
    tail = _bandpass(_noise(n - j2, seed + 5), 800, 4000) * _env_exp(n - j2, 0.05)
    out[j2:] += tail * 0.4
    out *= 0.9 / (np.abs(out).max() + 1e-9)
    return np.stack([out, np.roll(out, 2)], axis=1)


def synth_equip(seed=300):
    n = int(0.52 * SR)
    out = np.zeros(n)
    # 拔枪风噪
    whoosh = _bandpass(_noise(n, seed), 350, 2600)
    env = np.sin(np.linspace(0, np.pi, n)) ** 1.7
    out += whoosh * env * 0.55
    # 末端到位卡扣
    j = int(0.38 * SR)
    c = _click(0.8, 0.045, 900, 3200, seed + 1)
    out[j:j + len(c)] += c
    out *= 0.9 / (np.abs(out).max() + 1e-9)
    return np.stack([out, np.roll(out, 4)], axis=1)


def write_wav(path, stereo):
    pcm = np.clip(stereo, -1, 1)
    pcm = (pcm * 32767).astype("<i2")
    with open(path, "wb") as fh:
        import wave
        with wave.open(fh, "wb") as w:
            w.setnchannels(2)
            w.setsampwidth(2)
            w.setframerate(SR)
            w.writeframes(pcm.tobytes())


def scaffold_sounds(spec):
    snd_dir = repo_path("assets", "sounds", "weapons")
    os.makedirs(snd_dir, exist_ok=True)
    for name, fn in [("fire", synth_fire), ("reload", synth_reload), ("equip", synth_equip)]:
        rel = spec["sounds"][name].removeprefix("assets/")
        path = repo_path("assets", rel)
        write_wav(path, fn())
        log(f"sound -> {os.path.relpath(path, REPO_ROOT)}")


# ---------------------------------------------------------------------------
# 5. 图片生成 / 处理
# ---------------------------------------------------------------------------

def gen_image(spec, host, model, seeds, timeout):
    key = spec["key"]
    out_dir = os.path.join(CAND_DIR, key)
    os.makedirs(out_dir, exist_ok=True)
    prompt_file = repo_path(PROMPT_DIR, f"{key}_icon.txt")
    base = [sys.executable, os.path.join(TOOLS_DIR, "comfyui-gen.py"),
            "--host", host, "--model", model, "--prompt-file", prompt_file,
            "--timeout", str(timeout)]
    for seed in seeds:
        out = os.path.join(out_dir, f"{key}_icon_seed{seed}.png")
        if os.path.exists(out) and os.path.getsize(out) > 10000:
            log(f"skip existing {out}")
            continue
        cmd = base + ["--seed", str(seed), "--out", out]
        log("RUN " + " ".join(cmd))
        r = subprocess.run(cmd, cwd=REPO_ROOT)
        if r.returncode != 0:
            log(f"gen failed seed={seed} rc={r.returncode}")
        elif os.path.exists(out):
            log(f"candidate -> {out}")


def _alpha_bbox(alpha, thresh=8):
    ys, xs = np.where(alpha > thresh)
    if len(xs) == 0:
        return None
    return int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())


def _components(alpha, thresh=60):
    mask = (alpha > thresh).astype(np.uint8)
    ys, xs = np.where(mask)
    if len(xs) == 0:
        return 0
    comp = 0
    seen = np.zeros_like(mask)
    for y, x in zip(ys.tolist(), xs.tolist()):
        if seen[y, x]:
            continue
        comp += 1
        stack = [(y, x)]
        seen[y, x] = 1
        while stack:
            cy, cx = stack.pop()
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    ny, nx = cy + dy, cx + dx
                    if 0 <= ny < mask.shape[0] and 0 <= nx < mask.shape[1] \
                            and mask[ny, nx] and not seen[ny, nx]:
                        seen[ny, nx] = 1
                        stack.append((ny, nx))
    return comp


def orient_right(arr, strip=0.05):
    """枪口朝右判定：右端应为细枪管、左端应为粗枪托。
    返回 (faces_right, need_flip)。"""
    rgb = arr[:, :, :3].astype(np.int16)
    a = arr[:, :, 3].astype(np.int16)
    nonwhite = (np.abs(rgb - 255).max(axis=2) > 18) & (a > 8)
    h, w = nonwhite.shape

    def strip_h(x0, x1):
        ys, xs = np.where(nonwhite[:, x0:x1])
        if len(ys) == 0:
            return 0
        return int(ys.max() - ys.min() + 1)

    left_h = strip_h(0, int(w * strip))
    right_h = strip_h(int(w * (1 - strip)), w)
    faces_right = left_h > right_h
    return faces_right, not faces_right


def _api(host, port, path, method="GET", payload=None):
    url = f"http://{host}:{port}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=60) as resp:
        return json.loads(resp.read().decode("utf-8"))


def _upload(host, port, path):
    filename = os.path.basename(path)
    boundary = "----RMBG" + str(random.randint(0, 2 ** 31 - 1))
    with open(path, "rb") as fh:
        data = fh.read()
    head = (f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="image"; filename="{filename}"\r\n'
            f"Content-Type: image/png\r\n\r\n").encode("utf-8")
    tail = f"\r\n--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        f"http://{host}:{port}/upload/image", data=head + data + tail, method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=120) as resp:
        j = json.loads(resp.read().decode("utf-8"))
    return j.get("name") or filename


def _rmbg_cutout(raw, host, port, model, timeout=900):
    """用 ComfyUI-RMBG 插件（BiRefNetRMBG 节点）抠图，返回透明 RGBA PNG 路径。"""
    name = _upload(host, port, raw)
    wf = {
        "1": {"class_type": "LoadImage", "inputs": {"image": name}},
        "2": {"class_type": "BiRefNetRMBG", "inputs": {
            "image": ["1", 0], "model": model,
            "sensitivity": 1.0, "mask_blur": 0, "mask_offset": 0,
            "invert_output": False, "refine_foreground": True,
            "background": "Alpha", "background_color": "#222222"}},
        "3": {"class_type": "MaskToImage", "inputs": {"mask": ["2", 1]}},
        "4": {"class_type": "SaveImage", "inputs": {"filename_prefix": "rmbg_mask", "images": ["3", 0]}},
        "5": {"class_type": "SaveImage", "inputs": {"filename_prefix": "rmbg_rgb", "images": ["2", 0]}},
    }
    q = _api(host, port, "/prompt", "POST", {"prompt": wf})
    if q.get("node_errors") or q.get("error"):
        raise RuntimeError("RMBG workflow rejected: " + json.dumps(q, ensure_ascii=False)[:500])
    pid = q["prompt_id"]
    deadline = time.time() + timeout
    out4 = out5 = None
    while time.time() < deadline:
        time.sleep(2)
        h = _api(host, port, f"/history/{pid}")
        e = h.get(pid)
        if not e:
            continue
        if e.get("status", {}).get("status_str") == "error":
            raise RuntimeError("RMBG error: " + json.dumps(e["status"], ensure_ascii=False)[:500])
        if e.get("status", {}).get("completed"):
            out4 = e["outputs"].get("4", {}).get("images", [])
            out5 = e["outputs"].get("5", {}).get("images", [])
            if out4 and out5:
                break
    if not (out4 and out5):
        raise RuntimeError("RMBG timeout")

    def fetch(img):
        v = f"/view?filename={img['filename']}&subfolder={img.get('subfolder', '')}&type={img.get('type', 'output')}"
        with urllib.request.urlopen(f"http://{host}:{port}{v}", timeout=120) as resp:
            return resp.read()

    rgb = Image.open(io.BytesIO(fetch(out5[0]))).convert("RGB")
    mask = Image.open(io.BytesIO(fetch(out4[0]))).convert("L")
    rgba = rgb.convert("RGBA")
    rgba.putalpha(mask)
    out = raw + ".rmbg.png"
    rgba.save(out)
    log(f"RMBG cutout -> {out}")
    return out


def _measure_tilt(im):
    """枪身基线倾角：取内容中段（25%~75% 宽）机匣/护木上沿拟合直线。
    返回倾角（度，>0 表示上沿向右下斜）。"""
    arr = np.asarray(im.convert("RGBA"))
    rgb = arr[:, :, :3].astype(np.int16)
    a = arr[:, :, 3]
    nonwhite = (np.abs(rgb - 255).max(axis=2) > 18) & (a > 8)
    h, w = nonwhite.shape
    cols = np.where(nonwhite.any(axis=0))[0]
    if len(cols) < 32:
        return 0.0
    x_min, x_max = int(cols.min()), int(cols.max())
    span = x_max - x_min
    x0 = x_min + int(span * 0.25)
    x1 = x_min + int(span * 0.75)
    step = 4
    xs, ys = [], []
    for x in range(x0, x1, step):
        seg = nonwhite[:, x:x + step]
        if seg.sum() == 0:
            continue
        yy = np.where(seg)[0]
        xs.append(x + step / 2)
        ys.append(yy.min())  # 上沿
    if len(xs) < 8:
        return 0.0
    k = np.polyfit(np.array(xs), np.array(ys), 1)[0]
    return float(np.degrees(np.arctan(k)))


def process_image(spec, raw, force, cutout_tool="auto", orient=True, auto_level=True,
                  rmbg_host="127.0.0.1", rmbg_port=8188, rmbg_model="BiRefNet-general",
                  timeout=900):
    key = spec["key"]
    layout = spec["layout"]
    canvas = int(layout["canvas"])
    im = Image.open(raw).convert("RGBA")
    if orient:
        arr0 = np.asarray(im)
        faces_right, need_flip = orient_right(arr0)
        log(f"orientation: {'right' if faces_right else 'LEFT -> will flip'}")
        if need_flip:
            im = ImageOps.mirror(im)
    if auto_level:
        # 迭代校平：PIL rotate(+θ) 为逆时针，向右下斜为正角 → 按同符号旋转，加 0.8 阻尼防震荡
        for _ in range(8):
            ang = _measure_tilt(im)
            if abs(ang) < 0.25:
                break
            rot = ang * 0.8
            log(f"auto-level: tilt={round(ang, 2)}deg -> rotate {round(rot, 2)}deg")
            im = im.rotate(rot, resample=Image.BICUBIC, expand=True,
                           fillcolor=(255, 255, 255, 255))
    arr = np.asarray(im).copy()
    a = arr[:, :, 3].astype(np.float32)
    rgb = arr[:, :, :3].astype(np.int16)
    if cutout_tool == "rmbg":
        tmp_raw = raw + ".tmp-leveled.png"
        im.save(tmp_raw)
        cut_path = _rmbg_cutout(tmp_raw, rmbg_host, rmbg_port, rmbg_model, timeout)
        cut = Image.open(cut_path).convert("RGBA")
        arr = np.asarray(cut).copy()
        a = arr[:, :, 3].astype(np.float32)
        for p in (tmp_raw, cut_path):
            if os.path.exists(p):
                os.remove(p)
    elif cutout_tool == "make-transparent-icon" or (cutout_tool == "auto" and _scipy_ok()):
        # SKILL 指定白底抠图工具：角点 flood fill + 最大连通域 + 羽化 + 边缘去污染
        tmp_raw = raw + ".tmp-cut.png"
        tmp_out = raw + ".tmp-cutout.png"
        im.save(tmp_raw)
        subprocess.run([sys.executable, os.path.join(TOOLS_DIR, "make-transparent-icon.py"),
                        tmp_raw, tmp_out], check=True, cwd=REPO_ROOT)
        cut = Image.open(tmp_out).convert("RGBA")
        for p in (tmp_raw, tmp_out):
            if os.path.exists(p):
                os.remove(p)
        arr = np.asarray(cut).copy()
        a = arr[:, :, 3].astype(np.float32)
    else:
        # 从画布四边泛洪去白底（保留枪身内部白色细节，避免整体阈值啃洞）
        is_white = (np.abs(rgb - 255).max(axis=2) <= 20) & (a > 8)
        h, w = is_white.shape
        flood = np.zeros((h, w), bool)
        stack = []
        for x in range(w):
            for y in (0, h - 1):
                if is_white[y, x] and not flood[y, x]:
                    flood[y, x] = True
                    stack.append((y, x))
        for y in range(h):
            for x in (0, w - 1):
                if is_white[y, x] and not flood[y, x]:
                    flood[y, x] = True
                    stack.append((y, x))
        while stack:
            y, x = stack.pop()
            for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                ny, nx = y + dy, x + dx
                if 0 <= ny < h and 0 <= nx < w and is_white[ny, nx] and not flood[ny, nx]:
                    flood[ny, nx] = True
                    stack.append((ny, nx))
        a[flood] = 0
        arr[:, :, 3] = a.astype(np.uint8)
    alpha = a
    bbox = _alpha_bbox(alpha)
    if bbox is None:
        log("ERROR: no visible content")
        sys.exit(1)
    x0, y0, x1, y1 = bbox
    bw, bh = x1 - x0 + 1, y1 - y0 + 1
    target_w = int(round(canvas * layout["contentWidthFrac"]))
    scale = target_w / bw
    nw = int(round(bw * scale))
    nh = int(round(bh * scale))
    content = Image.fromarray(arr).crop((x0, y0, x1 + 1, y1 + 1)).resize((nw, nh), Image.LANCZOS)
    out = Image.new("RGBA", (canvas, canvas), (0, 0, 0, 0))
    px = int(round(canvas * layout["centerX"] - nw / 2))
    py = int(round(canvas * layout["centerY"] - nh / 2))
    out.paste(content, (px, py), content)
    equip = repo_path("assets", "weapons", f"{key}-equip.png")
    icon = repo_path("assets", "icons", f"{key}-equip.png")
    for p in (equip, icon):
        if os.path.exists(p) and not force:
            shutil.copy2(p, p + ".bak")
        out.save(p)
    log(f"equip texture -> {equip}")
    log(f"icon texture  -> {icon}")
    # 校验
    m = np.asarray(out)[:, :, 3]
    bx = _alpha_bbox(m)
    if bx:
        bwx, bhy = bx[2] - bx[0] + 1, bx[3] - bx[1] + 1
        log(f"stats: bbox={bwx}x{bhy} aspect={round(bwx/bhy,2)} "
            f"fill%={round(100*bwx*bhy/canvas/canvas,1)} "
            f"cx={int(round((bx[0]+bx[2])/2-canvas/2))} cy={int(round((bx[1]+bx[3])/2-canvas/2))}")
    log(f"components(alpha>60): {_components(m)}")


def _scipy_ok():
    try:
        import scipy  # noqa: F401
        return True
    except Exception:
        return False


# ---------------------------------------------------------------------------
# 6. 视频
# ---------------------------------------------------------------------------

def gen_video(spec, host, duration, port, timeout):
    key = spec["key"]
    prompt_file = repo_path(PROMPT_DIR, f"{key}_video.txt")
    out = repo_path("assets", "videos", f"{key}_showcase.mp4")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    cmd = [sys.executable, os.path.join(TOOLS_DIR, "minimax-h3-gen.py"),
           "--prompt-file", prompt_file, "--host", host, "--port", str(port),
           "--duration", str(duration), "--size", "1344x768", "--out", out,
           "--timeout", str(timeout)]
    log("RUN " + " ".join(cmd))
    r = subprocess.run(cmd, cwd=REPO_ROOT)
    log(f"video rc={r.returncode}; output: {out}")


# ---------------------------------------------------------------------------
# 7. 校验
# ---------------------------------------------------------------------------

def verify(spec):
    pairs = [
        ("data/equipment.json", "public/data/equipment.json"),
        ("data/craft-config.json", "public/data/craft-config.json"),
    ]
    ok = True
    for a, b in pairs:
        raw_a = open(repo_path(a), "rb").read()
        raw_b = open(repo_path(b), "rb").read()
        same = raw_a == raw_b
        ok &= same
        log(f"double-copy {a} vs {b}: {'OK' if same else 'DIFF'}")
    anim = read_json("public/data/weapon-anim-config.json")
    ok &= spec["weaponType"] in anim
    log(f"weapon-anim-config has '{spec['weaponType']}': {'OK' if spec['weaponType'] in anim else 'MISSING'}")
    for rel in [spec["assets"]["equipImage"], spec["assets"]["iconImage"]]:
        exists = os.path.exists(repo_path(rel))
        ok &= exists
        log(f"asset {rel}: {'OK' if exists else 'MISSING'}")
    for rel in spec["sounds"].values():
        exists = os.path.exists(repo_path(rel))
        ok &= exists
        log(f"sound {rel}: {'OK' if exists else 'MISSING'}")
    js_files = [
        "src/ui/equip-data-manager.js", "src/ui/shop-system.js",
        "src/config/weapon-texture-map.js", "src/config/weapon-attack-config.js",
        "src/config/gun-ammo.js", "src/config/craft-default-slots.js",
        "src/config/weapon-fx-config.js", "src/config/attack-formula.js",
        "src/entities/player/weapon-anim.js", "src/entities/player/update.js",
        "src/entities/player/subsystems.js", "src/game.js", "src/ui/dev-tool.js",
        "src/world/defense-system.js",
    ]
    for rel in js_files:
        p = repo_path(rel)
        if not os.path.exists(p):
            continue
        r = subprocess.run(["node", "--check", p], cwd=REPO_ROOT,
                           capture_output=True, text=True)
        flag = "OK" if r.returncode == 0 else f"FAIL: {r.stderr.strip()[:200]}"
        ok &= r.returncode == 0
        log(f"node --check {rel}: {flag}")
    return ok


# ---------------------------------------------------------------------------

def js_todo(spec):
    key = spec["key"]
    log("=" * 70)
    log("JS 补丁清单（配合 apply_patch 落盘，锚点如下）:")
    rows = [
        ("src/ui/equip-data-manager.js", "在 AKM_ITEM 块后加 M416_ITEM"),
        ("src/ui/shop-system.js", "在 akm 商店条目后加 m416 条目（含 attackFormula 等全字段）"),
        ("src/config/player-defaults.js", "images 加 m416"),
        ("src/entities/player/index.js", "预载 m416Image"),
        ("src/config/weapon-texture-map.js", "getWeaponTextureLoadList 加 weapon_m416"),
        ("src/config/weapon-attack-config.js", "akm 条目后加 m416 条目"),
        ("src/config/gun-ammo.js", "GUN_AMMO_CAP weapon21 / GUN_WEAPON_TYPES / TWO_HANDED_WEAPONS / rifle / FIRE_MODES / GUN_EQUIP_SOUND"),
        ("src/config/craft-default-slots.js", "weapon7 块后加 weapon21 槽位"),
        ("src/config/weapon-fx-config.js", "lmg.soundMap 加 m416"),
        ("src/config/attack-formula.js", "步枪精通判定加 m416"),
        ("src/entities/player/weapon-anim.js", "远程判定(121)与 cfgKey(494)加 m416"),
        ("src/entities/player/update.js", "isPkm 全自动组(880)加 m416；attackKey 三元链(1014)加 m416"),
        ("src/entities/player/subsystems.js", "切枪保护(1023)/模式图标(1037)/装载分支(1089)/开火执行 isPkmOrAkm(1667)/动画 isPkmOrAkm(1963)/_isPkmOrAkm(2061)/副手 cfgKey(1479) 加 m416"),
        ("src/phaser/scenes/GameScene.js", "isGun/isGunR/isGunOff/isGunSpecial/副手名单 六处加 m416（否则持枪贴图错误）"),
        ("src/combat/weapon-transform.js", "加 m416 变换块（抄 akm）+ getAttackAnimOffset 分支"),
        ("src/config/enchant-config.js", "枪械类可附魔名单加 m416"),
        ("src/ui/quick-bar.js", "冲撞/远程判定加 m416"),
        ("src/ui/equip-manager.js", "weapon2 槽 equippedRangedType 加 m416"),
        ("src/combat/attack.js", "RangedAttack 开火音效加 m416"),
        ("src/game.js", "_WEAPON_SPAWN_LIST 在 AKM 后加 M416_ITEM"),
        ("src/ui/dev-tool.js", "WEAPON_MAP 加 m416"),
        ("src/world/defense-system.js", "TOWER_WEAPON_TYPES/BASE_WEAPON_DAMAGE/heights/TOWER_FIRE_SOUNDS 加 m416"),
    ]
    for rel, what in rows:
        log(f"  - {rel}: {what}")
    log("=" * 70)


def main():
    ap = argparse.ArgumentParser(description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--spec", default=os.path.join(TOOLS_DIR, "weapon-specs", "m416.json"))
    sub = ap.add_subparsers(dest="cmd")
    sub.add_parser("scaffold")
    g = sub.add_parser("gen-image")
    g.add_argument("--host", default="127.0.0.1")
    g.add_argument("--model", default="flux2-klein-4b")
    g.add_argument("--seeds", default="1,2,3")
    g.add_argument("--timeout", type=int, default=900)
    p = sub.add_parser("process-image")
    p.add_argument("--raw", required=True)
    p.add_argument("--force", action="store_true")
    p.add_argument("--cutout-tool", choices=["auto", "make-transparent-icon", "flood", "none", "rmbg"],
                   default="auto",
                   help="抠图工具：rmbg=ComfyUI-RMBG 插件（BiRefNet，推荐），auto=优先 make-transparent-icon，flood=内置泛洪，none=输入已透明")
    p.add_argument("--no-orient", action="store_true", help="关闭枪口朝右自动镜像")
    p.add_argument("--no-auto-level", action="store_true", help="关闭枪身水平自动校正")
    p.add_argument("--rmbg-host", default="127.0.0.1")
    p.add_argument("--rmbg-port", type=int, default=8188)
    p.add_argument("--rmbg-model", default="BiRefNet-general")
    p.add_argument("--rmbg-timeout", type=int, default=900)
    v = sub.add_parser("gen-video")
    v.add_argument("--host", default="192.168.3.142")
    v.add_argument("--port", type=int, default=8188)
    v.add_argument("--duration", type=int, default=2)
    v.add_argument("--timeout", type=int, default=1800)
    sub.add_parser("verify")
    args = ap.parse_args()

    with open(repo_path(args.spec), "r", encoding="utf-8") as fh:
        spec = json.load(fh)
    log(f"spec: {spec['name']} ({spec['weaponId']}/{spec['weaponType']}, {spec['rarityLabel']})")

    if args.cmd == "scaffold":
        scaffold_data(spec)
        build_depth_template(spec, os.path.join("tools", "ai-gen", "_depth_templates",
                                                f"{spec['key']}_sil.png"))
        scaffold_prompts(spec)
        scaffold_sounds(spec)
        js_todo(spec)
        verify(spec)
    elif args.cmd == "gen-image":
        seeds = [int(x) for x in args.seeds.split(",") if x.strip()]
        gen_image(spec, args.host, args.model, seeds, args.timeout)
    elif args.cmd == "process-image":
        process_image(spec, args.raw, args.force, cutout_tool=args.cutout_tool,
                      orient=not args.no_orient, auto_level=not args.no_auto_level,
                      rmbg_host=args.rmbg_host, rmbg_port=args.rmbg_port,
                      rmbg_model=args.rmbg_model, timeout=args.rmbg_timeout)
    elif args.cmd == "gen-video":
        gen_video(spec, args.host, args.duration, args.port, args.timeout)
    elif args.cmd == "verify":
        sys.exit(0 if verify(spec) else 1)
    else:
        ap.print_help()


if __name__ == "__main__":
    main()
