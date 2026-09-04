"""Import the user-accepted sheets; no regeneration, resampling or game startup."""
import json
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PROJECT = ROOT.parents[2]
UNIT = 'hamster_catapult_crew'
SCALE = 0.675  # ~112px engineer body -> ~75.6 world px; cart excluded from body height.


def write_json(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def main():
    manifest = json.loads((ROOT/'spritesheet-manifest.json').read_text(encoding='utf-8'))
    destination = PROJECT/'assets/companions'/UNIT
    destination.mkdir(parents=True, exist_ok=True)
    animation_map = {'idle': 'idle', 'run': 'walk', 'attack': 'attack', 'die': 'dying'}
    animations = {}
    budget_sheets = []
    for source_kind, key in animation_map.items():
        action = manifest['actions'][source_kind]
        filename = {'walk': 'running.png', 'attack': 'attacking.png', 'dying': 'dying.png'}.get(key, 'idle.png')
        target = destination/filename
        shutil.copyfile(ROOT/action['sheet'], target)
        animations[key] = {
            'src': target.relative_to(PROJECT).as_posix(),
            **{field: action[field] for field in ('frameWidth', 'frameHeight', 'cols', 'rows', 'frameCount', 'footX', 'footY')},
            'frames': [0, action['frameCount'] - 1],
            'frameRate': action['frameCount'] * 1000 / action['durationMs'],
            'frameDurations': action['frameDurationsMs'],
            'durationMs': action['durationMs'],
            'repeat': -1 if action['loop'] else 0,
        }
        budget_sheets.append({'textureKey': f'companion_{UNIT}_{key}',
            'path': animations[key]['src'],
            **{field: action[field] for field in ('frameWidth', 'frameHeight', 'frameCount', 'endFrame', 'footX', 'footY')}})
        action.update(assetOnly=False, runtimeIntegrationActive=True,
            runtimeScale=SCALE, runtimePath=animations[key]['src'])

    projectile = manifest['projectile']
    shutil.copyfile(ROOT/projectile['path'], destination/'stone.png')
    width, height = projectile['size']
    animations['projectile'] = {'src': f'assets/companions/{UNIT}/stone.png',
        'frameWidth': width, 'frameHeight': height, 'cols': 1, 'rows': 1,
        'frameCount': 1, 'frames': [0, 0], 'frameRate': 1, 'repeat': 0}
    budget_sheets.append({'kind': 'image', 'textureKey': f'companion_{UNIT}_projectile',
        'path': animations['projectile']['src']})

    attack = manifest['actions']['attack']
    release_frame = attack['keyEvents']['projectileReleaseOutputFrame']
    attack['keyEvents']['sourceVisualEventOnly'] = False
    part = next(part for part in attack['projectileParts']
                if part['sourceFrame'] == attack['keyEvents']['projectileReleaseSourceFrame'])
    left, top, right, bottom = part['sourceBBox']
    anchor_x, anchor_y = attack['anchorInVideo']
    release_x = ((left + right) / 2 - anchor_x) * attack['sourceScale']
    release_height = (anchor_y - (top + bottom) / 2) * attack['sourceScale']
    idle = animations['idle']
    foot_offset = (idle['footY'] - idle['frameHeight'] / 2) * SCALE
    config = {
        'id': UNIT, 'name': '仓鼠投石组', 'title': '工程师营地一级·双人工程器械',
        'desc': '两名仓鼠工程师操作木制投石机。移动缓慢，石弹按预判落点抛射并造成小范围物理伤害；两名成员共用一组生命与命令。',
        'role': UNIT, 'growthRule': 'ranger', 'avatar': '⚒️', 'weaponType': 'catapult',
        'baseLevel': 1, 'baseExp': 0, 'baseMaxHp': 360,
        'baseData': {'str': 18, 'dex': 12, 'int': 5, 'con': 18, 'wis': 5, 'luck': 5},
        'statFormula': 'enemy', 'groundRadius': 36, 'collisionRadius': 36,
        'bodyHeight': 100, 'size': 96, 'fogVisionProfile': 'military', 'skills': [], 'sounds': {},
        'ai': {'role': 'ranged_artillery', 'walkSpeed': 65, 'runSpeed': 65,
            'attackInterval': 6500, 'attackDamage': 180, 'attackRange': 850, 'minimumRange': 190, 'engageRange': 1050,
            'projectileSpeed': 620, 'arcHeight': 110, 'splashRadius': 72, 'splashFalloff': 0.5,
            'expectedExtraTargets': 1, 'attackReleaseFrame': release_frame,
            'appliesMarkArrow': False, 'followOffset': 200, 'followArriveDist': 48,
            'decisionMs': 160, 'teleportDist': 999999, 'teleportHardDist': 9999999},
        'displaySize': 512*SCALE, 'spriteOffsetY': -foot_offset,
        'render': {'footOffsetY': foot_offset, 'hudOffsetY': 125,
            'collisionWidth': 72, 'collisionHeight': 100, 'corpseHoldMs': 1500,
            'projectileReleaseOffsetX': release_x, 'projectileReleaseHeight': release_height,
            'projectileDisplaySize': width*SCALE, 'projectileTipDirection': 'right'},
        'animations': animations,
    }
    for folder in ('data', 'public/data'):
        write_json(PROJECT/folder/'hamster-catapult-crew-config.json', config)
    manifest.update(assetOnly=False, runtimeIntegrationActive=True,
        status='user_accepted_imported_runtime_untested', runtimeScale=SCALE,
        runtimeConfig='data/hamster-catapult-crew-config.json',
        runtimeNotes=['User accepted four animations and authorized import.',
                      'Runtime consumes original per-frame durations; death remains one-shot.',
                      'Gameplay and visual scale await user testing.'])
    # Imported metadata must not retain the packaging stage's "not implemented" notes.
    manifest['notes'] = list(manifest['runtimeNotes'])
    projectile['gameplayIntegrated'] = True
    projectile['runtimePath'] = animations['projectile']['src']
    write_json(ROOT/'spritesheet-manifest.json', manifest)
    write_json(ROOT/'sprite-budget-manifest.json', {'version': 1, 'id': UNIT,
        'profile': 'crowd', 'runtimeIntegrationActive': True, 'textureKeysAreProposedOnly': False,
        'dependencies': [], 'sheets': budget_sheets})
    index = json.loads((ROOT/'task-index.json').read_text(encoding='utf-8-sig'))
    index.update(status='user_accepted_imported_runtime_untested', assetOnly=False,
        runtimeIntegrationActive=True, runtimeConfig=manifest['runtimeConfig'],
        runtimeNotes=manifest['runtimeNotes'],
        approvalScope='User accepted the four animations and explicitly authorized game import; runtime testing remains pending.',
        acceptance={'date': '2026-08-30', 'userInstruction': '可用，导入游戏', 'runtimeTested': False})
    index['budget']['runtimeScale'] = SCALE
    for source_kind, key in animation_map.items():
        index['actions'][source_kind].update(status='user_accepted_imported_runtime_untested',
            runtimePath=animations[key]['src'])
    write_json(ROOT/'task-index.json', index)
    print('Imported accepted catapult sheets and generated both runtime configs; no tests run.')


if __name__ == '__main__':
    main()
