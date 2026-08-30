"""Build a local, uninstalled candidate from reviewed Dev materials on v3 geometry.

AI supplies material variation only. Blender owns silhouette, shared seams and
lighting; wood/iron refinements retain component masks and the original alpha.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
SOURCE = HERE/"_mine_visual_finish_v3_20260830"
OUT = SOURCE/"dev-candidate"


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name,HERE/filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def write(path, data):
    path.write_text(json.dumps(data,ensure_ascii=False,indent=2)+"\n",encoding="utf-8")


def materials(raw):
    OUT.mkdir(exist_ok=True)
    stone = module("v3_periodic", "prepare-mine-v3-stone.py")
    sampler = module("v3_sample", "mine-dev-finish-kit.py")
    lighting = module("v3_lighting", "finalize-abandoned-mine-wall-kit-ai12.py")
    native = np.asarray(Image.open(SOURCE/"wall_a_native.png").convert("RGBA"))
    keyed = OUT/"rock_keyed.png"
    subprocess.run([sys.executable,str(HERE/"key-world122-building-body.py"),str(raw),str(keyed),
                    "--threshold","80","--remove-all-green","--nearest-opaque-edge-rgb"],check=True)
    source = Image.open(keyed).convert("RGBA")
    valid = np.minimum(np.asarray(source.getchannel("A")),native[...,3])
    valid = np.asarray(Image.fromarray(valid).filter(ImageFilter.MinFilter(5)))
    chosen = np.asarray(source.convert("RGB").filter(ImageFilter.GaussianBlur(.7)),dtype=float)
    # Slate uses a fixed mineral palette. Per-channel division near a green
    # backdrop creates false purple/green bands, so transfer luminance only.
    luminance = chosen @ np.array([.2126,.7152,.0722])
    low = lighting._masked_low_frequency(luminance/255,valid,radius=42)*255
    scalar = np.clip(luminance/np.maximum(low,8),.55,1.65)
    scalar[valid<230] = 1
    ratio = np.repeat(scalar[...,None],3,axis=2)
    geo = json.loads((SOURCE/"geometry.json").read_text(encoding="utf-8"))["wall"]
    dx,dy = 64*1024/geo["display"][0],32*1024/geo["display"][1]
    foot = float(np.flatnonzero(native[:,512,3]>230)[-1])
    delta = np.array(geo["camera"]["position"])-np.array(geo["camera"]["target"])
    elevation = math.atan2(delta[2],np.linalg.norm(delta[:2]))
    height = geo["modelCore"][2]*math.cos(elevation)*1024/geo["camera"]["orthoScale"]
    v,u = np.mgrid[0:512,0:512]/511
    face_x = 360+(u-.5)*dx
    fields = {
        "face":sampler.sample(ratio,face_x,foot+(dy/dx)*(face_x-512)-v*height),
        "crown":sampler.sample(ratio,512+dx*(u-v),foot-height+dy*(u+v-2.18)),
    }
    for part, field in fields.items():
        field = stone.periodic_component(field)
        field /= np.mean(field,axis=(0,1))
        field = 1+(np.clip(field,.55,1.65)-1)*.78
        for index,key in enumerate("abc"):
            blend = .7*np.sin(np.pi*u)**2*np.sin(np.pi*v)**2 if index else np.zeros_like(u)
            alternate = np.roll(field,(index*103,index*171),axis=(0,1))
            variant = field*(1-blend[...,None])+alternate*blend[...,None]
            Image.fromarray(np.uint8(np.clip(variant*np.array([97,103,106]),0,255))).save(OUT/f"stone_{key}_{part}.png")
    write(OUT/"material-source.json",{
        "rockRaw":str(raw.relative_to(SOURCE)),"selection":"agent-selected material candidate; not user acceptance",
        "generationRecord":str(raw.with_suffix(".generation.json").relative_to(SOURCE)),
        "method":"keyed monochrome unlit variation from Dev raw, periodic-plus-smooth tiles, interior-only ABC mixing; Blender relighting",
        "nativeGeometry":"../mine_visual_v3.blend","sameGeometry":True,"runtimeInstalled":False,
        "smoothingSourcePx":.7,"variationStrength":.78,"baseColor":[97,103,106],
    })


def components():
    lighting = module("component_lighting", "finalize-abandoned-mine-wall-kit-ai12.py")
    records = []
    for key, native_name, mask_name, target_name in (
        ("gate","gate_native.png","gate_component_mask.png","gate.png"),
        ("supports","wall_c_native.png","wall_c_component_mask.png","wall_c.png"),
    ):
        raw = SOURCE/key/"raw.png"
        keyed = OUT/f"{key}_keyed.png"
        subprocess.run([sys.executable,str(HERE/"key-world122-building-body.py"),str(raw),str(keyed),
                        "--threshold","80","--remove-all-green","--nearest-opaque-edge-rgb"],check=True)
        generated = np.asarray(Image.open(keyed).convert("RGBA"))
        native = np.asarray(Image.open(OUT/native_name).convert("RGBA"))
        mask = np.asarray(Image.open(OUT/mask_name).convert("RGBA"))
        result = native.copy()
        counts = []
        for channel, name in ((0,"wood"),(1,"iron")):
            component = (mask[...,channel]>200)&(native[...,3]>200)
            valid = component&(generated[...,3]>230)
            alpha = np.uint8(valid)*255
            raw_low = np.stack([lighting._masked_low_frequency(generated[...,c]/255,alpha,radius=12)
                                for c in range(3)],axis=-1)
            native_low = np.stack([lighting._masked_low_frequency(native[...,c]/255,alpha,radius=12)
                                   for c in range(3)],axis=-1)
            gain = np.clip((native_low*1.10/np.maximum(raw_low,1/255))**.65,.65,1.35)
            rgb = np.clip(generated[...,:3]*gain,0,255)
            # Keep authored edge RGB; no generated green or shifted outline is
            # admitted. Material transfer stays inside the existing components.
            weight = np.asarray(Image.fromarray(alpha).filter(ImageFilter.GaussianBlur(.8)))/255
            weight *= valid
            result[...,:3] = np.uint8(np.rint(result[...,:3]*(1-weight[...,None])+rgb*weight[...,None]))
            counts.append({"component":name,"authoredPixels":int(component.sum()),"materialPixels":int(valid.sum())})
        result[result[...,3]==0,:3]=0
        Image.fromarray(result).save(OUT/target_name)
        records.append({"asset":key,"raw":str(raw.relative_to(SOURCE)),"output":target_name,
                        "alpha":"unchanged authored v3 alpha", "componentCoverage":counts})
    for key in "ab":
        Image.open(OUT/f"wall_{key}_native.png").save(OUT/f"wall_{key}.png")
    write(OUT/"component-materials.json",{"method":"component-scoped Dev RGB with native light envelope; no alpha/geometry change",
                                          "outputs":records,"runtimeInstalled":False})


if __name__ == "__main__":
    p=argparse.ArgumentParser()
    p.add_argument("stage",choices=("materials","components"))
    p.add_argument("--rock-raw",help="explicit source override; otherwise reuse material-source.json")
    args=p.parse_args()
    if args.stage=="materials":
        record=OUT/"material-source.json"
        current=json.loads(record.read_text(encoding="utf-8"))["rockRaw"] if record.exists() else "rock/raw.png"
        materials(SOURCE/(args.rock_raw or current))
    else:
        components()
