# 用实机导出的真实多边形+真实精灵参数做合成对照（_fitdump.json）。
# 画布 = 世界坐标平移；红=游戏实际绘制的最终阴影多边形，贴图按 anchor/footY 盖上。
import json
from PIL import Image, ImageDraw

dump = json.load(open('tools/verify-shots/_fitdump.json', encoding='utf-8'))

for it in dump['items']:
    key = it['key']
    if not it.get('poly') or not it.get('sil') or not it.get('sprite'):
        print('skip', it['id'])
        continue
    sp, sil = it['sprite'], it['sil']
    dw, dh = sp['dw'], sp['dh']
    footY = it['footY']
    ax, ay = sil['anchorX'], sil['anchorY']
    xs = [p['x'] for p in it['poly']] + [ax - dw / 2, ax + dw / 2]
    ys = [p['y'] for p in it['poly']] + [ay - footY - dh / 2, ay - footY + dh / 2]
    minX, maxX = min(xs) - 30, max(xs) + 30
    minY, maxY = min(ys) - 30, max(ys) + 30
    W, H = int(maxX - minX), int(maxY - minY)
    canvas = Image.new('RGBA', (W, H), (40, 36, 32, 255))
    d = ImageDraw.Draw(canvas)
    pts = [(p['x'] - minX, p['y'] - minY) for p in it['poly']]
    d.polygon(pts, fill=(0, 0, 0, 140), outline=(255, 60, 60, 255))
    sprite = Image.open(f'assets/terrain/{key}.png').convert('RGBA').resize((round(dw), round(dh)), Image.LANCZOS)
    if sp.get('flipX'):
        sprite = sprite.transpose(Image.FLIP_LEFT_RIGHT)
    canvas.alpha_composite(sprite, (round(ax - dw / 2 - minX), round(ay - footY - dh / 2 - minY)))
    d = ImageDraw.Draw(canvas)
    d.ellipse([ax - minX - 3, ay - minY - 3, ax - minX + 3, ay - minY + 3], outline=(0, 255, 0, 255), width=2)
    canvas.convert('RGB').save(f'tools/verify-shots/_live_{key}.png')
    print('saved', key)
