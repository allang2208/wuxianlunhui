"""Coffin ward candidate sprites. Never writes runtime assets or configuration."""
from pathlib import Path
import argparse
import json
import math
import subprocess
import sys

import av
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy.ndimage import distance_transform_edt

ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parents[2]
BUILD = ROOT / "sprite-build"
ACTIONS = ("idle", "walking", "attacking", "dying")


def write_json(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def read_frames(action):
    with av.open(str(ROOT / "videos" / f"{action}-doubao-v01.mp4")) as container:
        return [frame.to_image().convert("RGB") for frame in container.decode(video=0)]


def prepare():
    selections = {}
    for action in ACTIONS:
        frames = read_frames(action)
        if len(frames) != 121 or frames[0].size != (720, 720):
            raise RuntimeError(f"Unexpected source: {action}")
        step = 4 if action in ("idle", "dying") else 2
        start, end = 0, 121
        candidates = []
        if action in ("idle", "walking"):
            # Proxy silhouettes serve only to select a natural cycle, never as alpha.
            proxies = []
            for frame in frames:
                rgb = np.asarray(frame)
                grey = cv2.cvtColor(rgb, cv2.COLOR_RGB2GRAY)
                mask = ((grey < 180) & (np.indices(grey.shape)[0] < 680)).astype(np.float32)
                proxies.append(cv2.resize(mask, (180, 180), interpolation=cv2.INTER_AREA))
            for s in range(16, 61, step):
                periods = range(48, 81, step) if action == "idle" else range(36, 65, step)
                for period in periods:
                    e = s + period
                    if e > 108:
                        continue
                    endpoint = float(np.abs(proxies[s]-proxies[e]).mean())
                    velocity = float(np.abs((proxies[s+step]-proxies[s])-(proxies[e]-proxies[e-step])).mean())
                    candidates.append(dict(start=s, endExclusive=e, period=period,
                                           endpointDelta=endpoint, velocityDelta=velocity,
                                           score=endpoint + velocity * .35))
            candidates.sort(key=lambda item: item["score"])
            best = candidates[0]
            start, end = best["start"], best["endExclusive"]
        indices = list(range(start, end, step))
        selections[action] = dict(start=start, endExclusive=end, sourceStep=step,
                                  sourceFrameIndices=indices, sourceFps=24,
                                  keyFps=24/step, outputFps=48/step,
                                  mode="loop" if action in ("idle", "walking") else "one-shot",
                                  cycleCandidates=candidates[:8],
                                  timingPolicy="Natural loop window; one-shots preserve 0-5s motion and the original final frame hold. No speed change.")
        print(action, json.dumps({k:v for k,v in selections[action].items() if k != "cycleCandidates"}), flush=True)
    write_json(BUILD / "selection.json", selections)
    request = json.loads((ROOT/"request.json").read_text(encoding="utf-8"))
    request.update(status="source_videos_approved_sprite_production_in_progress",
                   sourceApproval="User: 可用。生成先精灵图。",
                   scope="Four transparent sprite sheets and preview GIFs for coffin ward only; no runtime or gameplay integration.")
    for action in request["actions"]:
        action["status"] = "source_approved_for_sprites"
    write_json(ROOT / "request.json", request)


def clean_cutout(rgb, alpha):
    if alpha.shape != rgb.shape[:2]:
        alpha = cv2.resize(alpha, (rgb.shape[1], rgb.shape[0]))
    alpha = alpha.astype(np.uint8)
    # Detached watermarks/background are not parts of this character.
    mask = (alpha > 24).astype(np.uint8)
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, 8)
    if count < 2:
        raise RuntimeError("Empty foreground from BiRefNet")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    keep = cv2.dilate((labels == largest).astype(np.uint8), np.ones((3, 3), np.uint8)) > 0
    alpha[(~keep) | (alpha <= 24)] = 0
    reliable = alpha >= 224
    _, nearest = distance_transform_edt(~reliable, return_indices=True)
    rgb = rgb.copy()
    edge = (alpha > 0) & ~reliable
    rgb[edge] = rgb[nearest[0][edge], nearest[1][edge]]
    rgb[alpha == 0] = 0
    return np.dstack((rgb, alpha))


