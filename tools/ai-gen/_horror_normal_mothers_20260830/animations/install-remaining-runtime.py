"""Install only the three authorized horror enemies; preserve concurrent config edits."""
from pathlib import Path
import copy
import json
import re
import shutil

import cv2
import numpy as np
from PIL import Image

ROOT=Path(__file__).resolve().parent
REPO=ROOT.parents[3]
BUILD=ROOT/"remaining-sprite-build-v01"
STATE={"idle":"idle","walking":"walk","attacking":"attack","dying":"death"}
SPECS={
    "shroud-thrall":dict(id="shroudThrall",family="shroud_thrall",name="裹尸囚徒",hp=170,speed=125,
        str=18,dex=9,con=18,int=3,wis=4,luck=3,range=80,damageMul=1.1,knockback=28,cooldown=5600,eventSourceFrame=50,
        skillName="裹布拍击",description="长臂裹尸囚徒，生命与力量介于矿工僵尸和棺板卫尸之间。停步蓄力后拍击锁定单体，可通过后撤、绕后、隔墙或换层躲避。"),
    "ossuary-caster":dict(id="ossuaryCaster",family="ossuary_caster",name="掷骨殓徒",hp=120,speed=135,
        str=16,dex=14,con=12,int=6,wis=8,luck=4,range=420,damageMul=1.2,knockback=12,cooldown=5800,eventSourceFrame=44,
        skillName="转肩掷骨",description="脆弱的远程殓徒。蓄力转肩后投出一枚骨镖，在出手帧预判原目标；目标绕到背后或失去视线则空挥。骨镖不追踪、不穿透，命中和墙体阻挡走共享弹道系统。"),
    "knell-attendant":dict(id="knellAttendant",family="knell_attendant",name="缚钟侍者",hp=190,speed=105,
        str=10,dex=7,con=19,int=16,wis=10,luck=3,range=65,damageMul=.85,knockback=18,cooldown=6500,eventSourceFrame=50,
        skillName="近域丧钟",description="迟缓的近距离声震怪。敲钟接触帧只结算一次小范围魔法伤害，受同地表和视线限制；没有持续光环、召唤、眩晕或叠加控制。"),
}


