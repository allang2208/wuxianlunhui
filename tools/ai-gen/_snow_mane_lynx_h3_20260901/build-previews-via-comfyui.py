#!/usr/bin/env python3
"""Use existing ComfyUI video nodes to build a contact sheet and preview GIF."""

from __future__ import annotations

import importlib.util
import time
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import Image, ImageSequence


HOST = "192.168.3.142"
PORT = 8188
ROOT = Path(__file__).resolve().parent
VIDEO = ROOT / "videos" / "snow-mane-lynx-running-h3-v01.mp4"
CONTACT = ROOT / "videos" / "snow-mane-lynx-running-h3-v01_contact.png"
WEBP = ROOT / "videos" / "snow-mane-lynx-running-h3-v01_preview.webp"
GIF = ROOT / "videos" / "snow-mane-lynx-running-h3-v01_preview.gif"
TOOLS = ROOT.parent


def load_h3_helpers():
    path = TOOLS / "minimax-h3-gen.py"
    spec = importlib.util.spec_from_file_location("minimax_h3_gen", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"cannot load {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def download(item: dict, output: Path) -> None:
    query = urllib.parse.urlencode({
        "filename": item["filename"],
        "subfolder": item.get("subfolder", ""),
        "type": item.get("type", "output"),
    })
    output.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"http://{HOST}:{PORT}/view?{query}", timeout=300) as response:
        output.write_bytes(response.read())


def output_item(entry: dict, node: str) -> dict:
    output = entry["outputs"][node]
    for key in ("images", "videos"):
        items = output.get(key, [])
        if items:
            return items[0]
    raise RuntimeError(f"node {node} returned no downloadable output: {output}")


def distributed_gif_durations(frame_count: int, total_ms: int) -> list[int]:
    total_units = round(total_ms / 10)
    base, extra = divmod(total_units, frame_count)
    durations = []
    accumulator = 0
    for _ in range(frame_count):
        accumulator += extra
        units = base
        if accumulator >= frame_count:
            units += 1
            accumulator -= frame_count
        durations.append(units * 10)
    return durations


def webp_to_gif() -> int:
    source = Image.open(WEBP)
    frames = []
    for frame in ImageSequence.Iterator(source):
        rgba = frame.convert("RGBA")
        background = Image.new("RGBA", rgba.size, "white")
        background.alpha_composite(rgba)
        frames.append(background.convert("RGB").quantize(colors=256))
    if not frames:
        raise RuntimeError("animated WebP contains no frames")
    durations = distributed_gif_durations(len(frames), 5170)
    frames[0].save(
        GIF,
        save_all=True,
        append_images=frames[1:],
        duration=durations,
        loop=0,
        disposal=2,
        optimize=False,
    )
    return len(frames)


def main() -> None:
    if not VIDEO.is_file():
        raise SystemExit(f"missing source video: {VIDEO}")
    h3 = load_h3_helpers()
    uploaded = h3.upload_image(HOST, PORT, str(VIDEO))
    subfolder = uploaded.get("subfolder", "")
    remote_name = f"{subfolder}/{uploaded['name']}" if subfolder else uploaded["name"]
    print(f"[lynx-preview] uploaded {remote_name}", flush=True)

    workflow = {
        "1": {"class_type": "LoadVideo", "inputs": {"file": remote_name}},
        "2": {"class_type": "VideoFrameSample", "inputs": {
            "video": ["1", 0], "num_frames": 24, "strategy": "uniform", "seed": 0,
        }},
        "3": {"class_type": "GetVideoComponents", "inputs": {"video": ["2", 0]}},
        "4": {"class_type": "ImageGrid", "inputs": {
            "images": ["3", 0], "columns": 6, "cell_width": 256,
            "cell_height": 144, "padding": 0,
        }},
        "5": {"class_type": "SaveImage", "inputs": {
            "images": ["4", 0],
            "filename_prefix": "video-review/snow_mane_lynx_running_h3_v01_contact",
        }},
        "6": {"class_type": "GetVideoComponents", "inputs": {"video": ["1", 0]}},
        "7": {"class_type": "ImageScale", "inputs": {
            "image": ["6", 0], "upscale_method": "lanczos", "width": 512,
            "height": 288, "crop": "disabled",
        }},
        "8": {"class_type": "SaveAnimatedWEBP", "inputs": {
            "images": ["7", 0],
            "filename_prefix": "video-review/snow_mane_lynx_running_h3_v01_preview",
            "fps": 24.0, "lossless": False, "quality": 82, "method": "default",
        }},
    }

    queued = h3.api(HOST, PORT, "/prompt", "POST", {"prompt": workflow})
    if queued.get("node_errors"):
        raise RuntimeError(f"ComfyUI node errors: {queued['node_errors']}")
    prompt_id = queued["prompt_id"]
    deadline = time.time() + 600
    entry = None
    while time.time() < deadline:
        time.sleep(2)
        history = h3.api(HOST, PORT, f"/history/{prompt_id}")
        entry = history.get(prompt_id)
        if not entry:
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError(f"ComfyUI preview workflow failed: {status}")
        if status.get("completed"):
            break
    else:
        raise TimeoutError("timed out waiting for preview workflow")

    download(output_item(entry, "5"), CONTACT)
    download(output_item(entry, "8"), WEBP)
    frame_count = webp_to_gif()
    print(
        f"[lynx-preview] contact={CONTACT.name} webp={WEBP.name} "
        f"gif={GIF.name} frames={frame_count}",
        flush=True,
    )


if __name__ == "__main__":
    main()
