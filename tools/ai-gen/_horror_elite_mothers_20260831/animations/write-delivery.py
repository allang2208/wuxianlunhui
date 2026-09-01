"""Refresh local source-video delivery records without changing game files."""
from pathlib import Path
import json

ROOT=Path(__file__).resolve().parent
PARENT=ROOT.parent
index=json.loads((ROOT/'task-index.json').read_text(encoding='utf-8-sig'))
if index.get('runtimeIntegrated') or any(j.get('runtimeIntegrationActive') for j in index['jobs']):
    raise SystemExit('Source-only writer retired: formal sprite integration exists. Update the actor delivery and preserve runtime status; no files changed.')
review_path=ROOT/'source-review.json'
reviews=json.loads(review_path.read_text(encoding='utf-8')) if review_path.exists() else []
rows=[]
finished=0
asset_order={'stitchface-headsman':0,'waxface-mourner':1}
state_order={'idle':0,'walking':1,'attacking':2,'dying':3}
for job in sorted(index['jobs'],key=lambda job:(asset_order[job['asset']],state_order[job['state']])):
    video=ROOT/job['video']
    report=video.parent.parent/'previews'/f'{video.stem}-preview.json'
    if video.exists() and report.exists():
        finished+=1
        info=json.loads(report.read_text(encoding='utf-8'))
        job['sourceMetadata']={k:info[k] for k in ['size','frameCount','fps','durationSeconds']}
        job['preview']=str(report.parent.relative_to(ROOT)/f'{video.stem}-source.gif').replace('\\','/')
        job['contactSheet']=str(report.parent.relative_to(ROOT)/f'{video.stem}-contact.png').replace('\\','/')
        job['provenance']=job['video']+'.json'
        job['status']='source_delivered_user_review_pending'
        name={'stitchface-headsman':'缝面刽子手','waxface-mourner':'蜡面哀祷者'}[job['asset']]
        action={'idle':'待机','walking':'行走','attacking':'攻击','dying':'死亡'}[job['state']]
        rows.append(f"| {name} | {action} | [MP4]({job['video']}) | [GIF]({job['preview']}) | {info['size'][0]}×{info['size'][1]}，{info['fps']:g}fps，{info['durationSeconds']:.3f}s |")
blocker_path=ROOT/index.get('blocker',index.get('quotaHistory','doubao-quota-blocker.json'))
quota_history=json.loads(blocker_path.read_text(encoding='utf-8')) if blocker_path.exists() else None
blocker=quota_history if quota_history and quota_history.get('status')=='blocked_doubao_rolling_quota' and finished<8 else None
if blocker:
    index['blocker']=str(blocker_path.relative_to(ROOT)).replace('\\','/')
    index['jobs'][blocker['failedJobIndex']]['status']='blocked_doubao_rolling_quota_no_video'
else:
    index.pop('blocker',None)
    if quota_history:
        index['quotaHistory']=str(blocker_path.relative_to(ROOT)).replace('\\','/')
index['status']='eight_sources_delivered_user_review_pending' if finished==8 else ('blocked_doubao_rolling_quota' if blocker else 'video_production_in_progress')
asset_progress={}
for asset in ['stitchface-headsman','waxface-mourner']:
    asset_jobs=[job for job in index['jobs'] if job['asset']==asset]
    delivered=[job['state'] for job in asset_jobs if job['status']=='source_delivered_user_review_pending']
    overview=ROOT/asset/'previews/four-actions-overview.gif'
    asset_progress[asset]={'completedSources':len(delivered),'totalSources':len(asset_jobs),'deliveredStates':delivered,'remainingStates':[job['state'] for job in asset_jobs if job['state'] not in delivered],'overview':str(overview.relative_to(ROOT)).replace('\\','/') if overview.exists() else None}
index['assetProgress']=asset_progress
active_asset=index.get('activeAsset')
if active_asset:
    active_progress=asset_progress[active_asset]
    index['activeAssetOverviewDelivered']=active_progress['completedSources']==4 and bool(active_progress['overview'])
index['completedSourceCount']=finished
index['runtimeIntegrated']=False
index['testsOrRuntimeValidationPerformed']=False
(ROOT/'task-index.json').write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')

