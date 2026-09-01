"""Second thrust candidate: chamber -> shoulder drive -> braced extension.

Uses only existing pixel cutouts. Writes power-v2/, never the approved slash
candidate, runtime images, skill timing, damage or movement configuration.
"""
import copy
import importlib.util
import json
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('transition_author', HERE / 'build_transitions.py')
author = importlib.util.module_from_spec(spec)
spec.loader.exec_module(author)
OUT = HERE / 'power-v2'
OUT.mkdir(exist_ok=True)
author.HERE = OUT
native_authored = author.authored
POWER = {'driveMs': 100, 'settleMs': 80, 'settleRatio': 0.13,
         'chamberPalm': [374, 229], 'extendedPalm': [482, 181],
         'chamberShoulder': [281, 177], 'extendedShoulder': [315, 172],
         'swordAngle': 91, 'shieldAngle': -14,
         'notes': ['Candidate only. 600ms active thrust, zero added windup, 500ms recovery.',
                   'Preparation bends the elbow; first 100ms sends the shoulder and sword forward.',
                   'Torso/legs use source-pixel mesh. Separate arm cutouts retain fixed bone lengths.',
                   'No camera shake, new VFX, damage, hit timing or physical displacement changes.']}


def powered(branch, index, progress, recovering=False):
    frame = native_authored(branch, index, progress, recovering)
    if branch != 'thrust' or recovering:
        return frame
    elapsed = progress * 600
    drive = 1 - (1 - min(1, elapsed / POWER['driveMs'])) ** 3
    if elapsed > POWER['driveMs']:
        drive -= POWER['settleRatio'] * author.smooth((elapsed - POWER['driveMs']) / POWER['settleMs'])
    points = copy.deepcopy(frame['points'])
    offsets = {'head': [26*drive, 10-8*drive], 'neck': [24*drive, 9-7*drive],
               'chest': [17*drive, 7-5*drive], 'waist': [8*drive, 5-3*drive],
               'hip': [3*drive, 5-5*drive], 'rearKnee': [-14*drive, -19*drive],
               'frontKnee': [16*drive, 5*drive]}
    for name, delta in offsets.items():
        points[name] = [points[name][i] + delta[i] for i in range(2)]
    points['mainShoulder'] = author.lerp(POWER['chamberShoulder'], POWER['extendedShoulder'], drive)
    points['mainPalm'] = author.lerp(POWER['chamberPalm'], POWER['extendedPalm'], drive)
    points['mainElbow'] = author.lerp([316, 247], [398, 169], drive)
    # Shield remains close to the ribs; the shoulder drives with the torso.
    for name in ('offShoulder', 'offElbow', 'offPalm'):
        points[name] = [points[name][0] + 17*drive, points[name][1] + 8-6*drive]
    names = author.CFG['bodyPointNames']
    torso = author.warp(author.BODY_IMAGES[frame['torso']],
                        {k: frame['points'][k] for k in names}, {k: points[k] for k in names})
    key = f'power-{index}-{progress:.5f}'
    frame['torso'] = author.register(key+'-torso', torso)
    picture, points = author.joint_parts(torso, points)
    frame['body'] = author.register(key, picture)
    frame['points'] = points
    frame['sword']['point'] = points['mainPalm']
    frame['sword']['angle'] = POWER['swordAngle']
    frame['sword']['origin'] = author.WEAPONS['thrust'][1]['grip']
    frame['shield'] = {'point': points['offPalm'], 'angle': POWER['shieldAngle'], 'behind': False}
    return frame


