"""V3: stable torso pixels and hand-bound recovery to real idle/run endpoints.

Candidate production only. Reuses the V2 algorithm module without depending on
the discarded V2 output directory. Approved slash, runtime images and combat
configuration stay untouched. Existing run frame 6 is the rigid upper-body donor.
"""
import copy
import importlib.util
import json
import math
from pathlib import Path
from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('power_v2', HERE / 'build_thrust_power.py')
v2 = importlib.util.module_from_spec(spec)
spec.loader.exec_module(v2)
a = v2.author
OUT = HERE / 'power-v3'
OUT.mkdir(exist_ok=True)
a.HERE = OUT
RECOVER = json.loads((a.ROOT / 'data/player-thrust-recover-poses.json').read_text(encoding='utf-8'))
original_blend = a.blend
DONOR = a.run_frame(6, 'thrust')
DONOR_POINTS = DONOR['points']
DONOR_IMAGE = a.BODY_IMAGES[DONOR['torso']]
UPPER = DONOR_IMAGE.copy()
UPPER.paste((0,0,0,0), (0, round(DONOR_POINTS['hip'][1]+19), 512, 512))


def stable(frame, key):
    """The same skull/ribs/pelvis pixels only rotate/translate; no body fit/scale."""
    frame = copy.deepcopy(frame)
    pts = frame['points']
    old_neck = pts['neck'][:]
    hip, neck = pts['hip'], pts['neck']
    src_hip, src_neck = DONOR_POINTS['hip'], DONOR_POINTS['neck']
    angle = math.degrees(math.atan2(neck[1]-hip[1], neck[0]-hip[0])
                         - math.atan2(src_neck[1]-src_hip[1], src_neck[0]-src_hip[0]))
    # Legs are already authored in the original step phase. Remove the old upper
    # body from the arm-free torso layer, not from the composite containing hands.
    lower = a.BODY_IMAGES[frame['torso']].copy()
    lower.paste((0,0,0,0), (0, 0, 512, round(hip[1]+10)))
    upper = a.run.place(UPPER, src_hip, hip, angle, a.SIZE)
    lower.alpha_composite(upper)
    for name in a.CFG['bodyPointNames'][:5]:
        pts[name] = a.run.turn(DONOR_POINTS[name], src_hip, hip, angle)
    shift = [pts['neck'][i]-old_neck[i] for i in range(2)]
    for side in ('main', 'off'):
        for joint in ('Shoulder', 'Elbow', 'Palm'):
            name = side+joint
            pts[name] = [pts[name][i]+shift[i] for i in range(2)]
    frame['torso'] = a.register(key+'-torso', lower)
    picture, pts = a.joint_parts(lower, pts)
    frame['body'] = a.register(key, picture)
    frame['points'] = pts
    frame['sword']['point'] = pts['mainPalm']
    frame['shield']['point'] = pts['offPalm']
    return frame


def authored(branch, index, progress, recovering=False):
    frame = v2.powered(branch, index, progress, recovering)
    if recovering:
        # The old candidate copied a source arm, but drove its sword from a
        # different hand path. Render the actual arm and gear from one solved palm.
        frame['sword']['angle'] = RECOVER['frames'][index]['swordAngle']
        frame['sword']['origin'] = a.WEAPONS[branch][1]['grip']
        frame['points']['mainPalm'] = RECOVER['frames'][index]['main'][:]
        frame['sword']['point'] = frame['points']['mainPalm']
        # As the chest opens back to idle, use the source far shoulder and lower
        # the shield forearm over the entire recovery, not only its final frame.
        shoulder = a.key_sample(a.CFG[branch]['recoverArmKeys'], index)[2]
        upper, fore = a.RIG['parts']['offUpper'], a.RIG['parts']['offForearm']
        amount = a.smooth(progress)
        elbow = a.run.turn(upper['end'], upper['pivot'], shoulder, 8*(1-amount))
        palm = a.run.turn(fore['end'], fore['pivot'], elbow, -92*(1-amount))
        frame['points'].update(offShoulder=shoulder, offElbow=elbow, offPalm=palm)
        frame['shield']['angle'] = a.lerp(v2.POWER['shieldAngle'], RECOVER['idle']['shieldAngle'], amount)
    return stable(frame, f'v3-{branch}-{recovering}-{index}-{progress:.5f}')


