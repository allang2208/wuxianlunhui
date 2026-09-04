"""Derive only this boss's config/budget records from the final sprite manifest."""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
MANIFEST = ROOT / "runtime-build/manifest.json"
manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
actions = {row["state"]: row for row in manifest["actions"]}


def replace_value(text, key, value, indent=2):
    match = re.search(r'(?m)^([ \t]*)"'+re.escape(key)+r'"\s*:\s*', text)
    if not match:
        block = json.dumps({key: value}, ensure_ascii=False, indent=indent)[2:-2]
        end = text.rfind('}')
        return text[:end].rstrip()+',\n'+block+'\n'+text[end:]
    _, length = json.JSONDecoder().raw_decode(text[match.end():])
    encoded = json.dumps(value, ensure_ascii=False, indent=indent)
    encoded = encoded.replace('\n', '\n'+match[1])
    return text[:match.end()]+encoded+text[match.end()+length:]


layouts = {}
for state, rec in actions.items():
    layouts[state] = {k: rec[k] for k in ('frameWidth','frameHeight','frameCount','rows','footY','authoredBodyHeight','frameRate','repeat')}
    layouts[state].update(columns=rec['cols'], duration=rec['durationMs'])
    for key in ('contactFrame','releaseFrame','releaseFrames','exposedStartFrame','exposedEndFrame'):
        if key in rec:
            layouts[state][key] = rec[key]

skills = {
    'stomp': dict(triggerRange=255, forwardOffset=85, radius=190, damageMul=1.65,
                  damageType='physical', knockback=110, crippleMs=1800, cooldown=4200),
    'pipe_blast': dict(minTriggerRange=220, triggerRange=850, initialCooldownMs=1800,
                       impactRadius=115, lateralOffsets=[0,-105,105], leadMs=500,
                       flightMs=850, projectileSize=38, muzzleForward=90, muzzleHeight=155,
                       arcHeight=65, damageMul=0.95, damageType='physical', knockback=45,
                       cooldown=10000),
    'vein_resonance': dict(triggerRange=360, radius=420, initialCooldownMs=6500,
                           damageMul=1.8, damageType='magic', knockback=125,
                           crippleMs=2400, cooldown=13000),
    'pressure_release': dict(attacksPerRelease=3, incomingAttackMul=1.5),
}
for state, skill in skills.items():
    rec = actions[state]
    skill.update(duration=rec['durationMs'], frames=rec['frameCount'])
    for key in ('contactFrame','releaseFrame','releaseFrames','exposedStartFrame','exposedEndFrame'):
        if key in rec:
            skill[key] = rec[key]

idle = actions['idle']
cfg = dict(id='deepVeinMother', name='深脉之母', type='首领', category='monster',
    family='僵尸', families=['僵尸','大型'], rank='boss', poolWhitelistOnly=True,
    color='#785096', highlightColor='rgba(188, 120, 240, 0.42)', size=34,
    collisionRadius=112, height=255, hp=4800, maxHp=4800, speed=105, level=12,
    str=92, dex=18, con=86, int=50, wis=44, luck=10, attackRange=255, attackDistance=255,
    aiInterval=1500, decisionIntervalMs=150, recoveryPauseMs=900,
    attackSkills=skills, death=dict(animMs=actions['dying']['durationMs'],holdMs=1800,fadeMs=400),
    ai=dict(aggroRange=9999,pacingRange=240,loseTimeout=999999,alertRange=9999),
    render=dict(bodyDisplayHeight=300,collisionWidth=224,collisionHeight=255,
                footOffsetY=(idle['footY']-idle['frameHeight']/2)*300/idle['authoredBodyHeight'],
                projectileHitbox=dict(width=224,height=255,offsetX=0,bottom=0),
                capsuleHudAnchor=True,colliderOffsetX=0,colliderOffsetY=0),
    textures={**{k:v['asset'] for k,v in actions.items()},
              'oreFragment':'assets/enemies/deep_vein_mother/ore_fragment.png','frameLayouts':layouts},
    description='高级废弃矿洞尽头的矿压融合体。升降笼、矿工残肢、管道与矿镐不对称嵌入岩体，四条紫晶粗腿支撑主体。三次攻击释放后矿压泄尽，低伏张开核心，进入约三秒易伤窗口。',
    skills=[
        dict(name='矿足重踏',desc='2.4秒单次动作，第24/41帧重踏锁定方向前方85像素处的190半径地面椭圆；物攻×1.65、击退110、致残1.8秒，可招架。冷却4.2秒。'),
        dict(name='高压喷矿',desc='3秒单次动作，第10、18、26/41帧各喷一枚碎矿，飞行0.85秒后落地115半径椭圆爆裂，每发物攻×0.95、击退45。起手锁定预判落点，不追踪，冷却10秒。'),
        dict(name='绞盘震脉',desc='3.2秒单次动作，第20/41帧释放420半径地面椭圆震荡；魔攻×1.8、击退125、致残2.4秒，不可招架。冷却13秒。'),
        dict(name='矿压泄尽',desc='每释放三次攻击动作后低伏6秒，第8至33帧前（49帧）开放核心约3.06秒；承受的输入攻击量×1.5后仍走正常防御与伤害链。期间不攻击、不移动。硬控中断后重新进入泄压，完成后清空矿压。'),
    ], attackType='矿足范围重踏、锁定落点三连喷矿、矿脉范围震荡与泄压易伤')

