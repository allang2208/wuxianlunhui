"""Produce isolated run/dash transition candidates. No game, tests or runtime writes.

Source pixels and equipment remain separate. Meshes author short pose bridges;
the original attack sheets and their sword trajectories are read-only inputs.
"""
from __future__ import annotations
import base64
import copy
import importlib.util
import io
import json
import math
import re
from pathlib import Path
import numpy as np
from PIL import Image, ImageChops, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
BASE = HERE.parent
ROOT = BASE.parents[2]
spec = importlib.util.spec_from_file_location('run_author', BASE / 'build.py')
run = importlib.util.module_from_spec(spec)
spec.loader.exec_module(run)
CFG = json.loads((HERE / 'transition-config.json').read_text(encoding='utf-8'))
RIG = json.loads((BASE / 'rig-export.json').read_text(encoding='utf-8'))
WAC = json.loads((ROOT / 'data/weapon-anim-config.json').read_text(encoding='utf-8'))['sword']
ANIMS = json.loads((ROOT / 'data/player-anim-config.json').read_text(encoding='utf-8'))
SKILLS = json.loads((ROOT / 'data/skills.json').read_text(encoding='utf-8'))
SIZE = (512, 512)
CANVAS = (1152, 640)
OFFSET = (272, 44)
SOURCE_SCALE = 512 / RIG['equipment']['playerDisplaySize']
FONT = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 19)
SMALL = ImageFont.truetype('C:/Windows/Fonts/msyh.ttc', 15)
PARTS = {k: Image.open(BASE / v['file']).convert('RGBA') for k, v in RIG['parts'].items()}
BODY_IMAGES = []
BODY_KEYS = {}
NATIVE = {}
PARTS_WRITTEN = set()


def clamp(t):
    return min(1, max(0, t))


def smooth(t):
    t = clamp(t)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    if isinstance(a, (tuple, list)):
        return [lerp(x, y, t) for x, y in zip(a, b)]
    return a + (b - a) * t


def key_sample(keys, frame):
    indices = sorted(int(k) for k in keys)
    lo = max((k for k in indices if k <= frame), default=indices[0])
    hi = min((k for k in indices if k >= frame), default=indices[-1])
    return copy.deepcopy(keys[str(lo)]) if lo == hi else lerp(keys[str(lo)], keys[str(hi)], (frame - lo) / (hi - lo))


def register(key, picture):
    if key not in BODY_KEYS:
        BODY_KEYS[key] = len(BODY_IMAGES)
        BODY_IMAGES.append(picture)
    return BODY_KEYS[key]


def shader_track(name):
    # Read the current JS literal table as source data; do not execute game modules.
    source = (ROOT / 'src/config/player-shield-poses.js').read_text(encoding='utf-8')
    block = re.search(rf'const {name} = poseTrack\([^\n]+\[([\s\S]*?)\n\]', source).group(1)
    block = re.sub(r'//[^\n]*', '', block)
    return json.loads('[' + block.rstrip().rstrip(',') + ']')


SHIELD_TRACKS = {'slash': shader_track('dashAttack'), 'thrust': shader_track('dashAttackThrust'),
                 'slash-recover': shader_track('dashRecover'), 'thrust-recover': shader_track('dashRecoverThrust')}


def png_data(image):
    out = io.BytesIO()
    image.save(out, 'PNG')
    return 'data:image/png;base64,' + base64.b64encode(out.getvalue()).decode('ascii')


def weapon_image(branch):
    ident = CFG[branch]['weapon']
    data = next(x for x in RIG['resolvedWeapons'] if x['id'] == ident)
    return Image.open(ROOT / data['path']).convert('RGBA'), data


WEAPONS = {name: weapon_image(name) for name in ('slash', 'thrust')}
SHIELD_IMAGE = Image.open(ROOT / RIG['sources']['shield']).convert('RGBA')
SHIELD_SIZE = RIG['resolvedShield']['sourceSize']
SHIELD_ORIGIN = RIG['resolvedShield']['grip']