def cutouts():
    sys.path.insert(0, str(TOOLS))
    from rmbg_cutout import get_model, predict_alpha
    model = get_model()
    selections = json.loads((BUILD/"selection.json").read_text(encoding="utf-8"))
    for action in ACTIONS:
        frames = read_frames(action)
        indices = sorted(set([0] + selections[action]["sourceFrameIndices"]))
        out = BUILD/"cutouts"/action
        out.mkdir(parents=True, exist_ok=True)
        for n, index in enumerate(indices):
            path = out/f"f{index:03d}.png"
            if path.exists():
                continue
            alpha = predict_alpha(model, frames[index])
            rgba = clean_cutout(np.asarray(frames[index]), alpha)
            Image.fromarray(rgba).save(path)
            if n % 5 == 0 or n == len(indices)-1:
                print(f"[cutout] {action}: {n+1}/{len(indices)} (source {index})", flush=True)


def rgba_box(frame):
    y, x = np.nonzero(frame[..., 3])
    return [int(x.min()), int(y.min()), int(x.max()+1), int(y.max()+1)]


def layout(count, width, height):
    options = []
    for cols in range(1, min(count, 4096//width)+1):
        rows = math.ceil(count/cols)
        if rows*height <= 4096:
            options.append(((cols*rows-count, abs(math.log((cols*width)/(rows*height)))), cols, rows))
    if not options:
        raise RuntimeError("No single-sheet layout under 4096")
    _, cols, rows = min(options)
    return cols, rows


def pack(cells, cols, path):
    height, width = cells[0].shape[:2]
    sheet = Image.new("RGBA", (cols*width, math.ceil(len(cells)/cols)*height))
    for index, cell in enumerate(cells):
        sheet.paste(Image.fromarray(cell), (index%cols*width, index//cols*height))
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path)
    return sheet.size


def checker(cell):
    height, width = cell.shape[:2]
    yy, xx = np.indices((height, width))
    grid = (xx//12 + yy//12) % 2
    rgb = np.where(grid[..., None] == 0, np.array([52, 56, 62]), np.array([66, 70, 77])).astype(np.uint8)
    bg = Image.fromarray(rgb).convert("RGBA")
    bg.alpha_composite(Image.fromarray(cell))
    return bg.convert("RGB")


def gif_durations(milliseconds):
    points = [0]
    total = 0
    for value in milliseconds:
        total += value
        points.append(round(total/10)*10)
    return [b-a for a,b in zip(points, points[1:])]


def save_preview(cells, milliseconds, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    frames = [checker(cell) for cell in cells]
    frames[0].save(path, save_all=True, append_images=frames[1:],
                   duration=gif_durations(milliseconds), loop=0, disposal=2, optimize=False)
    return sum(gif_durations(milliseconds))


def compose():
    selections = json.loads((BUILD/"selection.json").read_text(encoding="utf-8"))
    # This transform belongs to the whole actor, never to a frame or action.
    scale = .35
    canvas = round(720*scale)
    anchor_x = canvas/2
    ref = np.asarray(Image.open(BUILD/"cutouts/idle/f000.png").convert("RGBA"))
    source_ground = rgba_box(ref)[3]-1
    body_mask = ref[..., 3].copy()
    body_mask[:, 400:] = 0  # torso/head/near foot; excludes the raised shield.
    by, bx = np.nonzero(body_mask)
    body_height = int(by.max()-by.min()+1)
    records = []
    for action in ACTIONS:
        spec = selections[action]
        frames = []
        for index in spec["sourceFrameIndices"]:
            frame = Image.open(BUILD/"cutouts"/action/f"f{index:03d}.png").convert("RGBA")
            rgba = np.asarray(frame.resize((canvas, canvas), Image.Resampling.LANCZOS)).copy()
            rgba[rgba[...,3] == 0, :3] = 0
            frames.append(rgba)
        boxes = [rgba_box(frame) for frame in frames]
        # Fixed crop per action, horizontally symmetric around the original center.
        radius = math.ceil(max(max(anchor_x-b[0], b[2]-anchor_x) for b in boxes))+8
        left = round(anchor_x-radius)
        top = min(b[1] for b in boxes)-8
        bottom = max(b[3] for b in boxes)+8
        width, height = 2*radius, bottom-top
        cells = []
        for rgba in frames:
            cell = np.zeros((height, width, 4), np.uint8)
            sx0, sy0, sx1, sy1 = max(0,left), max(0,top), min(canvas,left+width), min(canvas,bottom)
            cell[sy0-top:sy1-top,sx0-left:sx1-left] = rgba[sy0:sy1,sx0:sx1]
            cells.append(cell)
        count = len(cells)*2-(spec["mode"] == "one-shot")
        cols, rows = layout(len(cells), width, height)
        out_cols, out_rows = layout(count, width, height)
        sheet = BUILD/"source-sheets"/f"{action}.png"
        pack(cells, cols, sheet)
        durations = [1000/spec["outputFps"]]*count
        if spec["mode"] == "one-shot":
            durations[-1] = 1000/24  # preserve source f120's hold even in 12fps death.
        record = dict(action=action, sourceVideo=f"videos/{action}-doubao-v01.mp4",
                      sourceSheet=sheet.relative_to(ROOT).as_posix(),
                      sourceFrameIndices=spec["sourceFrameIndices"], sourceKeyCount=len(cells),
                      sourceCols=cols, sourceRows=rows, keyFps=spec["keyFps"],
                      frameWidth=width, frameHeight=height, frameCount=count, endFrame=count-1,
                      cols=out_cols, rows=out_rows, outputFps=spec["outputFps"], mode=spec["mode"],
                      sourceScale=scale, sourceAnchorX=360, sourceGroundY=source_ground,
                      cropScaled=[left,top,left+width,bottom], footX=anchor_x-left,
                      footY=source_ground*scale-top, frameDurationsMs=durations,
                      durationMs=sum(durations), sheetWidth=out_cols*width, sheetHeight=out_rows*height,
                      rgbaMiB=out_cols*width*out_rows*height*4/1048576,
                      emptyCellRatio=(out_cols*out_rows-count)/(out_cols*out_rows))
        records.append(record)
        print("[compose]", action, f"{width}x{height}, {count} frames, {record['rgbaMiB']:.2f} MiB", flush=True)
    total = sum(rec["rgbaMiB"] for rec in records)
    write_json(BUILD/"source-manifest.json", dict(actor="coffin-ward", sourceScale=scale,
               sourceBodyHeightPx=body_height, preparedBodyHeightPx=body_height*scale,
               transformPolicy="One fixed whole-canvas scale for every frame and action; one symmetric crop per action. No per-frame translation, fitting, foot correction or trajectory straightening.",
               targetMiB=32, admissionMiB=64, estimatedRgbaMiB=total,
               bodyReference="minerZombie; world display/collision and camera acceptance deferred to runtime integration",
               runtimeIntegrationActive=False, actions=records))
    print(f"[compose] total {total:.3f} MiB, body {body_height*scale:.1f}px", flush=True)


def interpolate():
    manifest = json.loads((BUILD/"source-manifest.json").read_text(encoding="utf-8"))
    for rec in manifest["actions"]:
        action = rec["action"]
        target = BUILD/"spritesheets"/f"{action}.png"
        report = BUILD/"reports"/f"{action}-rife.json"
        if target.exists() and report.exists():
            print(f"[cached RIFE] {action}", flush=True)
            continue
        cmd = [sys.executable, str(TOOLS/"rife-spritesheet-interpolate.py"),
               "--sheet",str(ROOT/rec["sourceSheet"]),"--out",str(target),"--name",f"coffin-ward-{action}",
               "--frame-width",str(rec["frameWidth"]),"--frame-height",str(rec["frameHeight"]),
               "--cols",str(rec["sourceCols"]),"--frame-count",str(rec["sourceKeyCount"]),
               "--frame-rate",str(rec["keyFps"]),"--mode",rec["mode"],"--out-cols",str(rec["cols"]),
               "--preview-dir",str(BUILD/"previews/rife"),"--report",str(report),
               "--repair-red-outliers","--preserve-vertical-motion"]
        report.parent.mkdir(parents=True,exist_ok=True)
        print(f"[RIFE begin] {action}",flush=True)
        with (report.with_suffix(".log")).open("w",encoding="utf-8") as log:
            subprocess.run(cmd,check=True,stdout=log,stderr=subprocess.STDOUT)
        print(f"[RIFE complete] {action}",flush=True)


def finish():
    source = json.loads((BUILD/"source-manifest.json").read_text(encoding="utf-8"))
    records, sequences = [], {}
    for rec in source["actions"]:
        action = rec["action"]
        path = BUILD/"spritesheets"/f"{action}.png"
        sheet = np.asarray(Image.open(path).convert("RGBA"))
        width,height,cols = rec["frameWidth"],rec["frameHeight"],rec["cols"]
        cells = [sheet[i//cols*height:(i//cols+1)*height,i%cols*width:(i%cols+1)*width].copy()
                 for i in range(rec["frameCount"])]
        sequences[action] = cells
        preview = BUILD/"previews/final"/f"{action}.gif"
        gif_ms = save_preview(cells, rec["frameDurationsMs"], preview)
        report = json.loads((BUILD/"reports"/f"{action}-rife.json").read_text(encoding="utf-8"))
        record = {**rec, "sheet":path.relative_to(ROOT).as_posix(), "gif":preview.relative_to(ROOT).as_posix(),
                  "gifDurationMs":gif_ms, "rgbaMiB":sheet.shape[0]*sheet.shape[1]*4/1048576,
                  "loop":rec["mode"] == "loop", "repeat":-1 if rec["mode"] == "loop" else 0,
                  "originalKeyOutputIndices":list(range(0,rec["frameCount"],2)),
                  "rifeReport":f"sprite-build/reports/{action}-rife.json",
                  "intrinsicProductionMetrics":report["validation"],
                  "sourceApprovedByUser":True,"finalSpriteApprovedByUser":False,
                  "runtimeIntegrationActive":False}
        if action == "dying":
            record.update(corpseFrame=rec["endFrame"], holdLastFrameOnCompletion=True)
            Image.fromarray(cells[-1]).save(BUILD/"spritesheets/corpse.png")
        if action == "attacking":
            record["eventCandidates"] = {"visualGroundContactOutputFrames":[50,52],
                                         "status":"Provisional visual contact only; no damage/audio timing registered."}
        records.append(record)
    font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",20)
    small = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc",14)
    names = dict(idle="待机",walking="行走",attacking="攻击",dying="死亡")
    panels = []
    for n in range(121):
        panel = Image.new("RGB",(640,640),(28,31,37))
        draw = ImageDraw.Draw(panel)
        for k,rec in enumerate(records):
            action = rec["action"]
            t = n/24
            index = int((t*rec["outputFps"])+1e-7)
            index = index%rec["frameCount"] if rec["loop"] else min(index,rec["endFrame"])
            tile = checker(sequences[action][index])
            x,y = k%2*320,k//2*320
            panel.paste(tile,(x+(320-tile.width)//2,y+38+(250-tile.height)//2))
            draw.text((x+14,y+8),names[action],font=font,fill="white")
            draw.text((x+14,y+296),f"{rec['frameCount']} 帧 | {rec['outputFps']:g} fps | {rec['durationMs']/1000:.3f}s",font=small,fill=(188,196,208))
        panels.append(panel)
    overview = BUILD/"previews/final/four-actions-overview.gif"
    panels[0].save(overview,save_all=True,append_images=panels[1:],duration=gif_durations([1000/24]*121),loop=0,disposal=2,optimize=False)
    panels[0].save(overview.with_suffix(".png"))
    contact = Image.new("RGB",(1680,1160),(28,31,37))
    draw = ImageDraw.Draw(contact)
    for row,rec in enumerate(records):
        action = rec["action"]
        chosen = [0,24,48,52,76,120] if action == "attacking" else ([0,12,20,26,34,60] if action == "dying" else np.linspace(0,rec["endFrame"],6).astype(int).tolist())
        for col,index in enumerate(chosen):
            tile = checker(sequences[action][index])
            x,y = col*280,row*290
            contact.paste(tile,(x+(280-tile.width)//2,y+30))
            draw.text((x+8,y+4),f"{names[action]} · 帧 {index}",font=small,fill="white")
    contact.save(BUILD/"previews/final/contact.png")
    manifest = {**source,"actions":records,"estimatedRgbaMiB":sum(r["rgbaMiB"] for r in records),
                "status":"sprite_candidates_delivered_awaiting_user_review",
                "sourceApproval":"User: 可用。生成先精灵图。",
                "pipeline":"ComfyUI-RMBG BiRefNet-general; fixed actor scale; per-action crop; 2x RIFE v4.6 split RGB/alpha",
                "overviewGif":overview.relative_to(ROOT).as_posix(),
                "previewNote":"GIFs repeat for review; attack/death are one-shot. Manifest frameDurationsMs preserves exact source timing; GIF is rounded to 10ms.",
                "budgetNote":"Above 32MiB target to retain full 5s attack/death and clear body detail; below 64MiB admission ceiling. No dependencies. corpse.png is an optional preview/export of the final death frame, not an additional runtime texture.",
                "knownSourceLimitations":["Small source pose drift and occasional RGB color fringes are retained in original keys.","Runtime foot alignment, display size, collision, hit/audio timing and loop visual acceptance remain untested."],
                "testsRun":False,"runtimeVerificationRun":False,"standaloneBudgetValidationRun":False}
    write_json(BUILD/"sprite-manifest.json",manifest)
    budget = dict(version=1,id="coffin-ward",profile="crowd",runtimeIntegrationActive=False,dependencies=[],
                  sheets=[dict(textureKey=f"enemy_coffin_ward_{r['action']}",path=(ROOT/r["sheet"]).relative_to(TOOLS.parents[1]).as_posix(),
                               **{key:r[key] for key in ("frameWidth","frameHeight","frameCount","endFrame","footX","footY")}) for r in records])
    write_json(BUILD/"sprite-budget-manifest.json",budget)
    request = json.loads((ROOT/"request.json").read_text(encoding="utf-8"))
    request.update(status=manifest["status"],spriteManifest="sprite-build/sprite-manifest.json",spriteOverview=manifest["overviewGif"])
    for item in request["actions"]:
        rec = next(r for r in records if r["action"] == item["id"])
        item.update(status="source_approved_sprite_candidate_delivered",spriteSheet=rec["sheet"],spriteGif=rec["gif"])
    write_json(ROOT/"request.json",request)
    lines = ["# 棺板卫尸：四动作透明精灵图（2026-08-30）", "",
             "用户已批准四条源视频，本轮只制作精灵图与预览。未接入游戏，未修改战斗、碰撞或运行时配置。", "",
             "![四动作预览](sprite-build/previews/final/four-actions-overview.gif)", "",
             "| 动作 | PNG精灵表 | GIF | 源视频 | 单帧尺寸 | 有效帧 / 列×行 | 输出fps | 时长 | RGBA MiB |",
             "|---|---|---|---|---|---|---|---|---|"]
    for r in records:
        lines.append(f"| {names[r['action']]} | [PNG]({r['sheet']}) | [GIF]({r['gif']}) | [MP4]({r['sourceVideo']}) | {r['frameWidth']}×{r['frameHeight']} | {r['frameCount']} / {r['cols']}×{r['rows']} | {r['outputFps']:g} | {r['durationMs']/1000:.3f}s | {r['rgbaMiB']:.2f} |")
    lines += ["", "## 比例、时序与归档", "",
              "- 统一源缩放0.35；源主体约581px，输出站立主体约203px（不按棺板顶点量体型）。每动作一个横向对称裁框，全部帧共用脚点；不逐帧缩放、居中或拉直轨迹。源720×720透明关键帧保存在` sprite-build/cutouts/`。",
              "- 待机采用源帧56–100、步长4，循环边界104；行走50–94、步长2，循环边界96。RIFE含末→首衔接。",
              "- 攻击保留源帧0–120、步长2；死亡0–120、步长4，均不回绕、不加速。插帧只填中间帧，原关键帧位于偶数索引。",
              "- 一次性动作总时长均为5.041667秒；死亡最后一帧时长为41.666667ms，其他帧为83.333333ms。不能简单以61/12计算后声称完全等时。GIF按累计10ms量化为5.040秒。",
              "- 死亡末帧为60；`corpse.png`仅为同一末帧的便利用导出，不应另注册一张常驻纹理。GIF重复仅用于查看，死亡不在游戏中循环。",
              "- 攻击接触姿态候选在输出帧50–52附近，未设定伤害或声音事件；游戏时钟、显示体量、最大镜头清晰度与矿工僵尸对齐均留待接入阶段。", "",
              "| 动作 | footX | footY | endFrame |", "|---|---|---|---|"]
    for r in records:
        lines.append(f"| {names[r['action']]} | {r['footX']:g} | {r['footY']:.2f} | {r['endFrame']} |")
    lines += ["", "## 预算与验收边界", "",
              f"crowd整套基础RGBA纹理估算 **{manifest['estimatedRgbaMiB']:.2f}MiB**，无专属依赖；高于32MiB目标，低于64MiB准入上限。保留完整5秒攻击、死亡时序和主体细节是超目标的主要原因，攻击表是最大项。计算包含末行空格，不使用PNG压缩大小估算显存。",
              "所有图集最长边小于4096px，空尾格不参与动画。该估算不包含驱动、渲染目标或场景内其他角色；同场组合512MiB、过渡640MiB预算须在接入时与其他实际资源合并，当前没有实机性能结论。", "",
              "RIFE自身生产报告位于`sprite-build/reports/`；它记录空帧、触边、透明RGB和插帧原关键帧保留情况，不能替代游戏或观感验收。源片的轻微姿态漂移和彩边没有通过重新绘制或几何拉直消除。", "",
              "**未运行测试、构建、浏览器/游戏运行时验证，也未单独运行预算检查脚本；按约定由用户测试。** 用户仍需重点看循环接缝、包布与棺板稳定性、砸击方向和倒地末姿。精灵图尚待用户视觉验收。", "",
              "## 文件与重建", "",
              "- [最终清单](sprite-build/sprite-manifest.json)：帧数、裁框、脚点、逐帧时长、原始帧映射及来源。",
              "- [预算清单](sprite-build/sprite-budget-manifest.json)：候选纹理键与资源路径，未自动注册。",
              "- [动作抽帧预览](sprite-build/previews/final/contact.png)。",
              "- `build-sprites.py`：依次执行prepare、cutouts、compose、interpolate、finish；使用ComfyUI虚拟环境Python。cutouts需让既有ComfyUI-RMBG更新其模型缓存；其余步骤只写本任务目录。",
              "- 更改选帧或缩放后不要复用旧RIFE缓存；请在新的任务输出目录重建，保留当前已交付版本。",
              "- 原母图、四条MP4及其provenance未改动；此前视频生成过程见[原视频交付记录](DELIVERY.md)。", ""]
    (ROOT/"SPRITE_DELIVERY.md").write_text("\n".join(lines).replace("` sprite-build", "`sprite-build"),encoding="utf-8")
    summary_keys = ("emptyFrames","touchingFrames","originalKeyFramesPreservedAtEvenIndices","nonzeroRgbInTransparentPixels","visibleDarkOutlierFrames","visibleRedOutlierFrames","middleFrameHeldSourceKeyFallbacks")
    print(json.dumps([dict(action=r["action"],frames=r["frameCount"],cell=[r["frameWidth"],r["frameHeight"]],MiB=r["rgbaMiB"],metrics={k:r["intrinsicProductionMetrics"][k] for k in summary_keys}) for r in records]),flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("prepare", "cutouts", "compose", "interpolate", "finish"))
    args = parser.parse_args()
    request_path = ROOT/"request.json"
    if request_path.exists() and json.loads(request_path.read_text(encoding="utf-8")).get("runtimeIntegrationActive"):
        raise SystemExit("This revision is installed. Rebuild in a new candidate directory to preserve approved sheets and runtime provenance.")
    globals()[args.stage]()
