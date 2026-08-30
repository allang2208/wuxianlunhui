"""Reuse approved Dev variation locally without the former smeared edge collar."""
import json
from pathlib import Path
import numpy as np
from PIL import Image

HERE = Path(__file__).resolve().parent
OUT = HERE / "_mine_visual_finish_v3_20260830"


def periodic_component(a):
    # Periodic-plus-smooth decomposition distributes the seam correction over
    # the image rather than collapsing a wide strip into one repeated row.
    h, w = a.shape[:2]
    boundary = np.zeros_like(a)
    boundary[0] = a[-1]-a[0]
    boundary[-1] = -boundary[0]
    delta = a[:,-1]-a[:,0]
    boundary[:,0] += delta
    boundary[:,-1] -= delta
    y,x = np.mgrid[0:h,0:w]
    denominator = 2*np.cos(2*np.pi*x/w)+2*np.cos(2*np.pi*y/h)-4
    denominator[0,0] = 1
    smooth = np.fft.fft2(boundary, axes=(0,1))/denominator[...,None]
    smooth[0,0] = 0
    return a-np.fft.ifft2(smooth, axes=(0,1)).real


def main():
    OUT.mkdir(exist_ok=True)
    data = np.load(HERE/"_mine_wall_dev_final_20260830/accepted-rock-periodic-ratios.npz")
    for part in ("face", "crown"):
        # Exclude historical 14% flattened seam bands before constructing new
        # seamless material; this preserves genuine approved source detail.
        field = data[part]
        field = field[85:-85,85:-85] if part == "crown" else field[30:-30,85:-85]
        field = np.stack([np.asarray(Image.fromarray(field[...,c].astype("float32"),"F").resize((512,512),Image.Resampling.BICUBIC)) for c in range(3)],axis=-1)
        field = periodic_component(field)
        field /= np.mean(field,axis=(0,1))
        field = 1+(np.clip(field,.55,1.7)-1)*.58
        y,x = np.mgrid[0:512,0:512]
        for index,key in enumerate("abc"):
            variant = field.copy()
            if index:
                blend = .7*np.sin(np.pi*x/511)**2*np.sin(np.pi*y/511)**2
                alternate = np.roll(field,(index*103,index*171),axis=(0,1))
                variant = field*(1-blend[...,None])+alternate*blend[...,None]
            rgb = np.uint8(np.clip(variant*np.array([97,103,106]),0,255))
            Image.fromarray(rgb).save(OUT/f"stone_{key}_{part}.png")
    (OUT/"stone-provenance.json").write_text(json.dumps({
        "source":"../_mine_wall_dev_final_20260830/accepted-rock-periodic-ratios.npz",
        "approvedImage":"../_mine_wall_a_dev_refine_20260830/wall_a_refine_v01_candidate.png",
        "method":"discard old flat collars, periodic-plus-smooth component, shared UV edges and interior-only ABC mixing",
        "newAIImages":False,"runtimeInstalled":False,
        "network":"this local preparation makes no network request; current authorized Dev batch status is in manifest.json"
    },ensure_ascii=False,indent=2),encoding="utf-8")


if __name__ == "__main__":
    main()