def sword_pose(grip, angle, scale=1.5, stretch=(1, 1), origin=None):
    h = RIG['equipment']['weaponBaseSize'] * RIG['equipment']['meleeScale'] * scale * SOURCE_SCALE
    return {'point': list(grip), 'angle': angle, 'size': [h * 0.63 * stretch[0], h * stretch[1]],
            'origin': list(origin or [0.5, 0.5 + WAC['gripOffset'] * SOURCE_SCALE / h])}


def track_pose(branch, progress):
    # Same discrete grip vs continuous legacy-center rules as WeaponTransform.
    frames = WAC['dashThrust' if branch == 'thrust' else 'dash']['frames']
    if branch == 'thrust':
        raw = clamp(progress) * len(frames)
        k = min(len(frames) - 1, int(raw))
        f = dict(frames[k])
        other = frames[min(k + 1, len(frames) - 1)]
        f['rotation'] = lerp(f['rotation'], other['rotation'], raw - k)
        grip = [256 + f['offsetX'] * SOURCE_SCALE, 256 + f['offsetY'] * SOURCE_SCALE]
        angle = f['rotation']
    else:
        raw = clamp(progress) * (len(frames) - 1)
        k, u = min(len(frames) - 1, int(raw)), raw % 1
        first, second = frames[k], frames[min(k + 1, len(frames) - 1)]
        f = {key: lerp(first.get(key, default), second.get(key, default), u)
             for key, default in [('offsetX', 0), ('offsetY', 0), ('rotation', 0), ('scale', 1), ('stretchX', 1), ('stretchY', 1)]}
        rad = math.radians(f['rotation'])
        grip = [256 + (f['offsetX'] - WAC['gripOffset'] * math.sin(rad)) * SOURCE_SCALE,
                256 + (f['offsetY'] + WAC['gripOffset'] * math.cos(rad)) * SOURCE_SCALE]
        angle = lerp(WAC['dashHand']['fromRotation'], WAC['dashHand']['toRotation'], clamp(progress))
    return sword_pose(grip, angle, f.get('scale', 1), (f.get('stretchX', 1), f.get('stretchY', 1)))


def body_points(values):
    return dict(zip(CFG['bodyPointNames'], copy.deepcopy(values)))


def off_arm(picture, shoulder, upper_angle, fore_angle):
    upper, fore = RIG['parts']['offUpper'], RIG['parts']['offForearm']
    elbow = run.turn(upper['end'], upper['pivot'], shoulder, upper_angle)
    palm = run.turn(fore['end'], fore['pivot'], elbow, fore_angle)
    out = Image.new('RGBA', SIZE)
    out.alpha_composite(run.place(PARTS['offUpper'], upper['localPivot'], shoulder, upper_angle, SIZE))
    out.alpha_composite(picture)
    out.alpha_composite(run.place(PARTS['offForearm'], fore['localPivot'], elbow, fore_angle, SIZE))
    return out, elbow, palm


def isolate_torso(frame, pts):
    # Keep the source head, ribs, pelvis and legs. Old arms outside the torso are removed.
    neck, chest, waist, hip = (pts[key] for key in ('neck', 'chest', 'waist', 'hip'))
    polygon = [(neck[0] - 43, 0), (neck[0] + 50, 0), (neck[0] + 39, neck[1]),
               (chest[0] + 33, chest[1]), (waist[0] + 17, waist[1]), (hip[0] + 39, hip[1] + 11),
               (512, hip[1] + 24), (512, 512), (0, 512), (0, hip[1] + 24),
               (hip[0] - 37, hip[1] + 11), (waist[0] - 20, waist[1]),
               (chest[0] - 31, chest[1]), (neck[0] - 35, neck[1])]
    return run.cut(frame, run.mask_polygon(SIZE, polygon))


