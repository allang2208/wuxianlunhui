"""Record the user-authorized import; no game execution or asset regeneration."""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
TASK = ROOT.parent
ANIMATION = TASK / 'animations-pleat-v03-20260831'
SPRITES = ANIMATION / 'sprite-production-v01'
REPO = ROOT.parents[3]
sys.path.insert(0, str(SPRITES))
from runtime_publication import annotate_publication


def read(path):
    return json.loads(path.read_text(encoding='utf-8'))


def write(path, data):
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2)+'\n',encoding='utf-8')


def main():
    config=read(REPO/'data/enemy-config.json')['pleatDevourer']
    actions={source:dict(state=state,textureKey=f'enemy_pleat_devourer_{state}',
        texture=config['textures'][state]) for source,state in
        {'idle':'idle','crawling':'walk','attack':'attack','dying':'death'}.items()}
    publication=dict(date='2026-09-01',unitKey='pleatDevourer',status='integrated_pending_user_validation',
        authorization=dict(userRequest='导入游戏设计状态机和数值。按照动画标准工作流处理，看看相关skill部分',
            scope='百褶噬团四动作入库、状态机、数值、恐怖地牢领主池；不包括空腔之卵、来袭、测试或EXE发布'),
        entity='src/entities/enemy-types/pleat-devourer.js',config='data/enemy-config.json#pleatDevourer',
        scale=dict(sourceScale=0.35,runtimeScale=1,sourceToWorldScale=0.35,referenceCell=448,
            sourceNeutralBodyHeight=124/0.35,normalZoom=1,maximumZoom=1.03,
            normalZoomBodyPixels=124,maximumZoomBodyPixels=127.72,
            neutralBodyWidth=310,neutralBodyHeight=124,
            basis='idle f0 alpha>=64；不含透明画布。身体无细长武器。所有动作固定倍率，不按每帧Alpha重缩放。',
            cameraSource='GameScene sceneBaseZoom=1 for dungeons; GunFeel.ZOOM_MAX=0.03'),
        collider=dict(radius=90,height=130,offsetX=0,offsetY=0,projectileHitbox=config['render']['projectileHitbox']),
        actions=actions,
        attack=dict(sourceFrame=39,contactFrame=26,contactMs=1625,activeFrames=[26,27],
            exposedStartFrame=28,exposedStartMs=1750,durationMs=config['attackSkills']['primary']['duration'],
            reach=200,width=96,shape='directedRect',damageMultiplier=3,knockback=70,
            cooldownMs=5600,cooldownSemantics='start-to-start; existing frequency modifier affects cooldown only',
            measuredFrontFromRoot=208.625,
            earlierCandidate='Frame34/2125ms was only a provisional hold pose; frames24..28 reveal forward peak at26.',
            rootMotion='locomotion moves Collider; attack fixes Collider movement and preserves authored internal motion'),
        cameraReview=dict(inheritedDirectionApproval=True,
            body='前端朝右，后部隆起在左，整体轻俯视侧向；无头胸胯膝足，按前褶/中段/后囊记录，不虚构人体关节。',
            travelAxis='屏幕左右，攻击锁定起手方向；上下/斜向共享左右源图，尚未实机验收。',
            identitySource='mother/pleat-devourer-mother-v03-animation-right.png',
            actualAnimationReferences=[
                dict(type='zombieDog',config='data/enemy-config.json#zombieDog.textures.frameLayouts.walk',
                    path='assets/enemies/zombie_dog/v3/running.png',frames=[0,9,18]),
                dict(type='stitchfaceHeadsman',config='data/enemy-config.json#stitchfaceHeadsman.textures.frameLayouts.walk',
                    path='assets/enemies/stitchface_headsman/walk.png',frames=[0,19,38]),
                dict(type='pleatDevourer',path=actions['crawling']['texture'],frames=[0,17,34])],
            plate='../../integration-20260901/direction-reference-plate.png',
            review='已查看当前真实动作帧；延续获准横向朝右的身体轴和轻俯视感，没有重新生成或改变原片步态。'),
        footprintPlate='../../integration-20260901/attack-contact-plate.png',
        dependencyNote='Four unique animation textures, 58.21951675415039 MiB. No extra summons, projectiles or custom VFX textures; common telegraph reuses the body texture. Not a scene-performance measurement.',
        userFinalRuntimeAcceptance=False,testsRun=False,runtimeValidationRun=False,
        pending=['贴脸/极限距离/侧移/后撤/隔墙/换层/长帧','左右及上下斜向命中观感','石化冻结/控制打断/死亡留尸淡出','蠕行循环接缝与前端张合','C/B/A同级战斗手感'])
    write(SPRITES/'runtime-integration.json',publication)
    manifest=read(SPRITES/'sprite-manifest.json')
    parameters=read(SPRITES/'animation-parameters.json')
    annotate_publication(manifest,parameters)
    write(SPRITES/'sprite-manifest.json',manifest)
    write(SPRITES/'animation-parameters.json',parameters)
    budget=read(SPRITES/'sprite-budget-manifest.json')
    budget.update(registered=True,runtimeIntegration='runtime-integration.json',dependencyNote=publication['dependencyNote'])
    for item in budget['resources']:
        item.update(runtimeTextureKey=actions[item['action']]['textureKey'],runtimePath=actions[item['action']]['texture'])
    write(SPRITES/'sprite-budget-manifest.json',budget)
    video=read(ANIMATION/'manifest.json')
    video.update(stage='runtime_integrated_pending_user_validation',runtimeIntegrationActive=True,
        runtimeIntegration='sprite-production-v01/runtime-integration.json')
    video['productionContract'].update(attackMotionTargetMs=config['attackSkills']['primary']['duration'],
        attackContactFrame=26,worldScale=1,normalAndMaxZoomPixels=[124,127.72],collider=publication['collider'],
        runtimeKeys=actions,rootMotion=publication['attack']['rootMotion'],
        death='保留完整塌伏和末帧；运行时留尸1600ms后淡出600ms，不反放。',
        unresolvedNote='已按用户请求接入；尚未运行测试/实机验收，保留源片蠕行张合、接缝和轻塌伏的观感限制。')
    video['productionContract']['frameLayouts']['runtimeRegistered']=True
    video['spriteProduction'].update(status='runtime_integrated_pending_user_validation',runtimeIntegrationActive=True)
    for action,record in video['actions'].items():
        if action in actions:
            record['runtimeIntegration']=actions[action]
            if 'spriteCandidate' in record:
                record['spriteCandidate'].update(approved=True,approvalBasis='2026-09-01 user requested runtime import')
    video['submission']['reason']='视频生成记录保留；攻击v04已接受，四动作图集已于2026-09-01按后续用户请求接入游戏。'
    write(ANIMATION/'manifest.json',video)
    task=read(TASK/'task-index.json')
    task.update(status='pleat_runtime_integrated_pending_user_validation',futurePlanOnly=False,runtimeIntegrationActive=True,
        generationNote='百褶噬团四动作正式入库，新增单时钟领主实体/重压/褶甲与恐怖C/B/A领主池。未生成新视频，空腔之卵保持母图阶段，未测试或发布EXE。',
        presentation='百褶噬团已接入，待用户游戏验收；空腔之卵保持白底母图。')
    pleat=next(item for item in task['assets'] if item['unitKey']=='pleat_devourer')
    pleat.update(status='runtime_integrated_pending_user_validation',approved=True,runtimeIntegrationActive=True,
        revisionRequest=publication['authorization']['userRequest'],
        runtimeIntegration='animations-pleat-v03-20260831/sprite-production-v01/runtime-integration.json')
    task['constraints']=['本次仅百褶噬团入库；空腔之卵和原视频不改。',
        '只新增恐怖地牢领主候选，不更改波次阶级/数量、最终Boss、其他地牢或来袭编组。',
        '未运行测试、构建或游戏运行时验证；按约定由用户测试。',
        '来源记录不代表第三方权利审核。']
    write(TASK/'task-index.json',task)
    print('Updated publication, source index, animation manifest, frame metadata and texture budget; no game or tests started.')


if __name__=='__main__':
    main()
