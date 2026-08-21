# 伊莉丝精灵图审计：网格匹配 + 对齐三铁律（高度/脚底基线/水平中心）+ 空帧/贴边
import sys, json
from PIL import Image

SHEETS = {
    'idle':     ('assets/companions/elise/idle.png',      512, 512, 1, 1, 1),
    'walk':     ('assets/companions/elise/walking.png',   640, 640, 4, 3, 12),
    'run':      ('assets/companions/elise/running.png',   640, 640, 5, 5, 23),
    'attack':   ('assets/companions/elise/attacking.png', 960, 1024, 5, 6, 28),
    'windmill': ('assets/companions/elise/windmill.png',  896, 640, 5, 5, 23),
    'defend':   ('assets/companions/elise/defending.png', 640, 640, 4, 5, 19),
}

def audit(name, path, fw, fh, cols, rows, frame_count):
    im = Image.open(path).convert('RGBA')
    W, H = im.size
    grid_ok = (W == fw * cols and H == fh * rows)
    print(f'\n== {name}: {path} 实际 {W}x{H} 期望 {fw*cols}x{fh*rows} 网格{"OK" if grid_ok else "★不匹配"}')
    alpha = im.getchannel('A')
    feet, centers, heights, widths = [], [], [], []
    empties, edge_hits = [], []
    n = cols * rows
    for i in range(n):
        cx, cy = (i % cols) * fw, (i // cols) * fh
        cell = alpha.crop((cx, cy, cx + fw, cy + fh))
        bbox = cell.getbbox()
        px = cell.load()
        if not bbox:
            empties.append(i); feet.append(None); centers.append(None); heights.append(None); widths.append(None)
            continue
        minx, miny, maxx, maxy = bbox
        # 有效内容（alpha>10）计数
        cnt = 0
        edge = 0
        step = 4
        for yy in range(miny, maxy, step):
            for xx in range(minx, maxx, step):
                a = px[xx, yy]
                if a > 10:
                    cnt += 1
                    if xx < 6 or yy < 6 or xx >= fw - 6 or yy >= fh - 6:
                        edge += 1
        if cnt * step * step < 50:
            empties.append(i)
        if edge > 0:
            edge_hits.append((i, edge * step * step))
        feet.append(maxy)
        centers.append((minx + maxx) / 2 - fw / 2)
        heights.append(maxy - miny)
        widths.append(maxx - minx)

    def stats(vals, label, ref=None):
        vs = [v for v in vals if v is not None]
        if not vs: return
        import statistics
        mean = statistics.mean(vs)
        std = statistics.pstdev(vs) if len(vs) > 1 else 0
        extra = f' (相对格中心/格底)' if ref is None else ''
        print(f'   {label}: mean={mean:.1f} std={std:.1f} min={min(vs)} max={max(vs)}')

    used = [i for i in range(n) if feet[i] is not None and i not in empties]
    print(f'   有效帧 {len(used)}/{n}，声明 frameCount={frame_count}；空帧={empties}')
    if edge_hits: print(f'   ★贴边帧(6px 内 alpha 像素): {edge_hits[:8]}')
    stats([feet[i] for i in used], '脚底基线 y(格内)')
    stats([centers[i] for i in used], '水平中心偏移 px')
    stats([heights[i] for i in used], '内容高度 px')
    stats([widths[i] for i in used], '内容宽度 px')
    # 逐帧列出脚底与中心，看漂移形态
    seq = ', '.join(f'{i}:{feet[i]}/{centers[i]:+.0f}' for i in used)
    print('   逐帧 帧号:脚底线/中心偏移 →', seq)

for name, args in SHEETS.items():
    try:
        audit(name, *args)
    except Exception as ex:
        print(f'== {name} 失败: {ex}')
