"""Publish staged animation geometry only; retain live combat/dungeon tuning.

Importing this module has no file-write side effects. No game/test process runs.
"""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
OUT = ROOT / 'runtime-build-v2'
GEOMETRY = ('frameWidth', 'frameHeight', 'frameCount', 'rows', 'footY', 'authoredBodyHeight')
EVENTS = ('contactFrame', 'releaseFrame', 'releaseFrames', 'exposedStartFrame', 'exposedEndFrame')


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, text):
    temp = path.with_name(path.name + '.animation-tmp')
    temp.write_text(text, encoding='utf-8')
    temp.replace(path)


def save(path, data):
    write(path, json.dumps(data, ensure_ascii=False, indent=2) + '\n')


def replace_value(text, key, value):
    match = re.search(r'(?m)^([ \t]*)"' + re.escape(key) + r'"\s*:\s*', text)
    if not match:
        raise RuntimeError(f'Missing existing config block: {key}')
    _, length = json.JSONDecoder().raw_decode(text[match.end():])
    encoded = json.dumps(value, ensure_ascii=False, indent=2).replace('\n', '\n' + match[1])
    return text[:match.end()] + encoded + text[match.end()+length:]


def main():
    manifest = read(OUT / 'manifest.json')
    live = read(REPO / 'data/enemy-config.json')['deepVeinMother']
    for rec in manifest['actions']:
        state = rec['state']
        current = live['textures']['frameLayouts'][state]
        if current['frameCount'] != rec['frameCount']:
            raise RuntimeError(f'Frame count changed; event mapping needs explicit review: {state}')
        if current['duration'] != rec['durationMs']:
            raise RuntimeError(f'Timing changed; rerun build-runtime-sprites.py finish before publishing: {state}')
        if not (OUT / 'sheets' / f'{state}.png').is_file():
            raise FileNotFoundError(state)

    # Read each current config immediately before touching its geometry. Never
    # recreate a whole boss from historical defaults or overwrite encounter waves.
    for relative in ('data/enemy-config.json', 'public/data/enemy-config.json'):
        path = REPO / relative
        text = path.read_text(encoding='utf-8')
        cfg = json.loads(text)['deepVeinMother']
        for rec in manifest['actions']:
            layout = cfg['textures']['frameLayouts'][rec['state']]
            layout.update({key: rec[key] for key in GEOMETRY})
            layout['columns'] = rec['cols']
            layout['frameRate'] = layout['frameCount']*1000/layout['duration']
        idle = cfg['textures']['frameLayouts']['idle']
        cfg['render']['footOffsetY'] = (idle['footY']-idle['frameHeight']/2) * cfg['render']['bodyDisplayHeight']/idle['authoredBodyHeight']
        write(path, replace_value(text, 'deepVeinMother', cfg))

    for rec in manifest['actions']:
        target = REPO / rec['asset']
        temp = target.with_name(target.name + '.animation-tmp')
        shutil.copyfile(OUT / 'sheets' / f"{rec['state']}.png", temp)
        temp.replace(target)
        for key in EVENTS:
            if key in live['attackSkills'].get(rec['state'], {}):
                rec[key] = live['attackSkills'][rec['state']][key]
    manifest.update(runtimeIntegrationActive=True, runtimeValidated=False,
                    installScope='Animation geometry only; live timings, events, combat and dungeon config preserved')
    save(OUT / 'manifest.json', manifest)

    budget = dict(version=2, id='deep-vein-mother', profile='boss', sheets=[dict(
        textureKey=r['textureKey'], path=r['asset'], frameWidth=r['frameWidth'], frameHeight=r['frameHeight'],
        frameCount=r['frameCount'], endFrame=r['frameCount']-1, footX=r['frameWidth']/2, footY=r['footY'])
        for r in manifest['actions']], dependencies=[])
    budget['sheets'].append(dict(textureKey='enemy_deep_vein_mother_ore_fragment',
        path='assets/enemies/deep_vein_mother/ore_fragment.png', kind='image'))
    save(OUT / 'sprite-budget-manifest.json', budget)

    rows = {r['state']: r for r in manifest['actions']}
    for path, prefix in ((ROOT/'task-index.json', ''), (ROOT.parent/'task-index.json', 'animations/')):
        index = read(path)
        index.update(runtimeIntegrationActive=True, runtimeValidated=False,
                     status='animation-optimized-awaiting-user-runtime-test',
                     sourceSpriteManifest=prefix+'runtime-build-v2/manifest.json',
                     spriteManifest=prefix+'runtime-build-v2/manifest.json',
                     spriteOverview=prefix+'runtime-build-v2/previews/runtime-overview.gif',
                     spriteDeliveryDocument=prefix+'INTEGRATION.md')
        for job in index.get('jobs', []):
            if job.get('state') not in rows:
                continue
            row = rows[job['state']]
            job.update(gif=f"runtime-build-v2/previews/{row['state']}.gif",
                       contact=f"runtime-build-v2/previews/{row['state']}-contact.png",
                       spritePreview=f"runtime-build-v2/previews/{row['state']}.gif",
                       spriteFrameCount=row['frameCount'], spriteFrameRate=row['frameRate'],
                       finalSpriteApprovedByUser=False, previewClock='runtime-config-not-source-video')
        if path.parent == ROOT:
            index['spritesheetStage'] = 'runtime-v2-antialiased-320px-awaiting-user-test'
            index['overview'] = 'runtime-build-v2/previews/runtime-overview.gif'
        else:
            index['scope'] = 'Approved v03 mother and seven videos preserved. 299-frame antialiased animation export; frozen/death/fear visual lifecycle repaired. Combat tuning preserved. No runtime tests run.'
        save(path, index)
    print('Published seven animation sheets and geometry only. No combat/dungeon tuning or runtime checks.')


if __name__ == '__main__':
    main()
