"""Prepare the accepted attack import; apply only with an explicit budget exception.

Copies the approved PNG verbatim. Does not generate, interpolate, test or run the game.
Only the foreman attack values in the two enemy configs are patched; walk is untouched.
"""
from pathlib import Path
import argparse
import difflib
import json
import shutil
import struct

ROOT = Path(__file__).resolve().parent
GAME = ROOT.parents[2]
ASSET = 'assets/enemies/foreman_zombie/attacking_h3.png'
MANIFEST = ROOT / 'attack-v04-sheet-manifest.json'
CONFIGS = ('data/enemy-config.json', 'public/data/enemy-config.json')


def read_json(path):
    return json.loads(path.read_text(encoding='utf-8'))


def save_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def value_span(text, keys, start=0):
    """Find a JSON value without reformatting unrelated concurrent edits."""
    decoder = json.JSONDecoder()
    while text[start].isspace():
        start += 1
    if not keys:
        return start, decoder.raw_decode(text, start)[1]
    array = text[start] == '['
    pos, index = start + 1, 0
    while True:
        while text[pos].isspace() or text[pos] == ',':
            pos += 1
        if text[pos] in '}]':
            raise KeyError(keys)
        key = index
        if not array:
            key, pos = decoder.raw_decode(text, pos)
            while text[pos].isspace() or text[pos] == ':':
                pos += 1
        if key == keys[0]:
            return value_span(text, keys[1:], pos)
        _, pos = decoder.raw_decode(text, pos)
        index += 1


def patch_value(text, keys, value):
    start, end = value_span(text, keys)
    line = text[text.rfind('\n', 0, start) + 1:start]
    indent = line[:len(line) - len(line.lstrip())]
    newline = '\r\n' if '\r\n' in text else '\n'
    encoded = json.dumps(value, ensure_ascii=False, indent=2).replace('\n', newline + indent)
    return text[:start] + encoded + text[end:]


def patch_config(text, layout, hit_frame, sound_frame):
    prefix = ['foremanZombie']
    changes = [
        (['textures', 'attack'], ASSET),
        (['textures', 'frameLayouts', 'attack'], layout),
        (['attackSkills', 'whip', 'frames'], layout['frameCount']),
        (['attackSkills', 'whip', 'hitFrame'], hit_frame),
        (['sounds', 'whipFrame'], sound_frame),
    ]
    foreman = json.loads(text)['foremanZombie']
    for index, skill in enumerate(foreman.get('skills', [])):
        if skill.get('name') == '鞭击':
            changes.append((['skills', index, 'desc'],
                '锁定方向的单目标鞭击，射程320px、宽26px；1.5秒39帧，第21帧（从0计，约596ms）命中，'
                '物理攻击×2并附加1层流血（每层每秒1%当前生命值，持续10s，可叠加，到期减一层）；'
                '冷却4.5秒，攻击时不可移动，目标离开或被墙隔断则空挥。'))
    for keys, value in changes:
        text = patch_value(text, prefix + keys, value)
    if 'attackWhipMode' in foreman['textures']:
        return patch_value(text, prefix + ['textures', 'attackWhipMode'], 'baked')
    # Insert next to attack without serializing the whole textures object.
    _, end = value_span(text, prefix + ['textures', 'attack'])
    newline = '\r\n' if '\r\n' in text else '\n'
    return text[:end] + ',' + newline + '      "attackWhipMode": "baked"' + text[end:]


