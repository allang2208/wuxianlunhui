"""Prepare only the requested broken-barrel, both-crew-down death revision."""
import copy
import json
from pathlib import Path

root = Path(__file__).resolve().parent
target = root/'die-v02-index.json'
if target.exists():
    raise SystemExit('Death revision already prepared; preserve existing progress.')
previous = json.loads((root/'task-index.json').read_text(encoding='utf-8'))
index = {key:copy.deepcopy(previous[key]) for key in
         ('unitKey','unitName','level','building','date','provider','mother','reference','budget')}
index.update(assetOnly=True,runtimeIntegrationActive=False,status='prepared',revision='v02',
             scope='Death only. Preserve all attack candidates, idle/run and existing runtime assets.',
             approvalScope='User requests a broken barrel and both crew fully fallen in the death animation, explicitly without firing. Continue the authorized H3 endpoint and same reference.',
             visualAcceptance='pending_user_review',reviewNotes='REVIEW-NOTES.md',
             generation={'endpoint':'http://192.168.3.142:8188','duration':6.6,
                         'frames':158,'fps':24,'size':[1024,576],'steps':20,'candidatesPerAction':1,
                         'uploaded':False,'submitted':False,'generated':False},
             actions={'die':{'prompt':'prompts/die-v02.txt','seed':830324,
                             'status':'prepared','loop':False,'actionMode':'one-way',
                             'sourceVideo':None,'sourceSheet':None,'finalSheet':None,'preview':None}},
             previousCandidate={'index':'task-index.json','video':'videos/die-v01.mp4',
                                'promptId':previous['actions']['die']['promptId']},
             intendedSequence=['both crew lose balance','barrel fractures and droops',
                               'both entire bodies land visibly in foreground','hold defeated final pose'],
             prohibitedEffects=['firing','muzzle flash','smoke','fire','explosion','sparks','projectile','shell ejection'])
target.write_text(json.dumps(index,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(target)
