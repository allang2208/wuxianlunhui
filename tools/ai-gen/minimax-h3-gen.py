#!/usr/bin/env python3
"""Remote MiniMax H3 text-to-video generation via the RTX 5080 ComfyUI (192.168.3.142).

Implements the official ComfyUI MiniMax H3 T2V workflow:
UNETLoader(fl2va) + CLIPLoader(qwen3vl minimax) + video/audio VAELoader ->
MiniMaxH3ImageToVideo -> BasicGuider + RandomNoise + KSamplerSelect(res_multistep)
+ BasicScheduler(simple) -> SamplerCustomAdvanced -> VAEDecode + VAEDecodeAudio
-> CreateVideo(24fps) -> SaveVideo(mp4). Video and native stereo audio are
generated together in one pass.

With --ref-image and/or --ref-video the workflow switches to the reference mode
(MiniMaxH3ReferenceToVideo, ref2va). Images use <Picture i>; videos use <Video k>.
--ref-size max gives best image identity fidelity.

Usage:
    python minimax-h3-gen.py --prompt "..." --duration 5 --out video.mp4
    python minimax-h3-gen.py --prompt-file prompt.txt --size 1024x576 --seed 42
    python minimax-h3-gen.py --ref-image idle.png --prompt "the character in <Picture 1> walks ..." --out video.mp4
"""

import argparse
import datetime
import hashlib
import json
import math
import os
import random
import re
import subprocess
import sys
import time
import urllib.request

TOOLS_DIR = os.path.dirname(os.path.abspath(__file__))
if TOOLS_DIR not in sys.path:
    sys.path.insert(0, TOOLS_DIR)
from pick_bg_color import inject_background, name_for_hex, pick_bg_color_from_image  # noqa: E402

UNET = "minimax_h3_fl2va_pruned_int8_convrot.safetensors"
REF2VA_UNET = "minimax_h3_ref2va_pruned_int8_convrot.safetensors"
CLIP = "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors"
VAE_VIDEO = "minimax_h3_video_vae_fp16.safetensors"
VAE_AUDIO = "minimax_h3_audio_vae_fp32.safetensors"
SCRATCH_DIR = r"Y:\工作\无尽轮回\scratch"
MIN_RELIABLE_FRAMES = 124


