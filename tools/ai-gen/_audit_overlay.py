# 把 _audit-realpoly.mjs 导出的真实运行时多边形叠回贴图（贴合审计可视化）。
import json
from PIL import Image, ImageDraw

data = json.load(open('tools/verify-shots/_realpoly.json', encoding='utf-8'))

for key, it in data['items'].items():
    if 'error' in it:
        continue
    texW, texH = it['texW'], it['texH']
    sx, sy = it['scaleX'], it['scaleY']
    fy = it['frontY']
    img = Image.open(f'assets/terrain/{key}.png').convert('RGBA')
    overlay = Image.new('RGBA', img.size, (0, 0, 0, 0))
    od = ImageDraw.Draw(overlay)

    def m(pts):
        return [(texW / 2 + p['x'] / sx, fy + p['y'] / sy) for p in pts]

    # 接地曲线（绿点）：阴影近边应贴的"地面线"
    for gx, gy in it['groundCurve']:
        od.ellipse([gx - 2, gy - 2, gx + 2, gy + 2], fill=(0, 255, 0, 220))
    # 实体四边形（蓝）
    body = m(it['bodyVerts'])
    if body:
        od.polygon(body, outline=(0, 80, 255, 255))
    # footprint 凸包（青）
    hull = m(it['hullBody'])
    if hull:
        od.polygon(hull, outline=(0, 255, 255, 255))
    # 剪影片（黄）
    sil = m(it['silPoly'])
    if sil:
        od.polygon(sil, outline=(255, 220, 0, 255))
    # 最终并集（红，半透明填充）
    uni = m(it['union'])
    if uni:
        od.polygon(uni, fill=(255, 0, 0, 60), outline=(255, 0, 0, 255))
    img.alpha_composite(overlay)
    img.save(f'tools/verify-shots/_realfit_{key}.png')
    print('saved', key)