def load(path): return json.loads(path.read_text(encoding="utf-8"))
def write(path,obj):
    path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(obj,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def main():
    configs=load(REPO/"data/enemy-config.json")
    if (BUILD/"runtime-manifest.json").exists():
        raise RuntimeError("Already installed. Preserve runtime tuning; edit the explicit entries instead of reinstalling.")
    miner=configs["minerZombie"]
    im=Image.open(REPO/miner["textures"]["idle"]).convert("RGBA").crop((0,0,512,512))
    body=cv2.morphologyEx((np.asarray(im)[...,3]>24).astype(np.uint8),cv2.MORPH_OPEN,np.ones((11,11),np.uint8))
    _,_,stats,_=cv2.connectedComponentsWithStats(body,8)
    box=stats[1+int(np.argmax(stats[1:,cv2.CC_STAT_AREA]))]
    reference_height=int(box[cv2.CC_STAT_HEIGHT])*miner["render"]["spriteSize"]/512
    prepared={}
    runtime={"status":"installed_pending_user_runtime_test","authorization":"注意大小统一、优化插帧、接入游戏，参考其他同级怪物设计数值，完善动作状态机",
             "reference":{"id":"minerZombie","bodySourceHeight":int(box[cv2.CC_STAT_HEIGHT]),"bodyDisplayHeight":reference_height,"collisionRadius":miner["collisionRadius"]},
             "testsRun":False,"runtimeVerified":False,"actors":[]}
    for actor,s in SPECS.items():
        m=load(BUILD/actor/"sprite-manifest.json")
        scale=reference_height/m["preparedBodyHeightPx"]
        textures={"referenceCell":256,"frameLayouts":{}}
        for r in m["actions"]:
            state=STATE[r["action"]]
            textures[state]=f"assets/enemies/{s['family']}/{state}.png"
            textures["frameLayouts"][state]={k:r[k] for k in ("frameWidth","frameHeight","frameCount","endFrame","footX","footY")}
            textures["frameLayouts"][state].update(columns=r["cols"],rows=r["rows"],duration=r["durationMs"],
                frameRate=r["nominalOutputFps"],frameDurations=r["frameDurationsMs"],repeat=r["repeat"])
        idle=textures["frameLayouts"]["idle"]
        textures.update(idleFrameWidth=idle["frameWidth"],idleFrameHeight=idle["frameHeight"],idleFrameCount=idle["frameCount"],idleSheetColumns=idle["columns"])
        attack=next(r for r in m["actions"] if r["action"]=="attacking")
        event=attack["sourceFrameIndices"].index(s["eventSourceFrame"])*2
        skill={k:s[k] for k in ("range","damageMul","knockback","cooldown")}
        skill.update(duration=attack["durationMs"],frames=attack["frameCount"],eventFrame=event,eventMs=sum(attack["frameDurationsMs"][:event]),
                     sourceEventFrame=s["eventSourceFrame"],comment="0-based事件帧和逐帧时长由正式精灵图派生；完整动作播放一次，长帧跨阈值只结算一次。")
        render=copy.deepcopy(miner["render"])
        render.update(spriteSize=256*scale,bodyDisplayHeight=reference_height,colliderOffsetX=0,colliderOffsetY=0,
                      footOffsetY=(idle["footY"]-idle["frameHeight"]/2)*scale)
        cfg={k:s[k] for k in ("id","name","hp","speed","str","dex","con","int","wis","luck","description")}
        cfg.update(type="普通",category="monster",family="僵尸",families=["僵尸"],rank="normal",level=4,maxHp=s["hp"],
            poolWhitelistOnly=True,color="#807769",size=17,collisionRadius=miner["collisionRadius"],height=miner["render"]["collisionHeight"],
            showWeapon=False,basicMeleeResolver=False,attackRange=s["range"],attackDistance=s["range"],
            attack={"type":"thrust","cooldown":s["cooldown"],"range":s["range"],"dynamicRange":s["range"],"width":40,"knockback":s["knockback"]},
            attackSkills={"primary":skill},ai={"aggroRange":9999,"pacingRange":60,"loseTimeout":3000},render=render,textures=textures,
            death={"animMs":textures["frameLayouts"]["death"]["duration"],"holdMs":1000,"fadeMs":300})
        if actor=="shroud-thrall":
            cfg["basicMeleeResolver"]=True
            cfg["basicMelee"]={"approachReach":80,"impactReach":80,"width":40,"forwardOffset":0,"backExtension":8,
                "requiresSameSurface":True,"requiresLosAtImpact":True,"timeline":{"durationMs":attack["durationMs"],"frameCount":attack["frameCount"],
                "contactFrame":event,"activeFrames":[event,event+1],"rebaseOnImpact":False}}
            cfg["attackType"]="物理（单体拍击）"
            desc=f"停步拍击锁定单体，物攻×{s['damageMul']}，击退{s['knockback']}；起手冷却{s['cooldown']/1000:g}秒。"
        elif actor=="ossuary-caster":
            cal=m["calibrations"]["h3"]
            # f44 is the first open throwing hand after the held dart in f42.
            source_x,source_y=669,14
            skill.update(projectileSpeed=560,projectileRange=520,projectileRadius=3,projectileDisplaySize=24,behindTolerance=12,
                releaseFrame=event,releaseOffsetPx={"x":(source_x-cal["sourceOrigin"][0])*cal["scale"],"y":(source_y-cal["sourceOrigin"][1])*cal["scale"]},
                releaseAnchorSource={"frame":44,"x":source_x,"y":source_y})
            textures["projectile"]="assets/enemies/ossuary_caster/projectile.png"
            cfg["attackType"]="物理（骨镖投射物）"
            desc=f"射程420，出手帧预判投掷一枚骨镖，物攻×{s['damageMul']}，飞速560，最长飞行520；起手冷却5.8秒。"
        else:
            skill.update(radius=130,pulseVisualMs=320)
            cfg["attackType"]="魔法（近距离声震）"
            desc="敲钟帧产生一次130半径的地面椭圆声震，魔攻×0.85、击退18；同地表且视线畅通才命中，起手冷却6.5秒，无持续伤害或硬控。"
        cfg["skills"]=[{"name":s["skillName"],"desc":desc+"眩晕、冻结、石化、恐惧和冲刺眩晕可打断未释放动作；已飞出的骨镖独立完成弹道。"}]
        prepared[actor]=(cfg,m)
        runtime["actors"].append({"id":s["id"],"name":s["name"],"manifest":f"remaining-sprite-build-v01/{actor}/sprite-manifest.json",
            "spriteSize":render["spriteSize"],"bodyDisplayHeight":reference_height,"rgbaMiB":m["estimatedRgbaMiB"],
            "eventFrame":event,"sourceEventFrame":s["eventSourceFrame"],"eventMs":skill["eventMs"],"overviewGif":m["overviewGif"],
            "sourceLimitations":["Source motion and side changes retained; no retiming."]+(["Raised hand at source f43-44 reaches top edge; original clipping is retained, not claimed reconstructed."] if actor=="ossuary-caster" else [])})
    edits={}
    for name in ("data/enemy-config.json","public/data/enemy-config.json"):
        path=REPO/name
        text=path.read_text(encoding="utf-8")
        marker='  "coffinWard": {'
        if marker not in text: raise RuntimeError(f"Missing insertion anchor: {name}")
        blocks=[]
        for actor,(cfg,m) in prepared.items():
            if f'"{cfg["id"]}":' in text:
                # Resume this interrupted first install only when its entry is unchanged.
                if json.loads(text)[cfg["id"]] != cfg:
                    raise RuntimeError(f"Existing runtime tuning differs in {name}: {cfg['id']}")
                continue
            blocks.append(json.dumps({cfg["id"]:cfg},ensure_ascii=False,indent=2)[2:-2])
        if blocks:
            edits[path]=text.replace(marker,",\n".join(blocks)+",\n"+marker,1)
    pool_edits=[]
    decoder=json.JSONDecoder()
    for name in ("data/dungeon-config.json","public/data/dungeon-config.json"):
        path=REPO/name; text=path.read_text(encoding="utf-8")
        for section in ("zombieDungeon","zombieDungeonBeginner","zombieDungeonMid"):
            pos=text.index(f'"{section}":'); start=text.index("{",pos)
            _,length=decoder.raw_decode(text[start:]); part=text[start:start+length]
            count=0
            def add(match):
                nonlocal count
                value=match.group(0)
                if '"coffinWard"' not in value: return value
                count+=1
                return re.sub(r'(^\s*)"coffinWard",',lambda p:p.group(0)+''.join(f'\n{p.group(1)}"{s["id"]}",' for s in SPECS.values() if f'"{s["id"]}"' not in value),value,count=1,flags=re.MULTILINE)
            changed=re.sub(r'"poolKeys"\s*:\s*\[[^\]]*\]',add,part)
            text=text[:start]+changed+text[start+length:]
            pool_edits.append({"file":name,"section":section,"pools":count})
        edits[path]=text
    for actor,(cfg,m) in prepared.items():
        for r in m["actions"]:
            state=STATE[r["action"]]; dst=REPO/cfg["textures"][state]
            dst.parent.mkdir(parents=True,exist_ok=True)
            shutil.copyfile(ROOT/r["sheet"],dst)
            r.update(runtimeSheet=cfg["textures"][state],runtimeTextureKey=f"enemy_{SPECS[actor]['family']}_{state}",runtimeIntegrationActive=True)
        if actor=="ossuary-caster":
            shutil.copyfile(ROOT.parent/"projectile/ossuary-caster/bone-dart-256-v01.png",REPO/cfg["textures"]["projectile"])
        m.update(status="installed_pending_user_runtime_test",runtimeIntegrationActive=True,runtimeConfigId=cfg["id"],integrationAuthorization=runtime["authorization"])
        write(BUILD/actor/"sprite-manifest.json",m)
        write(BUILD/actor/"sprite-budget-manifest.json",{"version":1,"id":actor,"profile":"crowd","runtimeIntegrationActive":True,
            "estimatedRgbaMiB":m["estimatedRgbaMiB"],"dependencies":[],
            "sheets":[{"textureKey":r["runtimeTextureKey"],"path":r["runtimeSheet"],**{k:r[k] for k in ("frameWidth","frameHeight","frameCount","endFrame","footX","footY")}} for r in m["actions"]]
                + ([{"kind":"image","textureKey":"enemy_ossuary_caster_projectile","path":cfg["textures"]["projectile"]}] if actor=="ossuary-caster" else [])})
    for path,text in edits.items(): path.write_text(text,encoding="utf-8",newline="\n")
    runtime["poolEdits"]=pool_edits
    write(BUILD/"runtime-manifest.json",runtime)
    print(json.dumps(runtime,ensure_ascii=False,indent=2))


if __name__=="__main__":
    import sys
    sys.stdout.reconfigure(encoding="utf-8")
    main()