def main():
    author.authored = powered
    sequences = [author.sequence('thrust', origin) for origin in range(8)]
    for seq in sequences:
        for record in seq['records']:
            time = record['timeMs'] - seq['attackAtMs']
            if 0 <= time < 100:
                record['phase'] = '攻击已生效／蹬地送肩刺出'
            elif 100 <= time < 180:
                record['phase'] = '前腿承重／刺出后短促回震'
            elif 180 <= time < seq['attackMs']:
                record['phase'] = '保持前压／盾贴肋部'
            elif record['phase'] == '已就绪，腿部继续跑':
                record['phase'] = '屈肘收剑就绪／腿部继续跑'
    author.export_gif(sequences[0])
    contact = Image.new('RGB', (1536, 768), '#1d2228')
    draw = ImageDraw.Draw(contact)
    labels = [(213,'低持跑姿'), (333,'屈肘收剑'), (780,'就绪：保留腿部步相'),
              (800,'点击即生效'), (840,'送肩刺出'), (900,'蹬地与最大伸展'),
              (980,'前腿承重，短促回震'), (1200,'保持前压'), (1400,'收势交接'),
              (1560,'屈肘回收'), (1840,'接回跑姿'), (1900,'继续奔跑')]
    for i, (time, label) in enumerate(labels):
        record = max((r for r in sequences[0]['records'] if r['timeMs'] <= time), key=lambda r:r['timeMs'])
        im = author.paint(record, 'thrust').resize((384, 213), Image.Resampling.LANCZOS)
        x, y = i % 4 * 384, i // 4 * 256
        contact.paste(im, (x, y+25), im)
        draw.text((x+6, y+4), f'{time}ms / {label}', font=author.SMALL, fill='#e5b15b')
    contact.save(OUT / 'thrust-transition-contact.png')
    visible = sorted({r['body'] for seq in sequences for r in seq['records']})
    indices = {old:new for new,old in enumerate(visible)}
    for seq in sequences:
        for record in seq['records']:
            record['body'] = indices[record['body']]
            record.pop('torso', None)
    metadata = {'status': 'thrust-power-v2-candidate-not-in-runtime', 'config': author.CFG,
                'power': POWER, 'sourceBodySize': author.SIZE, 'canvas': author.CANVAS,
                'offset': author.OFFSET, 'weapons': {k:v[1] for k,v in author.WEAPONS.items()},
                'shieldSize': author.SHIELD_SIZE, 'shieldOrigin': author.SHIELD_ORIGIN,
                'sequences': sequences}
    (OUT / 'transition-export.json').write_text(json.dumps(metadata, ensure_ascii=False, separators=(',', ':'))+'\n', encoding='utf-8')
    payload = dict(metadata, bodies=[author.png_data(author.BODY_IMAGES[i]) for i in visible],
                   weaponImages={k:author.png_data(v[0]) for k,v in author.WEAPONS.items()},
                   shieldImage=author.png_data(author.SHIELD_IMAGE))
    (OUT / 'transition-data.js').write_text('window.DASH_TRANSITIONS = '+json.dumps(payload, ensure_ascii=False, separators=(',', ':'))+';\n', encoding='utf-8')
    (OUT / 'power-config.json').write_text(json.dumps(POWER, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
    preview = (HERE / 'preview.html').read_text(encoding='utf-8')
    preview = preview.replace('<option value="slash">普通冲刺攻击 · 生锈长剑</option>', '')
    preview = preview.replace('剑盾奔跑与冲刺衔接候选', '冲刺突击 · 力量增强候选 V2')
    preview = preview.replace('低持奔跑 → 冲刺 → 收势回跑', '屈肘收剑 → 蹬地送肩 → 刺出定势')
    preview = preview.replace('两种动作分别衔接，可从8个跑步帧进入。', '突击V2可从8个跑步帧进入；普通冲刺已按用户确认单独导入。')
    start, end = preview.index('<div class="notes">'), preview.index('<div class="links">')
    preview = preview[:start] + '''<div class="notes">
  <p><b>屈肘收剑</b><br>奔跑就绪时先屈肘，剑留出向前刺出的距离；盾牌贴近胸肋，腿部继续跑。</p>
  <p><b>蹬地送肩</b><br>点击后立即生效，前100ms送肩伸臂，随后80ms小幅回震。保留600ms攻击与500ms收势；没有改动伤害、位移或命中时窗。</p>
</div>
''' + preview[end:]
    preview = preview.replace('<a href="slash-transition-both-directions.gif">普通冲刺GIF</a>', '<a href="../slash-transition-both-directions.gif">已确认普通冲刺GIF</a>')
    preview = preview.replace('href="../preview.html">原奔跑姿态编辑', 'href="../../preview.html">原奔跑姿态编辑')
    preview = preview.replace('<script src="preview.js">', '<script src="../preview.js">')
    (OUT / 'preview.html').write_text(preview, encoding='utf-8')
    print(f'Power v2: {len(visible)} body images, eight entry phases; candidate only.', flush=True)


if __name__ == '__main__':
    main()