def png_size(path):
    with path.open('rb') as source:
        header = source.read(24)
    if header[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError(f'Not a PNG: {path}')
    return struct.unpack('>II', header[16:24])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply-runtime', action='store_true')
    parser.add_argument('--budget-exception-note', help='Record the user approval verbatim; never invent approval.')
    args = parser.parse_args()
    manifest = read_json(MANIFEST)
    config = read_json(GAME / CONFIGS[0])
    source = ROOT / manifest['sheet']
    count = manifest['finalFrameCount']
    layout = {key: manifest[key] for key in ('frameWidth', 'frameHeight', 'footX', 'footY')}
    layout.update(frameCount=count, endFrame=count - 1, cols=manifest['finalCols'],
                  rows=manifest['finalRows'], duration=manifest['durationMs'],
                  frameDurations=manifest['frameDurations'], repeat=0)
    active = config['foremanZombie']['textures']['attack'] == ASSET
    hit_frame, sound_frame = 21, 8
    budget_dir = ROOT / 'budget'
    relative_budget = budget_dir.relative_to(GAME).as_posix()
    current_foreman = config['foremanZombie']
    sheets = []
    for state in ('idle', 'walk', 'attack', 'howl', 'death'):
        entry_layout = layout if state == 'attack' else current_foreman['textures']['frameLayouts'][state]
        path = (ASSET if active or args.apply_runtime else source.relative_to(GAME).as_posix()) if state == 'attack' else current_foreman['textures'][state]
        sheets.append(dict(textureKey=f'enemy_foreman_{state}', path=path, **entry_layout))
    budgets = {'foremanZombie': dict(version=1, id='foremanZombie', profile='boss', sheets=sheets,
                                   dependencies=[f'{relative_budget}/mineCave.json'])}
    budgets['mineCave'] = dict(version=1, id='mineCave', profile='crowd',
        sheets=[dict(textureKey='enemy_mine_cave', path=config['mineCave']['textures']['idle'], kind='image')],
        dependencies=[f'{relative_budget}/{name}.json' for name in ('minerZombie', 'lanternMinerZombie')])
    for name, key_prefix, counts in (
        ('minerZombie', 'enemy_miner_zombie', dict(idle=1, walk=14, attack=24, death=13)),
        ('lanternMinerZombie', 'enemy_lantern_miner', dict(idle=1, walk=18, attack=30, attack2=22, death=15)),
    ):
        render = config[name]['render']
        foot_y = 256 + (render['footOffsetY'] + render.get('colliderOffsetY', 0)) * 512 / render['spriteSize']
        dep_sheets = [dict(textureKey=f'{key_prefix}_{state}', path=config[name]['textures'][state],
            frameWidth=512, frameHeight=512, frameCount=frames, endFrame=frames - 1,
            footX=256, footY=foot_y, anchorSource='Existing render footOffsetY; not newly visually calibrated')
            for state, frames in counts.items()]
        if name == 'lanternMinerZombie':
            dep_sheets.append(dict(textureKey='enemy_lantern_miner_projectile', kind='image',
                path='assets/enemies/lantern_miner_zombie/projective.png'))
        budgets[name] = dict(version=1, id=name, profile='crowd', sheets=dep_sheets, dependencies=[])

    inventory = []
    for name, budget in budgets.items():
        for entry in budget['sheets']:
            actual_path = source if entry['textureKey'] == 'enemy_foreman_attack' else GAME / entry['path']
            width, height = png_size(actual_path)
            inventory.append(dict(owner=name, **entry, pngWidth=width, pngHeight=height,
                                  rgbaMiB=width * height * 4 / 1048576))
    direct = sum(row['rgbaMiB'] for row in inventory if row['owner'] == 'foremanZombie')
    total = sum(row['rgbaMiB'] for row in inventory)
    policy = read_json(ROOT.parent / 'character-sprite-standard.json')
    exception = args.budget_exception_note or manifest.get('budgetExceptionApproval')
    over_limit = total > policy['profiles']['boss']['reviewLimitMiB']
    if args.apply_runtime and over_limit and not exception:
        raise SystemExit(f'Import not applied: dependency closure {total:.5f} MiB exceeds boss limit. '
                         'Explicit user budget exception is required. Run without --apply-runtime to prepare.')

    if not args.apply_runtime and not active:
        proposed_diff = []
        for relative in CONFIGS:
            text = (GAME / relative).read_bytes().decode('utf-8')
            replacement = patch_config(text, layout, hit_frame, sound_frame)
            proposed_diff.extend(difflib.unified_diff(text.splitlines(True), replacement.splitlines(True),
                fromfile=f'a/{relative}', tofile=f'b/{relative}'))
        (ROOT / 'planned-config.patch').write_text(''.join(proposed_diff), encoding='utf-8', newline='')

    if args.apply_runtime:
        # Keep all unrelated formatting and edits; read each copy immediately before patching it.
        for relative in CONFIGS:
            path = GAME / relative
            text = path.read_bytes().decode('utf-8')
            replacement = patch_config(text, layout, hit_frame, sound_frame)
            # Parse the serialized output as part of writing valid JSON, not a separate test run.
            json.loads(replacement)
            backup = ROOT / 'before-h3-integration' / relative.replace('enemy-config.json', 'foremanZombie.json')
            if not backup.exists():
                save_json(backup, json.loads(text)['foremanZombie'])
            if not (GAME / ASSET).exists() or relative == CONFIGS[0]:
                shutil.copyfile(source, GAME / ASSET)
            with path.open('r+b') as target:
                target.write(replacement.encode('utf-8'))
                target.truncate()
        active = True

    status = 'runtime_integrated_user_validation_pending' if active else 'accepted_pending_budget_exception'
    manifest.update(status=status, assetApproved=True, assetApproval='可用，按动画标准工作流导入',
                    runtimeIntegrationActive=active, assetOnly=not active)
    manifest.setdefault('productionNotes', manifest.get('notes', []))
    manifest['notes'] = [
        'The user accepted v04. Preserve the final PNG, all 39 frame durations and native midpoint overrides verbatim.',
        'Only the attack is selected; existing 15-frame walk, idle, howl and death remain unchanged.',
        'Runtime activation is recorded by runtimeIntegrationActive; source approval is not runtime acceptance.',
        'See runtimeImport for the contact/sound clock and budget for the full summon dependency overage.',
    ]
    if exception:
        manifest['budgetExceptionApproval'] = exception
    manifest['runtimeImport'] = dict(asset=ASSET, textureKey='enemy_foreman_attack', layout=layout,
        attackWhipMode='baked', hitFrame=hit_frame, hitTimeMs=sum(layout['frameDurations'][:hit_frame]),
        soundFrame=sound_frame, soundTimeMs=sum(layout['frameDurations'][:sound_frame]),
        unchanged=dict(durationMs=1500, cooldownMs=4500, range=320, width=26, damageMul=2, bleedStacks=1),
        movement='Existing walking.png: 15 frames / 1500ms; walk-v01 remains an unapproved candidate',
        supportedArtDirections='right and mirrored left; no eight-direction contact artwork',
        runtimeValidationPerformed=False)
    manifest['budget'] = dict(profile='boss', directMiB=direct, dependencyClosureMiB=total,
        targetMiB=policy['profiles']['boss']['targetMiB'], reviewLimitMiB=policy['profiles']['boss']['reviewLimitMiB'],
        status='exception_approved' if exception else 'over_limit_exception_pending',
        exceptionApproval=exception,
        budgetCheckerRun=False, runtimeMemoryMeasured=False)
    save_json(MANIFEST, manifest)
    for name, budget in budgets.items():
        save_json(budget_dir / f'{name}.json', budget)
    save_json(budget_dir / 'inventory.json', dict(manifest['budget'], importStatus=status, textures=inventory,
        note='Actual PNG dimensions; includes legacy summon textures and dedicated lantern projectile. '
             'Shared core smoke/fire, mipmaps, render targets and driver memory are excluded.'))
    save_json(ROOT / 'runtime-import.json', dict(status=status, assetOnly=not active,
        runtimeIntegrationActive=active, manifest='attack-v04-sheet-manifest.json',
        **manifest['runtimeImport'], budget=manifest['budget']))
    selection = read_json(ROOT / 'attack-impact-selection.json')
    selection.update(status=status, assetApproved=True, runtimeIntegrationActive=active, assetOnly=not active,
                     finalManifest='attack-v04-sheet-manifest.json')
    save_json(ROOT / 'attack-impact-selection.json', selection)
    jobs = read_json(ROOT / 'generation-jobs.json')
    for job in jobs:
        if job['action'] == 'attack-v04':
            job.update(queue='completed', status=status, reason='User accepted the pixels; import follows runtime-import.json')
    save_json(ROOT / 'generation-jobs.json', jobs)
    summaries = read_json(ROOT / 'candidate-summary.json')
    for entry in summaries:
        if entry['action'] == 'attack-v04':
            entry.update(status=status, assetApproved=True, runtimeIntegrationActive=active, assetOnly=not active)
    save_json(ROOT / 'candidate-summary.json', summaries)
    if active:
        old = ROOT.parent / '_foreman_whip_doubao_20260831'
        for filename in ('runtime-manifest.json', 'selection.json'):
            old_manifest = read_json(old / filename)
            old_manifest.update(status='superseded_by_approved_h3_v04', runtimeIntegrationActive=False,
                assetOnly=True, replacedBy='../_foreman_h3_redo_20260831/attack-v04-sheet-manifest.json')
            save_json(old / filename, old_manifest)
    print(json.dumps(dict(status=status, directMiB=direct, dependencyClosureMiB=total), ensure_ascii=False))


if __name__ == '__main__':
    main()
