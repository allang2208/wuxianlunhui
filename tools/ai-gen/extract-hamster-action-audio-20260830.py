#!/usr/bin/env python3
"""Reproduce explicit per-action crops; --review produces audio/visual evidence.

No game tests, runtime, or asset acceptance automation. Review uses local AST
scores plus source contact frames; imports are authored in the JSON manifest.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re

import av
import numpy as np
from scipy.signal import resample_poly
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[2]
HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location("extractor", HERE / "extract-hamster-soldier-audio.py")
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


def output_for(clip):
    name = re.sub(r"(?<!^)(?=[A-Z])", "_", clip["key"]).lower()
    variant = f"_{clip['variant']}" if clip.get("variant") else ""
    folder = HERE / "_hamster_audio_staged_20260830" if clip.get("staged") else ROOT / "assets/sounds/friendly"
    return folder / f"{clip['unit']}_{name}{variant}_video.mp3"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--review", type=Path)
    parser.add_argument("--model", type=Path)
    parser.add_argument("--extract", action="store_true")
    args = parser.parse_args()
    clips = json.loads((HERE / "hamster-action-audio-20260830.json").read_text(encoding="utf-8"))["clips"]
    results = []
    if args.review:
        import torch
        from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
        torch.set_num_threads(4)
        device = "cuda" if torch.cuda.is_available() else "cpu"
        feature = AutoFeatureExtractor.from_pretrained(args.model, local_files_only=True)
        model = AutoModelForAudioClassification.from_pretrained(args.model, local_files_only=True).to(device).eval()
        args.review.mkdir(parents=True, exist_ok=True)
    for index, clip in enumerate(clips):
        source = HERE / clip["source"]
        output = output_for(clip)
        if not source.exists() and clip.get("sourceAvailable") is False:
            if args.extract and not output.exists():
                raise FileNotFoundError(
                    f"archived output is also missing for unavailable source: {output}"
                )
            start, end = clip["window"]
            result = {
                **clip,
                "output": output.relative_to(ROOT).as_posix(),
                "duration": round(end - start, 4),
            }
            results.append(result)
            print(json.dumps(result, ensure_ascii=True), flush=True)
            continue
        audio = extractor.decode_stereo(source)
        start, end = clip["window"]
        crop = extractor.prepare_clip(audio, start, end)
        result = {**clip, "output": output.relative_to(ROOT).as_posix(), "duration": round(crop.shape[1]/44100,4)}
        if args.extract:
            extractor.encode_mp3(output, crop)
        if args.review:
            mono = resample_poly(crop.mean(axis=0),160,441).astype(np.float32)
            inputs = feature(mono, sampling_rate=16000, return_tensors="pt").to(device)
            with torch.inference_mode():
                scores = model(**inputs).logits.sigmoid()[0].cpu().numpy()
            result["top"] = [[model.config.id2label[int(i)],round(float(scores[i]),4)] for i in np.argsort(scores)[-6:][::-1]]
            result["music"] = round(float(scores[next(i for i,s in model.config.id2label.items() if s == "Music")]),4)
            canvas = Image.new("RGB",(1000,180),(255,255,255))
            draw = ImageDraw.Draw(canvas)
            draw.text((4,2),f"{index} {clip['unit']} {clip['key']} {start}..{end}s music={result['music']} {result['top'][:2]}", fill="black")
            times = np.linspace(max(0,start-.15),min(audio.shape[1]/44100,end+.15),5)
            container = av.open(str(source))
            cursor = 0
            for frame in container.decode(video=0):
                seconds = float(frame.time)
                if cursor < len(times) and seconds >= times[cursor]:
                    pic = frame.to_image()
                    pic.thumbnail((196,137))
                    canvas.paste(pic,(cursor*200,25))
                    draw.text((cursor*200+3,163),f"{seconds:.3f}s",fill="black")
                    cursor += 1
                if cursor == len(times):
                    break
            container.close()
            canvas.save(args.review / f"clip-{index:02}.jpg")
        results.append(result)
        print(json.dumps(result,ensure_ascii=True),flush=True)
    if args.review:
        (args.review/"crops.json").write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding="utf-8")
        for page in range((len(clips)+5)//6):
            canvas = Image.new("RGB",(1000,1080),"white")
            for row in range(6):
                i = page*6+row
                if i < len(clips):
                    canvas.paste(Image.open(args.review/f"clip-{i:02}.jpg"),(0,row*180))
            canvas.save(args.review/f"page-{page}.jpg")
    if args.extract:
        (HERE/"hamster-action-audio-extracted-20260830.json").write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding="utf-8")


if __name__ == "__main__":
    main()