def original_main(frame, shoulder, elbow, palm):
    mask = Image.new('L', SIZE)
    draw = ImageDraw.Draw(mask)
    draw.line([tuple(shoulder), tuple(elbow), tuple(palm)], fill=255, width=23, joint='curve')
    for point, radius in [(shoulder, 14), (elbow, 14), (palm, 24)]:
        x, y = point
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=255)
    return run.cut(frame, mask)


def source_frame(anim, index):
    key = (anim, index)
    if key not in NATIVE:
        definition = ANIMS[anim]
        source = Image.open(ROOT / definition['src']).convert('RGBA')
        w, h, cols = definition['frameWidth'], definition['frameHeight'], definition['cols']
        x, y = index % cols * w, index // cols * h
        picture = source.crop((x, y, x + w, y + h))
        # Phaser displays both 512x512 and 512x516 frame grids in a 144px square.
        if picture.size != SIZE:
            picture = picture.resize(SIZE, Image.Resampling.BICUBIC)
        NATIVE[key] = picture
    return NATIVE[key]


def run_frame(index, branch):
    pose = RIG['poses'][index]
    body = Image.open(BASE / RIG['bodyFiles'][index]).convert('RGBA')
    picture = run.render(RIG, pose, body, PARTS, None, None, False).crop((128, 12, 640, 524))
    joints = run.joint_points(RIG, pose)
    points = body_points(CFG['runBodyPoints'][index])
    for side in ('main', 'off'):
        points.update({side + name.title(): joints[side][name] for name in ('shoulder', 'elbow', 'palm')})
    return {'body': register(f'run-{index}', picture), 'torso': register(f'run-torso-{index}', body), 'points': points,
            'sword': sword_pose(points['mainPalm'], pose['swordAngle'], origin=WEAPONS[branch][1]['grip']),
            'shield': {'point': points['offPalm'], 'angle': pose['shieldAngle'], 'behind': False},
            'source': f'run:{index}', 'sourceFrame': index}


def authored(branch, index, progress, recovering=False):
    config = CFG[branch]
    anim = config['recoverAnim' if recovering else 'anim']
    picture = source_frame(anim, index)
    factor_y = 512 / ANIMS[anim]['frameHeight']
    pts = body_points(key_sample(config['recoverBodyKeys' if recovering else 'bodyKeys'], index))
    arms = key_sample(config['recoverArmKeys' if recovering else 'armKeys'], index)
    for point in list(pts.values()) + arms:
        point[1] *= factor_y
    main_shoulder, main_elbow, off_shoulder, off_elbow = arms
    if recovering:
        main_palm = list(config['recoverMain'][index])
        angle = lerp(track_pose(branch, 1)['angle'], RIG['poses'][0]['swordAngle'], smooth(progress))
        sword = sword_pose(main_palm, angle, origin=WEAPONS[branch][1]['grip'])
    else:
        sword = track_pose(branch, progress)
        main_palm = sword['point']
    shield_source = SHIELD_TRACKS[branch + ('-recover' if recovering else '')][index]
    off_palm = [shield_source[0], shield_source[1] * factor_y]
    behind = len(shield_source) > 3 and bool(shield_source[3])
    shield_angle = shield_source[2]
    if branch == 'thrust':
        clean = isolate_torso(picture, pts)
        main = original_main(picture, main_shoulder, main_elbow, main_palm)
        clean.alpha_composite(main)
        off_shoulder = [pts['neck'][0] + config['offShoulderDelta'][0], pts['neck'][1] + config['offShoulderDelta'][1]]
        picture, off_elbow, off_palm = off_arm(clean, off_shoulder, config['offUpper'], config['offForearm'])
        shield_angle, behind = config['shieldAngle'], False
        out_dir = HERE / 'parts'
        out_dir.mkdir(exist_ok=True)
        # Reusable body / authored main arm; shield arm uses the parent's independent cutouts.
        if (anim, index) not in PARTS_WRITTEN:
            isolate_torso(source_frame(anim, index), pts).save(out_dir / f'{anim}-body-{index:02d}.png')
            main.save(out_dir / f'{anim}-main-{index:02d}.png')
            PARTS_WRITTEN.add((anim, index))
    pts.update({'mainShoulder': main_shoulder, 'mainElbow': main_elbow, 'mainPalm': main_palm,
                'offShoulder': off_shoulder, 'offElbow': off_elbow, 'offPalm': off_palm})
    torso = isolate_torso(source_frame(anim, index), pts)
    return {'body': register(f'{anim}-{index}', picture), 'torso': register(f'{anim}-torso-{index}', torso), 'points': pts, 'sword': sword,
            'shield': {'point': off_palm, 'angle': shield_angle, 'behind': behind},
            'source': f'{anim}:{index}', 'sourceFrame': index}


