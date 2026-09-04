"""Reject the firing-contaminated v02 and prepare a quiet collapse with end-state conditioning."""
import copy
import json
from pathlib import Path

root = Path(__file__).resolve().parent
target = root/'die-v03-index.json'
if target.exists():
    raise SystemExit('v03 already prepared; preserve its state.')
previous_path = root/'die-v02-index.json'
previous = json.loads(previous_path.read_text(encoding='utf-8'))
previous.update(status='candidate_rejected_unwanted_firing',visualAcceptance='not_accepted',
                productionReviewStatus='rejected',hasKnownVisualIssues=True,
                rejectionReason='A clear muzzle blast at about 2.4 seconds violates the explicit no-firing requirement. Retain only as source evidence; its final pose can guide the new candidate.')
previous_path.write_text(json.dumps(previous,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
index = {key:copy.deepcopy(previous[key]) for key in
         ('unitKey','unitName','level','building','date','provider','mother','reference','budget','scope','approvalScope','prohibitedEffects')}
index.update(assetOnly=True,runtimeIntegrationActive=False,status='prepared',revision='v03',
             visualAcceptance='pending_user_review',reviewNotes='REVIEW-NOTES.md',
             lastFrameReference='previews/die-final-pose-v02.png',
             lastFrameReferenceNote='Only the final still of rejected v02 guides broken equipment and visible fallen crew; the rejected firing motion is not reused or accepted.',
             generation={'endpoint':'http://192.168.3.142:8188','duration':6.6,
                         'frames':158,'fps':24,'size':[1024,576],'steps':20,'candidatesPerAction':1,
                         'uploaded':False,'submitted':False,'generated':False},
             actions={'die':{'prompt':'prompts/die-v03.txt','seed':830334,
                             'status':'prepared','loop':False,'actionMode':'one-way',
                             'sourceVideo':None,'sourceSheet':None,'finalSheet':None,'preview':None}},
             previousCandidate={'index':'die-v02-index.json','video':'videos/die-v02.mp4',
                                'promptId':previous['actions']['die']['promptId'],'rejected':True},
             intendedSequence=['gentle loss of balance','gravity-driven tube fracture',
                               'both bodies fall forward into view','hold fallen end state without emission'])
target.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(target)