for relative in ('data/enemy-config.json','public/data/enemy-config.json'):
    path = REPO / relative
    path.write_text(replace_value(path.read_text(encoding='utf-8'), 'deepVeinMother', cfg), encoding='utf-8')

# Replace only the advanced mine bossEncounter value, retaining all other dirty
# content and all beginner/mid-tier waves, rewards, events and encounter pools.
for relative in ('data/dungeon-config.json','public/data/dungeon-config.json'):
    path = REPO / relative
    text = path.read_text(encoding='utf-8')
    start = re.search(r'"abandonedMineDungeon"\s*:\s*', text).end()
    area, length = json.JSONDecoder().raw_decode(text[start:])
    boss = area['bossEncounter']
    boss['monsterComposition'] = {'boss':1,'normal':4}
    boss['waveComposition'] = [{'normal':5},{'normal':5},{'normal':4,'boss':1}]
    if 'deepVeinMother' not in boss['poolKeys']:
        boss['poolKeys'].append('deepVeinMother')
    boss['matchPoolRanks'] = True
    section = replace_value(text[start:start+length], 'bossEncounter', boss, indent=1)
    path.write_text(text[:start]+section+text[start+length:], encoding='utf-8')

# Keep the reusable mineral image inside this texture family so a boss does not
# pull in every OreSpider action via the directory-based residency collector.
assetdir = REPO / 'assets/enemies/deep_vein_mother'
shutil.copyfile(REPO/'assets/enemies/ore_spider/projective.png', assetdir/'ore_fragment.png')
manifest['dependencies'] = [dict(textureKey='enemy_deep_vein_mother_ore_fragment',
    path='assets/enemies/deep_vein_mother/ore_fragment.png', derivedFrom='assets/enemies/ore_spider/projective.png')]
manifest['runtimeIntegrationActive'] = True
manifest['runtimeValidated'] = False
MANIFEST.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
budget = dict(version=1,id='deep-vein-mother',profile='boss',sheets=[dict(
    textureKey=r['textureKey'],path=r['asset'],frameWidth=r['frameWidth'],frameHeight=r['frameHeight'],
    frameCount=r['frameCount'],endFrame=r['frameCount']-1,footX=r['frameWidth']/2,footY=r['footY']) for r in actions.values()],dependencies=[])
budget['sheets'].append(dict(textureKey='enemy_deep_vein_mother_ore_fragment',path='assets/enemies/deep_vein_mother/ore_fragment.png',kind='image'))
(ROOT/'runtime-build/sprite-budget-manifest.json').write_text(json.dumps(budget,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

for path, prefix in ((ROOT/'task-index.json',''), (ROOT.parent/'task-index.json','animations/')):
    index = json.loads(path.read_text(encoding='utf-8'))
    index.update(assetOnly=False, runtimeIntegrationActive=True, runtimeValidated=False,
                 status='integrated-awaiting-user-runtime-test',
                 runtimeAuthorization='用户：注意大小统一、优化插帧、接入游戏，作为废弃矿洞boss，参考其他同类型怪物设计数值，完善动作状态机。',
                 sourceSpriteManifest=prefix+'runtime-build/manifest.json',
                 spriteManifest=prefix+'runtime-build/manifest.json',
                 spriteOverview=prefix+'runtime-build/previews/runtime-overview.gif',
                 spriteDeliveryDocument=prefix+'INTEGRATION.md')
    if path.parent == ROOT:
        index['spritesheetStage'] = 'runtime-optimized-integrated-awaiting-user-test'
    else:
        index['scope'] = 'Approved v03 mother and seven source videos preserved. Optimized 299-frame runtime export and advanced abandoned-mine boss integration implemented; no runtime tests run.'
    path.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print('Installed DeepVeinMother config, advanced mine final wave and family manifest; no runtime checks run.')