def warp(picture, source, target):
    """Inverse thin-plate mesh: joint landmarks move together, with fixed image bounds."""
    keys = list(source)
    src = np.array([source[k] for k in keys] + [[0,0],[512,0],[512,512],[0,512]], dtype=float) / 512
    dst = np.array([target[k] for k in keys] + [[0,0],[512,0],[512,512],[0,512]], dtype=float) / 512
    if np.max(np.abs(src - dst)) < 1e-7:
        return picture.copy()
    def basis(points, centers):
        r2 = ((points[:,None,:] - centers[None,:,:]) ** 2).sum(axis=2)
        return r2 * np.log(np.maximum(r2, 1e-12))
    count = len(dst)
    p = np.column_stack((np.ones(count), dst))
    matrix = np.block([[basis(dst, dst) + np.eye(count) * 1e-8, p], [p.T, np.zeros((3,3))]])
    coefficients = np.linalg.solve(matrix, np.vstack((src, np.zeros((3,2)))))
    grid = np.arange(0, 513, 16)
    xx, yy = np.meshgrid(grid, grid)
    queries = np.column_stack((xx.ravel(), yy.ravel())) / 512
    mapped = np.column_stack((basis(queries, dst), np.ones(len(queries)), queries)) @ coefficients * 512
    mapped = mapped.reshape(len(grid), len(grid), 2)
    mesh = []
    for j in range(len(grid) - 1):
        for i in range(len(grid) - 1):
            quad = np.array([mapped[j,i], mapped[j+1,i], mapped[j+1,i+1], mapped[j,i+1]]).ravel()
            mesh.append(((int(grid[i]), int(grid[j]), int(grid[i+1]), int(grid[j+1])), tuple(quad)))
    return picture.transform(SIZE, Image.Transform.MESH, mesh, Image.Resampling.BICUBIC)


def joint_parts(torso, point_data):
    """Rotate separate arm pixels, never deform an arm through the head/torso mesh."""
    points = copy.deepcopy(point_data)
    layers = {}
    for side in ('main','off'):
        upper, fore = RIG['parts'][side+'Upper'], RIG['parts'][side+'Forearm']
        root = np.array(points[side+'Shoulder'], dtype=float)
        goal = np.array(points[side+'Palm'], dtype=float)
        hint = np.array(points[side+'Elbow'], dtype=float)
        a = np.array(upper['end']) - np.array(upper['pivot'])
        b = np.array(fore['end']) - np.array(fore['pivot'])
        la, lb = float(np.linalg.norm(a)), float(np.linalg.norm(b))
        direction = goal - root
        distance = float(np.linalg.norm(direction))
        if distance < 0.001:
            direction, distance = np.array([0.,1.]), 1.
        direction /= distance
        # No elastic bone stretch. Any reach correction is shared by the equipment.
        reach = min(la+lb-0.01, max(abs(la-lb)+0.01, distance))
        goal = root + direction * reach
        along = (la*la - lb*lb + reach*reach) / (2*reach)
        height = math.sqrt(max(0, la*la - along*along))
        normal = np.array([-direction[1],direction[0]])
        c1, c2 = root+direction*along+normal*height, root+direction*along-normal*height
        elbow = c1 if np.linalg.norm(c1-hint) <= np.linalg.norm(c2-hint) else c2
        upper_angle = math.degrees(math.atan2(*(elbow-root)[::-1]) - math.atan2(a[1],a[0]))
        fore_angle = math.degrees(math.atan2(*(goal-elbow)[::-1]) - math.atan2(b[1],b[0]))
        layer = Image.new('RGBA', SIZE)
        layer.alpha_composite(run.place(PARTS[side+'Upper'], upper['localPivot'], root, upper_angle, SIZE))
        layer.alpha_composite(run.place(PARTS[side+'Forearm'], fore['localPivot'], elbow, fore_angle, SIZE))
        layers[side] = layer
        points[side+'Elbow'], points[side+'Palm'] = elbow.tolist(), goal.tolist()
    out = Image.new('RGBA', SIZE)
    out.alpha_composite(layers['off'])
    out.alpha_composite(torso)
    out.alpha_composite(layers['main'])
    # Only off forearm comes in front of the torso, as in the existing run rig.
    off_fore = RIG['parts']['offForearm']
    p, q = points['offElbow'], points['offPalm']
    angle = math.degrees(math.atan2(q[1]-p[1],q[0]-p[0]) - math.atan2(off_fore['end'][1]-off_fore['pivot'][1],off_fore['end'][0]-off_fore['pivot'][0]))
    out.alpha_composite(run.place(PARTS['offForearm'],off_fore['localPivot'],p,angle,SIZE))
    return out, points


