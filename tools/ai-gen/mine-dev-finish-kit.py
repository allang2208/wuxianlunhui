"""Finish the accepted Dev rock family and refine the modeled wood/iron only.

Stages are production operations, never game tests. Runtime install is separate.
"""
import argparse
import importlib.util
import json
import math
from pathlib import Path
import hashlib
import shutil
import subprocess
import sys

import numpy as np
from PIL import Image, ImageFilter

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "_mine_wall_pbr_kit_v2_20260830"
SELECTED = HERE / "_mine_wall_a_dev_refine_20260830"
OUT = HERE / "_mine_wall_dev_final_20260830"


def write_json(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_module(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def read_image(path):
    return np.asarray(Image.open(path).convert("RGBA"))


def sample(values, x, y):
    x, y = np.clip(x, 0, values.shape[1]-1), np.clip(y, 0, values.shape[0]-1)
    x0, y0 = np.floor(x).astype(int), np.floor(y).astype(int)
    x1, y1 = np.minimum(x0+1, values.shape[1]-1), np.minimum(y0+1, values.shape[0]-1)
    tx, ty = (x-x0)[..., None], (y-y0)[..., None]
    return ((1-tx)*values[y0, x0]+tx*values[y0, x1])*(1-ty) + ((1-tx)*values[y1, x0]+tx*values[y1, x1])*ty


def periodic(tile, vertical=False):
    tile = tile.copy()
    for axis in ((1, 0) if vertical else (1,)):
        data = np.moveaxis(tile, axis, 0)
        width = max(2, round(len(data)*.14))
        seam = (data[0]+data[-1])*.5
        for i in range(width):
            t = 1-i/(width-1)
            weight = t*t*(3-2*t)
            data[i] = data[i]*(1-weight)+seam*weight
            data[-1-i] = data[-1-i]*(1-weight)+seam*weight
        tile = np.moveaxis(data, 0, axis)
    return tile


def tile_variant(tile, index, top=False):
    if index == 0:
        return tile
    h, w = tile.shape[:2]
    y, x = np.mgrid[0:h, 0:w]
    weight = .25*np.sin(np.pi*x/(w-1))**2*np.sin(np.pi*y/(h-1))**2
    alternate = np.roll(tile, (index*w//3, index*h//5 if top else 0), axis=(1, 0))
    return tile*(1-weight[..., None])+alternate*weight[..., None]


def prepare_stone():
    OUT.mkdir(exist_ok=True)
    authored = read_image(SOURCE / "wall_a.png")
    chosen = read_image(SELECTED / "wall_a_refine_v01_candidate.png")
    lighting = load_module("mine_material_lighting", "finalize-abandoned-mine-wall-kit-ai12.py")
    # Extract unlit material variation, not chosen/native pixel ratios: moving
    # inverse native relief shadows would stamp bright false fissures elsewhere.
    low = np.stack([lighting._masked_low_frequency(chosen[..., channel].astype(float)/255, chosen[..., 3])
                    for channel in range(3)], axis=-1)*255
    ratio = np.clip(chosen[..., :3].astype(float)/np.maximum(low, 8), .55, 1.7)
    ratio[authored[..., 3] < 220] = 1
    geo = json.loads((SOURCE / "geometry.json").read_text(encoding="utf-8"))
    wall = geo["wall"]
    dx, dy = 64*1024/wall["display"][0], 32*1024/wall["display"][1]
    slope = dy/dx
    foot = float(np.flatnonzero(authored[:, 512, 3] > 200)[-1])
    camera = wall["camera"]
    delta = np.array(camera["position"])-np.array(camera["target"])
    elevation = math.atan2(delta[2], np.linalg.norm(delta[:2]))
    height = wall["modelCore"][2]*math.cos(elevation)*1024/camera["orthoScale"]
    top_y = foot-height
    left_center = 360.0
    n = 512
    v, u = np.mgrid[0:n, 0:n]/(n-1)
    sx = left_center+(u-.5)*dx
    sy = foot+slope*(sx-512)-v*height
    face = periodic(sample(ratio, sx, sy))
    tu, tv = u-1.09, v-1.09
    crown = periodic(sample(ratio, 512+dx*(tu-tv), top_y+dy*(tu+tv)), vertical=True)
    np.savez_compressed(OUT / "accepted-rock-periodic-ratios.npz", face=face, crown=crown)
    Image.fromarray(np.uint8(np.clip(face*.5, 0, 1)*255)).save(OUT / "rock-face-ratio-preview.png")
    y, x = np.mgrid[0:1024, 0:1024]
    mirrored_x = np.minimum(x, 1024-x)
    fu = ((mirrored_x-left_center)/dx+.5) % 1
    fz = np.clip((foot-slope*np.abs(x-512)-y)/height, 0, 1)
    cu = ((x-512)/(2*dx)+(y-top_y)/(2*dy)+1.09) % 1
    cv = (-(x-512)/(2*dx)+(y-top_y)/(2*dy)+1.09) % 1
    top_mask = (y <= top_y-slope*np.abs(x-512))[..., None]
    collar = np.asarray(Image.fromarray(authored[..., 3]).filter(ImageFilter.MinFilter(9)), dtype=float)/255
    for index, key in enumerate("abc"):
        field = np.where(top_mask,
                         sample(tile_variant(crown, index, True), cu*(n-1), cv*(n-1)),
                         sample(tile_variant(face, index), fu*(n-1), fz*(n-1)))
        field = 1+(field-1)*collar[..., None]
        base = read_image(SOURCE / f"wall_{key}.png")
        if key != "a":
            mask = read_image(OUT / f"wall_{key}_component_mask.png")
            component = np.max(mask[..., :2], axis=2).astype(float)/255
            field = field*(1-component[..., None])+component[..., None]
        rgb = np.uint8(np.clip(np.rint(base[..., :3]*field), 0, 255))
        image = Image.fromarray(np.dstack((rgb, base[..., 3])), "RGBA")
        image.save(OUT / f"wall_{key}_stone_base.png")
        image.save(OUT / f"wall_{key}.png")
    geo["runtimeInstalled"] = False
    geo["wall"]["runtimeInstalled"] = False
    geo["wall"]["materialMapping"] = "accepted Dev48 variant01; runtime-pitch periodic material ratios; shared boundaries, interior-only B/C variation"
    write_json(OUT / "geometry.json", geo)
    write_json(OUT / "stone-source.json", {
        "selected": "../_mine_wall_a_dev_refine_20260830/wall_a_refine_v01_candidate.png",
        "approval": "同意，然后继续", "geometrySource": "../_mine_wall_pbr_kit_v2_20260830/geometry.json",
        "method": "2D unlit Dev material variation in runtime-pitch coordinates over native shading; not new 3D modeling",
        "periodSourcePixels": [dx, dy], "tileSize": [n, n], "edgeBlendFraction": .14,
        "variantInteriorBlend": .25, "silhouette": "original per-variant alpha, unchanged",
        "components": "Blender-rendered masks preserve original modeled ore/wood/iron",
        "limitation": "Finite A/B/C and modeled relief remain recognizable; no runtime acceptance claimed",
    })


def green_input(source, destination):
    rgba = Image.open(source).convert("RGBA")
    green = Image.new("RGBA", rgba.size, (0, 255, 0, 255))
    green.alpha_composite(rgba)
    green.convert("RGB").save(destination)


def depth_input(source, destination):
    data = np.asarray(Image.open(source))
    if data.dtype.itemsize > 1:
        data = np.rint(data.astype(float)/257)
    Image.fromarray(np.uint8(data), "L").save(destination)


def prepare_refinement():
    common = "Clean semi-realistic strategy-game PBR, calm broad material fields, low saturation, restrained wear, soft neutral upper-left light. Preserve the exact supplied composition, components and depth silhouette. Flat pure green background, absolutely no cast shadow of any kind outside the object. "
    descriptions = {
        "supports": "Refine only the existing seasoned oak support beams and their small matte dark iron bands. Subdued lengthwise wood grain, sparse worn fibers and small functional iron wear. Preserve all beam positions, thicknesses, joints and the existing dark-grey rock mass. Keep the rock's mineral layout unchanged.",
        "gate": "One independent lifting mine gate with exactly nine vertical seasoned oak timbers, existing rails, dark iron fittings and bottom spikes. Keep all existing gaps, fastener positions, board widths and unequal projected heights exactly as in the source. Subdued lengthwise oak grain, sparse worn fibers, matte dark iron and restrained oxidation. Preserve the existing muted wood palette and clear repeated slat structure.",
    }
    for key in descriptions:
        folder = OUT / key
        folder.mkdir(exist_ok=True)
        if any(folder.glob("*_raw.png")):
            raise SystemExit("Keep existing refinement provenance; use generate or finalize.")
        source = OUT / "wall_c_stone_base.png" if key == "supports" else SOURCE / "gate_frames/gate_00.png"
        depth = SOURCE / "wall_c_body_depth.png" if key == "supports" else SOURCE / "gate_depth/gate_00.png"
        green_input(source, folder / "init_green.png")
        depth_input(depth, folder / "depth_control.png")
        (folder / "prompt.txt").write_text(common+descriptions[key]+"\n", encoding="utf-8")
        size = Image.open(source).size
        write_json(folder / "request.json", {
            "asset": key, "model": "flux2-dev-depth", "stage": "refine", "steps": 48,
            "denoise": .30, "controlStrength": .75, "cfg": 3.5, "sampler": "euler", "scheduler": "simple",
            "size": list(size), "seeds": [122083060, 122083061] if key == "supports" else [122083070, 122083071],
            "initImage": "init_green.png", "controlImage": "depth_control.png", "prompt": "prompt.txt",
            "source": str(source.relative_to(HERE)), "depthSource": str(depth.relative_to(HERE)),
            "destination": "192.168.3.142:8188", "approval": "pending explicit authorization for new C-wall and gate payloads",
            "runtimeInstalled": False,
        })


def generate():
    for key in ("supports", "gate"):
        folder = OUT / key
        request = json.loads((folder / "request.json").read_text(encoding="utf-8"))
        for index, seed in enumerate(request["seeds"], 1):
            raw = folder / f"{key}_v{index:02d}_raw.png"
            if raw.exists():
                continue
            command = [sys.executable, str(HERE/"comfyui-gen.py"), "--host", "192.168.3.142",
                       "--model", request["model"], "--steps", "48", "--cfg", "3.5", "--sampler", "euler",
                       "--scheduler", "simple", "--size", "x".join(map(str, request["size"])),
                       "--seed", str(seed), "--control-image", str(folder/"depth_control.png"), "--strength", "0.75",
                       "--init-image", str(folder/"init_green.png"), "--denoise", "0.30",
                       "--prompt-file", str(folder/"prompt.txt"), "--out", str(raw),
                       "--prefix", f"mine_final_{key}_{index}", "--timeout", "1800"]
            metadata = {**request, "seed": seed, "raw": raw.name, "command": command, "status": "submitted"}
            write_json(folder/f"{key}_v{index:02d}_generation.json", metadata)
            subprocess.run(command, check=True)
            metadata["status"] = "generated; pending material review"
            write_json(folder/f"{key}_v{index:02d}_generation.json", metadata)


def preview():
    """Assemble the finished rock family with the unchanged native wood gate."""
    renderer = load_module("mine_final_preview", "compose-mine-wall-pbr-kit-v2.py")
    old_manifest = json.loads((OUT/"manifest.json").read_text(encoding="utf-8")) if (OUT/"manifest.json").exists() else {}
    geometry = json.loads((OUT/"geometry.json").read_text(encoding="utf-8"))
    wall_geo, gate_geo = geometry["wall"], geometry["gate"]
    sprites = {key: Image.open(OUT/f"wall_{key}.png").convert("RGBA") for key in "abc"}
    frame_dir = OUT/"gate_frames"
    frame_dir.mkdir(exist_ok=True)
    for i in range(16):
        shutil.copyfile(SOURCE/f"gate_frames/gate_{i:02d}.png", frame_dir/f"gate_{i:02d}.png")
    shutil.copyfile(SOURCE/"abandoned_mine_gate.png", OUT/"abandoned_mine_gate.png")
    frames = [Image.open(frame_dir/f"gate_{i:02d}.png").convert("RGBA") for i in range(16)]
    for key, sprite in sprites.items():
        sprite.getchannel("A").save(OUT/f"wall_{key}_alpha.png")
    write_json(OUT/"material-summary.json", renderer.luminance_summary(sprites))
    contact = Image.new("RGBA", (1500, 1090), (27, 32, 36, 255))
    renderer.label(contact, (30, 20), "矿洞墙 · 已选Dev岩面共用到A/B/C", 30)
    renderer.label(contact, (30, 66), "原模型与Alpha不变；木撑、矿脉和门暂留原生PBR，新增远程精修待授权。", 19)
    for i, key in enumerate("abc"):
        contact.alpha_composite(sprites[key].resize((450, 450), Image.Resampling.LANCZOS), (25+i*500, 110))
        renderer.label(contact, (40+i*500, 565), ("A 岩面", "B 原矿脉", "C 原木撑")[i], 24)
    for i, number in enumerate((0, 7, 15)):
        renderer.label(contact, (30+i*500, 610), ("原门：关闭", "原门帧7：原画布上缘裁剪", "原门帧15：游戏中隐藏")[i], 18)
        contact.alpha_composite(frames[number].resize((430, 430), Image.Resampling.LANCZOS), (25+i*500, 646))
    contact.save(OUT/"wall-gate-contact.png")
    seams = Image.new("RGBA", (1800, 1810), (24, 29, 33, 255))
    renderer.label(seams, (30, 22), "Dev岩面 · 双轴混排、转角与原门衔接（离线素材）", 29)
    for flip in (False, True):
        cells = [(0, i) if flip else (i, 0) for i in range(10)]
        renderer.paint(seams, renderer.assembly.mixed_jobs(cells, (1640 if flip else 160, 315), sprites, wall_geo))
    renderer.label(seams, (35, 666), "共享转角", 23)
    renderer.paint(seams, renderer.assembly.mixed_jobs([(i, 0) for i in range(5)]+[(0, i) for i in range(5)], (410, 882), sprites, wall_geo))
    cells = [(i, 0) for i in range(5)]+[(i, 4) for i in range(5)]+[(0, i) for i in range(5)]+[(4, i) for i in range(5)]
    renderer.label(seams, (935, 666), "四角不重复叠块", 23)
    renderer.paint(seams, renderer.assembly.mixed_jobs(cells, (1280, 900), sprites, wall_geo))
    for flip in (False, True):
        renderer.label(seams, (35+900*flip, 1240), "原门 · 六层裁片与端片退层", 23)
        renderer.doorway(seams, (1590 if flip else 200, 1460), sprites, frames[0], wall_geo, gate_geo, flip)
    renderer.label(seams, (30, 1760), "固定步长±64,+32；有限三款仍有规律重复。不是游戏截图，不能替代实机遮挡与碰撞验收。", 18)
    seams.save(OUT/"wall-gate-seams.png")
    animation, duration = [], []
    sequence = [(0, False, 600)]+[(i, False, 30 if i in (0, 15) else 60) for i in range(16)]
    sequence += [(15, True, 650)]+[(i, False, 30 if i in (0, 15) else 60) for i in range(15, -1, -1)]
    for index, hidden, ms in sequence:
        canvas = Image.new("RGBA", (1340, 640), (24, 29, 33, 255))
        renderer.label(canvas, (24, 18), "新岩面 + 原门 · 原16帧/900ms升降（离线呈现）", 23)
        for flip in (False, True):
            renderer.doorway(canvas, (1195 if flip else 145, 305), sprites, frames[index], wall_geo, gate_geo, flip, hidden)
        renderer.label(canvas, (24, 602), "保留原裁片位置、端片退层和完全开启隐藏；木铁Dev精修尚未执行。", 18)
        animation.append(canvas.convert("RGB"))
        duration.append(ms)
    animation[0].save(OUT/"wall-gate-animation.gif", save_all=True, append_images=animation[1:], duration=duration, loop=0, disposal=2)
    manifest = {
        "stage": "accepted Dev rock family prepared; wood/gate remote refinement blocked pending payload approval",
        "runtimeInstalled": False, "approvedRockSource": "../_mine_wall_a_dev_refine_20260830/wall_a_refine_v01_candidate.png",
        "approval": "同意，然后继续", "model": "../_mine_wall_pbr_kit_v2_20260830/mine_wall_and_gate_pbr_v2.blend",
        "geometry": "geometry.json", "stoneMapping": "stone-source.json", "componentMasks": "component-mask-source.json",
        "materialSummary": "material-summary.json", "walls": {key: f"wall_{key}.png" for key in "abc"},
        "gate": {"sheet": "abandoned_mine_gate.png", "source": "../_mine_wall_pbr_kit_v2_20260830/abandoned_mine_gate.png", "unchangedNativePBR": True, "frameSize": [640, 640], "frames": 16},
        "pending": "supports and gate Dev48 requests prepared but never executed; auto-review rejected new payload transmission",
        "previews": ["wall-gate-contact.png", "wall-gate-seams.png", "wall-gate-animation.gif"],
        "knownLimits": ["Finite three-variant material and modeled relief repeat", "Original gate raised-frame clipping and hideWhenOpen retained", "Offline rendering is not runtime acceptance"],
        "tests": "未运行测试或运行时验证，按约定由用户测试。",
    }
    if old_manifest.get("runtimeInstalled"):
        manifest["lastInstallation"] = {key: old_manifest[key] for key in ("installed", "acceptedOn", "installer")}
    elif old_manifest.get("lastInstallation"):
        manifest["lastInstallation"] = old_manifest["lastInstallation"]
    write_json(OUT/"manifest.json", manifest)
    print("Prepared rock-family and native-gate previews:", OUT, flush=True)


def install():
    root = HERE.parents[1]
    successor = HERE/"_mine_visual_finish_v3_20260830/dev-candidate/installation.json"
    if successor.exists():
        raise SystemExit("Historical v2 installer retired; current installation: " + str(successor))
    manifest_path = OUT/"manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    mapping = {**{f"abandoned_mine_wall_block_{key}": f"wall_{key}.png" for key in "abc"}, "abandoned_mine_gate": "abandoned_mine_gate.png"}
    payloads = {key: (OUT/name).read_bytes() for key, name in mapping.items()}
    # Preserve a local pre-install record; do not touch unrelated assets.
    backup = OUT/"before_install"
    backup.mkdir(exist_ok=True)
    installed = {}
    for key, payload in payloads.items():
        target = root/f"assets/terrain/{key}.png"
        if not (backup/target.name).exists():
            shutil.copyfile(target, backup/target.name)
        target.write_bytes(payload)
        installed[key] = {"path": target.relative_to(root).as_posix(), "source": mapping[key], "sha256": hashlib.sha256(payload).hexdigest(), "nativeGateUnchanged": key == "abandoned_mine_gate"}
    manifest.update({"stage": "accepted Dev A/B/C rock family installed; native wood/iron and gate unchanged, remote refinement pending", "runtimeInstalled": True, "installed": installed, "installer": "tools/ai-gen/mine-dev-finish-kit.py install", "acceptedOn": "2026-08-30"})
    write_json(manifest_path, manifest)
    geometry = json.loads((OUT/"geometry.json").read_text(encoding="utf-8"))
    geometry["runtimeInstalled"] = geometry["wall"]["runtimeInstalled"] = True
    write_json(OUT/"geometry.json", geometry)
    source_manifest_path = SOURCE/"manifest.json"
    source_manifest = json.loads(source_manifest_path.read_text(encoding="utf-8"))
    source_manifest.update({"runtimeInstalled": False, "stage": "historical v2 source; rock materials superseded, native wood/gate retained by successor", "supersededBy": manifest_path.relative_to(root).as_posix()})
    write_json(source_manifest_path, source_manifest)
    source_geometry = json.loads((SOURCE/"geometry.json").read_text(encoding="utf-8"))
    source_geometry["runtimeInstalled"] = source_geometry["wall"]["runtimeInstalled"] = False
    write_json(SOURCE/"geometry.json", source_geometry)
    floor_path = HERE/"_abandoned_mine_20260828/manifest.json"
    floor = json.loads(floor_path.read_text(encoding="utf-8"))
    floor["modeledWallKit"] = manifest_path.relative_to(root).as_posix()
    write_json(floor_path, floor)
    print("Installed A/B/C rock material; native gate bytes retained.", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("stage", choices=("stone", "prepare", "generate", "preview", "install"))
    args = parser.parse_args()
    {"stone": prepare_stone, "prepare": prepare_refinement, "generate": generate, "preview": preview, "install": install}[args.stage]()