readme='''# 恐怖地牢精英：攻击设计与豆包视频

母图已按用户“可用”确认。当前交付的是角色动作源视频和攻击设计，未做透明精灵表、RIFE或游戏接入。

攻击方式见 [设计说明](ATTACK-DESIGN.md) 和 [机器可读设计](attack-design.json)。缝面刽子手使用锁向单体蓄力斩骨；蜡面哀祷者使用释放后固定落点的封蜡诅咒。暂定数值均未写入游戏，最终刀刃距离、接触/释放帧仍须按获准素材和显示比例标定。

## 源视频

完成 COUNT/8 段。GIF完整保留原片时间轴，约12fps展示；攻击与死亡的GIF循环只方便查看，不表示游戏动作循环。

BLOCKER

按最新要求先完成刽子手四动作源视频与总览，再提交哀祷者剩余动作；已生成的哀祷者攻击保留。当前刽子手 HEADSMAN_COUNT/4，哀祷者 MOURNER_COUNT/4。

OVERVIEWS

| 怪物 | 动作 | 视频 | 动图 | 实际源规格 |
|---|---|---|---|---|
ROWS

## 来源和制作

- 通过项目统一入口 ai-asset.py video generate --provider doubao 调用已登录豆包客户端，每次只提交一条候选。刽子手早期行走存在朝向漂移，旧版和修订版均保留来源；当前选用版本以表格为准。请求模型Seedance 2.0 Mini；界面后端托管的任务不声称核实具体实际模型，当前新提交则显示Mini。逐段mp4.json保留真实modelSelection、参数与提示词来源。
- 两张获准母图未覆盖。初始动作参考由video-safe-reference.py等比补白至1280×720，主体约432px；记录在references/preparation.json。本次仅刽子手行走使用imagegen制作的稍朝右派生参考，保留原镜头俯角、造型和装备，其他动作继续使用原参考。新版v05/v06直接编辑祖先和方向参考均见references下的同名reference.json；v06补白后主体432px、脚线598。生成服务是否保持输入比例仍以原片为准，不能宣称各源动作已经同尺度。
- 原片、逐动作不可变提示词、来源记录、GIF、24点联系图均保留。源视频仍含平台水印和可能的灰底/阴影，不是透明运行时素材。
- 完整攻击源片约5秒，最终精灵动作目标约1500ms；当前没有裁切、加速或伪造接触帧，GIF也不是游戏速度。
- 源片观察记录见[source-review.json](source-review.json)。母图接受不等于视频自动接受；后续须处理记录中的画面差异，核对刀/手/碗/三烛和镜头、循环、脚点后才制作正式精灵图。
- 刽子手攻击原片有小幅迈步及落刀后的停留；第56帧（约2.333秒）首次形成完整低位刀姿，只是素材观察锚点，不是已设置的伤害帧。后续保留原动作轨迹，不另叠代码冲刺。
- 刽子手本次行走修订要求固定原镜头、人物略朝右、左右脚沿同一前后轴迈步，禁止转向观众；最终仍须截取完整步态并处理首尾衔接，源视频不等于已通过的无缝精灵循环。
- 行走v03、v04、v05均因朝向问题未采用；v04在与正式人形怪物对照后确认转向近正面的幅度过大，不再称为少量肩胯随动。v06的新方向参考和提交状态见[续抽记录](stitchface-headsman/WALKING-REROLL-v05.md)。此次只处理行走，其他三段动作与哀祷者源视频没有改动。
- 哀祷者约第47—52帧掌前出现少量灰烟，未达到纯身体无特效的目标；需后续清理或重出。约第42—48帧为释放姿势候选，尚未绑定游戏释放时机。

## 重建与续作

generate-doubao.ps1 -Index N 从task-index.json选择单条prepared任务，原编号不变。先完成刽子手的2（待机）、3（行走）、4（死亡），导出该角色四动作总览并刷新交付记录后，才允许继续哀祷者5—7。已有视频或已提交状态会拒绝重投；下载/连接异常须先定位原任务，不生成另一条冒充原结果。旧额度拒绝保留在doubao-quota-blocker.json；当前登录状态已变化，按新提交的实际页面结果判断额度。没有自动预约、购买额度或更换管线。

build-video-previews.py --video <MP4> 可重建源GIF/联系图；--overview <asset-id> 仅在该角色四段均齐全后使用。当前已有总览只按上方实际文件列出。

本轮没有修改src、data/public、正式assets或EXE。未运行测试或运行时验证，按约定由用户测试；视频制作与离线预览不代表游戏内验收。
'''.replace('HEADSMAN_COUNT',str(asset_progress['stitchface-headsman']['completedSources'])).replace('MOURNER_COUNT',str(asset_progress['waxface-mourner']['completedSources'])).replace('COUNT',str(finished)).replace('ROWS','\n'.join(rows)).replace('BLOCKER',('**豆包额度阻塞，未全部完成。** 当前有效额度拒绝见 [额度记录](doubao-quota-blocker.json)，未下载的状态不计作完成。' if blocker else '旧登录状态的额度拒绝保留为历史；当前制作使用豆包现有登录状态，没有购买额度或更换管线。')).replace('OVERVIEWS','\n'.join(f"- [{'刽子手' if asset=='stitchface-headsman' else '哀祷者'}四动作原片总览]({info['overview']})" for asset,info in asset_progress.items() if info['overview']) or '尚无齐全的四动作总览。')
readme=readme.replace('[额度记录](doubao-quota-blocker.json)',f'[额度记录]({blocker_path.name})')
if blocker and index['jobs'][blocker['failedJobIndex']]['asset']=='stitchface-headsman':
    readme=readme.replace('[刽子手四动作原片总览]','[刽子手旧版总览（行走已淘汰）]')
    readme+='\n## 行走续抽的当前状态\n\nv04经人形移动对照淘汰；新生成v05仍有近正面转身及主体放大，也淘汰。v06步行参考与提示词已完成，两次提交分别遭遇每日免费次数及换号后的近7天额度拒绝，未产生视频。当前有效源状态为7/8；其余三段刽子手动作和四段哀祷者动作未改。详见[续抽记录](stitchface-headsman/WALKING-REROLL-v05.md)。\n'
(ROOT/'DELIVERY.md').write_text(readme,encoding='utf-8')
parent=json.loads((PARENT/'manifest.json').read_text(encoding='utf-8'))
parent['status']='mothers_approved_eight_video_sources_delivered' if finished==8 else ('mothers_approved_video_sources_partial_doubao_quota_blocked' if blocker else 'mothers_approved_video_production_in_progress')
parent['scope']='Two approved elite mother images; attack design and source-video stage only. No runtime integration.'
parent['animationDelivery']='animations/DELIVERY.md'
parent['completedVideoSources']=finished
parent['animationAssetProgress']=asset_progress
parent['generationOrder']=index.get('generationOrder')
(PARENT/'manifest.json').write_text(json.dumps(parent,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Delivery records updated: {finished}/8 source videos.')