def blend(first, second, t, key, source_policy='nearest'):
    t = clamp(t)
    if t == 0:
        return copy.deepcopy(first)
    if t == 1:
        return copy.deepcopy(second)
    points = {k: lerp(first['points'][k], second['points'][k], t) for k in first['points']}
    source = first if source_policy == 'first' or t < 0.5 else second
    body_names = CFG['bodyPointNames']
    picture = warp(BODY_IMAGES[source['torso']], {k:source['points'][k] for k in body_names}, {k:points[k] for k in body_names})
    torso_id = register(key + '-torso', picture)
    picture, points = joint_parts(picture, points)
    sword = {field: lerp(first['sword'][field], second['sword'][field], t) for field in ('point','angle','size','origin')}
    shield = {field: lerp(first['shield'][field], second['shield'][field], t) for field in ('point','angle')}
    shield['behind'] = first['shield']['behind'] if t < 0.5 else second['shield']['behind']
    sword['point'], shield['point'] = points['mainPalm'], points['offPalm']
    return {'body': register(key, picture), 'torso': torso_id, 'points': points, 'sword': sword, 'shield': shield,
            'source': first['source'] + ' → ' + second['source'], 'sourceFrame': second['sourceFrame']}


def prepared(base, first_attack, amount, key):
    target = copy.deepcopy(first_attack)
    # Keep the current running knee/foot phase. Torso and hip compress into the thrust stance.
    for name in CFG['bodyPointNames'][5:]:
        target['points'][name] = base['points'][name]
    # Retarget the existing run pixels, not a predicted future click or a frozen lunge leg.
    points = {k:lerp(base['points'][k], target['points'][k], amount) for k in base['points']}
    names = CFG['bodyPointNames']
    torso = warp(BODY_IMAGES[base['torso']], {k:base['points'][k] for k in names}, {k:points[k] for k in names})
    image, points = joint_parts(torso, points)
    target['body'] = register(key + '-ready', image)
    target['torso'] = register(key + '-torso', torso)
    target['points'] = points
    target['sword'] = {field:lerp(base['sword'][field], first_attack['sword'][field], amount) for field in ('point','angle','size','origin')}
    target['sword']['point'] = points['mainPalm']
    target['shield'] = {'point':points['offPalm'], 'angle':lerp(base['shield']['angle'], first_attack['shield']['angle'],amount), 'behind':False}
    return target


def choose_return_phase(frame, branch):
    names = ('rearKnee','rearAnkle','frontKnee','frontAnkle')
    return min(range(8), key=lambda k: sum(math.dist(frame['points'][name], CFG['runBodyPoints'][k][CFG['bodyPointNames'].index(name)]) ** 2 for name in names))


