"""Interpolate the original FlySwarm sheet; never consume H3 trial images."""
from pathlib import Path
import argparse
import json
import shutil
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent
REPO = ROOT.parents[2]
SOURCE = REPO / "assets/enemies/flyswarm/idle.png"
OUTPUT = ROOT / "_build/idle-rife64.png"
RUNTIME = REPO / "assets/enemies/flyswarm/idle-rife64.png"
DURATION_MS = 2000

def cells(path, count):
    sheet = Image.open(path).convert("RGBA")
    return [sheet.crop(((i%8)*512,(i//8)*512,(i%8+1)*512,(i//8+1)*512)) for i in range(count)]

def frame_times(count):
    return [round((i+1)*DURATION_MS/count/10)*10-round(i*DURATION_MS/count/10)*10 for i in range(count)]

def previews(sheet_path):
    before, after = cells(SOURCE, 32), cells(sheet_path, 64)
    preview_dir = ROOT / "previews"
    preview_dir.mkdir(exist_ok=True)
    try:
        font = ImageFont.truetype("C:/Windows/Fonts/msyh.ttc", 17)
    except OSError:
        font = ImageFont.load_default()
    full_frames, compare_frames = [], []
    for i, sprite in enumerate(after):
        background = Image.new("RGBA", (512,512), (43,47,49,255))
        draw = ImageDraw.Draw(background)
        for y in range(0,512,32):
            for x in range(0,512,32):
                if (x//32+y//32)%2:
                    draw.rectangle((x,y,x+31,y+31), fill=(52,56,58,255))
        background.alpha_composite(sprite)
        full_frames.append(background.convert("RGB").resize((384,384), Image.Resampling.LANCZOS))
        compare = Image.new("RGBA",(768,450),(34,38,42,255))
        draw = ImageDraw.Draw(compare)
        draw.text((24,16),"原动画：32帧 / 16 FPS",font=font,fill="white")
        draw.text((408,16),"插帧后：64帧 / 32 FPS / 尺寸+20%",font=font,fill="white")
        draw.text((24,48),"制作示意放大2倍；两侧均为2秒，非游戏截图",font=font,fill=(180,185,190,255))
        for center, image, factor in ((192,before[i//2],1.0),(576,sprite,1.2)):
            size = round(120*factor*2)
            root_y = 324
            image_y = root_y-30*factor*2
            display = image.resize((size,size),Image.Resampling.LANCZOS)
            compare.alpha_composite(display,(round(center-size/2),round(image_y-size/2)))
            draw.line((center-5,root_y,center+5,root_y),fill=(150,150,150,255))
            draw.line((center,root_y-5,center,root_y+5),fill=(150,150,150,255))
            for x,y,r in ((0,25,34),(-26,29,22),(26,29,22)):
                cx,cy=center+x*factor*2,root_y+y*factor*2
                rx,ry=r*factor*2,r*factor
                draw.ellipse((cx-rx,cy-ry,cx+rx,cy+ry),outline=(223,166,69,255),width=1)
        compare_frames.append(compare.convert("RGB"))
    for frames,name in ((full_frames,"flyswarm-rife64-2s.gif"),(compare_frames,"flyswarm-before-after-2s.gif")):
        frames[0].save(preview_dir/name,save_all=True,append_images=frames[1:],
                       duration=frame_times(64),loop=0,disposal=2,optimize=False)

def manifest(installed):
    result={
        "id":"flySwarm","source":"assets/enemies/flyswarm/idle.png",
        "sourceRuntimePath":"assets/enemies/flyswarm/idle.png",
        "sourceFrameCount":32,"sourceFrameRate":16,
        "output":"assets/enemies/flyswarm/idle-rife64.png" if installed else "_build/idle-rife64.png","runtimePath":"assets/enemies/flyswarm/idle-rife64.png",
        "textureKey":"enemy_flyswarm_idle","frameWidth":512,"frameHeight":512,
        "frameCount":64,"endFrame":63,"columns":8,"rows":8,"frameRate":32,
        "durationMs":2000,"loop":True,"wrapPair":[31,0],
        "sourceScale":1,"originalKeyMapping":"outputIndex = sourceIndex * 2",
        "worldScaleMultiplier":1.2,"displaySizeBefore":120,"displaySizeAfter":144,
        "profile":"crowd","rgbaMiBBefore":32,"rgbaMiBAfter":64,
        "budgetNote":"At crowd 64MiB upper limit, above 32MiB target. Native 512px keys are retained for the requested original art; no image resampling. Source alpha union occupies x=3..509,y=17..487, so trimming cannot restore the 32MiB target without resampling.",
        "assetOnly":not installed,"runtimeIntegrationActive":installed,
        "h3TrialsUsed":False,"preserveVerticalMotion":True,
        "report":"reports/rife.json","review":"reports/review.json",
        "productionTool":"rife-production-snapshot.py","pipelineVersion":"rife-v4.6-rgba-v8-exact-half-step",
        "preview":"previews/flyswarm-rife64-2s.gif",
        "comparison":"previews/flyswarm-before-after-2s.gif",
        "runtimeTesting":"Not run; user acceptance follows project policy."
    }
    (ROOT/"manifest.json").write_text(json.dumps(result,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--install",action="store_true")
    parser.add_argument("--reuse-generated",action="store_true")
    parser.add_argument("--rife",type=Path,help="Optional local RIFE executable path")
    args=parser.parse_args()
    if not args.reuse_generated:
        if not SOURCE.exists():
            raise FileNotFoundError(SOURCE)
        command=[sys.executable,str(ROOT/"rife-production-snapshot.py"),
                 "--sheet",str(SOURCE),"--out",str(OUTPUT),"--name","flyswarm-original",
                 "--frame-width","512","--frame-height","512","--cols","8","--frame-count","32",
                 "--frame-rate","16","--mode","loop","--out-cols","8",
                 "--preserve-vertical-motion",
                 "--preview-dir",str(ROOT/"_build/rife-source-clock"),
                 "--report",str(ROOT/"reports/rife.json")]
        if args.rife:
            command += ["--rife",str(args.rife)]
        subprocess.run(command,check=True)
        previews(OUTPUT)
    if args.install:
        if OUTPUT.exists():
            shutil.copy2(OUTPUT,RUNTIME)
        elif not (args.reuse_generated and RUNTIME.exists()):
            raise FileNotFoundError(OUTPUT)
    manifest(args.install or RUNTIME.exists())
    print("FlySwarm original animation: 32 -> 64 frames, 2 seconds, native pixels retained.")

if __name__=="__main__":
    main()
