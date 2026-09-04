"""Install the accepted Pleat Devourer sheets and its bounded config entries.

Only the named JSON members are replaced; unrelated concurrent config edits and
formatting survive. This is an explicit publication step, not a test runner.
"""
import json
import re
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[3]
SPRITES = ROOT.parent / 'animations-pleat-v03-20260831/sprite-production-v01'
MAPPING = {'idle': 'idle', 'crawling': 'walk', 'attack': 'attack', 'dying': 'death'}
DECODER = json.JSONDecoder()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def write(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')


def member_range(text, start, key):
    """Locate a direct member without matching the same key in nested objects."""
    pos = start + 1
    while True:
        while text[pos].isspace() or text[pos] == ',':
            pos += 1
        if text[pos] == '}':
            return None
        name, pos = DECODER.raw_decode(text, pos)
        while text[pos].isspace() or text[pos] == ':':
            pos += 1
        begin = pos
        _, pos = DECODER.raw_decode(text, pos)
        if name == key:
            return begin, pos


def replace_member(path, keys, value):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        text = stream.read()
    newline = '\r\n' if '\r\n' in text else '\n'
    start = len(text) - len(text.lstrip())
    for key in keys:
        span = member_range(text, start, key)
        if span is None:
            raise ValueError(f'Missing {keys} in {path}')
        start, end = span
    line_start = text.rfind('\n', 0, start) + 1
    indent = re.match(r'\s*', text[line_start:start]).group()
    unit = 1 if path.name == 'dungeon-config.json' else 2
    rendered = json.dumps(value, ensure_ascii=False, indent=unit)
    rendered = rendered.replace('\n', newline + indent)
    with path.open('w', encoding='utf-8', newline='') as stream:
        stream.write(text[:start] + rendered + text[end:])


def append_enemy(path, config):
    with path.open(encoding='utf-8-sig', newline='') as stream:
        text = stream.read()
    if 'pleatDevourer' in read(path):
        replace_member(path, ['pleatDevourer'], config)
        return
    newline = '\r\n' if '\r\n' in text else '\n'
    end = text.rfind('}')
    block = json.dumps(config, ensure_ascii=False, indent=2).replace('\n', newline + '  ')
    text = text[:end].rstrip() + ',' + newline + '  "pleatDevourer": ' + block + newline + '}' + text[end+1:]
    with path.open('w', encoding='utf-8', newline='') as stream:
        stream.write(text)


def main():
    params = read(SPRITES / 'animation-parameters.json')
    layouts = {}
    textures = {'referenceCell': params['referenceCell']}
    asset_dir = REPO / 'assets/enemies/pleat_devourer'
    asset_dir.mkdir(parents=True, exist_ok=True)
    for source, state in MAPPING.items():
        action = params['actions'][source]
        # Source lives in final/ even after metadata is marked as published.
        shutil.copy2(SPRITES / 'final' / f'{source}.png', asset_dir / f'{state}.png')
        textures[state] = f'assets/enemies/pleat_devourer/{state}.png'
        layouts[state] = {k: action[k] for k in (
            'frameWidth', 'frameHeight', 'frameCount', 'endFrame', 'columns', 'rows',
            'footX', 'footY', 'duration', 'frameDurations', 'repeat')}
    textures['frameLayouts'] = layouts
    textures.update(idleFrameWidth=339, idleFrameHeight=149, idleFrameCount=60, idleSheetColumns=5)
    attack = layouts['attack']
    impact_frame = 26
    event_ms = sum(attack['frameDurations'][:impact_frame])
    config = dict(
        entityClass='PleatDevourer',
        invasion=dict(enabled=False, comment='本次仅接入恐怖地牢，不新增来袭编组。'),
        id='pleatDevourer', name='百褶噬团', type='领主', category='monster',
        family='僵尸', families=['僵尸', '深渊', '大型'], rank='lord', level=12,
        poolWhitelistOnly=True, hp=2100, maxHp=2100, speed=100,
        str=78, dex=26, con=70, int=8, wis=26, luck=8,
        size=30, collisionRadius=90, height=130, color='#766553', showWeapon=False,
        description='恐怖地牢专属抽象领主。低伏褶团缓慢蠕行，闭合褶甲承伤较低；靠近后停步锁向，将前端褶层水平推出形成重压。侧移或后撤可避开，长收势是反击窗口。没有人形肢体、追踪突进、召唤或死亡爆炸。',
        attackType='物理（锁向矩形重压AOE）', basicMeleeResolver=True,
        attackRange=200, attackDistance=200, aiInterval=120,
        attackTelegraph=dict(overlapWindup=True, durationMs=event_ms),
        attack=dict(type='thrust', cooldown=5600, range=200, dynamicRange=200, width=96, knockback=70),
        basicMelee=dict(approachReach=200, impactReach=200, width=96, forwardOffset=0,
            backExtension=0, requiresSameSurface=True, requiresLosAtImpact=True,
            timeline=dict(durationMs=attack['duration'], frameCount=81, contactFrame=impact_frame,
                activeFrames=[26, 27], rebaseOnImpact=True)),
        attackSkills=dict(
            primary=dict(range=200, width=96, damageMul=3, knockback=70, cooldown=5600,
                duration=attack['duration'], frames=81, eventFrame=impact_frame, eventMs=event_ms,
                sourceEventFrame=39, shape='directedRect', targets='allHostile',
                comment='源f39→正式f26，前端首次完全水平推出；0-based事件在1625ms仅结算一次。起手到下次起手冷却5600ms，整段5041.667ms，不追加代码位移。'),
            pleatArmor=dict(closedDamageTakenMultiplier=0.8, exposedDamageTakenMultiplier=1.25,
                exposedStartFrame=28, exposedStartMs=sum(attack['frameDurations'][:28]),
                exposedEndMs=attack['duration'], disabledByControl=True,
                comment='常规防御结算前的输入伤害倍率，非最终伤害减免；收势以同一动作时钟判定，硬控/恐惧取消褶甲。')),
        ai=dict(aggroRange=9999, pacingRange=90, loseTimeout=3000),
        render=dict(spriteSize=448, collisionWidth=300, collisionHeight=130,
            bodyDisplayHeight=124, footOffsetY=67.1, colliderOffsetX=0, colliderOffsetY=0,
            projectileHitbox=dict(width=300, height=130, offsetX=0, bottom=0),
            capsuleHudAnchor=True), textures=textures,
        death=dict(animMs=layouts['death']['duration'], holdMs=1600, fadeMs=600),
        skills=[
            dict(name='百褶重压', desc='停步锁定方向并预警1.625秒，第26帧对前方200×96地面矩形内的敌对目标各结算一次物攻×3物理伤害，击退70。动作总长约5.04秒，起手间隔5.6秒；不转向、不突进，隔墙、换层或移出区域可躲避。'),
            dict(name='褶甲收张', desc='闭合时进入常规防御前的伤害×0.8；攻击第28帧（1.75秒）至收势结束改为×1.25。眩晕、冻结、石化、恐惧及冲刺眩晕会取消未命中攻击与褶甲收益，解除后不补发。'),
            dict(name='褶团塌伏', desc='死亡仅播放完整塌伏动作，末帧留尸1.6秒后用0.6秒淡出；不爆炸、不召唤，经验与掉落沿用领主规则。')])
    for relative in ['data/enemy-config.json', 'public/data/enemy-config.json']:
        append_enemy(REPO / relative, config)
    for relative in ['data/dungeon-config.json', 'public/data/dungeon-config.json']:
        path = REPO / relative
        current = read(path)
        paths = [['monsterStatProfiles', 'horror', 'enemyKeys']]
        for block in ['zombieDungeonBeginner', 'zombieDungeonMid', 'zombieDungeon']:
            paths.append([block, 'encounters', 'elite', 'poolKeys'])
            if current[block].get('bossEncounter'):
                paths.append([block, 'bossEncounter', 'poolKeys'])
        for keys in paths:
            pool = current
            for key in keys:
                pool = pool[key]
            if 'pleatDevourer' not in pool:
                replace_member(path, keys, [*pool, 'pleatDevourer'])
    write(ROOT / 'runtime-config.json', config)
    print('Published four accepted sheets; added only pleatDevourer and five lord pools plus horror stat whitelist to each config copy.')


if __name__ == '__main__':
    main()