def format_h3_prompt(prompt, mode, action_mode, audio_mode="prompt",
                     ref_image_count=0, ref_video_count=0,
                     visual_profile="general", duration=5.17,
                     has_first_frame=False, has_last_frame=False):
    """Wrap an authored prompt in MiniMax H3's documented field structure."""
    timeline = {
        "loop": ("Begin in the supplied opening state, perform the continuous cyclic action through "
                 "clear readable phases, then naturally return to the exact opening pose and screen "
                 "position without freezing or slowing at the seam."),
        "recover": ("Begin in the supplied opening state, build through anticipation into one clear peak "
                    "action, then recover naturally to a stable ready pose. Do not repeat the action."),
        "one-way": ("Begin in the supplied opening state, progress through one clear irreversible action, "
                    "and settle in the authored final state without returning to the opening pose."),
        "free": "Follow the authored temporal order exactly and keep every transition visually readable.",
    }[action_mode]
    if audio_mode == "visual-only":
        soundscape = "N/A"
        music = "N/A"
    else:
        soundscape = ("Follow explicit diegetic sound instructions in the authored description; "
                      "otherwise use unobtrusive natural sound.")
        music = "None unless explicitly requested in the authored description."
    visual_fidelity = {
        "general": ("Preserve fine material texture, coherent edges, consistent lighting, and stable "
                    "small-scale detail across the full shot."),
        "character-asset": ("Preserve fine material texture, a clean silhouette, stable rigid-equipment "
                            "topology, consistent facial markings, and temporally coherent fur or cloth "
                            "detail across every frame."),
    }[visual_profile]

    if mode == "ref2va":
        definitions = []
        retention = []
        subjects = []
        for index in range(ref_image_count):
            subject = f"<Subject {index + 1}>"
            picture = f"<Picture {index + 1}>"
            subjects.append(subject)
            definitions.append(
                f"{subject} is the target subject defined by {picture}, including identity, proportions, "
                "materials, colors, and equipment."
            )
            retention.extend([
                f"{subject} (appears in [Shot 1]): fully_preserved - identity, proportions, materials, "
                "colors, and rigid equipment remain continuous.",
                f"{picture} (applies to {subject}): fully_preserved - the declared visual traits remain "
                "recognizable throughout the target video.",
            ])
        for index in range(ref_video_count):
            video = f"<Video {index + 1}>"
            definitions.append(
                f"{video} is the motion-timing and trajectory reference only; its subject, scene, and style "
                "do not define the target video."
            )
            retention.append(
                f"{video} (motion timing and trajectory): weak_reference - only the action rhythm and path "
                "guide [Shot 1]; its subject, scene, and style are not copied."
            )
        subject_summary = ", ".join(subjects) if subjects else "the authored target subject"
        video_summary = (" while using " + ", ".join(
            f"<Video {index + 1}>" for index in range(ref_video_count)
        ) + " only for motion") if ref_video_count else ""
        return "\n".join([
            "subject_definitions:",
            *(definitions or ["The authored description defines the target subject and scene."]),
            "",
            "summary:",
            f"[reference generation] The target video preserves {subject_summary}{video_summary}.",
            "",
            "retention_analysis:",
            *(retention or ["The authored target subject (appears in [Shot 1]): fully_preserved - its declared visual identity remains continuous."]),
            "",
            "detailed_description:",
            f"[Shot 1] {prompt} {visual_fidelity} Temporal action path: {timeline}",
            "",
            "overall_soundscape:",
            soundscape,
            "",
            "non_diegetic_music:",
            music,
        ])

    if mode == "i2v_firstframe":
        if has_first_frame and has_last_frame:
            alignment = ("How the reference pictures align with the target video — Picture 1 (from Shot 1) "
                         "aligns with the 0.00-second mark of the target video; Picture 2 (from Shot 1) "
                         f"aligns with the {duration:.2f}-second mark of the target video.")
        elif has_first_frame:
            alignment = ("For the target video, at 0.00 seconds into the target video, <Picture 1> "
                         "(from [Shot 1]) is fully referenced.")
        else:
            alignment = (f"For the target video, at {duration:.2f} seconds into the target video, "
                         "<Picture 1> (from [Shot 1]) is fully referenced.")
    else:
        alignment = None
    sections = [
        f"integrated_multimodal_description: [Shot 1] {prompt} {visual_fidelity} "
        f"Temporal action path: {timeline}",
        "",
        "overall_soundscape:",
        soundscape,
        "",
        "non_diegetic_music:",
        music,
    ]
    if alignment:
        sections = [alignment, "", *sections]
    return "\n".join(sections)


def warn_prompt_risks(prompt):
    negative_count = len(re.findall(
        r"\b(?:no|not|never|without|forbid(?:den)?|must not|do not|cannot)\b",
        prompt,
        flags=re.IGNORECASE,
    ))
    if len(prompt) > 2200 or negative_count > 14:
        print(f"[minimax-h3] warning: prompt is constraint-heavy "
              f"({len(prompt)} chars, {negative_count} negative clauses); "
              "prefer positive observable motion and one temporal path", flush=True)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def source_record(path):
    absolute = os.path.abspath(path)
    return {
        "path": absolute,
        "bytes": os.path.getsize(absolute),
        "sha256": sha256_file(absolute),
    }


def candidate_output_path(base_path, index, count):
    if count == 1:
        return base_path
    stem, ext = os.path.splitext(base_path)
    return f"{stem}_c{index + 1:02d}{ext or '.mp4'}"


