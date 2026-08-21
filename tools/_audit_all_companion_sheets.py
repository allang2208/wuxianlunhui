# 全体友军动画精灵图批量审计（2026-08-21）：网格匹配/空帧/脚基线/中心漂移/贴边
# 数据源：data/companion-config.json + data/hamster-*-config.json 的 animations 块
import json, glob, os, sys
import numpy as np
from PIL import Image

sys.stdout.reconfigure(encoding='utf-8', errors='replace')
ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__)))

def load_anims():
    out = []  # (owner, animKey, def)
    cc = json.load(open('data/companion-config.json', encoding='utf-8'))
    for c in cc['companions']:
        if not isinstance(c.get('animations'), dict):
            continue
        if 'elise' not in c.get('modelPlaceholder', '') and 'luna' not in str(c.get('animations', {})):
            pass
        for k, d in c['animations'].items():
            out.append((c['id'], k, d))
    for f in sorted(glob.glob('data/hamster-*-config.json')):
        cfg = json.load(open(f, encoding='utf-8'))
        uid = cfg.get('id') or os.path.basename(f)
        for k, d in (cfg.get('animations') or {}).items():
            out.append((uid, k, d))
    return out

def audit(owner, key, d):
    src = d.get('src')
    if not src or not os.path.exists(src):
        print(f'!! {owner}/{key}: src 缺失 {src}')
        return
    fw, fh = d.get('frameWidth', 512), d.get('frameHeight', 512)
    cols, rows = d.get('cols', 1), d.get('rows', 1)
    fc = d.get('frameCount', 1)
    im = Image.open(src).convert('RGBA')
    W, H = im.size
    grid_ok = (W == fw * cols and H == fh * rows)
    arr = np.asarray(im)
    # 按配置帧区间审计（frames [a,b] 优先；否则 0..frameCount-1）
    fr_range = d.get('frames')
    if isinstance(fr_range, list) and len(fr_range) == 2:
        indices = list(range(fr_range[0], min(fr_range[1], cols * rows - 1) + 1))
    else:
        indices = list(range(min(fc, cols * rows)))
    feet, cx_drift, heights = [], [], []
    empty = []
    edge = []
    for i in indices:
        cell = arr[(i // cols) * fh:(i // cols + 1) * fh, (i % cols) * fw:(i % cols + 1) * fw]
        a = cell[..., 3]
        m = a > 10
        if m.sum() < 50:
            empty.append(i)
            continue
        ys, xs = np.where(m)
        top, bottom = int(ys.min()), int(ys.max())
        left, right = int(xs.min()), int(xs.max())
        feet.append(bottom)
        cx_drift.append((left + right) / 2 - fw / 2)
        heights.append(bottom - top)
        if left <= 0 or right >= fw - 1 or top <= 0 or bottom >= fh - 1:
            edge.append(i)
    std_cx = float(np.std(cx_drift)) if len(cx_drift) > 1 else 0.0
    std_ft = float(np.std(feet)) if len(feet) > 1 else 0.0
    flags = []
    if not grid_ok: flags.append(f'★网格不匹配(实际{W}x{H})')
    if empty: flags.append(f'★空帧{empty}')
    if edge: flags.append(f'★贴边帧{edge[:5]}')
    if std_cx > 12: flags.append(f'★中心漂移std={std_cx:.0f}')
    if std_ft > 3: flags.append(f'★脚基线std={std_ft:.1f}')
    fr = d.get('frameRate', '?')
    seg = ''
    if d.get('startFrames'): seg = f' start{d["startFrames"]}@{d.get("startFrameRate", fr)} loop{d.get("loopFrames")}@{fr}'
    if d.get('enterFrames'): seg = f' enter{d["enterFrames"]}@{d.get("enterFrameRate", fr)} exit{d.get("exitFrames")}@{d.get("exitFrameRate", fr)}'
    status = ' '.join(flags) if flags else 'OK'
    print(f'{"!!" if flags else "  "}{owner}/{key}: {fc}f @{fr}fps{seg} | 中心std={std_cx:.1f} 脚std={std_ft:.1f} | {status}')

print(f'{"== 友军动画批量审计 == "}\n')
for owner, key, d in load_anims():
    audit(owner, key, d)