def skill_data(skill_id):
    def visit(value):
        if isinstance(value, dict):
            if value.get('id') == skill_id and 'effectFormula' in value:
                return value['effectFormula']
            if skill_id in value and isinstance(value[skill_id], dict) and 'effectFormula' in value[skill_id]:
                return value[skill_id]['effectFormula']
            for child in value.values():
                found = visit(child)
                if found:
                    return found
        if isinstance(value, list):
            for child in value:
                found = visit(child)
                if found:
                    return found
        return None
    return visit(SKILLS)


def sequence(branch, origin):
    config = CFG[branch]
    effect = skill_data('dashAttackThrust' if branch == 'thrust' else 'dashAttack')
    total = effect['totalMs']
    count = ANIMS[config['anim']]['frameCount']
    rec_count = ANIMS[config['recoverAnim']]['frameCount']
    pre_ms, hold, recovery = CFG['previewRunMs'], CFG['slashHoldMs'] if branch == 'slash' else 0, CFG['recoverMs']
    recover_at = pre_ms + total + hold
    return_at = recover_at + recovery
    duration = return_at + CFG['previewReturnRunMs']
    readiness = CFG['readinessBaseMs'] * (1 - (CFG['previewSkillLevel'] - 1) * CFG['readinessLevelReduction'])
    first_attack = authored(branch, 0, 0)
    recover_start = authored(branch, count - 1, 1)
    if branch == 'slash':
        recover_start = authored(branch, 0, 0, True)
        recover_start['sword'] = track_pose(branch, 1)
    last_recover = authored(branch, rec_count - 1, 1, True)
    return_phase = choose_return_phase(last_recover, branch)
    return_pose = run_frame(return_phase, branch)
    times = set(range(0, duration, CFG['sampleMs']))
    times.update(pre_ms + i * total / count for i in range(count))
    times.update(recover_at + i * recovery / rec_count for i in range(rec_count))
    times.update([pre_ms, recover_at, return_at])
    if branch == 'thrust':
        times.update([max(0, readiness - CFG['thrustPrepareMs']), readiness])
    records = []
    # The last displayed running frame is selected by the user; no restart at frame zero.
    entry_run = run_frame(origin, branch)
    if branch == 'thrust':
        entry_run = prepared(entry_run, first_attack, 1, f'ready-entry-{origin}')
    for time in sorted(times):
        if time < pre_ms:
            k = (origin - 7 + int(time / 100)) % 8
            frame = run_frame(k, branch)
            phase = '低持奔跑'
            if branch == 'thrust':
                amount = smooth((time - (readiness - CFG['thrustPrepareMs'])) / CFG['thrustPrepareMs'])
                if amount > 0:
                    frame = prepared(frame, first_attack, amount, f'prepare-{k}-{round(amount,5)}')
                    phase = '奔跑中预备' if amount < 1 else '已就绪，腿部继续跑'
        elif time < pre_ms + total:
            elapsed = time - pre_ms
            progress = clamp(elapsed / total)
            k = min(count - 1, int(progress * count + 1e-8))
            frame = authored(branch, k, progress)
            phase = '原冲刺劈砍' if branch == 'slash' else '原零前摇突击'
            if branch == 'slash' and elapsed < CFG['slashEntryMs']:
                frame = blend(entry_run, frame, smooth(elapsed / CFG['slashEntryMs']), f'slash-entry-{origin}-{elapsed:.4f}')
                phase = '原起手内衔接'
            elif branch == 'thrust' and elapsed < CFG['thrustLegSettleMs']:
                target_points = copy.deepcopy(frame['points'])
                u = smooth(elapsed / CFG['thrustLegSettleMs'])
                for name in CFG['bodyPointNames'][5:]:
                    target_points[name] = lerp(entry_run['points'][name], frame['points'][name], u)
                picture = warp(BODY_IMAGES[frame['body']], frame['points'], target_points)
                frame['body'] = register(f'thrust-leg-entry-{origin}-{elapsed:.4f}', picture)
                frame['points'] = target_points
                phase = '突击已生效／腿部交接'
        elif time < recover_at:
            frame = copy.deepcopy(recover_start)
            phase = '保留原500ms定格'
        elif time < return_at:
            elapsed = time - recover_at
            progress = clamp(elapsed / recovery)
            k = min(rec_count - 1, int(progress * rec_count + 1e-8))
            frame = authored(branch, k, progress, True)
            phase = '原时长收势'
            if elapsed < CFG['recoverEntryMs']:
                frame = blend(recover_start, frame, smooth(elapsed / CFG['recoverEntryMs']), f'{branch}-recover-entry-{elapsed:.4f}')
                phase = '收势起点连续交接'
            elif elapsed >= recovery - CFG['returnBlendMs']:
                u = smooth((elapsed - recovery + CFG['returnBlendMs']) / CFG['returnBlendMs'])
                frame = blend(frame, return_pose, u, f'{branch}-return-{elapsed:.4f}')
                phase = '收势末段接回跑姿'
        else:
            k = (return_phase + int((time - return_at) / 100)) % 8
            frame = run_frame(k, branch)
            phase = f'恢复奔跑／从帧{return_phase}接入'
        records.append(dict(frame, timeMs=round(time, 5), phase=phase))
    return {'branch': branch, 'entryRunFrame': origin, 'returnRunFrame': return_phase,
            'durationMs': duration, 'attackAtMs': pre_ms, 'attackMs': total, 'holdMs': hold,
            'recoverAtMs': recover_at, 'recoverMs': recovery, 'returnAtMs': return_at,
            'addedAttackDelayMs': 0, 'records': records}