def prepared(base, first_attack, amount, key):
    target = copy.deepcopy(first_attack)
    for name in a.CFG['bodyPointNames'][5:]:
        target['points'][name] = base['points'][name]
    frame = original_blend(base, target, amount, key, source_policy='first')
    return stable(frame, key+'-stable')


def blend(first, second, amount, key, source_policy='nearest'):
    frame = original_blend(first, second, amount, key, source_policy)
    if amount <= 0 or amount >= 1:
        return frame
    return stable(frame, key+'-stable')


def idle_frame():
    factor = 512 / RECOVER['idle']['width']
    picture = Image.open(a.ROOT / RECOVER['idle']['source']).convert('RGBA').resize(a.SIZE, Image.Resampling.BICUBIC)
    raw = [[267,45],[258,94],[260,149],[258,197],[258,250],
           [224,347],[211,459],[213,485],[300,347],[303,456],[331,480]]
    pts = a.body_points([[v*factor for v in p] for p in raw])
    for side in ('main', 'off'):
        upper, fore = a.RIG['parts'][side+'Upper'], a.RIG['parts'][side+'Forearm']
        pts[side+'Shoulder'] = [v*factor for v in upper['pivot']]
        pts[side+'Elbow'] = [v*factor for v in upper['end']]
        pts[side+'Palm'] = [v*factor for v in fore['end']]
    return {'body': a.register('idle-real', picture),
            'torso': a.register('idle-torso', a.isolate_torso(picture, pts)), 'points': pts,
            'sword': a.sword_pose(pts['mainPalm'], RECOVER['idle']['swordAngle'], origin=a.WEAPONS['thrust'][1]['grip']),
            'shield': {'point': pts['offPalm'], 'angle': RECOVER['idle']['shieldAngle'], 'behind': False},
            'source': 'idle:0', 'sourceFrame': 0}


def idle_sequence(running, idle):
    sequence = copy.deepcopy(running)
    sequence['exitState'] = 'idle'
    last_attack = authored('thrust', 14, 1)
    for i, record in enumerate(sequence['records']):
        time = record['timeMs']
        if time < sequence['recoverAtMs']:
            continue
        elapsed = time - sequence['recoverAtMs']
        if elapsed >= 500:
            frame = copy.deepcopy(idle)
            phase = '待机：剑盾留在各自手掌'
        else:
            k = min(13, int(elapsed / 500 * 14 + 1e-8))
            frame = authored('thrust', k, elapsed/500, True)
            phase = '收势：双臂与装备同步回收'
            if elapsed < 80:
                frame = blend(last_attack, frame, a.smooth(elapsed/80), f'idle-entry-{elapsed:.5f}')
            elif elapsed >= 340:
                # Final bridge actually targets idle.png, not the low-carry run.
                # One body pose/one pair of palms drives all three layers.
                frame = original_blend(frame, idle, a.smooth((elapsed-340)/160), f'idle-end-{elapsed:.5f}')
                phase = '回待机：掌点与装备共同落位'
        sequence['records'][i] = dict(frame, timeMs=time, phase=phase)
    return sequence


def export_pair(seq, name):
    a.export_gif(seq)
    (OUT/'thrust-transition-both-directions.gif').replace(OUT/f'thrust-{name}-both-directions.gif')
    (OUT/'thrust-transition-contact.png').replace(OUT/f'thrust-{name}-contact.png')


