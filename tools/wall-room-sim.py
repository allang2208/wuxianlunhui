# -*- coding: utf-8 -*-
"""菱形房间墙壁拼装模拟器：用与 JS 相同的映射数学渲染，供视觉迭代"""
from PIL import Image, ImageDraw
import math
import json

T = 'E:/无尽轮回/长期备份/2026-7-13-1/game-dev/assets/terrain'
OUT = 'E:/无尽轮回/长期备份/2026-7-13-1/tmp_wall_view/sim_room.png'

# ---- 贴图几何（ship 坐标系，wall-asset-prep.py 实测 + 手动补充） ----
GEO = {
    'diag': {  # wall_diag.png 裁掉两端帽(列150-1450)后 1300x1315
        'base': [(0, 699.1), (1300, 1335.7)], 'wallH': 824, 'crop': (150, 0, 1450, 1315),
    },
    'top': {  # ∧ 转角上 1600x843：顶点(854,478) 臂尖(250,750)/(1350,640)（尖端有渐隐，取实体端）
        'vertex': (854, 478), 'tipL': (250, 750), 'tipR': (1350, 640), 'wallH': 493, 'trim': (150, 1450),
    },
    'bottom': {  # ∨ 转角下 1600x751：顶点(850,705) 臂尖(130,390)/(1450,380)
        'vertex': (850, 705), 'tipL': (130, 390), 'tipR': (1450, 380), 'wallH': 427, 'trim': (130, 1470),
    },
    'left': {  # < 转角左 1343x1600：角柱底(50,1020) 上臂尖(1180,240) 下臂尖(1326,1500)
        'vertex': (50, 1020), 'tipUpper': (1180, 240), 'tipLower': (1326, 1500), 'wallH': 520,
    },
    'right': {  # > 转角右 1600x1517：角柱底(1590,930) 上臂尖(150,300) 下臂尖(310,1450)
        'vertex': (1590, 930), 'tipUpper': (150, 300), 'tipLower': (310, 1450), 'wallH': 500,
    },
}

# ---- 房间参数 ----
CX, CY = 1350, 780
RX, RY = 1200, 600         # 菱形半径（ry/rx = 0.5 与地板透视一致）
WALL_H = 190               # 目标墙高（世界像素，底边->顶沿）
DOOR_EDGE = 'RB'           # 出入口所在边
DOOR_W = 100

pieces = []  # (depth, draw_fn)


def load(key, fname):
    img = Image.open(f'{T}/{fname}').convert('RGBA')
    tr = GEO[key].get('trim')
    if tr:
        img = img.crop((tr[0], 0, tr[1], img.height))
        # 锚点 x 坐标平移到裁剪后空间
        g = GEO[key]
        for k in ('vertex', 'tipL', 'tipR', 'tipUpper', 'tipLower'):
            if k in g:
                g[k] = (g[k][0] - tr[0], g[k][1])
    return img


IMG = {
    'diag': load('diag', 'wall_diag.png').crop(GEO['diag']['crop']),
    'top': load('top', 'wall_corner_top.png'),
    'bottom': load('bottom', 'wall_corner_bottom.png'),
    'left': load('left', 'wall_corner_left.png'),
    'right': load('right', 'wall_corner_right.png'),
}

canvas = Image.new('RGB', (2900, 1750), (8, 8, 10))


def paste(img, x, y, w, h, flip=False):
    if flip:
        img = img.transpose(Image.FLIP_LEFT_RIGHT)
    img = img.resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS)
    canvas.paste(img, (round(x), round(y)), img)


def map_seg(img, A, B, flip=False):
    """直墙贴图底边映射到世界线段 A->B（A 上端/右端，B 下端/左端）"""
    g = GEO['diag']
    (p0x, p0y), (p1x, p1y) = g['base']
    w, h = img.size
    if not flip:
        sx = (B[0] - A[0]) / (p1x - p0x)
        sy = (B[1] - A[1]) / (p1y - p0y)
        x0 = A[0] - p0x * sx
        y0 = A[1] - p0y * sy
    else:
        # flipX 为 quad 内镜像：贴图点 p 落在 x0 + (w-p.x)*sx；p0->A，p1->B
        sx = (A[0] - B[0]) / (p1x - p0x)
        sy = (B[1] - A[1]) / (p1y - p0y)
        x0 = A[0] - (w - p0x) * sx
        y0 = A[1] - p0y * sy
    paste(img, x0, y0, w * sx, h * sy, flip)


def corner_scale(key):
    return WALL_H / GEO[key]['wallH']


def place_corner(key, V):
    g = GEO[key]
    s = corner_scale(key)
    img = IMG[key]
    w, h = img.size
    x0 = V[0] - g['vertex'][0] * s
    y0 = V[1] - g['vertex'][1] * s
    paste(img, x0, y0, w * s, h * s)


def corner_tip_world(key, V, tip_key):
    g = GEO[key]
    s = corner_scale(key)
    t = g[tip_key]
    return (V[0] + (t[0] - g['vertex'][0]) * s, V[1] + (t[1] - g['vertex'][1]) * s)


# 顶点
Tv = (CX, CY - RY)
Rv = (CX + RX, CY)
Bv = (CX, CY + RY)
Lv = (CX - RX, CY)