def build_workflow(prompt, seed, width, height, length, steps, scheduler, sampler, prefix,
                   ref_images=None, ref_videos=None, ref_image_size="max",
                   first_frame=None, last_frame=None):
    ref_images = ref_images or []
    ref_videos = ref_videos or []
    has_references = bool(ref_images or ref_videos)
    unet_name = REF2VA_UNET if has_references else UNET
    wf = {
        "1": {"class_type": "UNETLoader", "inputs": {"unet_name": unet_name, "weight_dtype": "default"}},
        "2": {"class_type": "CLIPLoader", "inputs": {"clip_name": CLIP, "type": "minimax"}},
        "3": {"class_type": "VAELoader", "inputs": {"vae_name": VAE_VIDEO}},
        "4": {"class_type": "VAELoader", "inputs": {"vae_name": VAE_AUDIO}},
    }
    if first_frame or last_frame:
        if has_references:
            raise ValueError("reference inputs cannot be combined with --first-frame/--last-frame")
        if first_frame:
            wf["15"] = {"class_type": "LoadImage", "inputs": {"image": first_frame}}
        if last_frame:
            wf["16"] = {"class_type": "LoadImage", "inputs": {"image": last_frame}}
        i2v_inputs = {
            "clip": ["2", 0], "vae": ["3", 0],
            "prompt": prompt, "width": width, "height": height, "length": length,
        }
        if first_frame:
            i2v_inputs["first_frame"] = ["15", 0]
        if last_frame:
            i2v_inputs["last_frame"] = ["16", 0]
        wf["5"] = {"class_type": "MiniMaxH3ImageToVideo", "inputs": i2v_inputs}
    elif has_references:
        for i, fname in enumerate(ref_images):
            wf[str(15 + i)] = {"class_type": "LoadImage", "inputs": {"image": fname}}
        next_node = 15 + len(ref_images)
        video_outputs = {}
        for i, fname in enumerate(ref_videos):
            load_node = str(next_node + i * 2)
            parts_node = str(next_node + i * 2 + 1)
            wf[load_node] = {"class_type": "LoadVideo", "inputs": {"file": fname}}
            wf[parts_node] = {"class_type": "GetVideoComponents", "inputs": {"video": [load_node, 0]}}
            video_outputs[f"ref_video_{i}"] = [parts_node, 0]
        wf["5"] = {
            "class_type": "MiniMaxH3ReferenceToVideo",
            "inputs": {
                "clip": ["2", 0], "vae": ["3", 0], "audio_vae": ["4", 0],
                "prompt": prompt, "width": width, "height": height, "length": length,
                "ref_image_size": ref_image_size,
                "ref_images": {f"ref_image_{i}": [str(15 + i), 0] for i in range(len(ref_images))},
                "ref_videos": video_outputs,
            },
        }
    else:
        wf["5"] = {
            "class_type": "MiniMaxH3ImageToVideo",
            "inputs": {
                "clip": ["2", 0], "vae": ["3", 0],
                "prompt": prompt, "width": width, "height": height, "length": length,
            },
        }
    wf.update({
        "6": {"class_type": "BasicGuider", "inputs": {"model": ["1", 0], "conditioning": ["5", 0]}},
        "7": {"class_type": "RandomNoise", "inputs": {"noise_seed": seed}},
        "8": {"class_type": "KSamplerSelect", "inputs": {"sampler_name": sampler}},
        "9": {"class_type": "BasicScheduler", "inputs": {
            "model": ["1", 0], "scheduler": scheduler, "steps": steps, "denoise": 1.0}},
        "10": {"class_type": "SamplerCustomAdvanced", "inputs": {
            "noise": ["7", 0], "guider": ["6", 0], "sampler": ["8", 0],
            "sigmas": ["9", 0], "latent_image": ["5", 1]}},
        "11": {"class_type": "VAEDecode", "inputs": {"samples": ["10", 0], "vae": ["3", 0]}},
        "12": {"class_type": "VAEDecodeAudio", "inputs": {"samples": ["10", 0], "vae": ["4", 0]}},
        "13": {"class_type": "CreateVideo", "inputs": {
            "images": ["11", 0], "fps": 24, "audio": ["12", 0], "bit_depth": 8}},
        "14": {"class_type": "SaveVideo", "inputs": {
            "video": ["13", 0], "filename_prefix": prefix, "format": "mp4", "codec": "h264"}},
    })
    return wf


def duration_to_frames(duration):
    """Frame count at 24fps snapped up to the model's 17k+5 grid."""
    n = max(5, round(duration * 24))
    return n + (5 - n % 17) % 17