def paint(record, branch, bones=False):
    canvas = Image.new('RGBA', CANVAS)
    def equipment(image, pose, size, origin):
        rounded = [round(x) for x in size]
        scaled = image.resize(tuple(rounded), Image.Resampling.LANCZOS)
        pivot = [rounded[i] * origin[i] for i in range(2)]
        root = [record[pose]['point'][i] + OFFSET[i] for i in range(2)]
        canvas.alpha_composite(run.place(scaled, pivot, root, record[pose]['angle'], CANVAS))
    if record['shield']['behind']:
        equipment(SHIELD_IMAGE, 'shield', SHIELD_SIZE, SHIELD_ORIGIN)
    body = BODY_IMAGES[record['body']]
    canvas.alpha_composite(body, OFFSET)
    sword = record['sword']
    equipment(WEAPONS[branch][0], 'sword', sword['size'], sword['origin'])
    # Source hand pixels share the body mesh. This small overlay covers the hilt.
    hand_mask = Image.new('L', SIZE)
    hx, hy = record['points']['mainPalm']
    ImageDraw.Draw(hand_mask).ellipse((hx-14,hy-16,hx+14,hy+16), fill=255)
    canvas.alpha_composite(run.cut(body, hand_mask), OFFSET)
    if not record['shield']['behind']:
        equipment(SHIELD_IMAGE, 'shield', SHIELD_SIZE, SHIELD_ORIGIN)
    if bones:
        draw = ImageDraw.Draw(canvas)
        for side, color in [('main','#e5b15b'), ('off','#65c9c4')]:
            pts = [tuple(record['points'][side + joint][i] + OFFSET[i] for i in range(2)) for joint in ('Shoulder','Elbow','Palm')]
            draw.line(pts, fill=color, width=3)
            for x,y in pts:
                draw.ellipse((x-4,y-4,x+4,y+4), fill=color)
    return canvas


