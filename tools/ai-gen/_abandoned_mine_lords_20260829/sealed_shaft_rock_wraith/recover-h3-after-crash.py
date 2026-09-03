#!/usr/bin/env python3
"""Recover known MiniMax H3 outputs whose local polling client was interrupted."""

from __future__ import annotations

import datetime
import hashlib
import importlib.util
import json
import subprocess
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path


ROOT = Path(__file__).resolve().parent
TOOLS = ROOT.parents[1]
GENERATOR_PATH = TOOLS / "minimax-h3-gen.py"
REFERENCE = ROOT / "references" / "mother-v04.png"
VIDEO_DIR = ROOT / "videos"
HOST = "192.168.3.142"
PORT = 8188

JOBS = {
    "crystalArmSmash": {
        "promptId": "39209dae-f59b-472f-a22e-468a5ab10c7d",
        "prompt": ROOT / "prompts" / "crystal-arm-smash-minimax-h3-v01.txt",
        "output": VIDEO_DIR / "crystal-arm-smash-minimax-h3-v01.mp4",
        "seed": 2026082923,
        "actionMode": "recover",
    },
    "borequake": {
        "promptId": "39a4fe34-4d4c-4a00-9e03-b90ef091b7cf",
        "prompt": ROOT / "prompts" / "borequake-minimax-h3-v01.txt",
        "output": VIDEO_DIR / "borequake-minimax-h3-v01.mp4",
        "seed": 2026082924,
        "actionMode": "recover",
    },
    "dying": {
        "promptId": "2da3d2bc-2664-46de-8466-632eb2cb1792",
        "prompt": ROOT / "prompts" / "dying-minimax-h3-v01.txt",
        "output": VIDEO_DIR / "dying-minimax-h3-v01.mp4",
        "seed": 2026082926,
        "actionMode": "one-way",
    },
}


def load_generator():
    spec = importlib.util.spec_from_file_location("minimax_h3_gen", GENERATOR_PATH)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Cannot load {GENERATOR_PATH}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def sha_text(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def wait_for_entry(generator, prompt_id: str, deadline: float) -> dict:
    while time.time() < deadline:
        history = generator.api(HOST, PORT, f"/history/{prompt_id}")
        entry = history.get(prompt_id)
        if not entry:
            time.sleep(5)
            continue
        status = entry.get("status", {})
        if status.get("status_str") == "error":
            raise RuntimeError(json.dumps(status, ensure_ascii=False, indent=2))
        if status.get("completed"):
            return entry
        time.sleep(5)
    raise TimeoutError(f"Timed out waiting for {prompt_id}")


def download(entry: dict, output: Path) -> None:
    items = entry.get("outputs", {}).get("14", {}).get("videos", [])
    if not items:
        items = entry.get("outputs", {}).get("14", {}).get("images", [])
    if not items:
        raise RuntimeError("Completed history entry has no node-14 video output")
    item = items[0]
    query = urllib.parse.urlencode({
        "filename": item["filename"],
        "subfolder": item.get("subfolder", ""),
        "type": item.get("type", "output"),
    })
    output.parent.mkdir(parents=True, exist_ok=True)
    with urllib.request.urlopen(f"http://{HOST}:{PORT}/view?{query}", timeout=300) as response:
        output.write_bytes(response.read())


def build_contact(output: Path) -> Path:
    contact = output.with_name(output.stem + "_contact.png")
    subprocess.run([
        sys.executable,
        str(TOOLS / "video-contact-sheet.py"),
        "--video", str(output),
        "--out", str(contact),
        "--count", "24",
        "--cols", "6",
        "--thumb", "256x144",
    ], check=True)
    return contact


def write_provenance(generator, name: str, job: dict, entry: dict, contact: Path) -> None:
    authored = job["prompt"].read_text(encoding="utf-8").strip()
    effective = generator.inject_background(authored, generator.name_for_hex("FFFFFF"), "FFFFFF")
    expected_final = generator.format_h3_prompt(
        effective,
        "i2v_firstframe",
        job["actionMode"],
        "visual-only",
        0,
        0,
        "character-asset",
        5.17,
        True,
        False,
    )
    remote_final = entry["prompt"][2]["5"]["inputs"]["prompt"]
    if expected_final != remote_final:
        raise RuntimeError(f"Recovered remote prompt does not match local contract for {name}")
    output = job["output"]
    provenance = {
        "provenanceVersion": 1,
        "provider": "minimax-h3-local",
        "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        "output": generator.source_record(str(output)),
        "promptId": job["promptId"],
        "candidate": 1,
        "candidateCount": 1,
        "visualProfile": "character-asset",
        "seed": job["seed"],
        "mode": "i2v_firstframe",
        "actionMode": job["actionMode"],
        "audioMode": "visual-only",
        "promptFormat": "h3",
        "authoredPrompt": authored,
        "effectivePrompt": effective,
        "finalPrompt": remote_final,
        "authoredPromptSha256": sha_text(authored),
        "effectivePromptSha256": sha_text(effective),
        "finalPromptSha256": sha_text(remote_final),
        "parameters": {
            "width": 1024,
            "height": 576,
            "duration": 5.17,
            "frames": 124,
            "steps": 20,
            "sampler": "res_multistep",
            "scheduler": "simple",
            "refImageSize": "max",
        },
        "models": {
            "unet": generator.UNET,
            "clip": generator.CLIP,
            "videoVae": generator.VAE_VIDEO,
            "audioVae": generator.VAE_AUDIO,
        },
        "inputs": {
            "promptFile": generator.source_record(str(job["prompt"])),
            "firstFrame": generator.source_record(str(REFERENCE)),
            "lastFrame": None,
            "referenceImages": [],
            "referenceVideos": [],
        },
        "contactSheet": generator.source_record(str(contact)),
        "elapsedSeconds": None,
        "recovery": {
            "reason": "local polling client interrupted after remote queue submission",
            "historyVerified": True,
        },
    }
    (Path(str(output) + ".json")).write_text(
        json.dumps(provenance, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def main() -> None:
    generator = load_generator()
    deadline = time.time() + 3600
    for name, job in JOBS.items():
        output = job["output"]
        if output.is_file() and Path(str(output) + ".json").is_file():
            print(f"[recover] {name}: already complete", flush=True)
            continue
        print(f"[recover] {name}: waiting for {job['promptId']}", flush=True)
        entry = wait_for_entry(generator, job["promptId"], deadline)
        download(entry, output)
        contact = build_contact(output)
        write_provenance(generator, name, job, entry, contact)
        print(f"[recover] {name}: saved {output}", flush=True)


if __name__ == "__main__":
    main()
