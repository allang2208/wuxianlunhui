"""Install the approved coffin ward sprites/config. No game/tests are launched."""
from pathlib import Path
import copy
import json
import re
import shutil

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[4]
BUILD = ROOT / "sprite-build"
STATE_MAP = {"idle": "idle", "walking": "walk", "attacking": "attack", "dying": "death"}


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    manifest = json.loads((BUILD / "sprite-manifest.json").read_text(encoding="utf-8"))
    configs = json.loads((REPO / "data/enemy-config.json").read_text(encoding="utf-8"))
    if "coffinWard" in configs:
        raise RuntimeError("Already installed; preserve runtime tuning and edit the coffinWard entry explicitly.")
    miner = configs["minerZombie"]
    miner_cell = Image.open(REPO / miner["textures"]["idle"]).convert("RGBA").crop((0, 0, 512, 512))
    mask = (np.asarray(miner_cell)[..., 3] > 24).astype(np.uint8)
    # Reference measurement only. Opening discards the thin pickaxe handle; no asset is modified.
    body = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((11, 11), np.uint8))
    _, _, stats, _ = cv2.connectedComponentsWithStats(body, 8)
    body_box = stats[1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))]
    reference_body_height = int(body_box[cv2.CC_STAT_HEIGHT])
    body_display_height = reference_body_height * miner["render"]["spriteSize"] / 512
    scale = body_display_height / manifest["preparedBodyHeightPx"]
    textures = {"referenceCell": 256, "frameLayouts": {}}
    actions = {}
    for record in manifest["actions"]:
        state = STATE_MAP[record["action"]]
        relative_path = f"assets/enemies/coffin_ward/{state}.png"
        textures[state] = relative_path
        layout = {key:record[key] for key in ("frameWidth", "frameHeight", "frameCount", "endFrame", "footX", "footY")}
        layout.update(columns=record["cols"], rows=record["rows"], duration=record["durationMs"],
                      frameRate=record["outputFps"], frameDurations=record["frameDurationsMs"], repeat=record["repeat"])
        textures["frameLayouts"][state] = layout
        actions[state] = {"textureKey":f"enemy_coffin_ward_{state}", "path":relative_path, **layout,
                          "sourceVideo":record["sourceVideo"], "previewGif":record["gif"], "rgbaMiB":record["rgbaMiB"]}
    idle = textures["frameLayouts"]["idle"]
    textures.update(idleFrameWidth=idle["frameWidth"], idleFrameHeight=idle["frameHeight"],
                    idleFrameCount=idle["frameCount"], idleSheetColumns=idle["columns"])
    duration = textures["frameLayouts"]["attack"]["duration"]
    render = copy.deepcopy(miner["render"])
    render.update(spriteSize=256*scale, bodyDisplayHeight=body_display_height,
                  footOffsetY=(idle["footY"]-idle["frameHeight"]/2)*scale)
    config = dict(id="coffinWard", name="棺板卫尸", type="普通", category="monster",
                  family="僵尸", families=["僵尸"], poolWhitelistOnly=True, color="#665b4a",
                  size=17, collisionRadius=miner["collisionRadius"], height=miner["render"]["collisionHeight"],
                  hp=240, maxHp=240, speed=90, level=4, rank="normal",
                  str=22, dex=6, con=24, int=3, wis=5, luck=3,
                  showWeapon=False, basicMeleeResolver=True, attackRange=80, attackDistance=80,
                  attack=dict(type="thrust", cooldown=6000, range=80, dynamicRange=80, width=42, knockback=45),
                  basicMelee=dict(approachReach=80, impactReach=80, width=42, forwardOffset=0, backExtension=8,
                                  requiresSameSurface=True, requiresLosAtImpact=True,
                                  timeline=dict(durationMs=duration, frameCount=121, contactFrame=52,
                                                activeFrames=[52,53], rebaseOnImpact=False)),
                  attackSkills=dict(strike=dict(comment="原视频5.041667秒时序；0-based第52帧单体拳砸，接触窗52–53，只结算一次；不启动通用突刺或范围冲击。",
                                               range=80, duration=duration, frames=121, hitFrame=52,
                                               damageMul=1.25, knockback=45, cooldown=6000)),
                  death=dict(animMs=textures["frameLayouts"]["death"]["duration"], holdMs=1000, fadeMs=300),
                  ai=dict(aggroRange=9999, pacingRange=60, loseTimeout=3000), render=render, textures=textures,
                  description="头部被灰白裹尸布完全缠住的墓穴卫尸，左臂抱持腐朽棺板，右拳增生为畸形硬结。移动缓慢、生命较高，蓄力后以右拳砸击锁定的单体。仅由恐怖地牢普通怪白名单生成；本阶段棺板不提供独立格挡或反射技能。",
                  skills=[dict(name="棺旁重拳", desc="停步锁定目标与方向，5.042秒动作第52帧造成物攻×1.25物理伤害并击退45；起手冷却6秒。后撤、绕后、隔墙或换层可躲避，眩晕、冻结、石化与恐惧可打断未结算攻击。")],
                  attackType="物理（单体拳砸）")

    # Prepare narrowly scoped edits from each current copy; don't serialize unrelated entries.
    edits = {}
    for name in ("data/enemy-config.json", "public/data/enemy-config.json"):
        path = REPO/name
        text = path.read_text(encoding="utf-8")
        if '"coffinWard":' in text:
            raise RuntimeError(f"Existing coffinWard entry: {name}")
        marker = '  "minerZombie": {'
        block = json.dumps({"coffinWard":config},ensure_ascii=False,indent=2)[2:-2]
        edits[path] = text.replace(marker, block+",\n"+marker, 1)
        if marker not in text:
            raise RuntimeError(f"Insertion anchor missing: {name}")
    pool_edits = []
    decoder = json.JSONDecoder()
    for name in ("data/dungeon-config.json", "public/data/dungeon-config.json"):
        path = REPO/name
        text = path.read_text(encoding="utf-8")
        for section in ("zombieDungeon", "zombieDungeonBeginner", "zombieDungeonMid"):
            start = text.index(f'"{section}":')
            object_start = text.index("{", start)
            _, length = decoder.raw_decode(text[object_start:])
            section_text = text[object_start:object_start+length]
            count = 0
            def add_to_pool(match):
                nonlocal count
                value = match.group(0)
                if '"coffinWard"' in value or '"fatZombie"' not in value:
                    return value
                count += 1
                return re.sub(r'(^\s*)"fatZombie",',r'\1"fatZombie",\n\1"coffinWard",',value, count=1, flags=re.MULTILINE)
            changed = re.sub(r'"poolKeys"\s*:\s*\[[^\]]*\]', add_to_pool, section_text)
            text = text[:object_start] + changed + text[object_start+length:]
            pool_edits.append(dict(file=name, section=section, pools=count))
        edits[path] = text

    for record in manifest["actions"]:
        state = STATE_MAP[record["action"]]
        dest = REPO/textures[state]
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(ROOT/record["sheet"],dest)
    for path,text in edits.items():
        path.write_text(text,encoding="utf-8",newline="\n")

    runtime = dict(id="coffinWard", approvedAfterSpriteDelivery="User: 继续", status="installed_pending_user_runtime_test",
                   runtimeIntegrationActive=True, runtimeVerified=False, testsRun=False,
                   sourceManifest="sprite-build/sprite-manifest.json", sourceScale=manifest["sourceScale"],
                   reference=dict(id="minerZombie", sourceBodyBox=body_box[:4].tolist(),
                                  sourceBodyHeightPx=reference_body_height, spriteSize=miner["render"]["spriteSize"],
                                  bodyDisplayHeight=body_display_height, measurement="11px opening, largest torso component; reference measurement only",
                                  inGameComparisonPerformed=False),
                   renderScale=scale, spriteSize=render["spriteSize"], collisionRadius=config["collisionRadius"],
                   profile="crowd", rgbaMiB=manifest["estimatedRgbaMiB"], dependencies=[],
                   actions=actions, poolEdits=pool_edits,
                   integrationFiles=["src/entities/enemy-types/coffin-ward.js","src/entities/enemy-types.js",
                                     "src/world/zombie-dungeon.js","src/phaser/scenes/BootScene.js",*[str(p.relative_to(REPO)).replace('\\','/') for p in edits]],
                   risks=["Source color fringes and minor pose drift retained.","Full approved attack lasts 5.04s; no acceleration.",
                          "Per-action feet, flip, collider, contact timing, controls and corpse cleanup require user runtime testing."])
    write_json(ROOT/"runtime/manifest.json",runtime)
    manifest.update(runtimeIntegrationActive=True, finalSpriteApprovedByUser=True,
                    runtimeManifest="runtime/manifest.json", status="installed_pending_user_runtime_test")
    for record in manifest["actions"]:
        state = STATE_MAP[record["action"]]
        record.update(finalSpriteApprovedByUser=True,runtimeIntegrationActive=True,runtimeTextureKey=f"enemy_coffin_ward_{state}",runtimeSheet=textures[state])
    write_json(BUILD/"sprite-manifest.json",manifest)
    request = json.loads((ROOT/"request.json").read_text(encoding="utf-8"))
    request.update(status="installed_pending_user_runtime_test",runtimeIntegrationActive=True,runtimeManifest="runtime/manifest.json",
                   scope="Coffin ward integrated into horror dungeon normal slots; three other mother designs remain candidates.")
    for action in request["actions"]:
        action["status"]="source_and_sprite_approved_runtime_installed_pending_user_test"
    write_json(ROOT/"request.json",request)
    budget = json.loads((BUILD/"sprite-budget-manifest.json").read_text(encoding="utf-8"))
    budget["runtimeIntegrationActive"] = True
    for item,record in zip(budget["sheets"],manifest["actions"]):
        state = STATE_MAP[record["action"]]
        item.update(textureKey=f"enemy_coffin_ward_{state}",path=textures[state])
    write_json(BUILD/"sprite-budget-manifest.json",budget)
    print(json.dumps(dict(spriteSize=render["spriteSize"],bodyDisplayHeight=body_display_height,
                          sourceSheetsUnchanged=True,poolEdits=pool_edits),ensure_ascii=False),flush=True)


if __name__ == "__main__":
    main()