def export_gif(sequence_data):
    branch = sequence_data['branch']
    # GIF is 10ms quantized; group timestamp collisions so total duration stays unchanged.
    samples = {}
    for record in sequence_data['records']:
        samples[round(record['timeMs'] / 10) * 10] = record
    times = sorted(samples)
    frames, durations = [], []
    for i, time in enumerate(times):
        record = samples[time]
        image = paint(record, branch).resize((576,320), Image.Resampling.LANCZOS)
        board = Image.new('RGB', (1152, 386), '#1d2228')
        board.paste(image, (0, 45), image)
        flipped = image.transpose(Image.Transpose.FLIP_LEFT_RIGHT)
        board.paste(flipped, (576,45), flipped)
        draw = ImageDraw.Draw(board)
        name = '普通冲刺衔接' if branch == 'slash' else '冲刺突击衔接'
        draw.text((16,7), name + ' / 双朝向 / 离线候选', font=FONT, fill='#e5b15b')
        draw.text((16,365), f'{record["phase"]}  |  {time}ms  |  起跑帧{sequence_data["entryRunFrame"]}', font=SMALL, fill='#b5c2cc')
        draw.line((16,40,16 + (1120*time/sequence_data['durationMs']),40), fill='#65c9c4', width=3)
        frames.append(board)
        durations.append((times[i+1] if i+1 < len(times) else sequence_data['durationMs']) - time)
    frames[0].save(HERE / f'{branch}-transition-both-directions.gif', save_all=True,
                   append_images=frames[1:], duration=durations, loop=0, disposal=2)
    key_times = ([213,300,333,780,800,840,1040,1400,1560,1740,1840,1900]
                 if branch == 'thrust' else [780,800,840,880,920,1450,1600,2099,2100,2440,2500,2600])
    contact = Image.new('RGB', (1536, 768), '#1d2228')
    draw = ImageDraw.Draw(contact)
    for i, time in enumerate(key_times):
        record = max((r for r in sequence_data['records'] if r['timeMs'] <= time), key=lambda r:r['timeMs'])
        im = paint(record, branch).resize((384,213), Image.Resampling.LANCZOS)
        x, y = i % 4 * 384, i // 4 * 256
        contact.paste(im, (x,y+25), im)
        draw.text((x+6,y+4), f'{time}ms / {record["phase"]}', font=SMALL, fill='#e5b15b')
    contact.save(HERE / f'{branch}-transition-contact.png')


def main():
    sequences = []
    # The approved ordinary slash is the only payload published here. Thrust
    # candidates are rebuilt separately by build_thrust_refined.py.
    for branch in ('slash',):
        for origin in range(8):
            sequences.append(sequence(branch, origin))
        print(f'Authored {branch}: eight entry phases, shared attack/recovery timing.', flush=True)
        export_gif(next(s for s in sequences if s['branch'] == branch and s['entryRunFrame'] == 0))
    # The viewer needs displayed composites, not duplicate intermediate torso work images.
    visible = sorted({record['body'] for seq in sequences for record in seq['records']})
    packed_indices = {old:new for new,old in enumerate(visible)}
    for seq in sequences:
        for record in seq['records']:
            record['body'] = packed_indices[record['body']]
            record.pop('torso', None)
    metadata = {'status': 'approved-slash-source', 'config': CFG, 'sourceBodySize': SIZE, 'canvas': CANVAS,
                'offset': OFFSET, 'weapons': {'slash': WEAPONS['slash'][1]},
                'shieldSize': SHIELD_SIZE, 'shieldOrigin': SHIELD_ORIGIN, 'sequences': sequences}
    (HERE / 'transition-export.json').write_text(json.dumps(metadata, ensure_ascii=False, separators=(',',':')) + '\n', encoding='utf-8')
    payload = dict(metadata, bodies=[png_data(BODY_IMAGES[index]) for index in visible],
                   weaponImages={'slash': png_data(WEAPONS['slash'][0])}, shieldImage=png_data(SHIELD_IMAGE))
    (HERE / 'transition-data.js').write_text('window.DASH_TRANSITIONS = ' + json.dumps(payload, ensure_ascii=False, separators=(',',':')) + ';\n', encoding='utf-8')
    print(f'Exported {len(visible)} visible body images and 8 approved slash sequences. No runtime files written.', flush=True)


if __name__ == '__main__':
    main()