# 地板菱形
floor = Image.new('RGBA', canvas.size, (0, 0, 0, 0))
fd = ImageDraw.Draw(floor)
fd.polygon([Tv, Rv, Bv, Lv], fill=(38, 36, 34, 255), outline=(90, 85, 80, 255))
# 地板菱形网格参考线
for i in range(-16, 17):
    fd.line([(CX + i * 100 - 1600, CY - 800), (CX + i * 100 + 1600, CY + 800)], fill=(50, 48, 45, 255))
    fd.line([(CX + i * 100 - 1600, CY + 800), (CX + i * 100 + 1600, CY - 800)], fill=(50, 48, 45, 255))
canvas.paste(floor, (0, 0), floor)

# 四角（先画，瓦片后画在下层？不——按 depth 排序统一画）
# 四角贴图覆盖范围（臂尖世界坐标）
tips = {
    'T_L': corner_tip_world('top', Tv, 'tipL'),
    'T_R': corner_tip_world('top', Tv, 'tipR'),
    'B_L': corner_tip_world('bottom', Bv, 'tipL'),
    'B_R': corner_tip_world('bottom', Bv, 'tipR'),
    'L_U': corner_tip_world('left', Lv, 'tipUpper'),
    'L_D': corner_tip_world('left', Lv, 'tipLower'),
    'R_U': corner_tip_world('right', Rv, 'tipUpper'),
    'R_D': corner_tip_world('right', Rv, 'tipLower'),
}

OVERLAP = 40  # 瓦片向转角臂内侵入


def lay_tiles(P, Q, flip, door_at=None):
    """在 P->Q 之间铺直墙瓦片（P 上端）。door_at: 沿边中点跳过门宽"""
    dx, dy = Q[0] - P[0], Q[1] - P[1]
    seg_len = math.hypot(dx, dy)
    if seg_len < 20:
        return
    # 方向校验：跨度方向必须与边方向一致（转角臂交叉时跳过）
    if (flip and dx > 0) or (not flip and dx < 0):
        return
    g = GEO['diag']
    (p0x, p0y), (p1x, p1y) = g['base']
    tex_len = math.hypot(p1x - p0x, p1y - p0y)
    s = WALL_H / g['wallH']
    tile_len = tex_len * s
    n = max(1, round(seg_len / tile_len))
    step = seg_len / n
    ux, uy = dx / seg_len, dy / seg_len
    for i in range(n):
        a = i * step
        b = (i + 1) * step
        if door_at is not None:
            # 与门区间相交则跳过
            if a < door_at + DOOR_W / 2 and b > door_at - DOOR_W / 2:
                continue
        A = (P[0] + ux * a, P[1] + uy * a)
        B = (P[0] + ux * b, P[1] + uy * b)
        depth = max(A[1], B[1])
        pieces.append((depth, lambda A=A, B=B, flip=flip: map_seg(IMG['diag'], A, B, flip)))
        print(f'  tile flip={flip} A=({A[0]:.0f},{A[1]:.0f}) B=({B[0]:.0f},{B[1]:.0f})')


def shrink(P, V, amt):
    """把臂尖 P 向顶点 V 方向收回 amt（瓦片起点伸入转角臂内，实现覆盖式拼接）"""
    dx, dy = P[0] - V[0], P[1] - V[1]
    d = math.hypot(dx, dy)
    if d == 0:
        return P
    return (P[0] - dx / d * amt, P[1] - dy / d * amt)


# 各边铺瓦（臂尖之间，向转角内侵入 OVERLAP）
# 边 TL：T->L 方向 "/" flip；边 TR：T->R "\"；边 LB：L->B "\"；边 RB：R->B "/"
lay_tiles(shrink(tips['T_L'], Tv, OVERLAP), shrink(tips['L_U'], Lv, OVERLAP), flip=True)
lay_tiles(shrink(tips['T_R'], Tv, OVERLAP), shrink(tips['R_U'], Rv, OVERLAP), flip=False)
lay_tiles(shrink(tips['L_D'], Lv, OVERLAP), shrink(tips['B_L'], Bv, OVERLAP), flip=False)
door_mid = math.hypot(Rv[0] - Bv[0], Rv[1] - Bv[1]) / 2 if DOOR_EDGE == 'RB' else None
lay_tiles(shrink(tips['R_D'], Rv, OVERLAP), shrink(tips['B_R'], Bv, OVERLAP), flip=True, door_at=door_mid)

# 转角 depth：顶点 y + 5 + 顺序偏置（由前到后：下>左>右>上）
pieces.append((Tv[1] + 5 + 0, lambda: place_corner('top', Tv)))
pieces.append((Rv[1] + 5 + 1, lambda: place_corner('right', Rv)))
pieces.append((Lv[1] + 5 + 2, lambda: place_corner('left', Lv)))
pieces.append((Bv[1] + 5 + 3, lambda: place_corner('bottom', Bv)))

# 按 depth 升序画
for _, fn in sorted(pieces, key=lambda p: p[0]):
    fn()

# 顶点标记（调试）
dbg = ImageDraw.Draw(canvas)
for name, V in [('T', Tv), ('R', Rv), ('B', Bv), ('L', Lv)]:
    dbg.ellipse([V[0] - 4, V[1] - 4, V[0] + 4, V[1] + 4], outline=(255, 60, 60), width=2)
    dbg.text((V[0] + 6, V[1] - 6), name, fill=(255, 255, 0))

canvas.save(OUT)
print('saved', OUT)