def upload_image(host, port, path, timeout=120):
    """Upload a local image to the ComfyUI input folder (multipart /upload/image)."""
    import mimetypes
    boundary = "----codexboundary%08x" % random.randint(0, 0xFFFFFFFF)
    filename = os.path.basename(path)
    content_type = mimetypes.guess_type(filename)[0] or "application/octet-stream"
    with open(path, "rb") as fh:
        blob = fh.read()
    body = bytearray()
    body += f"--{boundary}\r\nContent-Disposition: form-data; name=\"image\"; filename=\"{filename}\"\r\nContent-Type: {content_type}\r\n\r\n".encode()
    body += blob
    body += f"\r\n--{boundary}\r\nContent-Disposition: form-data; name=\"type\"\r\n\r\ninput\r\n--{boundary}--\r\n".encode()
    req = urllib.request.Request(
        f"http://{host}:{port}/upload/image", data=bytes(body), method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def api(host, port, path, method="GET", payload=None, timeout=60):
    url = f"http://{host}:{port}{path}"
    data = json.dumps(payload).encode("utf-8") if payload is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def main():
    ap = argparse.ArgumentParser(description="Remote MiniMax H3 text-to-video (RTX 5080).")
    ap.add_argument("--prompt", help="video prompt (scene + shots + audio)")
    ap.add_argument("--prompt-file", help="read prompt from a text file")
    ap.add_argument("--duration", type=float, default=5.17,
                    help="duration in seconds (default 5.17s/124 frames, inside H3's reliable range)")
    ap.add_argument("--size", default="1344x768", help="widthxheight, multiples of 32 (H3 native 1344x768)")
    ap.add_argument("--steps", type=int, default=20)
    ap.add_argument("--scheduler", default="simple")
    ap.add_argument("--sampler", default="res_multistep")
    ap.add_argument("--seed", type=int, default=None)
    ap.add_argument("--candidates", type=int, default=1,
                    help="generate sequential candidates while reusing uploaded references")
    ap.add_argument("--seed-step", type=int, default=1,
                    help="seed increment between candidates")
    ap.add_argument("--out", default=None, help="output mp4 path")
    ap.add_argument("--prefix", default="video/minimax_h3")
    ap.add_argument("--ref-image", action="append", default=None,
                    help="local reference image for ref2va (repeatable; <Picture 1..N> in prompt)")
    ap.add_argument("--ref-video", action="append", default=None,
                    help="local 2-15s reference video for ref2va (repeatable; <Video 1..N> in prompt)")
    ap.add_argument("--ref-size", choices=["match", "max"], default="max",
                    help="reference sizing: match=faster, max=best identity fidelity")
    ap.add_argument("--first-frame", default=None, help="local image used as the exact first video frame (H3 I2V)")
    ap.add_argument("--last-frame", default=None, help="local image used as the exact last video frame (H3 I2V)")
    ap.add_argument("--action-mode", choices=["loop", "recover", "one-way", "free"], default="free",
                    help="temporal contract used by the structured H3 prompt")
    ap.add_argument("--prompt-format", choices=["h3", "raw"], default="raw",
                    help="h3 wraps the prompt in MiniMax's documented fields; raw preserves legacy direct callers")
    ap.add_argument("--audio-mode", choices=["prompt", "visual-only"], default="prompt",
                    help="prompt follows authored sound instructions; visual-only prioritizes sprite motion")
    ap.add_argument("--visual-profile", choices=["general", "character-asset"], default="general",
                    help="compact detail-stability clause; character-asset also locks equipment/fur/cloth")
    ap.add_argument("--contact-count", type=int, default=24,
                    help="evenly sampled frames in the automatic identity/motion contact sheet")
    ap.add_argument("--no-contact-sheet", action="store_true",
                    help="skip the automatic contact sheet (not recommended for asset candidates)")
    ap.add_argument("--host", default="192.168.3.142")
    ap.add_argument("--port", type=int, default=8188)
    ap.add_argument("--timeout", type=int, default=2400, help="max seconds to wait for generation")
    ap.add_argument("--bg-color", default=None,
                    help="背景色 #RRGGBB 或 auto（用 --first-frame 参考图自动选主体没有的颜色，"
                         "强制注入纯色底+无阴影条款；缺省不注入=沿用提示词原背景描述）")
    args = ap.parse_args()

    if args.candidates < 1:
        ap.error("--candidates must be at least 1")
    if args.seed_step < 1:
        ap.error("--seed-step must be at least 1")
    if args.contact_count < 1:
        ap.error("--contact-count must be at least 1")

    if args.prompt_file:
        with open(args.prompt_file, "r", encoding="utf-8") as fh:
            prompt = fh.read().strip()
    else:
        prompt = args.prompt
    if not prompt:
        ap.error("provide --prompt or --prompt-file")
    authored_prompt = prompt
    if args.bg_color:
        if args.bg_color.lower() == "auto":
            ref = args.first_frame or (args.ref_image[0] if args.ref_image else None)
            if not ref:
                print("[minimax-h3] --bg-color auto 但无参考图，跳过注入", flush=True)
            else:
                pick = pick_bg_color_from_image(ref)
                prompt = inject_background(prompt, pick["name"], pick["hex"])
                print(f"[minimax-h3] bg-color auto: {pick['name']} #{pick['hex']} "
                      f"({pick['reason']})", flush=True)
        else:
            h = args.bg_color.lstrip("#")
            name = name_for_hex(h)
            prompt = inject_background(prompt, name, h)
            print(f"[minimax-h3] bg-color: {name} #{h}", flush=True)
    try:
        width, height = (int(x) for x in args.size.lower().split("x"))
    except ValueError:
        ap.error("--size must be like 1344x768")

    length = duration_to_frames(args.duration)
    if length < MIN_RELIABLE_FRAMES:
        print(f"[minimax-h3] warning: {length} frames is below the reliable 124-frame/5.17s "
              "asset range; use short clips only for deliberate VFX experiments", flush=True)
    ref_images = []
    if args.ref_image:
        for p in args.ref_image:
            up = upload_image(args.host, args.port, p)
            sub = up.get("subfolder", "")
            ref_images.append(f"{sub}/{up['name']}" if sub else up["name"])
        print(f"[minimax-h3] uploaded {len(ref_images)} ref image(s): {ref_images} (ref_size={args.ref_size})", flush=True)
    ref_videos = []
    if args.ref_video:
        for p in args.ref_video:
            up = upload_image(args.host, args.port, p)
            sub = up.get("subfolder", "")
            ref_videos.append(f"{sub}/{up['name']}" if sub else up["name"])
        print(f"[minimax-h3] uploaded {len(ref_videos)} ref video(s): {ref_videos}", flush=True)
    first_frame = last_frame = None
    if args.first_frame:
        up = upload_image(args.host, args.port, args.first_frame)
        sub = up.get("subfolder", "")
        first_frame = f"{sub}/{up['name']}" if sub else up["name"]
        print(f"[minimax-h3] uploaded first frame: {first_frame}", flush=True)
    if args.last_frame:
        up = upload_image(args.host, args.port, args.last_frame)
        sub = up.get("subfolder", "")
        last_frame = f"{sub}/{up['name']}" if sub else up["name"]
        print(f"[minimax-h3] uploaded last frame: {last_frame}", flush=True)
    mode = "ref2va" if (ref_images or ref_videos) else ("i2v_firstframe" if (first_frame or last_frame) else "t2v")
    if args.action_mode == "loop" and mode == "i2v_firstframe" and not last_frame:
        ap.error("--action-mode loop with first-frame I2V requires --last-frame")
    final_prompt = (format_h3_prompt(prompt, mode, args.action_mode, args.audio_mode,
                                     len(ref_images), len(ref_videos), args.visual_profile,
                                     args.duration, bool(first_frame), bool(last_frame))
                    if args.prompt_format == "h3" else prompt)
    warn_prompt_risks(prompt)

    base_seed = args.seed if args.seed is not None else random.randint(0, 2**31 - 1)
    base_out = args.out or os.path.join(SCRATCH_DIR, f"minimax_h3_{base_seed}.mp4")
    prompt_source = source_record(args.prompt_file) if args.prompt_file else None
    input_sources = {
        "promptFile": prompt_source,
        "firstFrame": source_record(args.first_frame) if args.first_frame else None,
        "lastFrame": source_record(args.last_frame) if args.last_frame else None,
        "referenceImages": [source_record(path) for path in (args.ref_image or [])],
        "referenceVideos": [source_record(path) for path in (args.ref_video or [])],
    }

    for index in range(args.candidates):
        seed = base_seed + index * args.seed_step
        out_path = candidate_output_path(base_out, index, args.candidates)
        wf = build_workflow(final_prompt, seed, width, height, length, args.steps,
                            args.scheduler, args.sampler, args.prefix,
                            ref_images=ref_images, ref_videos=ref_videos,
                            ref_image_size=args.ref_size,
                            first_frame=first_frame, last_frame=last_frame)
        print(f"[minimax-h3] candidate {index + 1}/{args.candidates} "
              f"{args.host}:{args.port} mode={mode} action={args.action_mode} seed={seed} "
              f"{width}x{height} {args.duration}s -> {length} frames, {args.steps} steps "
              f"({args.sampler}/{args.scheduler})", flush=True)
        t0 = time.time()
        queued = api(args.host, args.port, "/prompt", "POST", {"prompt": wf})
        pid = queued["prompt_id"]
        if queued.get("node_errors"):
            print("Workflow errors:", json.dumps(queued["node_errors"], ensure_ascii=False, indent=2))
            sys.exit(1)

        deadline = time.time() + args.timeout
        video = None
        while time.time() < deadline:
            time.sleep(5)
            history = api(args.host, args.port, f"/history/{pid}")
            entry = history.get(pid)
            if not entry:
                continue
            if entry.get("status", {}).get("status_str") == "error":
                print("Generation error:", json.dumps(entry["status"], ensure_ascii=False, indent=2))
                sys.exit(1)
            if entry.get("status", {}).get("completed"):
                video = entry["outputs"].get("14", {}).get("videos", [])
                if not video:
                    video = entry["outputs"].get("14", {}).get("images", [])
                break

        if not video:
            print("Timed out waiting for generation", file=sys.stderr)
            sys.exit(1)

        item = video[0]
        view = (f"/view?filename={item['filename']}&subfolder={item.get('subfolder', '')}"
                f"&type={item.get('type', 'output')}")
        out_dir = os.path.dirname(os.path.abspath(out_path))
        os.makedirs(out_dir, exist_ok=True)
        with urllib.request.urlopen(f"http://{args.host}:{args.port}{view}", timeout=300) as resp:
            data = resp.read()
        with open(out_path, "wb") as fh:
            fh.write(data)

        elapsed = time.time() - t0
        contact_record = None
        if not args.no_contact_sheet:
            contact_path = os.path.splitext(out_path)[0] + "_contact.png"
            contact_cmd = [
                sys.executable, os.path.join(TOOLS_DIR, "video-contact-sheet.py"),
                "--video", out_path, "--out", contact_path,
                "--count", str(args.contact_count), "--cols", "6", "--thumb", "256x144",
            ]
            try:
                subprocess.run(contact_cmd, check=True)
                contact_record = source_record(contact_path)
            except (OSError, subprocess.CalledProcessError) as exc:
                print(f"[minimax-h3] warning: contact sheet failed for {out_path}: {exc}", flush=True)
        provenance = {
            "provenanceVersion": 1,
            "provider": "minimax-h3-local",
            "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "output": source_record(out_path),
            "promptId": pid,
            "candidate": index + 1,
            "candidateCount": args.candidates,
            "visualProfile": args.visual_profile,
            "seed": seed,
            "mode": mode,
            "actionMode": args.action_mode,
            "audioMode": args.audio_mode,
            "promptFormat": args.prompt_format,
            "authoredPrompt": authored_prompt,
            "effectivePrompt": prompt,
            "finalPrompt": final_prompt,
            "authoredPromptSha256": hashlib.sha256(authored_prompt.encode("utf-8")).hexdigest(),
            "effectivePromptSha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
            "finalPromptSha256": hashlib.sha256(final_prompt.encode("utf-8")).hexdigest(),
            "parameters": {
                "width": width, "height": height, "duration": args.duration,
                "frames": length, "steps": args.steps, "sampler": args.sampler,
                "scheduler": args.scheduler, "refImageSize": args.ref_size,
            },
            "models": {
                "unet": REF2VA_UNET if mode == "ref2va" else UNET,
                "clip": CLIP, "videoVae": VAE_VIDEO, "audioVae": VAE_AUDIO,
            },
            "inputs": input_sources,
            "contactSheet": contact_record,
            "elapsedSeconds": round(elapsed, 3),
        }
        with open(out_path + ".json", "w", encoding="utf-8") as fh:
            json.dump(provenance, fh, ensure_ascii=False, indent=2)
            fh.write("\n")
        print(f"Saved {out_path} ({len(data)/1024/1024:.1f} MB) in {elapsed:.0f}s; "
              f"provenance={out_path}.json")


if __name__ == "__main__":
    main()
