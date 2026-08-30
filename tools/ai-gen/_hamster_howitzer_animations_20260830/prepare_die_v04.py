"""Prepare a fresh fluid death take after explicit user rejection of rigid v03."""
import copy
import json
from pathlib import Path

root = Path(__file__).resolve().parent
target = root/'die-v04-index.json'
if target.exists():
    raise SystemExit('v04 already prepared; preserve its state.')
previous_path = root/'die-v03-index.json'
previous = json.loads(previous_path.read_text(encoding='utf-8'))
previous.update(status='candidate_rejected_by_user_stiffness',visualAcceptance='rejected_by_user',
                productionReviewStatus='rejected',userFeedback='过于僵硬，重新生成',
                rejectionReason='User rejected stiff transitions and requested regeneration. The previous no-firing observation remains historical evidence, not acceptance.')
previous_path.write_text(json.dumps(previous,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
index = {key:copy.deepcopy(previous[key]) for key in
         ('unitKey','unitName','level','building','date','provider','mother','reference','budget','scope','prohibitedEffects')}
index.update(assetOnly=True,runtimeIntegrationActive=False,status='prepared',revision='v04',
             approvalScope='User explicitly requested regeneration because v03 was too rigid. Preserve broken barrel, two fallen crew and the explicit no-firing constraint; use the same authorized H3 endpoint.',
             visualAcceptance='pending_user_review',reviewNotes='REVIEW-NOTES.md',
             generation={'endpoint':'http://192.168.3.142:8188','duration':5.17,
                         'frames':124,'fps':24,'size':[1024,576],'steps':20,'candidatesPerAction':1,
                         'uploaded':False,'submitted':False,'generated':False},
             actions={'die':{'prompt':'prompts/die-v04.txt','seed':830344,
                             'status':'prepared','loop':False,'actionMode':'one-way',
                             'sourceVideo':None,'sourceSheet':None,'finalSheet':None,'preview':None}},
             previousCandidate={'index':'die-v03-index.json','video':'videos/die-v03.mp4',
                                'promptId':previous['actions']['die']['promptId'],'rejectedByUser':True},
             motionChanges=['remove rigid final-frame conditioning','shorter overall clip and final hold',
                            'staggered asymmetric falls with bent joints','continuous weight transfer and floor-contact settling'],
             retainedConstraints=['same crew identity and camera','broken barrel remains broken',
                                  'both whole bodies end lying down','no firing or smoke/explosion effects'],
             sourceMotionPolicy='Generate a new native trajectory, not speed up or geometrically warp the rejected video.')
target.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(target)