def main():
    a.authored, a.prepared, a.blend = authored, prepared, blend
    idle = idle_frame()
    sequences = []
    for origin in range(8):
        seq = a.sequence('thrust', origin)
        seq['exitState'] = 'run'
        sequences.extend([idle_sequence(seq, idle), seq])
    export_pair(sequences[0], 'idle')
    export_pair(sequences[1], 'run')
    board = Image.new('RGB', (1536, 768), '#1d2228')
    draw = ImageDraw.Draw(board)
    for i, time in enumerate([180,333,780,800,840,900,1400,1560,1740,1800,1880,1900]):
        record = max((r for r in sequences[0]['records'] if r['timeMs'] <= time), key=lambda r:r['timeMs'])
        im = a.paint(record, 'thrust', bones=True).resize((384,213), Image.Resampling.LANCZOS)
        x,y = i%4*384,i//4*256
        board.paste(im,(x,y+25),im)
        draw.text((x+6,y+4),f'{time}ms / 剑=主掌，盾=副掌',font=a.SMALL,fill='#e5b15b')
    board.save(OUT/'thrust-idle-binding-contact.png')
    visible = sorted({r['body'] for seq in sequences for r in seq['records']})
    indices = {old:new for new,old in enumerate(visible)}
    for seq in sequences:
        for record in seq['records']:
            record['body'] = indices[record['body']]
            record.pop('torso', None)
    metadata = {'status':'thrust-v3-candidate-not-in-runtime','config':a.CFG,'power':v2.POWER,
                'bodyPolicy':{'upperDonor':'run:6','scale':1,'motion':'rotation-and-translation',
                              'idleSource':RECOVER['idle']['source']},
                'sourceBodySize':a.SIZE,'canvas':a.CANVAS,'offset':a.OFFSET,
                'weapons':{k:v[1] for k,v in a.WEAPONS.items()},'shieldSize':a.SHIELD_SIZE,
                'shieldOrigin':a.SHIELD_ORIGIN,'sequences':sequences}
    (OUT/'transition-export.json').write_text(json.dumps(metadata,ensure_ascii=False,separators=(',',':'))+'\n',encoding='utf-8')
    payload = dict(metadata,bodies=[a.png_data(a.BODY_IMAGES[i]) for i in visible],
                   weaponImages={k:a.png_data(v[0]) for k,v in a.WEAPONS.items()},shieldImage=a.png_data(a.SHIELD_IMAGE))
    (OUT/'transition-data.js').write_text('window.DASH_TRANSITIONS = '+json.dumps(payload,ensure_ascii=False,separators=(',',':'))+';\n',encoding='utf-8')
    preview = (HERE/'preview.html').read_text(encoding='utf-8')
    preview = preview.replace('力量增强候选 V2','体量与跟手修正 V3')
    preview = preview.replace('<label>点击时跑帧','<label>收势终点 <select id="exit"><option value="idle">待机</option><option value="run">继续奔跑</option></select></label>\n    <label>点击时跑帧')
    preview = preview.replace('<script src="../preview.js">','<script src="preview.js">')
    preview = preview.replace('href="thrust-transition-both-directions.gif"','href="thrust-idle-both-directions.gif"')
    preview = preview.replace('屈肘收剑 → 蹬地送肩 → 刺出定势','稳定躯干体量 → 突击 → 剑盾跟手回待机')
    preview = preview.replace('前100ms送肩伸臂，随后80ms小幅回震。','前100ms送肩伸臂，随后80ms小幅回震；突击躯干使用同一切片，只旋转平移。')
    preview = preview.replace('没有改动伤害、位移或命中时窗。','剑盾绑定同一帧的双掌，末160ms可回原idle或回跑。没有改动伤害、位移或命中时窗。')
    (OUT/'preview.html').write_text(preview,encoding='utf-8')
    js = (HERE/'preview.js').read_text(encoding='utf-8')
    js = js.replace("s.branch===el('branch').value&&s.entryRunFrame", "s.exitState===el('exit').value&&s.branch===el('branch').value&&s.entryRunFrame")
    js = js.replace("['branch','origin']", "['branch','origin','exit']")
    (OUT/'preview.js').write_text(js,encoding='utf-8')
    print(f'V3 candidate: {len(visible)} body images, 8 entries x idle/run exits; no runtime body writes.',flush=True)


if __name__ == '__main__':
    main()
