#!/usr/bin/env python3
"""Offline per-video audio evidence. Does not modify runtime assets/configs.

Uses existing ComfyUI PyAV/scipy/torch/transformers and a locally downloaded
MIT AST AudioSet model. No private media is uploaded. Scores are evidence,
not a guarantee of music absence; trim/import decisions remain explicit.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import re

import numpy as np
from scipy.signal import resample_poly, stft

ROOT = Path(__file__).resolve().parents[2]
spec = importlib.util.spec_from_file_location("extractor", Path(__file__).with_name("extract-hamster-soldier-audio.py"))
extractor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(extractor)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    args = parser.parse_args()
    import torch
    from transformers import AutoFeatureExtractor, AutoModelForAudioClassification
    torch.set_num_threads(4)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    feature = AutoFeatureExtractor.from_pretrained(args.model, local_files_only=True)
    model = AutoModelForAudioClassification.from_pretrained(args.model, local_files_only=True).to(device).eval()
    print(f"AST device={device}", flush=True)
    labels = [model.config.id2label[i] for i in range(model.config.num_labels)]
    music_ids = [i for i, label in enumerate(labels) if re.search(r"music|singing|choir|chant|orchestra|guitar|piano|violin", label, re.I)]

    def classify(mono):
        inputs = feature(mono, sampling_rate=16000, return_tensors="pt").to(device)
        with torch.inference_mode():
            scores = model(**inputs).logits.sigmoid()[0].cpu().numpy()
        top = np.argsort(scores)[-8:][::-1]
        music = max(music_ids, key=lambda i: scores[i])
        return {"top": [[labels[i], round(float(scores[i]), 4)] for i in top],
                "musicMax": round(float(scores[music]), 4), "musicLabel": labels[music]}

    args.output.mkdir(parents=True, exist_ok=True)
    rows = []
    for directory in sorted((ROOT / "tools/ai-gen").glob("_hamster_*")):
        if any(x in directory.name for x in ("residents", "delivery", "boiler", "missing_mothers", "engineering_mothers")):
            continue
        for video in sorted(directory.rglob("*.mp4")):
            rel = video.relative_to(ROOT).as_posix()
            row = {"source": rel}
            if re.search(r"(^|[-_])(idle|dying|die|death)([-_.]|$)", video.name):
                row["disposition"] = "excluded_idle_or_death_by_user"
                rows.append(row)
                continue
            try:
                audio = extractor.decode_stereo(video)
            except StopIteration:
                row["disposition"] = "no_audio_stream"
                rows.append(row)
                print(rel, "NO AUDIO", flush=True)
                continue
            mono = resample_poly(audio.mean(axis=0), 160, 441).astype(np.float32)
            row["duration"] = round(len(mono) / 16000, 4)
            row["rms100ms"] = [round(float(20*np.log10(np.sqrt(np.mean(x*x))+1e-12)), 1)
                                 for x in np.array_split(mono, max(1, round(len(mono)/1600))) ]
            row["full"] = classify(mono)
            row["windows"] = []
            for start in np.arange(0, len(mono)/16000 - 0.3, 1.0):
                end = min(start+2.0, len(mono)/16000)
                row["windows"].append({"start": float(start), "end": round(end,4),
                                       **classify(mono[int(start*16000):int(end*16000)])})
            row["disposition"] = "analyzed_pending_manual_decision"
            rows.append(row)
            # One spectrum per source, labelled by path, for reviewing persistent
            # harmonic beds separately from short broadband action transients.
            from PIL import Image, ImageDraw
            _, _, z = stft(mono, fs=16000, nperseg=512, noverlap=384)
            db = np.clip((20*np.log10(np.abs(z)+1e-9)+90)/80, 0, 1)
            rgb = np.stack([db, db**2, np.sqrt(db)], axis=2)
            spectrum = Image.fromarray((rgb[::-1]*255).astype(np.uint8)).resize((1000,256))
            canvas = Image.new("RGB", (1000,300), "white")
            canvas.paste(spectrum,(0,44))
            ImageDraw.Draw(canvas).text((5,5),rel.replace("tools/ai-gen/", ""),fill="black")
            ImageDraw.Draw(canvas).text((5,24),f"0..{row['duration']:.2f}s; 0..8kHz; {row['full']['top'][:3]}",fill="black")
            spectrum_name = rel.replace("/", "__").replace(".mp4", ".png")
            canvas.save(args.output / spectrum_name)
            row["spectrogram"] = spectrum_name
            (args.output / "analysis.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False),encoding="utf-8")
            print(rel, json.dumps(row["full"],ensure_ascii=True),flush=True)
    (args.output / "analysis.json").write_text(json.dumps(rows, indent=2, ensure_ascii=False),encoding="utf-8")
    print(f"DONE {len(rows)} videos",flush=True)


if __name__ == "__main__":
    main()
