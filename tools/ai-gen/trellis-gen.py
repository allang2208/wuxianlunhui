#!/usr/bin/env python3
"""TRELLIS.2 图生 3D 客户端：上传图片 → 提交原始管线 workflow → 轮询 → 下载 GLB。

用法：
    python trellis-gen.py --image ref.png --out out.glb --prefix my_asset [--seed 1] [--faces 20000]

链路（5080 Blackwell 安全版，绕开 CuMesh）：
LoadImage → LoadModel(sdpa/low_vram) → ImageCond → Sparse → Shape →
DecodeLatents → VoxelToMesh（CPU marching cubes，兼容补丁官方方案）→
MeshWithVoxelToTrimesh(90°) → SimplifyTrimesh → MeshTexturing(1024/2048) → ExportMesh(glb)
"""

import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.parse
import uuid

HOST = "http://192.168.3.142:8188"


def http_json(url, data=None, timeout=120):
    if data is not None and not isinstance(data, bytes):
        data = json.dumps(data).encode("utf-8")
    req = urllib.request.Request(url, data=data)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def upload_image(path):
    boundary = uuid.uuid4().hex
    name = os.path.basename(path)
    with open(path, "rb") as fh:
        blob = fh.read()

    def field(k, v):
        return (f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n').encode("utf-8")

    body = b""
    body += (f'--{boundary}\r\nContent-Disposition: form-data; name="image"; filename="{name}"\r\n'
             "Content-Type: image/png\r\n\r\n").encode("utf-8") + blob + b"\r\n"
    body += field("type", "input")
    body += field("overwrite", "true")
    body += f"--{boundary}--\r\n".encode("utf-8")
    req = urllib.request.Request(
        HOST + "/upload/image",
        data=body,
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(req, timeout=120) as resp:
        return json.loads(resp.read().decode("utf-8")), name


def build_workflow(image_name, seed, faces, prefix):
    return {
        "1": {"class_type": "LoadImage", "inputs": {"image": image_name}},
        "2": {
            "class_type": "Trellis2LoadModel",
            "inputs": {
                "modelname": "microsoft/TRELLIS.2-4B",
                "backend": "sdpa",
                "device": "cuda",
                "low_vram": True,
                "keep_models_loaded": True,
                "conv_backend": "flex_gemm",
                "sparse_backend": "xformers",
                "use_reconviagen": False,
            },
        },
        "8": {
            "class_type": "Trellis2ImageCondGenerator",
            "inputs": {
                "pipeline": ["2", 0],
                "image": ["1", 0],
                "max_views": 4,
            },
        },
        "9": {
            "class_type": "Trellis2SparseGenerator",
            "inputs": {
                "pipeline": ["2", 0],
                "image_cond": ["8", 0],
                "seed": seed,
                "sparse_structure_steps": 12,
                "sparse_structure_guidance_strength": 7.5,
                "sparse_structure_guidance_rescale": 0.01,
                "sparse_structure_rescale_t": 5.0,
                "sparse_structure_sampler": "heun",
                "sparse_structure_resolution": 128,
                "sparse_structure_guidance_interval_start": 0.1,
                "sparse_structure_guidance_interval_end": 1.0,
                "fill_holes": False,
                "hole_iterations": 0,
                "verbose": False,
                "dino_lock": 0.0,
                "dino_substeps": 8,
                "hole_fill_algorithm": "flood_fill",
                "dino_foundation_cap": 1.0,
                "keep_only_shell": False,
            },
        },
        "10": {
            "class_type": "Trellis2ShapeGenerator",
            "inputs": {
                "pipeline": ["9", 2],
                "image_cond": ["8", 0],
                "coords": ["9", 0],
                "resolution": "512",
                "shape_steps": 12,
                "shape_guidance_strength": 7.5,
                "shape_guidance_rescale": 0.01,
                "shape_rescale_t": 3.0,
                "shape_sampler": "heun",
                "shape_guidance_interval_start": 0.1,
                "shape_guidance_interval_end": 1.0,
                "verbose": False,
                "dino_lock": 0.0,
                "dino_substeps": 9,
                "dino_foundation_cap": 1.0,
                "image": ["1", 0],
            },
        },
        "11": {
            "class_type": "Trellis2DecodeLatents",
            "inputs": {
                "pipeline": ["10", 2],
                "shape_slat": ["10", 0],
                "resolution": 128,
                "use_tiled_decoder": True,
            },
        },
        "12": {
            "class_type": "Trellis2VoxelToMesh",
            "inputs": {
                "mesh": ["11", 0],
                "target_height_mm": 0.0,
                "sigma": 1.5,
                "coarse_downsample": 4.0,
                "taubin_iterations": 20,
            },
        },
        "13": {
            "class_type": "Trellis2MeshWithVoxelToTrimesh",
            "inputs": {"mesh": ["12", 0], "reorient_vertices": "90 degrees"},
        },
        "14": {
            "class_type": "Trellis2SimplifyTrimesh",
            "inputs": {"trimesh": ["13", 0], "target_face_num": faces, "method": "Meshlib"},
        },
        "15": {
            "class_type": "Trellis2MeshTexturing",
            "inputs": {
                "pipeline": ["2", 0],
                "image": ["1", 0],
                "trimesh": ["14", 0],
                "seed": seed,
                "texture_steps": 12,
                "texture_guidance_strength": 5.0,
                "texture_guidance_rescale": 0.05,
                "texture_rescale_t": 3.0,
                "resolution": "1024",
                "texture_size": 2048,
                "texture_alpha_mode": "OPAQUE",
                "double_side_material": False,
                "texture_guidance_interval_start": 0.0,
                "texture_guidance_interval_end": 0.9,
                "max_views": 4,
                "bake_on_vertices": False,
                "use_custom_normals": False,
                "mesh_cluster_threshold_cone_half_angle_rad": 60.0,
                "sampler": "euler",
                "inpainting": "telea",
                "verbose": False,
                "dino_lock": 0.0,
                "dino_substeps": 4,
                "dino_foundation_cap": 1.0,
            },
        },
        "16": {
            "class_type": "Trellis2ExportMesh",
            "inputs": {"trimesh": ["15", 0], "filename_prefix": prefix, "file_format": "glb"},
        },
    }


def find_output_glb(history):
    outputs = history.get("outputs", {})
    for node_id, out in outputs.items():
        for key, val in out.items():
            if isinstance(val, list):
                for item in val:
                    if isinstance(item, dict) and "filename" in item and item.get("type") == "output":
                        return item
            elif isinstance(val, dict) and "filename" in val:
                return val
    return None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--image", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--prefix", default="trellis_asset")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--faces", type=int, default=20000)
    args = ap.parse_args()

    print(f"[trellis] upload {args.image}", flush=True)
    upload, image_name = upload_image(args.image)
    print(f"[trellis] uploaded as {image_name}: {upload}", flush=True)

    workflow = build_workflow(image_name, args.seed, args.faces, args.prefix)
    print(f"[trellis] submit prompt (seed={args.seed}, faces={args.faces})", flush=True)
    resp = http_json(HOST + "/prompt", {"prompt": workflow, "client_id": "trellis-cli"})
    prompt_id = resp["prompt_id"]
    print(f"[trellis] prompt_id={prompt_id}", flush=True)

    deadline = time.time() + 900
    while time.time() < deadline:
        time.sleep(5)
        hist = http_json(HOST + f"/history/{prompt_id}", timeout=60)
        if prompt_id not in hist:
            continue
        entry = hist[prompt_id]
        status = entry.get("status", {})
        if status.get("completed"):
            item = find_output_glb(entry)
            if not item:
                print("[trellis] ERROR: completed but no GLB output", file=sys.stderr)
                print(json.dumps(
                    {"status": entry.get("status"), "outputs": entry.get("outputs")},
                    ensure_ascii=False, indent=2)[:4000], file=sys.stderr)
                sys.exit(1)
            url = f"{HOST}/view?filename={urllib.parse.quote(item['filename'])}&subfolder={urllib.parse.quote(item.get('subfolder', ''))}&type=output"
            print(f"[trellis] download {url}", flush=True)
            os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
            with urllib.request.urlopen(url, timeout=180) as resp2:
                open(args.out, "wb").write(resp2.read())
            print(f"[trellis] saved {args.out}", flush=True)
            return
        if status.get("status_str") in ("error", "error_processing"):
            msgs = entry.get("status", {}).get("messages", [])
            print(f"[trellis] ERROR: {json.dumps(msgs, ensure_ascii=False)[:2000]}", file=sys.stderr)
            sys.exit(1)
        print(f"[trellis] ... {int(time.time() - deadline + 900)}s elapsed", flush=True)

    print("[trellis] TIMEOUT after 900s", file=sys.stderr)
    sys.exit(1)


if __name__ == "__main__":
    main()
